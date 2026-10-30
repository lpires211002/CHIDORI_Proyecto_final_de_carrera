/* ─────────────────────────────────────────────────────────────────────────
 * edicion.js · edición NO destructiva de una sesión guardada
 *
 * La sesión original (measurements / session_events) no se toca nunca. Una
 * edición son PARÁMETROS, siempre en la base de tiempo ORIGINAL, y de ellos
 * sale una serie nueva que se guarda aparte (measurements_edited). La app y
 * el EDA leen esa misma serie, así que los dos ven exactamente lo mismo.
 *
 * Orden del procesamiento (fijo):
 *
 *   1 · recorte de inicio y fin         → el tiempo 0 pasa al primer punto
 *                                         que queda, si se cortó el inicio
 *   2 · tramos del medio sacados        → se rellenan con PCHIP sobre Z y Vadc
 *   3 · suavizado centrado (opcional)   → media o mediana de n muestras
 *   4 · basal y final                   → ventana a mano o las reglas de hoy
 *                                         (mediana del primer y último minuto)
 *   5 · eventos                         → agua y micción fuera del recorte se
 *                                         conservan; marcas y cortes, no
 *
 * Todo es puro (sin DOM ni red): se prueba con node.
 * ───────────────────────────────────────────────────────────────────────── */

import {
  median, sessionStats, BASELINE_WINDOW_S, TREND_WINDOW_S,
  RATE_WINDOW_S, RATE_BLOCK_S, RATE_MIN_SPAN_S,
} from './signal.js';

/** Sube cuando cambia el procesamiento: queda guardado con cada edición. */
export const ALGO_VERSION = 1;

/* Apoyo de la interpolación · mediana de 5 s a cada lado del tramo.
 * PCHIP con un solo punto por lado es una recta, así que se toman DOS bloques
 * de 5 s por lado (0–5 s y 5–10 s): el del borde fija el nivel y el de afuera
 * da la pendiente con la que la curva entra y sale. La mediana (y no la
 * muestra suelta del borde) hace que un artefacto pegado al tramo no arrastre
 * el relleno. */
export const APOYO_S = 5;

/** Un click sin arrastrar marca una ventana de ±15 s alrededor del punto. */
export const VENTANA_CLICK_S = 15;

/** Tramo rellenado más largo que esto: se avisa (no se impide). */
export const TRAMO_AVISO_S = 300;

/** Fuera del recorte solo sobreviven estos eventos (son fisiología, no del registro). */
export const TIPOS_QUE_SOBREVIVEN_AL_RECORTE = new Set(['water', 'void']);

/** Eventos que el clínico puede agregar a mano desde el editor. */
export const TIPOS_AGREGABLES = ['mark', 'water', 'void'];

export const NOMBRE_TIPO = {
  mark: 'Marca', water: 'Ingesta', void: 'Micción', gap: 'Microcorte',
  disconnect: 'Desconexión', reconnect: 'Reconexión',
};

/* ═══ tiempo ═══════════════════════════════════════════════════════════ */

