/* ─────────────────────────────────────────────────────────────────────────
 * edicionDB.js · lectura y escritura de ediciones, apta y comentarios
 *
 * Tablas de sql/edicion_sesiones.sql. Si la base todavía no corrió ese
 * script, las lecturas devuelven { disponible: false } en vez de romper el
 * panel: la sesión se sigue viendo, solo no se puede editar.
 * ───────────────────────────────────────────────────────────────────────── */

import { ALGO_VERSION, normalizarParams, completarEventos } from './edicion.js';
import { version as APP_VERSION } from '../../package.json';

const PAGINA = 1000;      // tope de PostgREST por request
const TANDA  = 1000;      // filas por insert al subir la serie editada

/** ¿El error es "esa tabla/función no existe"? (SQL sin correr) */
export function esFaltaDeSQL(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || code === '42883'
    || /does not exist|could not find the (table|function)|schema cache/i.test(msg);
}

export const AVISO_SQL = 'Para editar curvas, marcar apta / no apta y anclar comentarios falta correr sql/edicion_sesiones.sql en Supabase.';

/**
 * Edición activa de una sesión, con su serie.
 * @returns { disponible, edicion: fila de session_edits | null, serie: [...] }
 */
export async function cargarEdicion(supabase, sessionId, { onProgress } = {}) {
  const { data: fila, error } = await supabase
    .from('session_edits')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) {
    if (esFaltaDeSQL(error)) return { disponible: false, edicion: null, serie: [] };
    throw error;
  }
  if (!fila) return { disponible: true, edicion: null, serie: [] };

  const serie = [];
  let desde = -1;
  // Paginado por clave (idx), no por offset: cada página lee solo sus filas.
  for (;;) {
    const { data, error: e2 } = await supabase
      .from('measurements_edited')
      .select('idx, elapsed_time, impedance, voltage_v, interpolated')
      .eq('session_id', sessionId)
      .eq('version', fila.version)
      .gt('idx', desde)
      .order('idx', { ascending: true })
      .limit(PAGINA);
    if (e2) throw e2;
    if (!data || data.length === 0) break;
    serie.push(...data);
    onProgress?.(serie.length);
    desde = data[data.length - 1].idx;
    if (data.length < PAGINA) break;
  }
  // Una serie que no llegó entera no se muestra como si fuera la edición
  if (serie.length !== Number(fila.n_muestras)) {
    throw new Error(`la serie editada está incompleta (${serie.length} de ${fila.n_muestras} muestras)`);
  }
  return { disponible: true, edicion: { ...fila, params: normalizarParams(fila.params) }, serie };
}

/** Eventos editados guardados (sin Z) → con Z y ΔZ leídos de la serie editada. */
export function eventosDeEdicion(edicion, serie) {
  if (!edicion) return [];
  return completarEventos(serie, edicion.eventos || [], edicion.initial_impedance);
}

export async function cargarRevision(supabase, sessionId) {
  const { data, error } = await supabase
    .from('session_review')
    .select('session_id, apta, nota, updated_by, updated_at')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) {
    if (esFaltaDeSQL(error)) return { disponible: false, revision: null };
    throw error;
  }
  return { disponible: true, revision: data || null };
}

export async function guardarRevision(supabase, sessionId, { apta, nota }) {
  const { data, error } = await supabase
    .from('session_review')
    .upsert({ session_id: sessionId, apta: Boolean(apta), nota: nota?.trim() ? nota.trim() : null },
      { onConflict: 'session_id' })
    .select('session_id, apta, nota, updated_by, updated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function cargarComentarios(supabase, sessionId) {
  const { data, error } = await supabase
    .from('session_comments')
    .select('id, t_from, t_to, body, created_by, created_at, updated_by, updated_at')
    .eq('session_id', sessionId)
    .order('t_from', { ascending: true });
  if (error) {
    if (esFaltaDeSQL(error)) return { disponible: false, comentarios: [] };
    throw error;
  }
  return { disponible: true, comentarios: data || [] };
}

const nuevoId = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
  }));

export { nuevoId };

const normComentario = (c) => ({
  id: c.id || nuevoId(),
  t_from: Number(c.t_from),
  t_to: c.t_to == null ? null : Number(c.t_to),
  body: String(c.body || '').trim(),
});

/**
 * Qué cambió entre los comentarios que se cargaron y los de ahora.
 * Se guarda solo eso (no la lista entera): un comentario que otra persona
 * agregó mientras tanto no se borra. Uno que quedó sin texto se borra.
 */
export function diffComentarios(iniciales, actuales) {
  const antes = new Map((iniciales || []).map((c) => [c.id, normComentario(c)]));
  const ahora = (actuales || []).map(normComentario);
  const idsAhora = new Set(ahora.filter((c) => c.body).map((c) => c.id));
  const cambios = ahora.filter((c) => {
    if (!c.body) return false;
    const a = antes.get(c.id);
    return !a || a.body !== c.body || a.t_from !== c.t_from || a.t_to !== c.t_to;
  });
  const borrar = [...antes.keys()].filter((id) => !idsAhora.has(id));
  return { cambios, borrar };
}

const argsComentarios = (diff) => (diff
  ? { p_comentarios: diff.cambios, p_borrar_comentarios: diff.borrar.length ? diff.borrar : null }
  : { p_comentarios: null, p_borrar_comentarios: null });

/** Lo que va en session_edits.stats: ventanas y conteos, NO valores de Z
 *  (esos van en columnas, así calibracion.sql los puede reescalar). */
