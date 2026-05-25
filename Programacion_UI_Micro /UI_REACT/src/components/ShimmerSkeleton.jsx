import React from 'react';

/**
 * ShimmerSkeleton · placeholder con animación de brillo deslizante.
 * Útil mientras Supabase responde (AdminView, SessionDetail).
 *
 * Variantes:
 *   <ShimmerSkeleton width="60%" height={20} />
 *   <ShimmerSkeleton rows={4} />          // bloque con N líneas
 */
export default function ShimmerSkeleton({
  width = '100%',
  height = 14,
  rows = 1,
  gap = 10,
  className,
  style,
}) {
  if (rows > 1) {
    return (
      <div className={className} style={{ display: 'flex', flexDirection: 'column', gap, ...style }}>
        {Array.from({ length: rows }).map((_, i) => (
          <span
            key={i}
            className="shimmer"
            style={{
              display: 'block',
              width: i === rows - 1 ? `${Math.round(40 + Math.random() * 30)}%` : width,
              height,
              borderRadius: 'var(--r-sm)',
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <span
      className={`shimmer ${className || ''}`}
      style={{
        display: 'inline-block',
        width,
        height,
        borderRadius: 'var(--r-sm)',
        ...style,
      }}
    />
  );
}