/** "mm:ss", "h:mm:ss", "ss" (acepta décimas con punto o coma) → segundos. */
export function parseTiempo(txt) {
  if (txt == null) return null;
  const s = String(txt).trim().replace(',', '.');
  if (!s) return null;
  const partes = s.split(':');
  if (partes.length > 3 || partes.some((p) => p === '' || !/^\d+(\.\d+)?$/.test(p))) return null;
  const nums = partes.map(Number);
  if (nums.slice(1).some((n) => n >= 60)) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

/** Segundos → "mm:ss" (los minutos no se cortan en 60, como en la app). */
export function fmtTiempo(secs, decimales = 0) {
  if (secs == null || !Number.isFinite(Number(secs))) return '—';
  const neg = secs < 0;
  let v = Math.abs(Number(secs));
  const f = 10 ** decimales;
  v = Math.round(v * f) / f;
  const m = Math.floor(v / 60);
  const resto = v - m * 60;
  const ss = decimales > 0
    ? resto.toFixed(decimales).padStart(3 + decimales, '0')
    : String(Math.floor(resto)).padStart(2, '0');
  return `${neg ? '−' : ''}${String(m).padStart(2, '0')}:${ss}`;
}

/** Duración corta legible: "45 s", "3 min 20 s". */
export function fmtDuracion(secs) {
  const v = Math.max(0, Math.round(Number(secs) || 0));
  if (v < 60) return `${v} s`;
  const m = Math.floor(v / 60);
  const s = v % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/* ═══ parámetros ════════════════════════════════════════════════════════ */

export function paramsVacios() {
  return {
    v: ALGO_VERSION,
    recorte: null,      // { desde, hasta }   · se conserva lo de adentro
    tramos: [],         // [{ desde, hasta }] · se sacan y se interpolan
    suavizado: null,    // { tipo: 'media' | 'mediana', n }
    basal: null,        // { desde, hasta }   · null = reglas de hoy
    final: null,        // { desde, hasta }
    eventos: null,      // lista completa editada · null = los originales
  };
}

/** Normaliza lo que venga de la base (o de una versión vieja de params). */
export function normalizarParams(p) {
  const base = paramsVacios();
  if (!p || typeof p !== 'object') return base;
  const rango = (r) => (r && Number.isFinite(Number(r.desde)) && Number.isFinite(Number(r.hasta))
    ? ordenarRango({ desde: Number(r.desde), hasta: Number(r.hasta) }) : null);
  return {
    ...base,
    recorte: rango(p.recorte),
    tramos: Array.isArray(p.tramos) ? p.tramos.map(rango).filter(Boolean) : [],
    suavizado: p.suavizado && ['media', 'mediana'].includes(p.suavizado.tipo) && Number(p.suavizado.n) >= 3
      ? { tipo: p.suavizado.tipo, n: impar(Number(p.suavizado.n)) } : null,
    basal: rango(p.basal),
    final: rango(p.final),
    eventos: Array.isArray(p.eventos) ? p.eventos.map(normalizarEventoParam).filter(Boolean) : null,
  };
}

function normalizarEventoParam(e) {
  if (!e || !Number.isFinite(Number(e.t)) || !e.kind) return null;
  const ml = e.ml == null || e.ml === '' ? null : Number(e.ml);
  return {
    id: Number(e.id),
    kind: String(e.kind),
    t: Number(e.t),
    ml: Number.isFinite(ml) ? ml : null,
    gap_s: e.gap_s == null ? null : Number(e.gap_s),
    origen: e.origen === 'agregado' ? 'agregado' : 'original',
  };
}

export function ordenarRango(r) {
  return r.desde <= r.hasta ? r : { desde: r.hasta, hasta: r.desde };
}

/** n de un filtro centrado: entero, impar y al menos 3. */
export function impar(n) {
  let k = Math.max(3, Math.round(Number(n) || 3));
  if (k % 2 === 0) k += 1;
  return k;
}

/** Eventos de la base → la forma de los params (base de tiempo original). */
export function eventosDesdeBase(rows) {
  return (rows || [])
    .map((e) => ({
      id: Number(e.event_number ?? e.id),
      kind: e.kind || 'mark',
      t: Number(e.elapsed_time),
      ml: e.amount_ml == null ? null : Number(e.amount_ml),
      gap_s: (e.kind === 'gap' && e.impedance_change != null) ? Number(e.impedance_change) : null,
      origen: 'original',
    }))
    .filter((e) => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t || a.id - b.id);
}

function mismoEvento(a, b) {
  return a.id === b.id && a.kind === b.kind
    && Math.abs(a.t - b.t) < 1e-6
    && (a.ml ?? null) === (b.ml ?? null);
}

/** ¿Los eventos de los params difieren de los originales? */
export function eventosCambiaron(eventosParam, eventosOriginales) {
  if (!eventosParam) return false;
  const orig = eventosDesdeBase(eventosOriginales);
  if (orig.length !== eventosParam.length) return true;
  const ord = [...eventosParam].sort((a, b) => a.t - b.t || a.id - b.id);
  return ord.some((e, i) => !mismoEvento(e, orig[i]));
}

/** ¿Hay alguna operación sobre la curva? Sin ninguna no hay edición que guardar. */
export function hayOperaciones(params, eventosOriginales) {
  const p = normalizarParams(params);
  return Boolean(
    p.recorte || p.tramos.length || p.suavizado || p.basal || p.final
    || eventosCambiaron(p.eventos, eventosOriginales),
  );
}

/* ═══ PCHIP ═════════════════════════════════════════════════════════════
 * Hermite cúbica monótona (Fritsch–Carlson, con los bordes de SciPy): entre
 * dos puntos de apoyo nunca pasa por encima ni por debajo de ellos. Un spline
 * cúbico común sí puede, e inventaría un pico que la vejiga no hizo. */

function bordePchip(h0, h1, d0, d1) {
  let m = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (Math.sign(m) !== Math.sign(d0)) m = 0;
  else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(m) > Math.abs(3 * d0)) m = 3 * d0;
  return m;
}

/** Devuelve f(x) que interpola (xs, ys). xs estrictamente creciente. */
export function pchip(xs, ys) {
  const n = xs.length;
  if (n === 0) return () => null;
  if (n === 1) return () => ys[0];
  const h = [];
  const d = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    d.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = new Array(n).fill(0);
  if (n === 2) {
    m[0] = d[0];
    m[1] = d[0];
  } else {
    for (let k = 1; k < n - 1; k++) {
      if (d[k - 1] * d[k] <= 0) { m[k] = 0; continue; }
      const w1 = 2 * h[k] + h[k - 1];
      const w2 = h[k] + 2 * h[k - 1];
      m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
    }
    m[0] = bordePchip(h[0], h[1], d[0], d[1]);
    m[n - 1] = bordePchip(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  }
  return (x) => {
    let i = 0;
    if (x >= xs[n - 1]) i = n - 2;
    else if (x > xs[0]) {
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] <= x) lo = mid; else hi = mid;
      }
      i = lo;
    }
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]
      + (t3 - 2 * t2 + t) * h[i] * m[i]
      + (-2 * t3 + 3 * t2) * ys[i + 1]
      + (t3 - t2) * h[i] * m[i + 1];
  };
}

