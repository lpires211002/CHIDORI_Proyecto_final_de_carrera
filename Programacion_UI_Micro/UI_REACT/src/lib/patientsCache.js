/**
 * Caché local del catálogo y de los pacientes.
 *
 * POR QUÉ EXISTE: el Chidori es un access point sin salida a internet. Mientras
 * estás enlazado al equipo no se puede leer Supabase, pero el protocolo exige
 * elegir el paciente ANTES de empezar a medir. Sin caché el orden queda forzado
 * —conectarse al WiFi de casa, elegir paciente, cambiar de red, medir— y si te
 * olvidás de alguno tenés que rehacer el camino.
 *
 * Con el caché, la última lista vista queda disponible offline: se puede elegir
 * paciente estando ya enlazado al equipo.
 *
 * Se guarda en localStorage y no en IndexedDB a propósito: son decenas de filas
 * livianas, no las decenas de miles de muestras de una sesión (eso sí va a
 * IndexedDB, ver lib/sessionSync.js). Acá lo que importa es leer sincrónico.
 *
 * El caché NO es la fuente de verdad: si hay internet se usa la respuesta de
 * Supabase y se refresca el caché. Solo se lee cuando la consulta falla.
 */

const KEY_PACIENTES = 'chidori.cache.patients';
const KEY_CAMPOS    = 'chidori.cache.fields';

/** Días después de los cuales el caché se considera viejo (se avisa, no se borra). */
const DIAS_FRESCO = 7;

function guardar(key, datos) {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), datos }));
  } catch {
    // Sin espacio o en modo privado: el caché es una mejora, no un requisito.
  }
}

function leer(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { at, datos } = JSON.parse(raw);
    if (!Array.isArray(datos)) return null;
    return { at, datos };
  } catch {
    return null;
  }
}

export const guardarPacientes = (filas) => guardar(KEY_PACIENTES, filas);
export const guardarCampos    = (filas) => guardar(KEY_CAMPOS, filas);

export const leerPacientes = () => leer(KEY_PACIENTES);
export const leerCampos    = () => leer(KEY_CAMPOS);

/** Antigüedad del caché en días, o null si no hay nada guardado. */
export function antiguedadDias(entrada) {
  if (!entrada?.at) return null;
  return (Date.now() - entrada.at) / 86400000;
}

/** true si el caché tiene más de DIAS_FRESCO días. */
export function estaViejo(entrada) {
  const d = antiguedadDias(entrada);
  return d != null && d > DIAS_FRESCO;
}

/** "hace 2 días" / "hace unas horas" · para avisar de qué momento son los datos. */
export function describirAntiguedad(entrada) {
  const d = antiguedadDias(entrada);
  if (d == null) return '';
  if (d < 1 / 24) return 'hace minutos';
  if (d < 1) return `hace ${Math.round(d * 24)} h`;
  if (d < 2) return 'de ayer';
  return `hace ${Math.round(d)} días`;
}

/**
 * Pacientes creados sin internet, a la espera de subir.
 *
 * Se les asigna un id temporal `local:<uuid>`. La sesión se puede medir y
 * guardar contra ese id; al reconectar, el paciente se inserta de verdad y la
 * cola de sesiones se resuelve con el id definitivo.
 */
const KEY_PENDIENTES = 'chidori.cache.patients.pending';

export function pacientesPendientes() {
  return leer(KEY_PENDIENTES)?.datos || [];
}

export function agregarPendiente(paciente) {
  const lista = pacientesPendientes();
  lista.push(paciente);
  guardar(KEY_PENDIENTES, lista);
  return paciente;
}

export function quitarPendiente(idLocal) {
  guardar(KEY_PENDIENTES, pacientesPendientes().filter((p) => p.id !== idLocal));
}

export const esLocal = (id) => typeof id === 'string' && id.startsWith('local:');
