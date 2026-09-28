/**
 * Sonido de la alarma · un único AudioContext para toda la app.
 *
 * Los navegadores (Safari sobre todo, y Chrome) arrancan un AudioContext
 * "suspendido" si se crea sin un gesto del usuario, y así no suena nada.
 * Antes el contexto se creaba recién al dispararse la alarma —sin gesto— y la
 * alarma quedaba muda. Ahora se "desbloquea" en gestos reales (Iniciar,
 * activar la alarma) y el tono reusa ese contexto.
 * En Electron no hace falta, pero no molesta.
 */
let ctx = null;

function getContext() {
  if (ctx && ctx.state !== 'closed') return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch { ctx = null; }
  return ctx;
}

/** Llamar dentro de un click / tecla del usuario. */
export function unlockAlarmAudio() {
  const c = getContext();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  // Un cuadro de silencio: algunos Safari solo quedan habilitados si algo
  // efectivamente se reproduce dentro del gesto.
  try {
    const buf = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
  } catch { /* noop */ }
}

/** Un pulso de 660 Hz de ~0,45 s. */
export function playAlarmTone() {
  const c = getContext();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.28, c.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.42);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.45);
  } catch { /* sin audio: quedan el cartel y el título titilando */ }
}

/** Pide permiso de notificaciones del sistema (dentro de un gesto). */
export function requestAlarmNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try { Notification.requestPermission().catch(() => {}); } catch { /* noop */ }
}