/* ═══ filtros centrados ═════════════════════════════════════════════════
 * Ventana de n muestras centrada en cada punto: k = (n−1)/2 a cada lado. En
 * los extremos la ventana se acorta a lo que hay (no se inventan muestras).
 * Los null (Vadc de firmwares que no lo mandaban) se saltean. */

export function mediaMovilCentrada(vals, n) {
  const N = vals.length;
  const k = (impar(n) - 1) / 2;
  const out = new Array(N).fill(null);
  let suma = 0;
  let cuenta = 0;
  let a = 0;          // ventana actual [a, b]
  let b = -1;
  for (let i = 0; i < N; i++) {
    const na = Math.max(0, i - k);
    const nb = Math.min(N - 1, i + k);
    while (b < nb) { b++; const v = vals[b]; if (v != null && Number.isFinite(v)) { suma += v; cuenta++; } }
    while (a < na) { const v = vals[a]; if (v != null && Number.isFinite(v)) { suma -= v; cuenta--; } a++; }
    out[i] = cuenta > 0 ? suma / cuenta : null;
  }
  return out;
}

function insertarOrdenado(arr, v) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  arr.splice(lo, 0, v);
}

function quitarOrdenado(arr, v) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  if (lo < arr.length && arr[lo] === v) arr.splice(lo, 1);
}

export function medianaMovilCentrada(vals, n) {
  const N = vals.length;
  const k = (impar(n) - 1) / 2;
  const out = new Array(N).fill(null);
  const ord = [];
  let a = 0;
  let b = -1;
  const ok = (v) => v != null && Number.isFinite(v);
  for (let i = 0; i < N; i++) {
    const na = Math.max(0, i - k);
    const nb = Math.min(N - 1, i + k);
    while (b < nb) { b++; if (ok(vals[b])) insertarOrdenado(ord, vals[b]); }
    while (a < na) { if (ok(vals[a])) quitarOrdenado(ord, vals[a]); a++; }
    const c = ord.length;
    out[i] = c === 0 ? null : (c % 2 ? ord[c >> 1] : (ord[c / 2 - 1] + ord[c / 2]) / 2);
  }
  return out;
}

/* ═══ utilidades ════════════════════════════════════════════════════════ */

/** Primer índice con t >= x (arr ordenado por t). */
function primerIndice(arr, x, key = 't') {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid][key] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Índice de la muestra más cercana a x. */
export function indiceMasCercano(arr, x, key = 'elapsed_time') {
  if (!arr.length) return -1;
  const i = primerIndice(arr, x, key);
  if (i <= 0) return 0;
  if (i >= arr.length) return arr.length - 1;
  return (x - arr[i - 1][key]) <= (arr[i][key] - x) ? i - 1 : i;
}

