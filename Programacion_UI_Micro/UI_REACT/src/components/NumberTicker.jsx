import React, { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

/**
 * NumberTicker · anima la transición de un número a otro con spring physics,
 * evitando los saltos bruscos cuando los KPIs cambian cada ~1s.
 *
 * Sin blur · los números deben ser legibles en todo momento (instrumento
 * clínico). El spring solo ya da el roll suave necesario.
 *
 * Props:
 *   value      · número actual
 *   decimals   · cantidad de decimales a mostrar
 *   stiffness  · qué tan rápido converge (más alto = más rápido)
 *   damping    · cuánto oscila (más alto = menos rebote)
 *   className  · pasada al wrapper
 *   formatter  · función opcional (n) => string custom (override decimals)
 */
export default function NumberTicker({
  value,
  decimals = 2,
  stiffness = 140,
  damping = 22,
  className,
  formatter,
}) {
  const motionValue = useMotionValue(value ?? 0);
  const spring = useSpring(motionValue, { stiffness, damping });

  const display = useTransform(spring, (latest) => {
    if (latest === null || latest === undefined || !Number.isFinite(latest)) return '—';
    if (formatter) return formatter(latest);
    return latest.toFixed(decimals);
  });

  useEffect(() => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      motionValue.jump(0);
      return;
    }
    motionValue.set(value);
  }, [value, motionValue]);

  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={className}>—</span>;
  }

  return (
    <motion.span className={className} style={{ display: 'inline-block' }}>
      {display}
    </motion.span>
  );
}
