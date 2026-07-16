import React, { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

/**
 * Bladder volume visual · editorial scientific instrument style.
 *
 * - Vessel SVG-shaped con grid marker (25/50/75%)
 * - Fill animado por spring physics sobre el porcentaje (no por CSS transition
 *   directo) para que se sienta orgánico cuando los datos en vivo cambian.
 * - Single signal color en estado normal, single alarm color past 85%.
 * - Percentage rendered en el display serif, sin pulse.
 */
export default function BladderVisual({
  initialValue,
  currentValue,
  alarmThreshold,
  capacityMl = 500,
}) {
  const targetPct = (() => {
    if (initialValue === null || currentValue === null) return 0;
    if (currentValue >= initialValue) return 0;
    const limit = alarmThreshold > 0 && alarmThreshold < initialValue
      ? alarmThreshold
      : initialValue - 35;
    const totalSpan = initialValue - limit;
    if (totalSpan <= 0) return 0;
    return Math.max(0, Math.min(100, ((initialValue - currentValue) / totalSpan) * 100));
  })();

  // Spring para el porcentaje en sí · suaviza el jitter de la señal en vivo
  const pctMV = useMotionValue(0);
  const pctSpring = useSpring(pctMV, { stiffness: 90, damping: 22, mass: 0.7 });
  // Transforms derivados
  const scaleY = useTransform(pctSpring, (v) => v / 100);
  const pctDisplay = useTransform(pctSpring, (v) => Math.max(0, Math.round(v)));
  const volDisplay = useTransform(pctSpring, (v) =>
    Math.max(0, Math.round((v / 100) * capacityMl))
  );

  useEffect(() => {
    pctMV.set(targetPct);
  }, [targetPct, pctMV]);

  const isAlarm = targetPct >= 85;

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
          <motion.div
            className="vessel-fill"
            style={{
              height: '100%',
              scaleY,
              transformOrigin: 'bottom',
              willChange: 'transform',
            }}
          />
        </div>

        <div className="vessel-meta">
          <span className="section-label">Llenado relativo</span>
          <span className="vessel-pct numeric">
            <motion.span>{pctDisplay}</motion.span>
            <span style={{ color: 'var(--type-low)', fontSize: 'var(--t-xl)' }}>%</span>
          </span>
          <span className="vessel-vol numeric">
            ≈ <motion.span>{volDisplay}</motion.span> ml de {capacityMl}
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