/** Período de muestreo típico (mediana de los intervalos) en segundos. */
export function periodoMuestreo(rows, key = 'elapsed_time') {
  if (!rows || rows.length < 3) return null;
  const dts = [];
  const paso = Math.max(1, Math.floor(rows.length / 4000));   // no hace falta mirar todas
  for (let i = paso; i < rows.length; i += paso) {
    const dt = Number(rows[i][key]) - Number(rows[i - paso][key]);
    if (dt > 0) dts.push(dt / paso);
  }
  return median(dts);
}

/** Ventana de ±15 s alrededor de un click, recortada a [lo, hi]. */
export function ventanaDeClick(t, lo = -Infinity, hi = Infinity) {
  return { desde: Math.max(lo, t - VENTANA_CLICK_S), hasta: Math.min(hi, t + VENTANA_CLICK_S) };
}

/** Une tramos que se pisan y los recorta al rango conservado. */
export function fusionarTramos(tramos, lo = -Infinity, hi = Infinity) {
  const ord = (tramos || [])
    .map(ordenarRango)
    .map((r) => ({ desde: Math.max(lo, r.desde), hasta: Math.min(hi, r.hasta) }))
    .filter((r) => r.hasta > r.desde)
    .sort((a, b) => a.desde - b.desde);
  const out = [];
  for (const r of ord) {
    const ult = out[out.length - 1];
    if (ult && r.desde <= ult.hasta) ult.hasta = Math.max(ult.hasta, r.hasta);
    else out.push({ ...r });
  }
  return out;
}

function normalizarMuestras(rows) {
  return (rows || [])
    .map((m) => ({
      t: Number(m.elapsed_time ?? m.t ?? m.x),
      z: Number(m.impedance ?? m.z ?? m.y),
      v: m.voltage_v == null || m.voltage_v === '' || !Number.isFinite(Number(m.voltage_v))
        ? null : Number(m.voltage_v),
    }))
    .filter((m) => Number.isFinite(m.t) && Number.isFinite(m.z))
    .sort((a, b) => a.t - b.t);
}

/* ═══ el procesamiento ══════════════════════════════════════════════════ */

/**
 * Aplica la edición a la sesión original.
 *
 * @param muestras  measurements de la base: [{ elapsed_time, impedance, voltage_v }]
 * @param eventos   session_events de la base
 * @param params    ver paramsVacios() · base de tiempo ORIGINAL
 * @returns {
 *   serie:   [{ elapsed_time, impedance, voltage_v, interpolated, t_orig }]  (tiempo re-cerado)
 *   eventos: [{ event_number, elapsed_time, impedance, impedance_change, kind, amount_ml,
 *               gap_s, fuera_del_recorte, origen, t_orig }]
 *   stats:   { basal, final, delta, deltaPct, durationS, samples, interpoladas,
 *              basalModo, finalModo, basalVentana, finalVentana, elapsedStr }
 *   tCero, lo, hi, tramos, errores, avisos, descartados
 * }
 */
