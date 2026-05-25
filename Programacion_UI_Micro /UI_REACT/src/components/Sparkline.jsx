import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

/**
 * Sparkline · micro-gráfico inline (estilo 21st.dev) para acompañar los KPIs.
 *
 * Renderiza el trazo con un spring sobre pathLength (entrada suave la primera vez)
 * y usa layout="position" en el punto final para que el "head" se desplace fluído
 * cuando entran muestras nuevas — el resto del path se re-dibuja sin animación
 * para no contradecir el dato en vivo.
 *
 * Props:
 *   data        · array de números o de objetos { y }
 *   width / h   · dimensiones SVG
 *   state       · 'pos' | 'neg' | null → tinta la línea con var(--alarm)/--signal
 *   strokeWidth · grosor de la línea
 *   showHead    · si true, dibuja un punto en la última muestra
 *   filled      · si true, agrega un gradient sutil por debajo del trazo
 */
export default function Sparkline({
  data,
  width = 120,
  height = 32,
  state = null,
  strokeWidth = 1.5,
  showHead = true,
  filled = true,
}) {
  const points = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return [];
    return data.map((d) => (typeof d === 'number' ? d : d?.y)).filter((n) => Number.isFinite(n));
  }, [data]);

  const path = useMemo(() => {
    if (points.length < 2) return null;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    const padY = strokeWidth + 1;
    const usableH = height - padY * 2;

    const stepX = width / (points.length - 1);
    const coords = points.map((y, i) => {
      const nx = i * stepX;
      const ny = padY + usableH - ((y - min) / span) * usableH;
      return [nx, ny];
    });

    const d = coords.reduce((acc, [x, y], i) => acc + (i === 0 ? `M${x},${y}` : ` L${x},${y}`), '');
    const lastX = coords[coords.length - 1][0];
    const lastY = coords[coords.length - 1][1];
    const area = `${d} L${lastX},${height} L0,${height} Z`;
    return { d, area, lastX, lastY };
  }, [points, width, height, strokeWidth]);

  if (!path) {
    return (
      <svg width={width} height={height} aria-hidden="true" style={{ display: 'block', opacity: 0.35 }}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 3"
          opacity={0.4}
        />
      </svg>
    );
  }

  const color = state === 'neg'
    ? 'var(--signal)'
    : state === 'pos'
    ? 'var(--alarm)'
    : 'currentColor';

  const gradId = `spark-grad-${state || 'n'}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ display: 'block', color, overflow: 'visible' }}
    >
      {filled && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
      )}

      {filled && <path d={path.area} fill={`url(#${gradId})`} />}

      <motion.path
        d={path.d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ pathLength: { type: 'spring', stiffness: 80, damping: 22 }, opacity: { duration: 0.2 } }}
      />

      {showHead && (
        <motion.circle
          cx={path.lastX}
          cy={path.lastY}
          r={2.2}
          fill={color}
          layout
          transition={{ type: 'spring', stiffness: 220, damping: 24 }}
        />
      )}
    </svg>
  );
}
