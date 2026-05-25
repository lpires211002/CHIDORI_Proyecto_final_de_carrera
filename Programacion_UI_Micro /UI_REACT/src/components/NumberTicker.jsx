import React, { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

/**
 * NumberTicker · anima la transición de un número a otro con spring physics,
 * evitando los saltos bruscos cuando los KPIs cambian cada ~1s.
 *
 * Truco de Emil Kowalski: durante el "stretch" del cambio, se aplica un
 * blur sutil para enmascarar el cross-fade entre dígitos (el ojo percibe
 * una transformación continua en vez de dos números solapándose).
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

  // Texto final formateado a partir del valor del spring
  const display = useTransform(spring, (latest) => {
    if (latest === null || latest === undefined || !Number.isFinite(latest)) return '—';
    if (formatter) return formatter(latest);
    return latest.toFixed(decimals);
  });

  // Velocidad instantánea del spring · usada para aplicar blur durante el roll
  const blur = useTransform(spring.velocity ?? motionValue, (v) => {
    const abs = Math.min(Math.abs(v ?? 0) / 80, 1.5);
    return `blur(${abs.toFixed(2)}px)`;
  });

  useEffect(() => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      motionValue.jump(0);
      return;
    }
    motionValue.set(value);
  }, [value, motionValue]);

  // Si el valor es nulo/no finito, mostramos el placeholder sin animación
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={className}>—</span>;
  }

  return (
    <motion.span
      className={className}
      style={{ filter: blur, display: 'inline-block', willChange: 'filter' }}
    >
      <motion.span>{display}</motion.span>
    </motion.span>
  );
}