export function aplicarEdicion(muestras, eventos, params) {
  const p = normalizarParams(params);
  const errores = [];
  const avisos = [];
  const src = normalizarMuestras(muestras);

  const vacio = (msg) => ({
    serie: [], eventos: [], stats: { ...sessionStats([]), interpoladas: 0 },
    tCero: 0, lo: 0, hi: 0, tramos: [], errores: [msg], avisos, descartados: [],
  });
  if (src.length < 2) return vacio('La sesión no tiene muestras suficientes.');

  const tMin = src[0].t;
  const tMax = src[src.length - 1].t;

  /* 1 · recorte ─────────────────────────────────────────────────────── */
  let lo = tMin;
  let hi = tMax;
  if (p.recorte) {
    lo = Math.max(tMin, p.recorte.desde);
    hi = Math.min(tMax, p.recorte.hasta);
  }
  const dentro = src.filter((s) => s.t >= lo && s.t <= hi);
  if (dentro.length < 2) return vacio('El recorte deja menos de dos muestras.');
  lo = Math.max(lo, dentro[0].t);
  hi = Math.min(hi, dentro[dentro.length - 1].t);
  // El 0 se mueve solo si de verdad se cortó el inicio
  const tCero = dentro[0].t > tMin ? dentro[0].t : 0;

  const N = dentro.length;
  const z = dentro.map((s) => s.z);
  const v = dentro.map((s) => s.v);
  const interp = new Uint8Array(N);

  /* 2 · tramos sacados, rellenados con PCHIP ────────────────────────── */
  const tramos = fusionarTramos(p.tramos, lo, hi);
  const rangos = tramos.map((r) => {
    const a = primerIndice(dentro, r.desde);
    let b = primerIndice(dentro, r.hasta);
    if (b >= N || dentro[b].t > r.hasta) b -= 1;
    return { ...r, a, b };
  });
  rangos.forEach(({ a, b }) => { for (let i = a; i <= b; i++) interp[i] = 1; });

  const bloque = (desde, hasta, incluyeDesde, incluyeHasta) => {
    let i = primerIndice(dentro, desde);
    const ts = [];
    const zs = [];
    const vs = [];
    for (; i < N && dentro[i].t <= hasta; i++) {
      const t = dentro[i].t;
      if ((!incluyeDesde && t <= desde) || (!incluyeHasta && t >= hasta)) continue;
      if (interp[i]) continue;          // nunca se apoya en lo que se sacó
      ts.push(t);
      zs.push(dentro[i].z);
      if (dentro[i].v != null && Number.isFinite(dentro[i].v)) vs.push(dentro[i].v);
    }
    if (!ts.length) return null;
    return { t: median(ts), z: median(zs), v: vs.length ? median(vs) : null };
  };

  rangos.forEach((r, n) => {
    const nombre = `Tramo ${n + 1} (${fmtTiempo(r.desde - tCero)}–${fmtTiempo(r.hasta - tCero)})`;
    if (r.b < r.a) {
      avisos.push(`${nombre}: no tiene muestras adentro, no cambia nada.`);
      return;
    }
    const izqCerca = bloque(r.desde - APOYO_S, r.desde, true, false);
    const derCerca = bloque(r.hasta, r.hasta + APOYO_S, false, true);
    if (!izqCerca || !derCerca) {
      errores.push(`${nombre}: no hay señal a ${!izqCerca ? 'la izquierda' : 'la derecha'} para apoyar el relleno. Si llega hasta el borde, es un recorte.`);
      for (let i = r.a; i <= r.b; i++) interp[i] = 0;
      return;
    }
    const izqLejos = bloque(r.desde - 2 * APOYO_S, r.desde - APOYO_S, true, false);
    const derLejos = bloque(r.hasta + APOYO_S, r.hasta + 2 * APOYO_S, false, true);
    const apoyos = [izqLejos, izqCerca, derCerca, derLejos].filter(Boolean);

    const fz = pchip(apoyos.map((q) => q.t), apoyos.map((q) => q.z));
    const conV = apoyos.filter((q) => q.v != null);
    const vOk = izqCerca.v != null && derCerca.v != null;
    const fv = vOk ? pchip(conV.map((q) => q.t), conV.map((q) => q.v)) : null;
    for (let i = r.a; i <= r.b; i++) {
      z[i] = fz(dentro[i].t);
      v[i] = fv ? fv(dentro[i].t) : null;
    }
    if (r.hasta - r.desde > TRAMO_AVISO_S) {
      avisos.push(`${nombre}: ${fmtDuracion(r.hasta - r.desde)} rellenados. Pasa de 5 min: es mucha curva inventada.`);
    }
  });

  /* 3 · suavizado centrado ──────────────────────────────────────────── */
  let zf = z;
  let vf = v;
  if (p.suavizado) {
    const filtro = p.suavizado.tipo === 'media' ? mediaMovilCentrada : medianaMovilCentrada;
    zf = filtro(z, p.suavizado.n);
    // Vadc se filtra igual, pero donde no había dato sigue sin haberlo
    vf = v.some((x) => x != null) ? filtro(v, p.suavizado.n).map((x, i) => (v[i] == null ? null : x)) : v;
  }

  const serie = dentro.map((s, i) => ({
    elapsed_time: s.t - tCero,
    impedance: zf[i],
    voltage_v: vf[i] ?? null,
    interpolated: interp[i] === 1,
    t_orig: s.t,
  }));

  /* 4 · basal y final ───────────────────────────────────────────────── */
  const buf = serie.map((s) => ({ x: s.elapsed_time, y: s.impedance }));
  const auto = sessionStats(buf);
  const t0 = serie[0].elapsed_time;
  const tN = serie[serie.length - 1].elapsed_time;

  const enVentana = (r, nombre) => {
    const desde = Math.max(lo, r.desde);
    const hasta = Math.min(hi, r.hasta);
    const vals = [];
    for (let i = primerIndice(dentro, desde); i < N && dentro[i].t <= hasta; i++) vals.push(zf[i]);
    if (!vals.length) {
      errores.push(`La ventana de ${nombre} queda fuera del recorte o no tiene muestras.`);
      return { valor: null, ventana: [desde - tCero, hasta - tCero] };
    }
    return { valor: median(vals), ventana: [desde - tCero, hasta - tCero] };
  };

  let basal = auto.basal;
  let basalVentana = [t0, Math.min(tN, t0 + BASELINE_WINDOW_S)];
  if (p.basal) ({ valor: basal, ventana: basalVentana } = enVentana(p.basal, 'basal'));
  let final = auto.final;
  let finalVentana = [Math.max(t0, tN - TREND_WINDOW_S), tN];
  if (p.final) ({ valor: final, ventana: finalVentana } = enVentana(p.final, 'final'));

  const delta = basal != null && final != null ? final - basal : null;
  const interpoladas = serie.reduce((n, s) => n + (s.interpolated ? 1 : 0), 0);
  const stats = {
    basal,
    final,
    delta,
    deltaPct: delta != null && basal ? (delta / basal) * 100 : null,
    durationS: tN - t0,
    samples: serie.length,
    interpoladas,
    basalModo: p.basal ? 'manual' : 'auto',
    finalModo: p.final ? 'manual' : 'auto',
    basalVentana,
    finalVentana,
    elapsedStr: fmtTiempo(tN),
  };

  /* 5 · eventos ─────────────────────────────────────────────────────── */
  const base = p.eventos ?? eventosDesdeBase(eventos);
  const descartados = [];
  const evs = [];
  [...base].sort((a, b) => a.t - b.t || a.id - b.id).forEach((e) => {
    const adentro = e.t >= lo && e.t <= hi;
    if (!adentro && !TIPOS_QUE_SOBREVIVEN_AL_RECORTE.has(e.kind)) {
      descartados.push(e);
      return;
    }
    evs.push({
      event_number: e.id,
      elapsed_time: e.t - tCero,
      kind: e.kind,
      amount_ml: e.ml ?? null,
      gap_s: e.gap_s ?? null,
      fuera_del_recorte: !adentro,
      origen: e.origen || 'original',
      t_orig: e.t,
    });
  });
  const eventosOut = completarEventos(serie, evs, basal);

  return { serie, eventos: eventosOut, stats, tCero, lo, hi, tramos, errores, avisos, descartados };
}

