import React, { useMemo } from 'react';
import NumberTicker from './NumberTicker';
import Sparkline from './Sparkline';

const SPARK_WINDOW = 40;

/**
 * Readout strip · jerárquico, hero + 2 satélites.
 *
 *   [ HERO · Z actual + sparkline ]  [ Z basal ]  [ Tasa + sparkline ]
 *
 * El cronómetro de sesión y el contador de eventos ya no viven acá: pasaron
 * a la barra de comando (timer) y al tab de eventos. Esto deja al readout
 * enfocado en las tres magnitudes que el clínico mira en vivo.
 */
export default function StatsGrid({
  initialValue,
  currentValue,
  /* Tendencia · mediana móvil de 60 s. Es lo que se muestra en grande: la
   * muestra cruda tiene artefactos de movimiento de hasta 4 Ω sobre una señal
   * de sesión de 1,8 Ω, así que como número principal es ilegible. El crudo
   * no se esconde: va abajo, en chico. */
  trendValue = null,
  /* La última muestra se apartó de la tendencia más de lo que explica el
   * ruido → el paciente se movió. */
  artifact = false,
  rate,
  voltage = null,
  voltageIsRaw = false,
  zHistory,
  rateHistory,
  stale = false,
}) {
  const zSpark = useMemo(
    () => (Array.isArray(zHistory) ? zHistory.slice(-SPARK_WINDOW) : []),
    [zHistory],
  );
  const rateSpark = useMemo(
    () => (Array.isArray(rateHistory) ? rateHistory.slice(-SPARK_WINDOW) : []),
    [rateHistory],
  );
  // Valor principal · tendencia si ya hay, crudo mientras se llena la ventana
  const shown = trendValue != null ? trendValue : currentValue;
  const diff = (initialValue != null && shown != null)
    ? shown - initialValue
    : null;
  const pct = (diff != null && initialValue) ? (diff / initialValue) * 100 : null;

  const diffStateClass = diff == null || diff === 0 ? '' : diff < 0 ? 'neg-state' : 'pos-state';
  const rateStateClass = rate == null || rate === 0 ? '' : rate < 0 ? 'neg-state' : 'pos-state';

  return (
    <div
      className={`readout ${voltage != null ? 'readout-4' : 'readout-3'} ${stale ? 'is-stale' : ''}`}
      role="group"
      aria-label={stale ? 'Lectura desactualizada · sin datos del dispositivo' : 'Lectura en vivo'}
    >
      {/* HERO · impedancia · tendencia de 60 s */}
      <div className="readout-cell hero">
        <span className="readout-label">
          Impedancia actual
          {trendValue != null && <span className="mute"> · tendencia 60 s</span>}
        </span>
        <span className={`readout-value numeric ${diffStateClass}`}>
          <NumberTicker value={shown} decimals={2} stiffness={170} damping={26} />
          <span className="readout-unit" style={{ marginLeft: 8, fontFamily: 'var(--font-mono)' }}>Ω</span>
        </span>
        {diff != null && (
          <span className={`readout-delta ${diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}`}>
            <span>
              {diff >= 0 ? '+' : ''}
              <NumberTicker value={diff} decimals={2} stiffness={140} damping={24} /> Ω
            </span>
            <span className="mute">
              · {pct >= 0 ? '+' : ''}
              <NumberTicker value={pct} decimals={1} stiffness={140} damping={24} />%
            </span>
          </span>
        )}
        {/* Lectura cruda · el dato instantáneo sigue a la vista, en segundo
            plano, junto con el aviso de movimiento. Así el clínico entiende
            por qué el número grande no salta cuando el paciente se mueve. */}
        {currentValue != null && trendValue != null && (
          <span className="readout-delta mute" style={{ gap: 8 }}>
            <span>crudo {currentValue.toFixed(2)} Ω</span>
            {artifact && (
              <span className="pill warn-state" title="La lectura se apartó de la tendencia más de lo que explica el ruido: el paciente se movió. No se descarta ningún dato.">
                movimiento
              </span>
            )}
          </span>
        )}
        <div className="readout-spark">
          <Sparkline data={zSpark} width={260} height={38} state={diff < 0 ? 'neg' : diff > 0 ? 'pos' : null} />
        </div>
      </div>

      {/* Basal · cambia poco, spring más rígido */}
      <div className="readout-cell">
        <span className="readout-label">Basal</span>
        <span className="readout-value numeric">
          <NumberTicker value={initialValue} decimals={2} stiffness={220} damping={30} />
          <span className="readout-unit" style={{ marginLeft: 6 }}>Ω</span>
        </span>
        <span className="readout-delta mute">Mediana del primer minuto</span>
      </div>

      {/* Tasa · pendiente robusta sobre 5 min. Con 3 decimales: la señal real
          de llenado es del orden de 0,02 Ω/min, con 2 decimales se veía
          siempre 0,00 o -0,02 y no se distinguía nada. */}
      <div className="readout-cell">
        <span className="readout-label">Tasa</span>
        <span className={`readout-value numeric ${rateStateClass}`}>
          {rate == null
            ? <span className="mute">—</span>
            : <NumberTicker value={rate} decimals={3} stiffness={110} damping={22} />}
          <span className="readout-unit" style={{ marginLeft: 6 }}>Ω/min</span>
        </span>
        <span className="readout-delta mute">
          {rate == null ? 'Necesita ~3 min de sesión' : 'Pendiente sobre 5 min'}
        </span>
        <div className="readout-spark">
          <Sparkline data={rateSpark} width={160} height={30} state={rate < 0 ? 'neg' : rate > 0 ? 'pos' : null} />
        </div>
      </div>

      {/* Tensión de lectura · diagnóstico.
          Con el firmware nuevo es la CONTINUA MEDIDA en A0: el único de los
          valores de la cadena que corresponde a un nodo real y se puede
          contrastar con el tester. Con firmware viejo llega la Vpp
          reconstruida, que no es medible en ningún punto — de ahí el rótulo
          distinto. */}
      {voltage != null && (
        <div className="readout-cell">
          <span className="readout-label">Tensión de lectura</span>
          <span className="readout-value numeric">
            <NumberTicker value={voltage} decimals={4} stiffness={140} damping={24} />
            <span className="readout-unit" style={{ marginLeft: 6 }}>V</span>
          </span>
          <span className="readout-delta mute">
            {voltageIsRaw ? 'continua medida en A0' : 'Vpp reconstruida'}
          </span>
        </div>
      )}
    </div>
  );
}
