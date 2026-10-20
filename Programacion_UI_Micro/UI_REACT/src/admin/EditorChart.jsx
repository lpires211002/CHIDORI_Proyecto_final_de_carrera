import { useCallback, useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { buildChartConfig, makeMarkersPlugin } from '../lib/chartImage';
import { CHART_FONT } from '../lib/chartFont';
import { fmtTiempo } from '../lib/edicion';

/**
 * Gráfico del editor de curva.
 *
 * Trabaja en la base de tiempo ORIGINAL de la sesión (la de los parámetros):
 * la curva original va en gris detrás y la editada encima, dibujada en el
 * tiempo original de cada muestra. Así lo que se marca acá es exactamente lo
 * que se guarda, sin conversiones.
 *
 * Interacción según la herramienta:
 *   navegar      arrastrar = desplazar · Ctrl/⌘ + rueda = zoom
 *   lupa         arrastrar = acercar a ese tramo
 *   el resto     arrastrar = marcar un tramo · click = un instante
 *
 * Quien lo usa recibe { desde, hasta, click, t } en onSeleccion y decide.
 */

function readToken(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}

const VACIO = [];
const UMBRAL_CLICK_PX = 4;

export default function EditorChart({
  original = VACIO,       // [{ elapsed_time, impedance }]   · base original
  editada = VACIO,        // [{ t_orig, impedance, ... }]     · se dibuja en t_orig
  eventos = VACIO,        // [{ elapsed_time (orig), kind, event_number }]
  comentarios = VACIO,    // [{ t_from, t_to, body }]        · base original
  overlay = null,         // { lo, hi, tramos, basal, final, foco }
  herramienta = 'navegar',
  onSeleccion,
  pedidoVista = null,     // { desde, hasta } · llevar ese tramo a pantalla
  height = 340,
}) {
  const canvasRef = useRef(null);
  const instRef = useRef(null);
  const overlayRef = useRef(overlay);
  const eventosRef = useRef(eventos);
  const comentariosRef = useRef(comentarios);
  const previewRef = useRef(null);       // { a, b } mientras se arrastra
  const herrRef = useRef(herramienta);
  const selRef = useRef(onSeleccion);
  const limitesRef = useRef({ min: 0, max: 1 });
  const [vista, setVista] = useState(null);   // { min, max } | null = todo
  const vistaRef = useRef(vista);

  useEffect(() => { overlayRef.current = overlay; instRef.current?.draw(); }, [overlay]);
  useEffect(() => { eventosRef.current = eventos; instRef.current?.draw(); }, [eventos]);
  useEffect(() => { comentariosRef.current = comentarios; instRef.current?.draw(); }, [comentarios]);
  useEffect(() => { herrRef.current = herramienta; }, [herramienta]);
  useEffect(() => { selRef.current = onSeleccion; }, [onSeleccion]);
  useEffect(() => { vistaRef.current = vista; }, [vista]);

  // Límites de la sesión entera
  useEffect(() => {
    if (!original.length) return;
    limitesRef.current = {
      min: Number(original[0].elapsed_time),
      max: Number(original[original.length - 1].elapsed_time),
    };
  }, [original]);

  /* ── creación (una vez) ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const c = {
      signal:   readToken('--signal', '#6366f1'),
      alarm:    readToken('--alarm', '#e5484d'),
      confirm:  readToken('--confirm', '#30a46c'),
      amber:    readToken('--amber', '#d97706'),
      onSignal: readToken('--signal-on', '#fff'),
      mute:     readToken('--type-mute', '#666'),
      original: readToken('--hairline-strong', '#888'),
      grid:     readToken('--hairline', 'rgba(255,255,255,0.06)'),
      hi:       readToken('--type-hi', '#eee'),
    };

    const cfg = buildChartConfig({ puntos: [], c, decimar: true, pointRadius: 0, fondo: [] });
    cfg.options.scales.x.title.text = 'tiempo del registro original (mm:ss)';
    cfg.options.scales.x.ticks.callback = (v) => fmtTiempo(v);
    cfg.options.plugins.tooltip.callbacks.title = (items) => `t = ${fmtTiempo(items[0].parsed.x, 1)} (original)`;

    // Capas del editor: lo que queda afuera del recorte, tramos, basal/final,
    // la selección en curso.
    const capas = {
      id: 'capasEditor',
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea, scales: { x } } = chart;
        const ov = overlayRef.current;
        if (!chartArea || !ov) return;
        const banda = (a, b, color, alpha) => {
          let xa = x.getPixelForValue(a);
          let xb = x.getPixelForValue(b);
          if (xb < chartArea.left || xa > chartArea.right) return null;
          xa = Math.max(xa, chartArea.left);
          xb = Math.min(xb, chartArea.right);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = color;
          ctx.fillRect(xa, chartArea.top, Math.max(xb - xa, 1.5), chartArea.bottom - chartArea.top);
          ctx.restore();
          return [xa, xb];
        };
        const rotulo = (texto, xa, xb, color, arriba = true) => {
          if (xb - xa < 14) return;
          ctx.save();
          ctx.font = `600 9px ${CHART_FONT}`;
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(texto, (xa + xb) / 2, arriba ? chartArea.top + 24 : chartArea.bottom - 26);
          ctx.restore();
        };
        const { min, max } = limitesRef.current;
        // fuera del recorte: velo
        if (ov.lo != null && ov.lo > min) banda(-1e9, ov.lo, c.mute, 0.22);
        if (ov.hi != null && ov.hi < max) banda(ov.hi, 1e9, c.mute, 0.22);
        (ov.tramos || []).forEach((r) => {
          const px = banda(r.desde, r.hasta, c.amber, 0.20);
          if (px) rotulo('interpolado', px[0], px[1], c.amber);
        });
        if (ov.basal) {
          const px = banda(ov.basal[0], ov.basal[1], c.confirm, 0.18);
          if (px) rotulo('basal', px[0], px[1], c.confirm, false);
        }
        if (ov.final) {
          const px = banda(ov.final[0], ov.final[1], c.confirm, 0.18);
          if (px) rotulo('final', px[0], px[1], c.confirm, false);
        }
        if (ov.foco) banda(ov.foco[0], ov.foco[1], c.hi, 0.08);
        const pv = previewRef.current;
        if (pv) {
          const a = Math.min(pv.a, pv.b);
          const b = Math.max(pv.a, pv.b);
          banda(a, b, c.signal, 0.22);
        }
      },
    };

    cfg.plugins = [
      capas,
      makeMarkersPlugin(() => eventosRef.current, c, 1, () => comentariosRef.current),
    ];
    const inst = new Chart(canvasRef.current, cfg);
    instRef.current = inst;
    return () => { inst.destroy(); instRef.current = null; };
  }, []);

  /* ── datos ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    const inst = instRef.current;
    if (!inst) return;
    inst.data.datasets[0].data = original.map((m) => ({ x: Number(m.elapsed_time), y: Number(m.impedance) }));
    inst.data.datasets[1].data = editada.map((m) => ({ x: Number(m.t_orig), y: Number(m.impedance) }));
    inst.update('none');
  }, [original, editada]);

  /* ── vista (zoom) ───────────────────────────────────────────────────── */
  useEffect(() => {
    const inst = instRef.current;
    if (!inst) return;
    inst.options.scales.x.min = vista ? vista.min : undefined;
    inst.options.scales.x.max = vista ? vista.max : undefined;
    inst.update('none');
  }, [vista]);

  const ponerVista = useCallback((min, max) => {
    const L = limitesRef.current;
    const span = L.max - L.min;
    let a = Math.max(L.min, Math.min(min, max));
    let b = Math.min(L.max, Math.max(min, max));
    if (b - a < 5) {                 // nunca menos de 5 s en pantalla
      const c = (a + b) / 2;
      a = Math.max(L.min, c - 2.5);
      b = Math.min(L.max, c + 2.5);
    }
    if (b - a >= span * 0.999) setVista(null);
    else setVista({ min: a, max: b });
  }, []);

  useEffect(() => {
    if (!pedidoVista) return;
    const d = Math.max(20, (pedidoVista.hasta - pedidoVista.desde) * 0.6);
    ponerVista(pedidoVista.desde - d, pedidoVista.hasta + d);
  }, [pedidoVista, ponerVista]);

  const zoom = useCallback((factor, centro = null) => {
    const L = limitesRef.current;
    const v = vistaRef.current || { min: L.min, max: L.max };
    const c = centro ?? (v.min + v.max) / 2;
    ponerVista(c - (c - v.min) * factor, c + (v.max - c) * factor);
  }, [ponerVista]);

  /* ── mouse ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return undefined;
    let arrastre = null;     // { px0, t0, vista0 }

    const tDe = (ev) => {
      const inst = instRef.current;
      if (!inst) return null;
      const r = cv.getBoundingClientRect();
      return inst.scales.x.getValueForPixel(ev.clientX - r.left);
    };
    const dentroDelArea = (ev) => {
      const inst = instRef.current;
      if (!inst?.chartArea) return false;
      const r = cv.getBoundingClientRect();
      const px = ev.clientX - r.left;
      const py = ev.clientY - r.top;
      const a = inst.chartArea;
      return px >= a.left && px <= a.right && py >= a.top && py <= a.bottom;
    };

    const down = (ev) => {
      if (ev.button !== 0 || !dentroDelArea(ev)) return;
      const t = tDe(ev);
      if (t == null) return;
      const L = limitesRef.current;
      arrastre = { px0: ev.clientX, t0: t, vista0: vistaRef.current || { min: L.min, max: L.max } };
      cv.setPointerCapture?.(ev.pointerId);
      ev.preventDefault();
    };
    const move = (ev) => {
      if (!arrastre) return;
      const t = tDe(ev);
      if (t == null) return;
      if (herrRef.current === 'navegar') {
        const inst = instRef.current;
        const dx = ev.clientX - arrastre.px0;
        const ancho = inst.chartArea.right - inst.chartArea.left;
        const span = arrastre.vista0.max - arrastre.vista0.min;
        const dt = -dx / ancho * span;
        const L = limitesRef.current;
        let a = arrastre.vista0.min + dt;
        let b = arrastre.vista0.max + dt;
        if (a < L.min) { b += L.min - a; a = L.min; }
        if (b > L.max) { a -= b - L.max; b = L.max; }
        if (span < (L.max - L.min) * 0.999) setVista({ min: a, max: b });
        return;
      }
      previewRef.current = { a: arrastre.t0, b: t };
      instRef.current?.draw();
    };
    const up = (ev) => {
      if (!arrastre) return;
      const a0 = arrastre;
      arrastre = null;
      previewRef.current = null;
      const t = tDe(ev);
      instRef.current?.draw();
      if (t == null || herrRef.current === 'navegar') return;
      const L = limitesRef.current;
      const clamp = (x) => Math.max(L.min, Math.min(L.max, x));
      const esClick = Math.abs(ev.clientX - a0.px0) < UMBRAL_CLICK_PX;
      if (herrRef.current === 'lupa') {
        if (esClick) zoom(0.5, t);
        else ponerVista(a0.t0, t);
        return;
      }
      const desde = clamp(Math.min(a0.t0, t));
      const hasta = clamp(Math.max(a0.t0, t));
      selRef.current?.({ desde, hasta, click: esClick, t: clamp(a0.t0) });
    };
    const rueda = (ev) => {
      if (!(ev.ctrlKey || ev.metaKey || ev.altKey) || !dentroDelArea(ev)) return;
      ev.preventDefault();
      const t = tDe(ev);
      zoom(ev.deltaY > 0 ? 1.25 : 0.8, t);
    };

    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', rueda, { passive: false });
    return () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
      cv.removeEventListener('wheel', rueda);
    };
  }, [zoom, ponerVista]);

  const cursor = herramienta === 'navegar' ? (vista ? 'grab' : 'default')
    : herramienta === 'lupa' ? 'zoom-in' : 'crosshair';

  return (
    <div>
      <div style={{ height, position: 'relative', cursor, touchAction: 'none' }}>
        <canvas ref={canvasRef} />
      </div>
      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="button button-ghost button-sm" onClick={() => zoom(0.5)} title="Acercar">Acercar</button>
        <button type="button" className="button button-ghost button-sm" onClick={() => zoom(2)} disabled={!vista} title="Alejar">Alejar</button>
        <button type="button" className="button button-ghost button-sm" onClick={() => setVista(null)} disabled={!vista}>Ver todo</button>
        {overlay?.lo != null && (
          <button type="button" className="button button-ghost button-sm"
            onClick={() => ponerVista(overlay.lo, overlay.hi)}>Ver el recorte</button>
        )}
        <span className="field-hint" style={{ marginLeft: 'auto' }}>
          {vista
            ? `Viendo ${fmtTiempo(vista.min)} – ${fmtTiempo(vista.max)}`
            : 'Sesión completa'}
          {' · '}Ctrl/⌘ + rueda: zoom
        </span>
      </div>
    </div>
  );
}