/**
 * Z y ΔZ de cada evento, leídos de la serie (editada u original).
 * Es lo mismo que hace la app en vivo: Z = la muestra de ese instante y, en
 * las marcas, ΔZ = Z − basal. En un microcorte ΔZ guarda la duración (s).
 * Los eventos fuera del recorte no tienen muestra: Z queda vacía.
 */
export function completarEventos(serie, eventos, basal) {
  return (eventos || []).map((e) => {
    const fuera = Boolean(e.fuera_del_recorte);
    let zEv = null;
    if (!fuera && serie.length) {
      const i = indiceMasCercano(serie, Number(e.elapsed_time));
      zEv = i >= 0 ? serie[i].impedance : null;
    }
    let cambio = null;
    if (e.kind === 'gap') cambio = e.gap_s ?? e.impedance_change ?? null;
    else if (e.kind === 'mark' && zEv != null && basal != null) cambio = zEv - basal;
    return { ...e, impedance: zEv, impedance_change: cambio };
  });
}

/* ═══ tasa (dZ/dt) ══════════════════════════════════════════════════════
 * La misma cuenta que la app hace en vivo (signal.robustRate), muestra por
 * muestra y mirando solo hacia atrás, para que la columna de la serie
 * editada signifique lo mismo que la de la original. Como en vivo, antes de
 * 3 min de registro no hay base para una pendiente y vale 0. */
