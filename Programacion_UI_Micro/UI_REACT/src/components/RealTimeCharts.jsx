import React, { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { Camera } from 'lucide-react';

/**
 * Live signal panel · UNA sola card con toggle entre las dos series.
 *
 *  [ Impedancia ]  → Z vs tiempo        · signal indigo line + event markers
 *  [ dZ/dt ]       → derivada temporal   · neutral hairline
 *
 * Antes eran dos charts apilados (~580px de alto). Ahora comparten host
 * y el clínico alterna con un segmented control. Recupera scroll vertical
 * sin perder ninguna de las dos lecturas.
 */
function readToken(name, fallback) {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}

export default function RealTimeCharts({ data, rateData, voltageData = [], events, theme }) {
  const [mode, setMode] = useState('z'); // 'z' | 'rate'
  // Acotado de ejes · ventana temporal (segundos o 'all') y límites de magnitud
  const [timeWin, setTimeWin] = useState('all');
  const [yMin, setYMin]       = useState('');
  const [yMax, setYMax]       = useState('');
  // Zoom por selección (arrastre): { xMin, xMax, yMin, yMax } · pisa a los demás
  const [zoom, setZoom]       = useState(null);
  const [dragBox, setDragBox] = useState(null);   // rectángulo en píxeles, mientras arrastrás
  const hostRef = useRef(null);
  const dragRef = useRef(null);
  const modeRef   = useRef(mode);
  const canvasRef = useRef(null);
  const instRef   = useRef(null);
  const eventsRef = useRef(events);

  useEffect(() => { eventsRef.current = events; }, [events]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const palette = () => ({
    signal: readToken('--signal', 'oklch(0.640 0.180 268)'),
    type:   readToken('--type-med', '#9ca3af'),
    mute:   readToken('--type-mute', '#666'),
    grid:   readToken('--hairline', 'rgba(255,255,255,0.06)'),
    bg:     readToken('--ink-1', '#181818'),
    alarm:  readToken('--alarm', '#e5484d'),
  });

  /* Plugin · bandas de microcorte.
   * Marca el intervalo donde se perdieron muestras (evento kind 'gap':
   * `time` es el instante en que volvieron los datos y `change` la duración
   * del hueco en segundos). Se dibuja ANTES del dataset para que la curva
   * quede por encima de la banda. Aplica a las tres series: el hueco de
   * transmisión afecta a todas por igual. */
  const gapBandsPlugin = {
    id: 'gapBands',
    beforeDatasetsDraw(chart) {
      const evts = eventsRef.current;
      if (!evts || evts.length === 0) return;
      const { ctx, chartArea, scales: { x } } = chart;
      if (!chartArea) return;

      const p = palette();
      const gaps = evts.filter((e) => e.kind === 'gap' && Number.isFinite(Number(e.change)));
      if (gaps.length === 0) return;

      ctx.save();
      gaps.forEach((g) => {
        const tEnd   = Number(g.time);
        const tStart = tEnd - Number(g.change);

        // Recortamos al área visible (con zoom o ventana puede quedar fuera)
        let xa = x.getPixelForValue(tStart);
        let xb = x.getPixelForValue(tEnd);
        if (xb < chartArea.left || xa > chartArea.right) return;
        xa = Math.max(xa, chartArea.left);
        xb = Math.min(xb, chartArea.right);

        const w = Math.max(xb - xa, 1.5);   // visible aunque el hueco sea corto
        const h = chartArea.bottom - chartArea.top;

        // Fondo tenue · usamos globalAlpha porque el canvas 2D no soporta
        // color-mix(); así funciona con cualquier formato del token (hex/oklch).
        ctx.globalAlpha = 0.13;
        ctx.fillStyle = p.alarm;
        ctx.fillRect(xa, chartArea.top, w, h);
        ctx.globalAlpha = 1;

        // Bordes punteados
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = p.alarm;
        ctx.moveTo(xa, chartArea.top);
        ctx.lineTo(xa, chartArea.bottom);
        ctx.moveTo(xb, chartArea.top);
        ctx.lineTo(xb, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
      });
      ctx.restore();
    },
  };

  // Plugin · event markers (solo en modo impedancia)
  const eventLinesPlugin = {
    id: 'eventLines',
    afterDraw(chart) {
      if (modeRef.current !== 'z') return;
      const evts = eventsRef.current;
      if (!evts || evts.length === 0) return;
      const { ctx, chartArea, scales: { x } } = chart;
      if (!chartArea) return;

      const p = palette();
      ctx.save();
      evts.forEach((evt) => {
        const xp = x.getPixelForValue(evt.time);
        if (xp < chartArea.left || xp > chartArea.right) return;

        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = p.signal;
        ctx.moveTo(xp, chartArea.top + 18);
        ctx.lineTo(xp, chartArea.bottom);
        ctx.stroke();

        ctx.setLineDash([]);
        const label = `${evt.id.toString().padStart(2, '0')}`;
        ctx.font = '600 10px Montserrat, system-ui, sans-serif';
        const labelWidth = ctx.measureText(label).width + 10;
        ctx.fillStyle = p.signal;
        ctx.beginPath();
        ctx.roundRect(xp - labelWidth / 2, chartArea.top + 2, labelWidth, 16, 3);
        ctx.fill();

        ctx.fillStyle = readToken('--signal-on', '#fff');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, xp, chartArea.top + 10);
      });
      ctx.restore();
    },
  };

  // Configuración de ejes según el modo actual
  const axisConfig = (p, m, lim = {}) => ({
    x: {
      type: 'linear',
      ...(lim.xMin != null ? { min: lim.xMin } : {}),
      ...(lim.xMax != null ? { max: lim.xMax } : {}),
      title: { display: true, text: 'tiempo (s)', color: p.mute, font: { size: 10, weight: '500', family: 'Montserrat' } },
      ticks: { color: p.mute, font: { size: 10, family: 'Montserrat' } },
      grid:  { color: p.grid, drawTicks: false },
      border: { color: p.grid },
    },
    y: {
      type: 'linear',
      ...(lim.yMin != null ? { min: lim.yMin } : {}),
      ...(lim.yMax != null ? { max: lim.yMax } : {}),
      title: {
        display: true,
        text: m === 'z' ? 'impedancia (Ω)' : m === 'v' ? 'tensión (V)' : 'Ω/min',
        color: p.mute,
        font: { size: 10, weight: '500', family: 'Montserrat' },
      },
      ticks: { color: p.mute, font: { size: 10, family: 'Montserrat' } },
      grid:  { color: p.grid, drawTicks: false },
      border: { color: p.grid },
    },
  });

  // Crear el chart una sola vez
  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const p = palette();
    instRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Impedancia',
          data,
          borderColor: p.signal,
          backgroundColor: 'transparent',
          tension: 0.24,
          borderWidth: 1.6,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: p.signal,
          pointHoverBorderColor: readToken('--signal-on', '#fff'),
          pointHoverBorderWidth: 1.5,
        }],
      },
      plugins: [gapBandsPlugin, eventLinesPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        // Requisitos del plugin decimation: sin parsing y datos {x,y}
        // ordenados por x (los buffers del Dashboard ya cumplen ambos).
        parsing: false,
        normalized: true,
        interaction: { intersect: false, mode: 'index' },
        scales: axisConfig(p, 'z'),
        plugins: {
          legend: { display: false },
          /* Decimación LTTB · sesiones largas (horas a 4 Hz) acumulan
           * decenas de miles de puntos; dibujarlos todos degrada la UI.
           * Por encima de `threshold` puntos, Chart.js reduce la serie a
           * `samples` muestras visualmente representativas. El dataset
           * completo queda intacto para export y cloud commit. */
          decimation: {
            enabled: true,
            algorithm: 'lttb',
            samples: 500,
            threshold: 1000,
          },
          tooltip: {
            backgroundColor: p.bg,
            titleColor: readToken('--type-hi', '#fff'),
            bodyColor: p.type,
            borderColor: readToken('--hairline-strong', '#444'),
            borderWidth: 1,
            padding: 10,
            displayColors: false,
            titleFont:  { family: 'Montserrat', size: 10 },
            bodyFont:   { family: 'Montserrat', size: 11 },
            callbacks: {
              title: (c) => `t = ${c[0].parsed.x.toFixed(1)} s`,
              // Un caso por modo. Antes eran dos ramas y el modo 'v' caía en
              // el else: la tensión se rotulaba como "dZ/dt ... Ω/min".
              label: (c) => {
                const v = c.parsed.y;
                if (modeRef.current === 'z') return `Z = ${v.toFixed(2)} Ω`;
                if (modeRef.current === 'v') return `V = ${v.toFixed(4)} V`;
                return `dZ/dt = ${v.toFixed(2)} Ω/min`;
              },
            },
          },
        },
      },
    });
    return () => { instRef.current?.destroy(); instRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Actualizar datos / modo / tema
  useEffect(() => {
    const inst = instRef.current;
    if (!inst) return;
    const p = palette();
    const ds = inst.data.datasets[0];

    if (mode === 'z') {
      ds.label = 'Impedancia';
      ds.data = data;
      ds.borderColor = p.signal;
      ds.borderWidth = 1.6;
      ds.tension = 0.24;
    } else if (mode === 'v') {
      ds.label = 'Tensión';
      ds.data = voltageData;
      ds.borderColor = p.type;
      ds.borderWidth = 1.4;
      ds.tension = 0.24;
    } else {
      ds.label = 'Tasa';
      ds.data = rateData;
      ds.borderColor = p.type;
      ds.borderWidth = 1.2;
      ds.tension = 0.2;
    }

    // ── Recorte de la serie ──────────────────────────────────────────────
    // IMPORTANTE: filtramos los PUNTOS (no solo el eje X). Si solo se acota el
    // eje, Chart.js sigue autoescalando Y sobre TODO el dataset y la curva
    // visible queda aplastada. Filtrando, el eje Y se ajusta a lo que se ve.
    const series = mode === 'z' ? data : mode === 'v' ? voltageData : rateData;
    const lastX  = series && series.length ? series[series.length - 1].x : 0;

    const yLo = parseFloat(yMin);
    const yHi = parseFloat(yMax);

    let visible = series;
    let lim;

    if (zoom) {
      visible = series.filter((pt) => pt.x >= zoom.xMin && pt.x <= zoom.xMax);
      lim = { xMin: zoom.xMin, xMax: zoom.xMax, yMin: zoom.yMin, yMax: zoom.yMax };
    } else if (timeWin !== 'all') {
      // El eje X muestra SIEMPRE la ventana completa (300 s = 300 s de eje),
      // aunque la sesión todavía no llegue: la curva queda comprimida a la
      // izquierda y el encuadre se mantiene estable mientras se llena.
      const win  = Number(timeWin);
      const from = Math.max(0, lastX - win);
      visible = series.filter((pt) => pt.x >= from);
      lim = {
        xMin: from,
        xMax: from + win,
        // Y autoescala sobre lo visible (por eso filtramos los puntos), salvo
        // que haya límites manuales.
        yMin: Number.isFinite(yLo) ? yLo : null,
        yMax: Number.isFinite(yHi) ? yHi : null,
      };
    } else {
      lim = {
        xMin: null,
        xMax: null,
        yMin: Number.isFinite(yLo) ? yLo : null,
        yMax: Number.isFinite(yHi) ? yHi : null,
      };
    }
    ds.data = visible;
    inst.options.scales = axisConfig(p, mode, lim);
    inst.options.plugins.tooltip.backgroundColor = p.bg;
    inst.options.plugins.tooltip.bodyColor = p.type;
    inst.options.plugins.tooltip.borderColor = readToken('--hairline-strong', '#444');
    inst.update('none');
  }, [data, rateData, voltageData, mode, theme, timeWin, yMin, yMax, zoom]);

  // Exponer para el export modal (siempre la instancia visible)
  useEffect(() => {
    window.mainChartInstance = instRef.current;
    return () => { window.mainChartInstance = null; };
  }, [data, events, mode]);

  /* ── Zoom por selección · arrastrar un rectángulo sobre el gráfico ─────
   * Convertimos los píxeles del recuadro a valores de los ejes con las
   * escalas de Chart.js. Doble click (o el botón Auto) vuelve a la vista
   * completa. Implementado a mano: evita sumar chartjs-plugin-zoom. */
  const pointerToValues = (clientX, clientY) => {
    const inst = instRef.current;
    if (!inst) return null;
    const rect = inst.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    return {
      x: inst.scales.x.getValueForPixel(px),
      y: inst.scales.y.getValueForPixel(py),
    };
  };

  const handleDragStart = (e) => {
    if (e.button !== 0) return;
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    dragRef.current = { x0: e.clientX, y0: e.clientY };
    setDragBox({ left: e.clientX - r.left, top: e.clientY - r.top, width: 0, height: 0 });
  };

  const handleDragMove = (e) => {
    if (!dragRef.current) return;
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const { x0, y0 } = dragRef.current;
    setDragBox({
      left:  Math.min(x0, e.clientX) - r.left,
      top:   Math.min(y0, e.clientY) - r.top,
      width:  Math.abs(e.clientX - x0),
      height: Math.abs(e.clientY - y0),
    });
  };

  const handleDragEnd = (e) => {
    const start = dragRef.current;
    dragRef.current = null;
    setDragBox(null);
    if (!start) return;

    // Arrastres muy chicos = click accidental
    if (Math.abs(e.clientX - start.x0) < 12 || Math.abs(e.clientY - start.y0) < 12) return;

    const a = pointerToValues(start.x0, start.y0);
    const b = pointerToValues(e.clientX, e.clientY);
    if (!a || !b) return;

    const next = {
      xMin: Math.min(a.x, b.x),
      xMax: Math.max(a.x, b.x),
      yMin: Math.min(a.y, b.y),
      yMax: Math.max(a.y, b.y),
    };
    if (!Number.isFinite(next.xMin) || !Number.isFinite(next.yMin)) return;
    setZoom(next);
  };

  const resetView = () => {
    setZoom(null);
    setYMin('');
    setYMax('');
    setTimeWin('all');
  };

  /** Duración registrada (s) de la serie visible · define qué ventanas aplican. */
  const seriesForSpan = mode === 'z' ? data : mode === 'v' ? voltageData : rateData;
  const recordedSpan = seriesForSpan && seriesForSpan.length
    ? seriesForSpan[seriesForSpan.length - 1].x
    : 0;

  const fmtSpan = (s) => {
    if (s < 60) return `${Math.floor(s)} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  };

  const onExport = () => {
    if (!instRef.current) return;
    const link = document.createElement('a');
    link.download = `chidori_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = instRef.current.toBase64Image();
    link.click();
  };

  return (
    <section className="surface" style={{ padding: '16px 18px 8px' }}>
      <header className="section-head" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 'var(--t-lg)' }}>Señal en vivo</h2>
          <span className="section-label" style={{ display: 'block', marginTop: 4 }}>
            {mode === 'z'
              ? 'Impedancia · módulo del tejido vesical'
              : mode === 'v'
                ? 'Tensión de lectura · Vpp del detector'
                : 'dZ/dt · velocidad de llenado'}
          </span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div className="segment segment-compact" role="tablist" aria-label="Serie a visualizar">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'z'}
              className={`segment-item ${mode === 'z' ? 'active' : ''}`}
              onClick={() => setMode('z')}
            >
              Impedancia
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'rate'}
              className={`segment-item ${mode === 'rate' ? 'active' : ''}`}
              onClick={() => setMode('rate')}
            >
              dZ/dt
            </button>
            {/* Solo si el firmware reporta tensión */}
            {voltageData.length > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'v'}
                className={`segment-item ${mode === 'v' ? 'active' : ''}`}
                onClick={() => setMode('v')}
              >
                Tensión
              </button>
            )}
          </div>
          <button type="button" className="icon-button" onClick={onExport} aria-label="Exportar gráfico">
            <Camera size={15} />
          </button>
        </div>
      </header>
      {/* ── Acotado de ejes ─────────────────────────────────────────── */}
      <div className="chart-axis-bar">
        <div className="segment segment-compact" role="group" aria-label="Ventana temporal">
          {[['all', 'Todo'], [300, '5 min'], [900, '15 min'], [3600, '1 h']].map(([val, label]) => (
            <button
              key={label}
              type="button"
              className={`segment-item ${String(timeWin) === String(val) ? 'active' : ''}`}
              onClick={() => setTimeWin(val)}
              title={val === 'all'
                ? `Toda la sesión · ${fmtSpan(recordedSpan)}`
                : `Escala fija de ${label} (la sesión lleva ${fmtSpan(recordedSpan)})`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="chart-axis-fields">
          <label className="chart-axis-label" htmlFor="y-min">
            {mode === 'z' ? 'Ω' : mode === 'v' ? 'V' : 'Ω/min'} mín
          </label>
          <input
            id="y-min"
            className="input input-xs numeric"
            type="number"
            step="any"
            placeholder="auto"
            value={yMin}
            onChange={(e) => setYMin(e.target.value)}
          />
          <label className="chart-axis-label" htmlFor="y-max">máx</label>
          <input
            id="y-max"
            className="input input-xs numeric"
            type="number"
            step="any"
            placeholder="auto"
            value={yMax}
            onChange={(e) => setYMax(e.target.value)}
          />
          {(yMin !== '' || yMax !== '' || timeWin !== 'all' || zoom) && (
            <button
              type="button"
              className="button button-ghost button-sm"
              onClick={resetView}
              title="Volver a la vista completa"
            >
              {zoom ? 'Quitar zoom' : 'Auto'}
            </button>
          )}
        </div>
      </div>

      <div
        className="chart-host"
        ref={hostRef}
        onMouseDown={handleDragStart}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={() => { dragRef.current = null; setDragBox(null); }}
        onDoubleClick={resetView}
        style={{ cursor: 'crosshair', position: 'relative' }}
        title="Arrastrá para hacer zoom · doble click para volver"
      >
        <canvas ref={canvasRef} />
        {dragBox && (
          <div
            className="chart-drag-box"
            style={{
              left: dragBox.left,
              top: dragBox.top,
              width: dragBox.width,
              height: dragBox.height,
            }}
          />
        )}
      </div>
    </section>
  );
}
