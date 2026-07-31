import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import {
  buildChartConfig, makeMarkersPlugin, normalizarMuestras,
  renderChartPNG, MUESTRAS_LTTB,
} from '../lib/chartImage';

/**
 * Curva de una sesión ya registrada, con sus marcadores.
 *
 * Usa las mediciones que el detalle ya trajo de la base: no consulta nada
 * extra. Los eventos se dibujan según su tipo, con el mismo código de color
 * que la vista en vivo, para que una sesión archivada se lea igual que una
 * recién tomada:
 *
 *   marca manual → indigo    ingesta → indigo    micción → verde
 *   desconexión  → rojo      microcorte → banda roja translúcida
 *
 * Expone `toPNG()` por ref para incrustar la curva en el PDF (ver
 * lib/chartImage: se re-rinde en paleta clara, el canvas de pantalla es
 * transparente y de tema oscuro).
 */

function readToken(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}

/** A partir de acá el canvas empieza a acusar el trazo punto por punto. */
const UMBRAL_DENSO = 4000;

const SessionChart = forwardRef(function SessionChart(
  { measurements = [], events = [], height = 260, busy = false, loaded = 0 },
  ref,
) {
  const canvasRef = useRef(null);
  const instRef   = useRef(null);
  const eventsRef = useRef(events);
  const measRef   = useRef(measurements);

  const total  = measurements.length;
  const pesado = total > UMBRAL_DENSO;
  // Por defecto se simplifica en sesiones largas; el trazo completo queda a un
  // click. La tabla y los exports siempre tienen las muestras enteras.
  const [completo, setCompleto] = useState(false);
  const simplificar = pesado && !completo;

  useEffect(() => { eventsRef.current = events; }, [events]);
  useEffect(() => { measRef.current = measurements; }, [measurements]);

  useImperativeHandle(ref, () => ({
    toPNG: (opts) => renderChartPNG({
      measurements: measRef.current,
      events: eventsRef.current,
      ...opts,
    }),
  }), []);

  useEffect(() => {
    if (!canvasRef.current || measurements.length === 0) return;

    const c = {
      signal:   readToken('--signal', '#6366f1'),
      alarm:    readToken('--alarm', '#e5484d'),
      confirm:  readToken('--confirm', '#30a46c'),
      onSignal: readToken('--signal-on', '#fff'),
      mute:     readToken('--type-mute', '#666'),
      grid:     readToken('--hairline', 'rgba(255,255,255,0.06)'),
    };

    // Con pocas muestras se dibuja cada punto (es lo que se quiere ver en una
    // sesión corta). Con muchas se pisan entre sí: queda la línea sola.
    const n = measurements.length;
    const radio = n > 2500 ? 0 : n > 1200 ? 1 : n > 400 ? 1.6 : 2.4;

    const cfg = buildChartConfig({
      puntos: normalizarMuestras(measurements),
      c,
      decimar: simplificar,
      pointRadius: radio,
    });
    cfg.plugins = [makeMarkersPlugin(() => eventsRef.current, c)];

    const inst = new Chart(canvasRef.current, cfg);
    instRef.current = inst;
    return () => { inst.destroy(); instRef.current = null; };
  }, [measurements, events, simplificar]);

  const n = (x) => x.toLocaleString('es-AR');

  if (busy) {
    return (
      <div className="surface surface-pad" style={{ marginBottom: 18 }}>
        <span className="section-label">Curva de la sesión</span>
        <span className="field-hint" style={{ display: 'block', marginTop: 6 }}>
          Descargando muestras{loaded > 0 ? ` · ${n(loaded)}` : ''}…
        </span>
      </div>
    );
  }

  if (total === 0) return null;

  return (
    <div className="surface surface-pad" style={{ marginBottom: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
        <span className="section-label">
          Curva de la sesión · {n(total)} puntos
          {events.length > 0 && ` · ${events.length} marcadores`}
        </span>

        {pesado && (
          <button
            type="button"
            className="button button-ghost button-sm"
            onClick={() => setCompleto((v) => !v)}
            title={completo
              ? 'Volver al trazo simplificado (más fluido)'
              : 'Dibujar las muestras una por una · puede tardar unos segundos'}
          >
            {completo ? 'Simplificar trazo' : 'Dibujar todos los puntos'}
          </button>
        )}
      </div>

      <div style={{ height, position: 'relative' }}>
        <canvas ref={canvasRef} />
      </div>

      <span className="field-hint" style={{ marginTop: 8, display: 'block' }}>
        {simplificar
          ? `Trazo simplificado a ~${n(MUESTRAS_LTTB)} puntos para que el gráfico responda; conserva picos y valles. La tabla y los exports usan las ${n(total)} muestras.`
          : `Trazo completo · las ${n(total)} muestras.`}
        {events.length > 0 && (
          <>
            {' '}Marcadores: <strong>A</strong> ingesta · <strong>M</strong> micción ·
            <strong> !</strong> desconexión · número = marca manual ·
            banda roja = microcorte.
          </>
        )}
      </span>
    </div>
  );
});

export default SessionChart;
