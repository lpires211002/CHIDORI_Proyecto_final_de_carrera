/**
 * Sesiones medidas offline (modo AP) → Supabase.
 *
 * La cola vive en IndexedDB (no en localStorage) para aguantar sesiones
 * largas de 4 h sin chocar el límite de ~5 MB. Se drena sola cuando vuelve
 * internet (ver components/usePendingSync.js). El CSV local sigue siendo el
 * respaldo durable independiente de todo esto.
 */

import { sincronizarPendientes } from './patients';
import { esLocal } from './patientsCache';

const DB_NAME = 'chidori';
const STORE   = 'pendingSessions';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'localId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function idbAll() {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  }));
}

function idbPut(item) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  }));
}

function idbDelete(localId) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(localId);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  }));
}

/** Encola una sesión medida offline para subirla más tarde. */
export async function queuePendingSession(payload) {
  const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await idbPut({ localId, queuedAt: Date.now(), ...payload });
  return localId;
}

/** Cuántas sesiones quedan por subir. */
export async function countPendingSessions() {
  try { return (await idbAll()).length; } catch { return 0; }
}

/**
 * Commit de UNA sesión a Supabase: sessions → measurements (en chunks) →
 * session_events. Lanza si algo falla (p.ej. sin internet). Reutilizado por
 * el guardado en vivo y por el re-sync de la cola.
 */
export async function commitSession(supabase, payload) {
  const { userId, patientPayload, stats, measurements, events } = payload;

  const sessionRow = {
    user_id:           userId,
    ...patientPayload,
    initial_impedance: stats.initialZ,
    final_impedance:   stats.finalZ,
    elapsed_time_str:  stats.elapsedStr,
    total_events:      stats.eventCount,
  };

  let { data: newSession, error: sErr } = await supabase
    .from('sessions').insert(sessionRow).select().single();

  // Fallback: si la base todavía no corrió el SQL del protocolo, esas columnas
  // no existen y el insert falla. Reintentamos sin ellas antes que perder la
  // sesión entera (las muestras son irrepetibles). Ver la guía de medición.
  const COLS_PROTOCOLO = ['notes', 'patient_id', 'session_data', 'session_number'];
  if (sErr && COLS_PROTOCOLO.some((c) => new RegExp(`\\b${c}\\b`, 'i').test(sErr.message || ''))) {
    const legacy = { ...sessionRow };
    COLS_PROTOCOLO.forEach((c) => delete legacy[c]);
    ({ data: newSession, error: sErr } = await supabase
      .from('sessions').insert(legacy).select().single());
  }
  if (sErr) throw sErr;

  const sId = newSession.id;

  const CHUNK = 500;
  for (let i = 0; i < measurements.length; i += CHUNK) {
    const slice = measurements.slice(i, i + CHUNK).map((m) => ({ ...m, session_id: sId }));
    const { error: mErr } = await supabase.from('measurements').insert(slice);
    if (mErr) throw mErr;
  }

  if (events && events.length > 0) {
    const evRows = events.map((e) => ({
      session_id:       sId,
      event_number:     e.id,
      elapsed_time:     e.time,
      impedance:        e.value,
      impedance_change: e.change,
      kind:             e.kind || 'mark',   // mark|disconnect|reconnect|gap|water|void
      amount_ml:        e.amount ?? null,    // ingesta / micción
    }));
    let { error: eErr } = await supabase.from('session_events').insert(evRows);

    // Fallback: si la columna `kind` todavía no existe en la tabla, reintentamos
    // sin ese campo. Preferimos guardar el evento (perdiendo el tipo) antes que
    // perder la sesión entera. Ver ALTER TABLE en COMO_MEDIR_CHIDORI.md.
    if (eErr && /(kind|amount_ml)/i.test(eErr.message || '')) {
      const legacy = evRows.map(({ kind, amount_ml, ...rest }) => rest);   // eslint-disable-line no-unused-vars
      ({ error: eErr } = await supabase.from('session_events').insert(legacy));
    }
    if (eErr) throw eErr;
  }

  return sId;
}

/**
 * Intenta subir TODAS las pendientes. Borra de la cola las que suben OK.
 * Si una falla (sin internet), corta y deja el resto para el próximo intento.
 * Devuelve { synced, remaining }.
 */
let flushing = false;

export async function flushPendingSessions(supabase) {
  if (!supabase) return { synced: 0, remaining: 0 };
  // Candado: evita que un flush automático y uno manual corran a la vez y
  // commiteen la misma sesión dos veces (duplicado).
  if (flushing) return { synced: 0, remaining: await countPendingSessions() };
  flushing = true;
  try {
    // Primero los pacientes creados offline: una sesión encolada puede apuntar
    // a un id `local:...` que todavía no existe en la base. Si se commiteara
    // así, el insert fallaría por la foreign key y la sesión quedaría trabada
    // para siempre en la cola.
    let mapaPacientes = {};
    try { mapaPacientes = await sincronizarPendientes(supabase); } catch { /* sin internet */ }

    let list;
    try { list = await idbAll(); } catch { return { synced: 0, remaining: 0 }; }

    let synced = 0;
    for (const item of list) {
      try {
        const pid = item.patientPayload?.patient_id;
        const arreglado = esLocal(pid)
          ? { ...item, patientPayload: { ...item.patientPayload, patient_id: mapaPacientes[pid] ?? null } }
          : item;

        // El paciente local todavía no subió: se deja la sesión para el
        // próximo intento en vez de guardarla sin atribuir.
        if (esLocal(pid) && !mapaPacientes[pid]) continue;

        await commitSession(supabase, arreglado);
        await idbDelete(item.localId);
        synced += 1;
      } catch {
        break; // probablemente no hay internet; reintentamos después
      }
    }
    let remaining = 0;
    try { remaining = (await idbAll()).length; } catch { remaining = 0; }
    return { synced, remaining };
  } finally {
    flushing = false;
  }
}
