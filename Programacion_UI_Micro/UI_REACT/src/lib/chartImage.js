import Chart from 'chart.js/auto';
import { CHART_FONT } from './chartFont';

/**
 * Curva de una sesión rendida como PNG para el PDF.
 *
 * No se puede reusar el canvas de pantalla: es transparente y de tema oscuro
 * (grilla blanca al 6 %, texto gris claro). Pegado en una hoja blanca queda
 * ilegible. Acá se rinde de nuevo, fuera del DOM, en paleta clara y al doble
 * de resolución, porque el PDF lo reduce a 170 mm de ancho.
 *
 * Lo usan el panel de administración (sesiones archivadas) y el cierre de
 * sesión del clínico, así que los marcadores se dibujan igual en los dos.
 */

/** Paleta de impresión · pensada para papel, no para pantalla. */
export const PALETA_IMPRESION = {
  signal:   '#4f46e5',
  alarm:    '#dc2626',
  confirm:  '#15803d',
  amber:    '#b45309',
  original: '#9ca3af',
  onSignal: '#ffffff',
  mute:     '#4b5563',
  grid:     '#dfe3e8',
  fondo:    '#ffffff',
};

/** Muestras que conserva la simplificación (LTTB respeta picos y valles). */
export const MUESTRAS_LTTB = 1500;

/**
 * Normaliza las dos formas en que viajan los eventos:
 *   base de datos → { event_number, elapsed_time, impedance_change, ... }
 *   sesión en vivo → { id, time, change, ... }
 */
export function normalizarEventos(events) {
  return (events || []).map((e) => ({
    event_number:     e.event_number ?? e.id,
    elapsed_time:     Number(e.elapsed_time ?? e.time ?? 0),
    impedance_change: e.impedance_change ?? e.change ?? null,
    kind:             e.kind || 'mark',
  }));
}

/** Idem para las muestras: { elapsed_time, impedance } o { x, y }. */
export function normalizarMuestras(rows) {
  return (rows || []).map((m) => ({
    x: Number(m.elapsed_time ?? m.x ?? 0),
    y: Number(m.impedance ?? m.y ?? 0),
  }));
}

/** Comentarios anclados: { t_from, t_to | null, body } → numerados C1, C2… */
export function normalizarComentarios(cs) {
  return (cs || [])
    .map((cm, i) => ({
      n: cm.n ?? i + 1,
      t_from: Number(cm.t_from),
      t_to: cm.t_to == null ? null : Number(cm.t_to),
      body: cm.body || '',
    }))
    .filter((cm) => Number.isFinite(cm.t_from));
}

/**
 * Marcadores y bandas de microcorte.
 *
 * @param getEvents  función · se lee en cada frame, así el chart no se recrea
 *                   cuando cambia la lista
 * @param c          paleta { signal, alarm, confirm, onSignal, amber }
 * @param escala     1 en pantalla; >1 al exportar (canvas más grande)
 * @param getComentarios  opcional · comentarios anclados (abajo, en ámbar)
 */
export function makeMarkersPlugin(getEvents, c, escala = 1, getComentarios = null) {
  const colorFor = (kind) =>
    kind === 'disconnect' || kind === 'gap' ? c.alarm
    : kind === 'void' ? c.confirm
    : c.signal;

  return {
    id: 'sessionMarkers',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales: { x } } = chart;
      if (!chartArea) return;

      // Bandas de los huecos de datos · el ancho es la duración del corte
      normalizarEventos(getEvents()).filter((e) => e.kind === 'gap').forEach((g) => {
        const dur = Number(g.impedance_change);
        if (!Number.isFinite(dur)) return;
        let xa = x.getPixelForValue(g.elapsed_time - dur);
        let xb = x.getPixelForValue(g.elapsed_time);
        if (xb < chartArea.left || xa > chartArea.right) return;
        xa = Math.max(xa, chartArea.left);
        xb = Math.min(xb, chartArea.right);
        ctx.save();
        ctx.globalAlpha = 0.13;
        ctx.fillStyle = c.alarm;
        ctx.fillRect(xa, chartArea.top, Math.max(xb - xa, 1.5 * escala), chartArea.bottom - chartArea.top);
        ctx.restore();
      });

      // Comentarios de tramo · banda ámbar muy suave
      const color = c.amber || c.signal;
      normalizarComentarios(getComentarios?.()).filter((cm) => cm.t_to != null).forEach((cm) => {
        let xa = x.getPixelForValue(cm.t_from);
        let xb = x.getPixelForValue(cm.t_to);
        if (xb < chartArea.left || xa > chartArea.right) return;
        xa = Math.max(xa, chartArea.left);
        xb = Math.min(xb, chartArea.right);
        ctx.save();
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = color;
        ctx.fillRect(xa, chartArea.top, Math.max(xb - xa, 1.5 * escala), chartArea.bottom - chartArea.top);
        ctx.restore();
      });
    },
    afterDraw(chart) {
      const { ctx, chartArea, scales: { x } } = chart;
      if (!chartArea) return;

      ctx.save();
      normalizarEventos(getEvents()).filter((e) => e.kind !== 'gap').forEach((e) => {
        const xp = x.getPixelForValue(e.elapsed_time);
        if (xp < chartArea.left || xp > chartArea.right) return;
        const col = colorFor(e.kind);

        ctx.beginPath();
        ctx.setLineDash([4 * escala, 4 * escala]);
        ctx.lineWidth = 1 * escala;
        ctx.strokeStyle = col;
        ctx.moveTo(xp, chartArea.top + 16 * escala);
        ctx.lineTo(xp, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Etiqueta: inicial del tipo, o número de la marca manual
        const label = e.kind === 'water' ? 'A'
                    : e.kind === 'void' ? 'M'
                    : e.kind === 'disconnect' ? '!'
                    : String(e.event_number ?? '').padStart(2, '0');
        ctx.font = `600 ${9 * escala}px ${CHART_FONT}`;
        const w = ctx.measureText(label).width + 9 * escala;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(xp - w / 2, chartArea.top + 1 * escala, w, 14 * escala, 3 * escala);
        ctx.fill();
        ctx.fillStyle = c.onSignal;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, xp, chartArea.top + 8 * escala);
      });

      // Comentarios · etiqueta C# abajo, para no pisar las de los eventos
      const color = c.amber || c.signal;
      normalizarComentarios(getComentarios?.()).forEach((cm) => {
        const xa = x.getPixelForValue(cm.t_from);
        const xb = cm.t_to != null ? x.getPixelForValue(cm.t_to) : xa;
        if (xb < chartArea.left || xa > chartArea.right) return;
        const xp = Math.min(Math.max((xa + xb) / 2, chartArea.left + 8 * escala), chartArea.right - 8 * escala);
        if (cm.t_to == null) {
          ctx.beginPath();
          ctx.setLineDash([2 * escala, 3 * escala]);
          ctx.lineWidth = 1 * escala;
          ctx.strokeStyle = color;
          ctx.moveTo(xa, chartArea.top);
          ctx.lineTo(xa, chartArea.bottom - 16 * escala);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        const label = `C${cm.n}`;
        ctx.font = `600 ${9 * escala}px ${CHART_FONT}`;
        const w = ctx.measureText(label).width + 9 * escala;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(xp - w / 2, chartArea.bottom - 15 * escala, w, 14 * escala, 3 * escala);
        ctx.fill();
        ctx.fillStyle = c.onSignal;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, xp, chartArea.bottom - 8 * escala);
      });
      ctx.restore();
    },
  };
}