function statsParaGuardar(r) {
  const s = r.stats;
  return {
    basal_modo: s.basalModo,
    final_modo: s.finalModo,
    basal_ventana: s.basalVentana,
    final_ventana: s.finalVentana,
    duracion_s: s.durationS,
    interpoladas: s.interpoladas,
    recorte: [r.lo, r.hi],
    tramos: r.tramos,
    eventos_descartados: r.descartados.length,
  };
}

/**
 * Guarda una edición nueva: sube la serie con una versión nueva y recién
 * después la activa (función guardar_edicion_sesion). Si la subida se corta
 * a la mitad, la edición anterior —o el original— queda como estaba, y lo
 * que alcanzó a subir se limpia.
 *
 * @param resultado  lo que devolvió aplicarEdicion()
 * @param params     los parámetros que lo produjeron
 * @param comentarios diffComentarios(...) (o null = no tocar los comentarios)
 */
export async function guardarEdicion(supabase, { sessionId, resultado, params, comentarios = null, onProgress }) {
  const version = nuevoId();
  const serie = resultado.serie;
  const filas = serie.map((s, idx) => ({
    session_id: sessionId,
    version,
    idx,
    elapsed_time: s.elapsed_time,
    impedance: s.impedance,
    voltage_v: s.voltage_v ?? null,
    interpolated: Boolean(s.interpolated),
  }));

  try {
    for (let i = 0; i < filas.length; i += TANDA) {
      const { error } = await supabase.from('measurements_edited').insert(filas.slice(i, i + TANDA));
      if (error) throw error;
      onProgress?.(Math.min(filas.length, i + TANDA), filas.length);
    }

    const eventos = resultado.eventos.map((e) => ({
      event_number: e.event_number,
      elapsed_time: e.elapsed_time,
      kind: e.kind,
      amount_ml: e.amount_ml ?? null,
      gap_s: e.gap_s ?? null,
      fuera_del_recorte: Boolean(e.fuera_del_recorte),
      origen: e.origen || 'original',
      t_orig: e.t_orig,
    }));

    const { error } = await supabase.rpc('guardar_edicion_sesion', {
      p_session: sessionId,
      p_accion: 'activar',
      p_edicion: {
        version,
        n_muestras: filas.length,
        params: { ...normalizarParams(params), v: ALGO_VERSION },
        eventos,
        stats: statsParaGuardar(resultado),
        initial_impedance: resultado.stats.basal,
        final_impedance: resultado.stats.final,
        elapsed_time_str: resultado.stats.elapsedStr,
        total_events: eventos.length,
        n_interpoladas: resultado.stats.interpoladas,
        t_cero: resultado.tCero,
        algo_version: ALGO_VERSION,
        app_version: APP_VERSION,
      },
      ...argsComentarios(comentarios),
    });
    if (error) throw error;
    return version;
  } catch (err) {
    // Limpieza de lo que alcanzó a subir. OJO: si la activación llegó a
    // hacerse y lo que se perdió fue la respuesta, esta versión YA es la
    // activa y no se toca. Si no se puede saber, tampoco: la próxima
    // activación borra los restos igual.
    try {
      const { data: activa, error: e2 } = await supabase
        .from('session_edits').select('version').eq('session_id', sessionId).maybeSingle();
      if (!e2 && activa?.version !== version) {
        await supabase.from('measurements_edited').delete()
          .eq('session_id', sessionId).eq('version', version);
      }
    } catch { /* noop */ }
    throw err;
  }
}

/** Volver al original · borra la edición y su serie (apta y comentarios quedan). */
export async function borrarEdicion(supabase, sessionId, comentarios = null) {
  const { error } = await supabase.rpc('guardar_edicion_sesion', {
    p_session: sessionId,
    p_accion: 'borrar',
    ...argsComentarios(comentarios),
  });
  if (error) throw error;
}

/** Solo comentarios (diffComentarios), sin tocar la edición. */
export async function guardarComentarios(supabase, sessionId, comentarios) {
  if (!comentarios || (!comentarios.cambios.length && !comentarios.borrar.length)) return;
  const { error } = await supabase.rpc('guardar_edicion_sesion', {
    p_session: sessionId,
    p_accion: 'mantener',
    ...argsComentarios(comentarios),
  });
  if (error) throw error;
}

/**
 * Para el listado: resumen de las ediciones y el apta de muchas sesiones.
 * Devuelve Maps por session_id; vacíos si el SQL no está corrido.
 */
export async function resumenesDeSesiones(supabase, ids) {
  const ediciones = new Map();
  const revisiones = new Map();
  const lotes = [];
  for (let i = 0; i < ids.length; i += 100) lotes.push(ids.slice(i, i + 100));
  try {
    for (const lote of lotes) {
      const [ed, rev] = await Promise.all([
        supabase.from('session_edits')
          .select('session_id, initial_impedance, final_impedance, elapsed_time_str, total_events, n_interpoladas, edited_by, edited_at')
          .in('session_id', lote),
        supabase.from('session_review').select('session_id, apta, nota').in('session_id', lote),
      ]);
      if (ed.error) throw ed.error;
      if (rev.error) throw rev.error;
      (ed.data || []).forEach((r) => ediciones.set(r.session_id, r));
      (rev.data || []).forEach((r) => revisiones.set(r.session_id, r));
    }
    return { disponible: true, ediciones, revisiones };
  } catch (err) {
    if (esFaltaDeSQL(err)) return { disponible: false, ediciones, revisiones };
    throw err;
  }
}
