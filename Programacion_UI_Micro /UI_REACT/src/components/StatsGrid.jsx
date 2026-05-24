import React from 'react';

export default function StatsGrid({ 
  initialValue, 
  currentValue, 
  elapsedTime, 
  eventCount, 
  rate 
}) {
  const getChange = () => {
    if (initialValue === null || currentValue === null) return { diff: null, pct: null };
    const diff = currentValue - initialValue;
    const pct = (diff / initialValue) * 100;
    return { diff, pct };
  };

  const { diff, pct } = getChange();

  const formatValue = (val) => {
    if (val === null || val === undefined) return '--';
    return val.toFixed(2);
  };

  const getIndicator = () => {
    if (diff === null || diff === 0) return '→';
    return diff > 0 ? '↑' : '↓';
  };

  const getIndicatorClass = () => {
    if (diff === null || diff === 0) return 'change-indicator';
    return diff > 0 ? 'change-indicator positive' : 'change-indicator negative';
  };

  const getIndicatorValueClass = () => {
    if (diff === null || diff === 0) return '';
    return diff > 0 ? 'red' : 'green';
  };

  return (
    <div className="stats-grid">
      <div className="stat-card">
        <span className="stat-label">Valor Inicial</span>
        <span className="stat-value">{formatValue(initialValue)}</span>
        <span className="stat-unit">Ω</span>
      </div>

      <div className="stat-card">
        <span className="stat-label">Valor Actual</span>
        <span className="stat-value">{formatValue(currentValue)}</span>
        <span className="stat-unit">Ω</span>
      </div>

      <div className="stat-card highlight">
        <span className="stat-label">Cambio Total</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <span className={`stat-value ${getIndicatorValueClass()}`}>{formatValue(diff ? Math.abs(diff) : null)}</span>
          <span className={getIndicatorClass()} style={{ fontSize: '20px', color: diff > 0 ? 'hsl(var(--accent-red))' : diff < 0 ? 'hsl(var(--accent-green))' : 'hsl(var(--text-tertiary))', animation: diff !== 0 ? 'bounce 2s infinite' : 'none' }}>
            {getIndicator()}
          </span>
        </div>
        <span className="stat-unit">{pct !== null ? `${pct.toFixed(1)} %` : '-- %'}</span>
      </div>

      <div className="stat-card">
        <span className="stat-label">Velocidad</span>
        <span className="stat-value" style={{ color: rate > 0 ? 'hsl(var(--accent-red))' : rate < 0 ? 'hsl(var(--accent-green))' : 'hsl(var(--text-primary))' }}>
          {formatValue(rate)}
        </span>
        <span className="stat-unit">Ω/min</span>
      </div>

      <div className="stat-card">
        <span className="stat-label">Tiempo Transcurrido</span>
        <span className="stat-value" style={{ background: 'none', WebkitTextFillColor: 'initial', color: 'hsl(var(--text-primary))' }}>
          {elapsedTime}
        </span>
        <span className="stat-unit">min:seg</span>
      </div>

      <div className="stat-card">
        <span className="stat-label">Eventos Marcados</span>
        <span className="stat-value" style={{ background: 'none', WebkitTextFillColor: 'initial', color: 'hsl(var(--text-primary))' }}>
          {eventCount}
        </span>
        <span className="stat-unit">marcadores</span>
      </div>
    </div>
  );
}
