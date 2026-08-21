/* ─────────────────────────────────────────────────────────────────────────
 * signal.js · estimadores robustos sobre la serie de impedancia
 *
 * POR QUÉ EXISTE ESTE MÓDULO
 * --------------------------
 * Medición real (P-004 · sesión 2 · 20-ago-2026 · 17.304 muestras, 84 min):
 *
 *   · ruido de fondo con el paciente quieto ....... σ ≈ 0,010 Ω
 *   · señal fisiológica de llenado ................ 1,28 Ω/hora  (0,021 Ω/min)
 *   · artefactos de movimiento .................... hasta 4,33 Ω, de 5 a 25 s
 *
 * O sea: UN SOLO movimiento produce una excursión de hasta 2,4 veces TODA la
 * señal de la sesión. Cualquier magnitud calculada sobre muestras sueltas
 * (la última lectura, las primeras 5, los últimos 10 puntos) queda a merced
 * de que el paciente se haya movido justo en ese instante.
 *
 * La salvación es la ESCALA TEMPORAL: los artefactos duran segundos y la
 * señal evoluciona en decenas de minutos. Una mediana móvil de 60 s elimina
 * cualquier excursión de menos de 30 s y distorsiona la señal real en
 * 0,02 Ω (lo que el llenado cambia en un minuto) — despreciable.
 *
 * Se usa MEDIANA y no promedio en todo el módulo: el promedio reparte el
 * artefacto sobre toda la ventana en vez de descartarlo.
 *
 * NADA DE ESTO TOCA EL DATO CRUDO. La serie que se grafica, se exporta y se
 * guarda en la BBDD sigue siendo la que manda el firmware, muestra por
 * muestra. Esto es la capa de lectura.
 * ───────────────────────────────────────────────────────────────────────── */

/* Ventana de la tendencia · 60 s.
 * Rechaza artefactos de hasta 30 s (la mitad de la ventana, propiedad de la
 * mediana) y cuesta 0,02 Ω de retardo sobre la señal real. */
export const TREND_WINDOW_S    = 60;

/* Basal · mediana del primer minuto en vez de las primeras 5 muestras
 * (1,4 s). Es el número contra el que se compara TODA la sesión: si cae
 * dentro de un artefacto, toda la sesión queda corrida. */
export const BASELINE_WINDOW_S = 60;

/* Tasa · dos bloques de 30 s separados por 5 min.
 * Con σ=0,010 Ω, medir la pendiente sobre 2,7 s (los 10 puntos que usaba la
 * versión anterior) da ±0,2 Ω/min de puro ruido sobre una señal real de
 * 0,021 Ω/min: el resultado era ruido amplificado, no una tasa. */
export const RATE_WINDOW_S     = 300;
export const RATE_BLOCK_S      = 30;
/* Antes de este tiempo de sesión no hay tramo suficiente: se informa null
 * ("—") en vez de un número inventado. */
export const RATE_MIN_SPAN_S   = RATE_WINDOW_S / 2 + RATE_BLOCK_S;

/* Artefacto · desvío respecto de la tendencia mayor a K sigmas robustos.
 * El piso absoluto evita marcar todo como artefacto si el paciente está
 * excepcionalmente quieto y sigma se va casi a cero. */
export const ARTIFACT_SIGMA_K  = 5;
export const ARTIFACT_MIN_ABS  = 0.05;
/* Cuántos residuos recientes se retienen para estimar el ruido (~5 min a
 * 3,65 Hz). Cola acotada: una sesión de 4 h no puede hacerla crecer. */
export const RESIDUAL_BUFFER_MAX = 1200;

/* Alarma · el umbral tiene que sostenerse este tiempo para disparar.
 * La tendencia ya es inmune a los artefactos; esto es el segundo cerrojo. */
export const ALARM_PERSIST_S   = 30;

