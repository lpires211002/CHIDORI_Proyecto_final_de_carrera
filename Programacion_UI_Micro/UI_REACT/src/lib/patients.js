import {
  guardarCampos, leerCampos,
  guardarPacientes, leerPacientes,
  pacientesPendientes, agregarPendiente, quitarPendiente,
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

/* ── Catálogo de campos ─────────────────────────────────────────────── */

export async function fetchFields(supabase, { includeInactive = false } = {}) {
  let q = supabase.from('field_definitions').select('*').order('sort_order');
  if (!includeInactive) q = q.eq('active', true);

  try {
    const { data, error } = await q;
    if (error) throw error;
    guardarCampos(data || []);
    return data || [];
  } catch (e) {
    // Enlazado al equipo no hay internet. El catálogo cambia poco: la última
    // copia sirve para armar los formularios sin conexión.
    const cache = leerCampos();
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
export async function fetchPatients(supabase, { search = '' } = {}) {
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

    const { data, error } = await q;
    if (error) throw error;

    // Solo se cachea la lista completa: una búsqueda filtrada pisaría el caché
    // con un subconjunto y offline parecería que faltan pacientes.
    if (!s) guardarPacientes(data || []);

    return { filas: [...(data || []), ...filtrar(pendientes)], deCache: false, cache: null };
  } catch (e) {
    const cache = leerPacientes();
    if (!cache && pendientes.length === 0) throw e;
    const base = cache?.datos || [];
    return { filas: filtrar([...base, ...pendientes]), deCache: true, cache };
  }
}

/** Cuenta las sesiones ya registradas de un paciente (para el "4 de 6"). */
export async function countSessions(supabase, patientId) {
  const { count, error } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('patient_id', patientId);
  if (error) return 0;
  return count || 0;
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
    const { data, error } = await supabase
      .from('patients').select('code').like('code', `${prefix}-%`);
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
    const { data: row, error } = await supabase
      .from('patients').insert(fila).select().single();
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
