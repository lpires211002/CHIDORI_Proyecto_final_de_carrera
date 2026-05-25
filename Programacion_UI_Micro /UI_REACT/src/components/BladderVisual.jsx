import React from 'react';

/**
 * Bladder volume visual · editorial scientific instrument style.
 *
 * Replaces the prior glassmorphic beaker with rotating wave overlays.
 * - Deterministic SVG-shaped vessel with hairline grid markers (25/50/75%).
 * - Fill uses transform: scaleY (no width/height layout transitions).
 * - Single signal color while normal, single alarm color past 85%.
 *   No yellow-orange-red transition cartoon.
 * - Percentage rendered in the display serif, never pulses.
 */
export default function BladderVisual({
  initialValue,
  currentValue,
  alarmThreshold,
  capacityMl = 500,
}) {
  const percentage = (() => {
    if (initialValue === null || currentValue === null) return 0;
    if (currentValue >= initialValue) return 0;
    const limit = alarmThreshold > 0 && alarmThreshold < initialValue
      ? alarmThreshold
      : initialValue - 35;
    const totalSpan = initialValue - limit;
    if (totalSpan <= 0) return 0;
    return Math.max(0, Math.min(100, ((initialValue - currentValue) / totalSpan) * 100));
  })();

  const volumeMl = Math.round((percentage / 100) * capacityMl);
  const isAlarm  = percentage >= 85;

  return (
    <section className="surface surface-pad" aria-label="Volumen vesical estimado">
      <header className="section-head" style={{ marginBottom: 18 }}>
        <div>
          <h2>Volumen estimado</h2>
          <span className="section-label" style={{ display: 'block', marginTop: 4 }}>
            Atenuación de impedancia · {capacityMl} ml máx.
          </span>
        </div>
      </header>

      <div className="vessel-wrap">
        <div className={`vessel ${isAlarm ? 'alarm' : ''}`} aria-hidden="true">
          <div className="vessel-grid" />
          <div
            className="vessel-fill"
            style={{ height: '100%', transform: `scaleY(${percentage / 100})` }}
          />
        </div>

        <div className="vessel-meta">
          <span className="section-label">Llenado relativo</span>
          <span className="vessel-pct numeric">
            {percentage.toFixed(0)}<span style={{ color: 'var(--type-low)', fontSize: 'var(--t-xl)' }}>%</span>
          </span>
          <span className="vessel-vol numeric">
            ≈ {volumeMl} ml de {capacityMl}
          </span>
          <div className="hairline" style={{ margin: '6px 0' }} />
          <span style={{ fontSize: 'var(--t-xs)', color: 'var(--type-mute)', lineHeight: 1.5 }}>
            Estimación basada en la caída de impedancia respecto al valor basal calibrado.
            No reemplaza a la sensación fisiológica del paciente.
          </span>
        </div>
      </div>
    </section>
  );
}
