const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Repo de donde se leen las versiones publicadas (GitHub Releases).
const GH_OWNER = 'lpires211002';
const GH_REPO  = 'CHIDORI_Proyecto_final_de_carrera';

let win = null;

/**
 * Ventana viva, o null.
 *
 * En macOS cerrar la ventana con el botón rojo NO cierra la app: el proceso
 * sigue vivo y `win` queda apuntando a un BrowserWindow ya destruido. El objeto
 * JS sigue existiendo, así que `if (win)` da true, pero cualquier método sobre
 * él tira "TypeError: Object has been destroyed". Todo acceso a la ventana pasa
 * por acá.
 */
function ventanaViva() {
  return win && !win.isDestroyed() ? win : null;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Aviso de actualizacion
 *  Al abrir, consulta el ultimo Release publicado en GitHub y, si hay una
 *  version mas nueva que la instalada, ofrece abrir la pagina de descarga.
 *  Es 100% tolerante a fallos: sin internet (modo AP), repo privado o sin
 *  releases, no muestra NADA y no molesta al usuario.
 * ───────────────────────────────────────────────────────────────────── */

/** "v1.2.3" → [1,2,3] · devuelve null si no parsea. */
function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** true si remota > local */
function isNewer(remote, local) {
  const r = parseVersion(remote); const l = parseVersion(local);
  if (!r || !l) return false;
  for (let i = 0; i < 3; i++) {
    if (r[i] > l[i]) return true;
    if (r[i] < l[i]) return false;
  }
  return false;
}

function fetchLatestRelease() {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${GH_OWNER}/${GH_REPO}/releases/latest`,
      method: 'GET',
      headers: { 'User-Agent': 'Chidori-App', Accept: 'application/vnd.github+json' },
      timeout: 8000,
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));     // sin internet → silencio
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function checkForUpdates() {
  const rel = await fetchLatestRelease();
  if (!rel || !rel.tag_name) return;
  if (!isNewer(rel.tag_name, app.getVersion())) return;

  const opciones = {
    type: 'info',
    title: 'Actualizacion disponible',
    message: `Hay una version nueva de Chidori (${rel.tag_name})`,
    detail: `Tenes instalada la ${app.getVersion()}.\n\n` +
            'Al descargar, instala la version nueva encima de la actual. ' +
            'Tus sesiones guardadas no se pierden.',
    buttons: ['Descargar', 'Mas tarde'],
    defaultId: 0,
    cancelId: 1,
  };

  // El chequeo corre 3 s después del arranque: para entonces la ventana puede
  // estar cerrada. Sin ventana viva el diálogo va suelto, no colgado de ella.
  const padre = ventanaViva();
  const { response } = padre
    ? await dialog.showMessageBox(padre, opciones)
    : await dialog.showMessageBox(opciones);

  if (response === 0) {
    shell.openExternal(rel.html_url ||
      `https://github.com/${GH_OWNER}/${GH_REPO}/releases/latest`);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'Chidori',
    backgroundColor: '#0b0b0d',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // Soltar la referencia al cerrarse, para no quedar con un objeto destruido.
  win.on('closed', () => { win = null; });

  // Cargamos la UI compilada (dist/). Origen file:// = contexto NO seguro,
  // por eso el ws:// al ESP funciona sin bloqueo de Mixed Content.
  const indexHtml = path.join(__dirname, '..', 'dist', 'index.html');
  if (!fs.existsSync(indexHtml)) {
    dialog.showErrorBox(
      'Falta el build de la interfaz',
      'No se encontro dist/index.html. Ejecuta "npm run build" antes de empaquetar.'
    );
    app.quit();
    return;
  }
  win.loadFile(indexHtml);

  // Links http/https se abren en el navegador del sistema, no dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

/** Trae al frente la ventana existente, o abre una si no quedó ninguna. */
function enfocarOAbrir() {
  const w = ventanaViva();
  if (!w) { createWindow(); return; }
  if (w.isMinimized()) w.restore();
  w.focus();
}

/* ─────────────────────────────────────────────────────────────────────
 *  Arranque
 *  Una sola instancia: si abren la app dos veces, la segunda se cierra y la
 *  primera se enfoca. El resto del arranque va dentro del else — sin eso, el
 *  proceso que pierde el lock seguía ejecutando y abría su propia ventana
 *  antes de que app.quit() terminara.
 * ───────────────────────────────────────────────────────────────────── */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', enfocarOAbrir);

  app.whenReady().then(() => {
    createWindow();
    // Chequeo de actualizacion diferido: no demora el arranque de la app.
    setTimeout(() => { checkForUpdates().catch(() => {}); }, 3000);
    // macOS · click en el icono del Dock con la app abierta
    app.on('activate', enfocarOAbrir);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
