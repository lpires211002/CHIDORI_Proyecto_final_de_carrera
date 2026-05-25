import React from 'react';
import NumberTicker from './NumberTicker';

/**
 * Readout strip · hierarchical, hero + 3 satellites.
 *
 *   [ HERO · Z actual ]  [ Z basal ]  [ Tasa ]  [ Sesión ]
 *
 * Cada valor numérico usa NumberTicker con spring physics. Los dígitos
 * cambian con un roll suave + blur durante el "stretch" para mascarar
 * el cross-fade entre números (truco de Emil Kowalski).
 */
export default function StatsGrid({
  initialValue,
  currentValue,
  elapsedTime,
  eventCount,
  rate,
}) {
  const diff = (initialValue != null && currentValue != null)
    ? currentValue - initialValue
    : null;
  const pct = (diff != null && initialValue) ? (diff / initialValue) * 100 : null;

  const diffStateClass = diff == null || diff === 0 ? '' : diff < 0 ? 'neg-state' : 'pos-state';
  const rateStateClass = rate == null || rate === 0 ? '' : rate < 0 ? 'neg-state' : 'pos-state';

  return (
    <div className="readout" role="group" aria-label="Lectura en vivo">
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
      </div>

      {/* Time + events · ticker sobre el contador */}
      <div className="readout-cell">
        <span className="readout-label">Sesión</span>
        <span className="readout-value numeric">{elapsedTime || '00:00'}</span>
        <span className="readout-delta mute">
          <NumberTicker
            value={eventCount}
            decimals={0}
            stiffness={260}
            damping={28}
            formatter={(n) => `${Math.round(n)}`}
          />
          {' '}{eventCount === 1 ? 'evento' : 'eventos'}
        </span>
      </div>
    </div>
  );
}
