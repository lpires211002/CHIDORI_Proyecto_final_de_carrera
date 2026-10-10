import {
  guardarCampos, leerCampos,
  guardarPacientes, leerPacientes,
  guardarConteos, leerConteos,
  pacientesPendientes, agregarPendiente, quitarPendiente, esLocal,
} from './patientsCache';

/**
 * Pacientes y campos configurables.
 *
 * El catálogo (`field_definitions`) define QUÉ se mide; los valores viajan en
 * JSONB (`patients.data` y `sessions.session_data`). Así se agregan o quitan
 * variables desde el panel de administración sin migrar la base.
 *
 * scope 'patient' → estable, se carga una vez (sexo, altura, año de nacimiento)
 * scope 'session' → cambia en cada medición (peso, temperatura, humedad, agua)
 */

/* ── Red ────────────────────────────────────────────────────────────── */

/**
 * Cuánto se espera a Supabase en las pantallas interactivas.
 *
 * Enlazado al Chidori no hay internet, y una consulta puede quedar colgada
 * hasta que el sistema operativo se rinda (decenas de segundos). Con un tope
 * corto la app cae al caché enseguida en vez de dejar al clínico mirando
 * "Cargando…".
 */
export const TIMEOUT_MS          = 5000;
export const TIMEOUT_PREFETCH_MS = 12000;

/**
 * Corre una consulta de Supabase con tope de tiempo.
 *
 * Corta el fetch con abortSignal y además rechaza la promesa al vencer el
 * tope: si el token de la sesión venció, supabase-js intenta renovarlo ANTES
 * de mandar la consulta, y esa renovación el abortSignal no la alcanza.
 */
export function conTimeout(consulta, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const q = typeof consulta?.abortSignal === 'function'
    ? consulta.abortSignal(ctrl.signal)
    : consulta;
  let timer;
  const tope = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error('Sin respuesta de la nube (¿sin internet?)'));
    }, ms);
  });
  return Promise.race([Promise.resolve(q), tope]).finally(() => clearTimeout(timer));
}

/* ── Catálogo de campos ─────────────────────────────────────────────── */

/**
 * `soloNube`: si falla la consulta, lanza en vez de devolver el caché. Lo usa
 * la descarga anticipada, que necesita saber si de verdad actualizó algo.
 */
export async function fetchFields(supabase, {
  includeInactive = false, timeoutMs = TIMEOUT_MS, soloNube = false,
} = {}) {
  let q = supabase.from('field_definitions').select('*').order('sort_order');
  if (!includeInactive) q = q.eq('active', true);

  try {
    const { data, error } = await conTimeout(q, timeoutMs);
    if (error) throw error;
    guardarCampos(data || []);
    return data || [];
  } catch (e) {
    // Enlazado al equipo no hay internet. El catálogo cambia poco: la última
    // copia sirve para armar los formularios sin conexión.
    const cache = soloNube ? null : leerCampos();
    if (!cache) throw e;
    const filas = cache.datos;
    return includeInactive ? filas : filas.filter((f) => f.active);
  }
}

