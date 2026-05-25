import React from 'react';

/**
 * Readout strip · hierarchical, not a 6-tile carpet.
 *
 *   [ HERO · Z actual ]  [ Z basal ]  [ Δ acumulado ]  [ Tasa ]
 *
 * No gradient text, no bounce icon. Numbers are tabular, in the display
 * serif. Color only encodes state (signal = recovering, alarm = rising).
 */
export default function StatsGrid({
  initialValue,
  currentValue,
  elapsedTime,
  eventCount,
  rate,
}) {
  const fmt = (v, d = 1) => (v === null || v === undefined ? '—' : v.toFixed(d));

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
          {fmt(currentValue, 2)}
          <span className="readout-unit" style={{ marginLeft: 8, fontFamily: 'var(--font-mono)' }}>Ω</span>
        </span>
        {diff != null && (
          <span className={`readout-delta ${diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}`}>
            {diff >= 0 ? '+' : ''}{fmt(diff, 2)} Ω
            <span className="mute">· {pct >= 0 ? '+' : ''}{fmt(pct, 1)}%</span>
          </span>
        )}
      </div>

      {/* Basal */}
      <div className="readout-cell">
        <span className="readout-label">Basal</span>
        <span className="readout-value numeric">
          {fmt(initialValue, 2)}
          <span className="readout-unit" style={{ marginLeft: 6 }}>Ω</span>
        </span>
        <span className="readout-delta mute">Referencia inicial</span>
      </div>

      {/* Rate */}
      <div className="readout-cell">
        <span className="readout-label">Tasa</span>
        <span className={`readout-value numeric ${rateStateClass}`}>
          {fmt(rate, 2)}
          <span className="readout-unit" style={{ marginLeft: 6 }}>Ω/min</span>
        </span>
        <span className="readout-delta mute">Δ por minuto</span>
      </div>

      {/* Time + events */}
      <div className="readout-cell">
        <span className="readout-label">Sesión</span>
        <span className="readout-value numeric">{elapsedTime || '00:00'}</span>
        <span className="readout-delta mute">
          {eventCount} {eventCount === 1 ? 'evento' : 'eventos'}
        </span>
      </div>
    </div>
  );
}
