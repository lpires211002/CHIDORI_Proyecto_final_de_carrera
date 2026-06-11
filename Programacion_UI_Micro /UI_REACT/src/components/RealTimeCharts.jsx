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

export default function RealTimeCharts({ data, rateData, events, theme }) {
  const [mode, setMode] = useState('z'); // 'z' | 'rate'
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
  });

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
        ctx.font = '500 10px "IBM Plex Mono", monospace';
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
  const axisConfig = (p, m) => ({
    x: {
      type: 'linear',
      title: { display: true, text: 'tiempo (s)', color: p.mute, font: { size: 10, weight: '500', family: 'IBM Plex Mono' } },
      ticks: { color: p.mute, font: { size: 10, family: 'IBM Plex Mono' } },
      grid:  { color: p.grid, drawTicks: false },
      border: { color: p.grid },
    },
    y: {
      type: 'linear',
      title: {
        display: true,
        text: m === 'z' ? 'impedancia (Ω)' : 'Ω/min',
        color: p.mute,
        font: { size: 10, weight: '500', family: 'IBM Plex Mono' },
      },
      ticks: { color: p.mute, font: { size: 10, family: 'IBM Plex Mono' } },
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
      plugins: [eventLinesPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        interaction: { intersect: false, mode: 'index' },
        scales: axisConfig(p, 'z'),
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: p.bg,
            titleColor: readToken('--type-hi', '#fff'),
            bodyColor: p.type,
            borderColor: readToken('--hairline-strong', '#444'),
            borderWidth: 1,
            padding: 10,
            displayColors: false,
            titleFont:  { family: 'IBM Plex Mono', size: 10 },
            bodyFont:   { family: 'IBM Plex Mono', size: 11 },
            callbacks: {
              title: (c) => `t = ${c[0].parsed.x.toFixed(1)} s`,
              label: (c) => (modeRef.current === 'z'
                ? `Z = ${c.parsed.y.toFixed(2)} Ω`
                : `dZ/dt = ${c.parsed.y.toFixed(2)} Ω/min`),
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
    } else {
      ds.label = 'Tasa';
      ds.data = rateData;
      ds.borderColor = p.type;
      ds.borderWidth = 1.2;
      ds.tension = 0.2;
    }

    inst.options.scales = axisConfig(p, mode);
    inst.options.plugins.tooltip.backgroundColor = p.bg;
    inst.options.plugins.tooltip.bodyColor = p.type;
    inst.options.plugins.tooltip.borderColor = readToken('--hairline-strong', '#444');
    inst.update('none');
  }, [data, rateData, mode, theme]);

  // Exponer para el export modal (siempre la instancia visible)
  useEffect(() => {
    window.mainChartInstance = instRef.current;
    return () => { window.mainChartInstance = null; };
  }, [data, events, mode]);

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
          </div>
          <button type="button" className="icon-button" onClick={onExport} aria-label="Exportar gráfico">
            <Camera size={15} />
          </button>
        </div>
      </header>
      <div className="chart-host">
        <canvas ref={canvasRef} />
      </div>
    </section>
  );
}