export function tasaSerie(serie) {
  const N = serie.length;
  const out = new Array(N).fill(0);
  if (N < 2) return out;
  const xs = serie.map((s) => Number(s.elapsed_time));
  const ys = serie.map((s) => Number(s.impedance));
  const t0 = xs[0];
  // Dos ventanas deslizantes ordenadas: insertar y sacar es barato, así una
  // sesión de 4 h se calcula en milisegundos en vez de ordenar cada bloque.
  const rec = [];        // bloque reciente: (now − 30, now]
  const vie = [];        // bloque viejo: (c − 15, c + 15]
  let r0 = 0;
  let r1 = 0;
  let o0 = 0;
  let o1 = 0;
  const med = (a) => {
    const c = a.length;
    if (!c) return null;
    return c % 2 ? a[c >> 1] : (a[c / 2 - 1] + a[c / 2]) / 2;
  };
  for (let i = 0; i < N; i++) {
    const now = xs[i];
    while (r1 <= i) { insertarOrdenado(rec, ys[r1]); r1++; }
    while (r0 < r1 && xs[r0] <= now - RATE_BLOCK_S) { quitarOrdenado(rec, ys[r0]); r0++; }
    const span = now - t0;
    if (span < RATE_MIN_SPAN_S) continue;
    const lag = Math.min(RATE_WINDOW_S, span - RATE_BLOCK_S);
    if (lag <= 0) continue;
    const c = now - lag;
    while (o1 < N && xs[o1] <= c + RATE_BLOCK_S / 2) { insertarOrdenado(vie, ys[o1]); o1++; }
    while (o0 < o1 && xs[o0] <= c - RATE_BLOCK_S / 2) { quitarOrdenado(vie, ys[o0]); o0++; }
    const reciente = med(rec);
    const viejo = med(vie);
    if (reciente == null || viejo == null) continue;
    out[i] = ((reciente - viejo) / lag) * 60;
  }
  return out;
}

/* ═══ comentarios ═══════════════════════════════════════════════════════
 * Se guardan en la base de tiempo ORIGINAL (no dependen de la edición: si se
 * vuelve al original, siguen ahí). Para dibujarlos sobre la editada se
 * corren al nuevo cero y se ocultan los que quedaron fuera del recorte. */
export function comentariosEnSerie(comentarios, { tCero = 0, lo = -Infinity, hi = Infinity } = {}) {
  return (comentarios || [])
    .filter((c) => {
      const a = Number(c.t_from);
      const b = c.t_to == null ? a : Number(c.t_to);
      return b >= lo && a <= hi;
    })
    .map((c) => ({
      ...c,
      t_from: Math.max(lo, Number(c.t_from)) - tCero,
      t_to: c.t_to == null ? null : Math.min(hi, Number(c.t_to)) - tCero,
    }));
}

/* ═══ descripción ═══════════════════════════════════════════════════════
 * Lo que se hizo, en una línea por operación: va en el detalle, en el PDF y
 * en el TXT, para que un reporte editado nunca se lea como el crudo. */
export function describirEdicion(params, { tCero = 0, periodo = null } = {}) {
  const p = normalizarParams(params);
  const out = [];
  const t = (x) => fmtTiempo(x, 0);
  if (p.recorte) out.push(`Recorte: se conserva de ${t(p.recorte.desde)} a ${t(p.recorte.hasta)} del registro original${tCero ? ' (el tiempo 0 pasa al inicio del recorte)' : ''}.`);
  // Los tramos como se aplicaron: unidos y dentro del recorte
  const tramos = fusionarTramos(p.tramos, p.recorte?.desde ?? -Infinity, p.recorte?.hasta ?? Infinity);
  if (tramos.length) {
    const tot = tramos.reduce((acc, r) => acc + (r.hasta - r.desde), 0);
    out.push(`Tramos sacados y rellenados con interpolación monótona (PCHIP): ${tramos.map((r) => `${t(r.desde)}–${t(r.hasta)}`).join(', ')} · ${fmtDuracion(tot)} en total (tiempos del original).`);
  }
  if (p.suavizado) {
    const seg = periodo ? ` (≈ ${(p.suavizado.n * periodo).toFixed(1).replace('.', ',')} s)` : '';
    out.push(`Suavizado: ${p.suavizado.tipo} centrada de ${p.suavizado.n} muestras${seg}, sobre Z y Vadc.`);
  }
  if (p.basal) out.push(`Basal a mano: mediana de ${t(p.basal.desde)}–${t(p.basal.hasta)} (original).`);
  if (p.final) out.push(`Final a mano: mediana de ${t(p.final.desde)}–${t(p.final.hasta)} (original).`);
  if (p.eventos) out.push('Eventos corregidos a mano.');
  return out;
}