/** Pinta el fondo detrás de todo · el PNG del PDF no puede ser transparente. */
export const fondoOpaco = (color) => ({
  id: 'fondoOpaco',
  beforeDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, chart.width, chart.height);
    ctx.restore();
  },
});

/** Configuración base de la curva · la comparten pantalla e impresión. */
export function buildChartConfig({ puntos, c, decimar, pointRadius, escala = 1, tooltip = true, fondo = null }) {
  const fuente = { family: CHART_FONT, size: 10 * escala };
  const eje = (titulo) => ({
    type: 'linear',
    title: { display: true, text: titulo, color: c.mute, font: fuente },
    ticks: { color: c.mute, font: fuente },
    grid: { color: c.grid, drawTicks: false },
    border: { color: c.grid },
  });

  return {
    type: 'line',
    data: {
      datasets: [...(fondo ? [{
        // Curva original detrás de la editada, en gris
        label: 'Original',
        data: fondo,
        borderColor: c.original || c.mute,
        borderWidth: 1 * escala,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
        order: 2,
      }] : []), {
        label: 'Impedancia',
        order: 1,
        data: puntos,
        borderColor: c.signal,
        borderWidth: 1.4 * escala,
        tension: 0.2,
        pointRadius: pointRadius * escala,
        pointBackgroundColor: c.signal,
        pointBorderWidth: 0,
        pointHoverRadius: 4,
        pointHoverBorderColor: c.onSignal,
        pointHoverBorderWidth: 1.5,
        fill: false,
      }],
    },
    options: {
      responsive: escala === 1,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      devicePixelRatio: escala === 1 ? undefined : 1,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        decimation: { enabled: decimar, algorithm: 'lttb', samples: MUESTRAS_LTTB },
        tooltip: tooltip ? {
          titleFont: { family: CHART_FONT, size: 10 },
          bodyFont:  { family: CHART_FONT, size: 11 },
          callbacks: {
            title: (items) => `t = ${Number(items[0].parsed.x).toFixed(1)} s`,
            label: (item) => `${item.dataset.label === 'Original' ? 'original · ' : ''}${Number(item.parsed.y).toFixed(3)} ohm`,
          },
        } : { enabled: false },
      },
      scales: { x: eje('tiempo (s)'), y: eje('impedancia (ohm)') },
    },
  };
}

/**
 * Rinde la curva fuera del DOM y devuelve un dataURL PNG (o null si no hay
 * datos). Sin animación el primer frame es sincrónico, así que se puede leer
 * el canvas inmediatamente.
 */
export function renderChartPNG({ measurements, events, comments = null, width = 1500, height = 620 } = {}) {
  const puntos = normalizarMuestras(measurements);
  if (puntos.length === 0) return null;

  const escala = 2;   // el PDF la reduce: se rinde al doble
  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;

  const cfg = buildChartConfig({
    puntos,
    c: PALETA_IMPRESION,
    decimar: puntos.length > MUESTRAS_LTTB,
    pointRadius: 0,
    escala,
    tooltip: false,
  });
  cfg.plugins = [
    fondoOpaco(PALETA_IMPRESION.fondo),
    makeMarkersPlugin(() => events, PALETA_IMPRESION, escala, () => comments),
  ];

  const chart = new Chart(canvas, cfg);
  try {
    chart.update('none');
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    chart.destroy();
  }
}
