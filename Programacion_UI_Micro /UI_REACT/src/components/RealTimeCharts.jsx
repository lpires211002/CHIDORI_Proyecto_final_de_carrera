import React, { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { Camera } from 'lucide-react';

/**
 * Hero chart pair · the actual instrument readout.
 *
 *  Top:    impedance vs time (Z)         · signal indigo line
 *  Bottom: rate of change (dZ/dt)        · neutral hairline
 *
 * Event markers: dashed signal-color lines + tiny pill IDs at top.
 * Theme is read from a CSS var so the chart follows the design system.
 */
function readToken(name, fallback) {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}

export default function RealTimeCharts({ data, rateData, events, theme }) {
  const mainRef    = useRef(null);
  const rateRef    = useRef(null);
  const mainInst   = useRef(null);
  const rateInst   = useRef(null);
  const eventsRef  = useRef(events);

  // Keep events updated for the plugin without recreating the chart
  useEffect(() => { eventsRef.current = events; }, [events]);

  const palette = () => ({
    signal: readToken('--signal', 'oklch(0.640 0.180 268)'),
    type:   readToken('--type-med', '#9ca3af'),
    mute:   readToken('--type-mute', '#666'),
    grid:   readToken('--hairline', 'rgba(255,255,255,0.06)'),
    bg:     readToken('--ink-1', '#181818'),
  });

  // Plugin · event markers (dashed verticals + numeric pill)
  const eventLinesPlugin = {
    id: 'eventLines',
    afterDraw(chart) {
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

        // Pill
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

  // Main chart (Z vs time)
  useEffect(() => {
    if (!mainRef.current) return;
    const ctx = mainRef.current.getContext('2d');

    if (!mainInst.current) {
      const p = palette();
      mainInst.current = new Chart(ctx, {
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
          scales: {
            x: {
              type: 'linear',
              title: { display: true, text: 'tiempo (s)', color: p.mute, font: { size: 10, weight: '500', family: 'IBM Plex Mono' } },
              ticks: { color: p.mute, font: { size: 10, family: 'IBM Plex Mono' } },
              grid:  { color: p.grid, drawTicks: false },
              border: { color: p.grid },
            },
            y: {
              type: 'linear',
              title: { display: true, text: 'impedancia (Ω)', color: p.mute, font: { size: 10, weight: '500', family: 'IBM Plex Mono' } },
              ticks: { color: p.mute, font: { size: 10, family: 'IBM Plex Mono' } },
              grid:  { color: p.grid, drawTicks: false },
              border: { color: p.grid },
            },
          },
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
                title: (ctx) => `t = ${ctx[0].parsed.x.toFixed(1)} s`,
                label: (ctx) => `Z = ${ctx.parsed.y.toFixed(2)} Ω`,
              },
            },
          },
        },
      });
    } else {
      mainInst.current.data.datasets[0].data = data;
      mainInst.current.update('none');
    }
  }, [data, theme]);

  // Theme change → recolor (no full rebuild needed; just update tokens)
  useEffect(() => {
    [mainInst, rateInst].forEach((ref) => {
      const inst = ref.current;
      if (!inst) return;
      const p = palette();
      const ds = inst.data.datasets[0];
      ds.borderColor = ds === inst.data.datasets[0] && inst === mainInst.current ? p.signal : p.type;
      inst.options.scales.x.ticks.color = p.mute;
      inst.options.scales.x.grid.color  = p.grid;
      inst.options.scales.x.border.color = p.grid;
      inst.options.scales.x.title.color = p.mute;
      inst.options.scales.y.ticks.color = p.mute;
      inst.options.scales.y.grid.color  = p.grid;
      inst.options.scales.y.border.color = p.grid;
      inst.options.scales.y.title.color = p.mute;
      inst.options.plugins.tooltip.backgroundColor = p.bg;
      inst.options.plugins.tooltip.bodyColor = p.type;
      inst.options.plugins.tooltip.borderColor = readToken('--hairline-strong', '#444');
      inst.update('none');
    });
  }, [theme]);

  // Rate chart (dZ/dt)
  useEffect(() => {
    if (!rateRef.current) return;
    const ctx = rateRef.current.getContext('2d');

    if (!rateInst.current) {
      const p = palette();
      rateInst.current = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: [{
            label: 'Tasa',
            data: rateData,
            borderColor: p.type,
            backgroundColor: 'transparent',
            tension: 0.2,
            borderWidth: 1.2,
            pointRadius: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 0 },
          interaction: { intersect: false, mode: 'index' },
          scales: {
            x: {
              type: 'linear',
              title: { display: true, text: 'tiempo (s)', color: p.mute, font: { size: 9, family: 'IBM Plex Mono' } },
              ticks: { color: p.mute, font: { size: 9, family: 'IBM Plex Mono' } },
              grid:  { color: p.grid, drawTicks: false },
              border: { color: p.grid },
            },
            y: {
              type: 'linear',
              title: { display: true, text: 'Ω/min', color: p.mute, font: { size: 9, family: 'IBM Plex Mono' } },
              ticks: { color: p.mute, font: { size: 9, family: 'IBM Plex Mono' } },
              grid:  { color: p.grid, drawTicks: false },
              border: { color: p.grid },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: p.bg,
              titleColor: readToken('--type-hi', '#fff'),
              bodyColor: p.type,
              borderColor: readToken('--hairline-strong', '#444'),
              borderWidth: 1,
              padding: 8,
              displayColors: false,
              titleFont: { family: 'IBM Plex Mono', size: 10 },
              bodyFont:  { family: 'IBM Plex Mono', size: 11 },
              callbacks: {
                label: (c) => `dZ/dt = ${c.parsed.y.toFixed(2)} Ω/min`,
              },
            },
          },
        },
      });
    } else {
      rateInst.current.data.datasets[0].data = rateData;
      rateInst.current.update('none');
    }
  }, [rateData, theme]);

  useEffect(() => () => {
    mainInst.current?.destroy(); mainInst.current = null;
    rateInst.current?.destroy(); rateInst.current = null;
  }, []);

  // Expose for the export modal
  useEffect(() => {
    window.mainChartInstance = mainInst.current;
    return () => { window.mainChartInstance = null; };
  }, [data, events]);

  const onExport = () => {
    if (!mainInst.current) return;
    const link = document.createElement('a');
    link.download = `chidori_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = mainInst.current.toBase64Image();
    link.click();
  };

  return (
    <div className="stack-md">
      <section className="surface" style={{ padding: '20px 22px 6px' }}>
        <header className="section-head" style={{ marginBottom: 12 }}>
          <div>
            <h2>Impedancia · tiempo</h2>
            <span className="section-label" style={{ display: 'block', marginTop: 4 }}>
              Curva en vivo · módulo de impedancia del tejido vesical
            </span>
          </div>
          <button type="button" className="icon-button" onClick={onExport} aria-label="Exportar gráfico">
            <Camera size={15} />
          </button>
        </header>
        <div className="chart-host">
          <canvas ref={mainRef} />
        </div>
      </section>

      <section className="surface" style={{ padding: '18px 22px 6px' }}>
        <header className="section-head" style={{ marginBottom: 10 }}>
          <div>
            <h2 style={{ fontSize: 'var(--t-lg)' }}>Derivada temporal</h2>
            <span className="section-label" style={{ display: 'block', marginTop: 4 }}>
              dZ/dt · indica velocidad de llenado
            </span>
          </div>
        </header>
        <div className="chart-host compact">
          <canvas ref={rateRef} />
        </div>
      </section>
    </div>
  );
}
