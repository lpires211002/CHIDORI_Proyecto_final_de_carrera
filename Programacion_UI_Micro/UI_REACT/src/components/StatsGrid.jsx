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
  const diff = (initialValue != null && currentValue != null)
    ? currentValue - initialValue
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
      {/* HERO · current impedance */}
      <div className="readout-cell hero">
        <span className="readout-label">Impedancia actual</span>
        <span className={`readout-value numeric ${diffStateClass}`}>
          <NumberTicker value={currentValue} decimals={2} stiffness={170} damping={26} />
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
        <span className="readout-delta mute">Referencia inicial</span>
      </div>

      {/* Rate · varía rápido, spring más suelto para suavizar el jitter */}
      <div className="readout-cell">
        <span className="readout-label">Tasa</span>
        <span className={`readout-value numeric ${rateStateClass}`}>
          <NumberTicker value={rate} decimals={2} stiffness={110} damping={22} />
          <span className="readout-unit" style={{ marginLeft: 6 }}>Ω/min</span>
        </span>
        <span className="readout-delta mute">Δ por minuto</span>
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
