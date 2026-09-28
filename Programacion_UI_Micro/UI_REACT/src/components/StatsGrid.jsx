import React from 'react';
import NumberTicker from './NumberTicker';

/**
 * Lecturas en vivo · Impedancia, Tensión de lectura y Tasa, más las celdas
 * plegables que pasa el Dashboard (Volumen estimado y Alarma) en la misma fila.
 *
 * El basal no tiene celda propia: está implícito en el cambio de la impedancia
 * ("… vs basal", con el valor en el tooltip) y visible en Calibración.
 *
 *
 * Rediseño (auditoría sep-2026): antes había una celda "hero" más ancha, dos
 * satélites y una cuarta con la tensión de lectura, cada una con sparkline y
 * un rótulo explicativo. Resultado: cuatro anchos distintos, celdas medio
 * vacías y mucho texto. Ahora:
 *   · tres celdas del mismo ancho, con el mismo esquema (rótulo, valor, una
 *     línea de detalle como máximo);
 *   · sin sparklines: el gráfico de abajo ya muestra la historia;
 *   · las explicaciones (qué es la tendencia, de dónde sale el basal) pasan al
 *     tooltip del rótulo en vez de ocupar pantalla;
 *   · la tensión de lectura sale de acá: es un dato de salud del equipo, no del
 *     paciente. Sigue en la serie "Tensión" del gráfico y en el tooltip del
 *     indicador de conexión.
 *
 * El número grande sigue siendo la TENDENCIA (mediana móvil de 60 s): la
 * muestra cruda tiene artefactos de movimiento de hasta 4 Ω sobre una señal de
 * sesión de ~1,8 Ω. El crudo no se esconde: va en la línea de detalle.
 */
export default function StatsGrid({
  initialValue,
  currentValue,
  trendValue = null,
  artifact = false,
  rate,
  voltage = null,
  voltageIsRaw = false,
  stale = false,
  /* Celdas extra (botones plegables) que viven en la misma grilla */
  trailing = null,
}) {
  const shown = trendValue != null ? trendValue : currentValue;
  const diff = (initialValue != null && shown != null) ? shown - initialValue : null;
  const pct = (diff != null && initialValue) ? (diff / initialValue) * 100 : null;

  const diffStateClass = diff == null || diff === 0 ? '' : diff < 0 ? 'neg-state' : 'pos-state';
  const rateStateClass = rate == null || rate === 0 ? '' : rate < 0 ? 'neg-state' : 'pos-state';
  const sign = (v) => (v >= 0 ? '+' : '−');

  return (
    <div
      className={`readout readout-3 ${trailing ? 'readout-5' : ''} ${stale ? 'is-stale' : ''}`}
      role="group"
      aria-label={stale ? 'Lectura desactualizada · sin datos del dispositivo' : 'Lectura en vivo'}
    >
      {/* Impedancia · tendencia de 60 s */}
      <div className="readout-cell" data-fly="z">
        {/* El aviso de movimiento va en la línea del rótulo: abajo, junto al
            crudo, empujaba un tercer renglón y alargaba toda la fila. */}
        <span className="readout-label readout-label-row">
          <span title="Tendencia: mediana móvil de 60 s. Filtra los movimientos del paciente sin tocar el dato crudo.">
            Impedancia
          </span>
          {artifact && trendValue != null && (
            <span
              className="pill warn-state"
              title="La lectura se apartó de la tendencia más de lo que explica el ruido: el paciente se movió. No se descarta ningún dato."
            >
              movimiento
            </span>
          )}
        </span>
        <span className={`readout-value numeric ${diffStateClass}`}>
          <NumberTicker value={shown} decimals={2} stiffness={170} damping={26} />
          <span className="readout-unit">Ω</span>
        </span>
        <span
          className="readout-delta"
          title={initialValue != null ? `Basal ${initialValue.toFixed(2)} Ω` : 'Sin basal todavía'}
        >
          {diff != null && (
            <span className={diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}>
              {sign(diff)}
              <NumberTicker value={Math.abs(diff)} decimals={2} stiffness={140} damping={24} /> Ω
              <span className="mute">
                {' '}({sign(pct)}<NumberTicker value={Math.abs(pct)} decimals={1} stiffness={140} damping={24} /> %) vs basal
              </span>
            </span>
          )}
        </span>
        {currentValue != null && trendValue != null && (
          <span className="readout-delta mute">
            crudo {currentValue.toFixed(2)} Ω
          </span>
        )}
      </div>

      {/* Tensión de lectura · salud de la cadena de medición.
          Con firmware nuevo es la continua medida en A0 (un nodo real,
          contrastable con el tester); con firmware viejo, la Vpp reconstruida. */}
      <div className="readout-cell" data-fly="v">
        <span
          className="readout-label"
          title={voltageIsRaw
            ? 'Continua medida en A0: se puede contrastar con el tester en el pin.'
            : 'Vpp reconstruida a partir de la lectura (no es un nodo medible del circuito).'}
        >
          Tensión
        </span>
        <span className="readout-value numeric">
          {voltage == null
            ? <span className="mute">—</span>
            : <NumberTicker value={voltage} decimals={4} stiffness={140} damping={24} />}
          <span className="readout-unit">V</span>
        </span>
        <span className="readout-delta mute">
          {voltage == null ? 'sin dato del equipo' : voltageIsRaw ? 'continua en A0' : 'Vpp reconstruida'}
        </span>
      </div>

      {/* Tasa · pendiente robusta sobre 5 min. Tres decimales: el llenado real
          es del orden de 0,02 Ω/min y con dos se veía siempre 0,00. */}
      <div className="readout-cell" data-fly="rate">
        <span
          className="readout-label"
          title="Pendiente robusta sobre los últimos 5 minutos."
        >
          Tasa
        </span>
        <span className={`readout-value numeric ${rateStateClass}`}>
          {rate == null
            ? <span className="mute">—</span>
            : <NumberTicker value={rate} decimals={3} stiffness={110} damping={22} />}
          <span className="readout-unit">Ω/min</span>
        </span>
        <span className="readout-delta mute">
          {rate == null ? 'disponible a los 3 min' : 'últimos 5 min'}
        </span>
      </div>

      {trailing}
    </div>
  );
}