/** Mediana de un array de números. Ordena una copia; no muta la entrada. */
export function median(values) {
  const n = values.length;
  if (n === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = n >> 1;
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Mediana de los puntos cuyo x cae en (fromX, toX].
 * `buf` es la serie cronológica [{x, y}]; se recorre desde el final porque
 * las consultas siempre miran la cola. Devuelve null si no hay puntos.
 */
export function medianInRange(buf, fromX, toX) {
  const vals = [];
  for (let i = buf.length - 1; i >= 0; i--) {
    const x = buf[i].x;
    if (x > toX) continue;
    if (x <= fromX) break;
    vals.push(buf[i].y);
  }
  return median(vals);
}

/** Valor de tendencia en el extremo de la serie: mediana de los últimos windowS. */
export function trendAt(buf, nowX, windowS = TREND_WINDOW_S) {
  if (!buf.length) return null;
  return medianInRange(buf, nowX - windowS, nowX);
}

/**
 * Ruido de fondo robusto (sigma) a partir de los residuos contra la
 * tendencia: sigma ≈ 1,4826 · mediana(|residuo|).
 *
 * OJO · NO sirve estimarlo con las diferencias entre muestras vecinas, que
 * sería más barato: el firmware ya promedia 12 valores, así que dos muestras
 * consecutivas están fuertemente correlacionadas y ese estimador da ~10 veces
 * menos de lo real (0,001 Ω contra los 0,010 Ω medidos en la sesión del
 * 20-ago). El residuo contra la tendencia sí mide el ruido verdadero, y como
 * la tendencia ya se calcula en cada muestra no cuesta nada extra.
 *
 * `residuals` es la cola de residuos recientes; devuelve null si son pocos.
 *
 * El sigma que sale de acá (≈0,06 Ω en la sesión del 20-ago) es MAYOR que el
 * ruido instantáneo real (0,010 Ω) porque la tendencia es una mediana hacia
 * atrás: durante y hasta un minuto después de cada artefacto el residuo
 * arrastra el desfasaje. Por eso se usa SOLO como vara para marcar
 * movimiento — conservadora, marca los desvíos francos — y no se muestra
 * como "piso de ruido" en ningún lado.
 */
export function sigmaFromResiduals(residuals) {
  if (!residuals || residuals.length < 60) return null;
  const mad = median(residuals.map(Math.abs));
  return 1.4826 * mad;
}

/**
 * Tasa de cambio robusta, en Ω/min.
 *
 * Compara la mediana del bloque final (últimos RATE_BLOCK_S) contra la
 * mediana de un bloque de igual ancho centrado RATE_WINDOW_S antes. Dos
 * medianas separadas por una base temporal larga: inmune a artefactos en
 * cualquiera de los dos extremos y sin el costo cuadrático de un ajuste
 * robusto tipo Theil-Sen.
 *
 * Mientras la sesión sea más corta que RATE_MIN_SPAN_S devuelve null: no hay
 * base temporal para una pendiente honesta.
 */
export function robustRate(buf, nowX) {
  if (buf.length < 2) return null;
  const span = nowX - buf[0].x;
  if (span < RATE_MIN_SPAN_S) return null;

  // Con sesiones cortas se acorta la base en vez de no informar nada.
  const lag    = Math.min(RATE_WINDOW_S, span - RATE_BLOCK_S);
  const recent = medianInRange(buf, nowX - RATE_BLOCK_S, nowX);
  const center = nowX - lag;
  const older  = medianInRange(buf, center - RATE_BLOCK_S / 2, center + RATE_BLOCK_S / 2);
  if (recent == null || older == null || lag <= 0) return null;

  return ((recent - older) / lag) * 60;
}

/**
 * ¿La última lectura es un artefacto de movimiento?
 * Compara la muestra contra la tendencia usando el ruido de fondo como vara.
 * Si todavía no hay estimación de ruido, cae al piso absoluto.
 */
export function isArtifact(value, trend, sigma) {
  if (value == null || trend == null) return false;
  const k = sigma != null ? ARTIFACT_SIGMA_K * sigma : 0;
  return Math.abs(value - trend) > Math.max(k, ARTIFACT_MIN_ABS);
}

/**
 * Serie de tendencia completa · para superponer al trazo crudo y para
 * recalcular sesiones ya guardadas.
 *
 * Recorre una sola vez con dos punteros sobre una ventana deslizante, así que
 * es lineal en cantidad de puntos salvo por el orden interno de cada mediana.
 * `stride` permite generar un punto cada N muestras cuando solo se quiere
 * dibujar (17.304 puntos no aportan más que 1.500 en pantalla).
 */
export function trendSeries(buf, windowS = TREND_WINDOW_S, stride = 1) {
  const out = [];
  let from = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i].x;
    while (buf[from].x <= x - windowS) from++;
    if (i % stride !== 0 && i !== buf.length - 1) continue;
    const vals = [];
    for (let j = from; j <= i; j++) vals.push(buf[j].y);
    out.push({ x, y: median(vals) });
  }
  return out;
}

/**
 * Estadísticas robustas de una sesión terminada · lo que se reporta y se
 * guarda. Basal y final son medianas de un minuto, no muestras sueltas.
 */
export function sessionStats(buf) {
  if (!buf || buf.length === 0) {
    return { basal: null, final: null, delta: null, deltaPct: null, durationS: 0, samples: 0 };
  }
  const t0 = buf[0].x;
  const tN = buf[buf.length - 1].x;
  const basal = medianInRange(buf, t0 - 1e-9, t0 + BASELINE_WINDOW_S);
  const final = medianInRange(buf, tN - TREND_WINDOW_S, tN);
  const delta = (basal != null && final != null) ? final - basal : null;
  return {
    basal,
    final,
    delta,
    deltaPct: (delta != null && basal) ? (delta / basal) * 100 : null,
    durationS: tN - t0,
    samples: buf.length,
  };
}
