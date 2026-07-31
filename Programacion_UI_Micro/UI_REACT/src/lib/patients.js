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
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
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

export async function fetchPatients(supabase, { search = '' } = {}) {
  let q = supabase
    .from('patients')
    .select('*')
    .eq('active', true)
    .order('code');

  const s = search.trim();
  if (s) q = q.or(`code.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%`);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
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
  const { data, error } = await supabase
    .from('patients')
    .select('code')
    .like('code', `${prefix}-%`)
    .order('code', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return `${prefix}-001`;

  const m = String(data[0].code).match(/-(\d+)$/);
  const n = m ? parseInt(m[1], 10) + 1 : 1;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

export async function createPatient(supabase, { code, first_name, last_name, data = {}, notes = '' }) {
  const { data: row, error } = await supabase
    .from('patients')
    .insert({ code, first_name, last_name, data, notes })
    .select()
    .single();
  if (error) throw error;
  return row;
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