export async function upsertField(supabase, field) {
  // Con id → UPDATE por clave primaria. Es lo que permite mover un campo de
  // ámbito (sesión ↔ paciente): un upsert por (scope,key) no encontraría el
  // registro con el ámbito nuevo e intentaría insertar reusando el id.
  if (field.id) {
    const { id, ...patch } = field;
    const { data, error } = await supabase
      .from('field_definitions')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('field_definitions')
    .insert(field)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteField(supabase, id) {
  const { error } = await supabase.from('field_definitions').delete().eq('id', id);
  if (error) throw error;
}

/* ── Pacientes ──────────────────────────────────────────────────────── */

/**
 * Lista de pacientes activos.
 *
 * Devuelve `{ filas, deCache, cache }` — no solo las filas — porque la
 * pantalla necesita poder avisar que está mostrando datos guardados y de qué
 * momento son. Se les suman los pacientes creados offline que todavía no
 * subieron.
 */
export async function fetchPatients(supabase, {
  search = '', timeoutMs = TIMEOUT_MS, soloNube = false,
} = {}) {
  const filtrar = (filas) => {
    const s = search.trim().toLowerCase();
    if (!s) return filas;
    return filas.filter((p) => [p.code, p.first_name, p.last_name]
      .filter(Boolean).join(' ').toLowerCase().includes(s));
  };

  const pendientes = pacientesPendientes();

  try {
    let q = supabase.from('patients').select('*').eq('active', true).order('code');
    const s = search.trim();
    if (s) q = q.or(`code.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%`);

    const { data, error } = await conTimeout(q, timeoutMs);
    if (error) throw error;

    // Solo se cachea la lista completa: una búsqueda filtrada pisaría el caché
    // con un subconjunto y offline parecería que faltan pacientes.
    if (!s) guardarPacientes(data || []);

    return { filas: [...(data || []), ...filtrar(pendientes)], deCache: false, cache: null };
  } catch (e) {
    if (soloNube) throw e;
    const cache = leerPacientes();
    if (!cache && pendientes.length === 0) throw e;
    const base = cache?.datos || [];
    return { filas: filtrar([...base, ...pendientes]), deCache: true, cache };
  }
}

/**
 * Lo último descargado más los pacientes creados offline, SIN tocar la red.
 * Es lo que permite abrir el selector al instante estando en la red del
 * Chidori. Null si en esta computadora nunca se descargó la lista.
 */
export function pacientesGuardados() {
  const cache = leerPacientes();
  const pendientes = pacientesPendientes();
  if (!cache && pendientes.length === 0) return null;
  return { filas: [...(cache?.datos || []), ...pendientes], cache };
}

/** Campos activos del último catálogo descargado, sin tocar la red. */
export function camposGuardados() {
  return (leerCampos()?.datos || []).filter((f) => f.active);
}

/**
 * Cuenta las sesiones de un paciente en la nube (para el "sesión N"). Sin
 * internet usa el último conteo descargado. No incluye las que esperan en la
 * cola local: eso lo suma `contarSesionesPaciente` (lib/sessionSync).
 */
export async function countSessions(supabase, patientId, { timeoutMs = TIMEOUT_MS } = {}) {
  if (!patientId || esLocal(patientId)) return 0;
  try {
    const { count, error } = await conTimeout(supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patientId), timeoutMs);
    if (error) throw error;
    return count || 0;
  } catch {
    return conteoGuardado(patientId);
  }
}

/** Último conteo descargado para ese paciente, sin tocar la red. */
export function conteoGuardado(patientId) {
  return leerConteos()?.mapa?.[patientId] ?? 0;
}

/**
 * Descarga todo lo necesario para elegir paciente sin internet: catálogo de
 * campos, pacientes activos y cuántas sesiones tiene cada uno.
 *
 * Se llama al abrir la app y cada tanto mientras hay internet
 * (components/usePatientsPrefetch.js). Así, cuando el clínico se pasa a la red
 * del Chidori, la lista ya está guardada y no hace falta volver al WiFi de
 * siempre para elegir paciente. Si no hay conexión lanza, y lo guardado antes
 * queda intacto.
 */
export async function prefetchPacientes(supabase) {
  const ms = TIMEOUT_PREFETCH_MS;
  const [campos, pacientes] = await Promise.all([
    fetchFields(supabase, { timeoutMs: ms, soloNube: true }),
    fetchPatients(supabase, { timeoutMs: ms, soloNube: true }),
  ]);

  // Sesiones por paciente · informativo: si falla, la lista ya quedó guardada.
  // Trae solo la columna patient_id (un dataset de tesis son decenas de filas;
  // Supabase corta en 1000 por defecto).
  try {
    const { data, error } = await conTimeout(
      supabase.from('sessions').select('patient_id').not('patient_id', 'is', null), ms);
    if (error) throw error;
    const mapa = {};
    (data || []).forEach(({ patient_id: id }) => { mapa[id] = (mapa[id] || 0) + 1; });
    guardarConteos(mapa);
  } catch { /* se conserva el conteo anterior */ }

  return { pacientes: pacientes.filas.length, campos: campos.length, at: Date.now() };
}

/**
 * Siguiente código libre con el formato P-001.
 * Se calcula sobre el máximo existente para no repetir aunque se borren filas.
 */
export async function nextPatientCode(supabase, prefix = 'P') {
  const siguiente = (codigos) => {
    let max = 0;
    codigos.forEach((c) => {
      const m = String(c || '').match(new RegExp(`^${prefix}-(\\d+)$`));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  };

  try {
    const { data, error } = await conTimeout(supabase
      .from('patients').select('code').like('code', `${prefix}-%`));
    if (error) throw error;
    // Los pendientes locales también ocupan número, o el próximo alta offline
    // reusaría un código y chocaría al subir.
    return siguiente([
      ...(data || []).map((r) => r.code),
      ...pacientesPendientes().map((p) => p.code),
    ]);
  } catch {
    // Offline: se calcula sobre el caché + los pendientes. Puede quedar corto
    // si otra máquina cargó pacientes mientras tanto, y por eso el alta valida
    // el duplicado contra el servidor al sincronizar.
    return siguiente([
      ...(leerPacientes()?.datos || []).map((p) => p.code),
      ...pacientesPendientes().map((p) => p.code),
    ]);
  }
}

/**
 * Alta de paciente · sube si hay internet, y si no queda pendiente.
 *
 * Sin conexión se le asigna un id `local:<uuid>` y se guarda en la cola. La
 * sesión se puede medir igual: al reconectar, `sincronizarPendientes` inserta
 * el paciente de verdad y reemplaza el id en las sesiones encoladas.
 */
export async function createPatient(supabase, { code, first_name, last_name, data = {}, notes = '' }) {
  const fila = { code, first_name, last_name, data, notes };
  try {
    // Con tope de tiempo: sin internet cae a pendiente en segundos. Si la nube
    // llegó a guardarlo pero la respuesta tardó, al sincronizar el código ya
    // existe y `sincronizarPendientes` reusa ese paciente: no se duplica.
    const { data: row, error } = await conTimeout(supabase
      .from('patients').insert(fila).select().single());
    if (error) throw error;
    return row;
  } catch (e) {
    // Un código duplicado tiene que fallar de verdad: si no, se crearían dos
    // pacientes con el mismo código y el dataset quedaría ambiguo.
    if (/duplicate|unique/i.test(String(e?.message || ''))) throw e;

    const local = {
      ...fila,
      id: `local:${crypto.randomUUID()}`,
      active: true,
      created_at: new Date().toISOString(),
      _pendiente: true,
    };
    agregarPendiente(local);
    return local;
  }
}

/**
 * Sube los pacientes creados sin internet y devuelve el mapa
 * `{ idLocal: idReal }`, para que la cola de sesiones pueda corregir su
 * `patient_id` antes de commitear.
 */
export async function sincronizarPendientes(supabase) {
  const mapa = {};
  for (const p of pacientesPendientes()) {
    // eslint-disable-next-line no-unused-vars
    const { id, _pendiente, created_at, ...fila } = p;
    try {
      const { data: row, error } = await supabase
        .from('patients').insert(fila).select().single();
      if (error) throw error;
      mapa[id] = row.id;
      quitarPendiente(id);
    } catch (e) {
      // Si el código ya existe (lo cargó otra máquina), se reusa ese paciente
      // en vez de dejar la sesión huérfana.
      const { data: existente } = await supabase
        .from('patients').select('id').eq('code', fila.code).maybeSingle();
      if (existente) { mapa[id] = existente.id; quitarPendiente(id); }
      else break;   // sin internet: se reintenta después
    }
  }
  return mapa;
}

export async function updatePatient(supabase, id, patch) {
  const { data, error } = await supabase
    .from('patients')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* ── Utilidades ─────────────────────────────────────────────────────── */

/** Nombre visible: "P-003 · Pérez, Ana" */
export function patientLabel(p) {
  if (!p) return '';
  const nom = [p.last_name, p.first_name].filter(Boolean).join(', ');
  return nom ? `${p.code} · ${nom}` : p.code;
}

/** Convierte los valores de un formulario al tipo declarado en el catálogo. */
export function coerceValues(fields, values) {
  const out = {};
  fields.forEach((f) => {
    const raw = values[f.key];
    if (raw === undefined || raw === null || raw === '') return;
    if (f.type === 'number') {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) out[f.key] = n;
    } else if (f.type === 'boolean') {
      out[f.key] = Boolean(raw);
    } else {
      out[f.key] = String(raw);
    }
  });
  return out;
}

/** Campos obligatorios sin completar (devuelve las etiquetas). */
export function missingRequired(fields, values) {
  return fields
    .filter((f) => f.required)
    .filter((f) => {
      const v = values[f.key];
      return v === undefined || v === null || String(v).trim() === '';
    })
    .map((f) => f.label);
}
