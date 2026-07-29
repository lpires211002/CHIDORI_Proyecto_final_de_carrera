import React, { useEffect, useRef } from 'react';

/**
 * SpotlightArea · efecto de foco + borde luminoso sobre las tarjetas existentes.
 *
 * Adaptación de MagicBento (React Bits) al proyecto:
 *   · NO reemplaza contenido: envuelve las tarjetas reales del dashboard y les
 *     aplica el efecto. Las tarjetas siguen siendo las de siempre.
 *   · Sin gsap: el original lo usa para animar; acá alcanza con variables CSS
 *     actualizadas en un rAF. Cero dependencias nuevas en el ejecutable.
 *   · Sin orbe flotante sobre el cursor: el brillo vive DENTRO de cada tarjeta
 *     (halo + borde). Menos invasivo sobre una pantalla de datos.
 *   · Sin tilt/magnetismo/partículas: sobre gráficos y valores clínicos, mover
 *     e inclinar las tarjetas dificulta la lectura, y animar en permanente
 *     tiene costo en sesiones de horas.
 *   · Color de marca desde el token CSS `--signal`.
 *   · Respeta `prefers-reduced-motion`.
 *
 * Props:
 *   selector  · qué elementos internos reciben el efecto
 *   radius    · radio de influencia en px
 */
export default function SpotlightArea({
  children,
  selector = '.surface, .readout-cell',
  radius = 320,
  className = '',
}) {
  const areaRef = useRef(null);
  const rafRef  = useRef(null);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const proximity    = radius * 0.5;
    const fadeDistance = radius * 0.75;

    const onMove = (e) => {
      if (rafRef.current) return;                 // throttle a 1 update por frame
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const rect = area.getBoundingClientRect();
        const inside =
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top  && e.clientY <= rect.bottom;

        const cards = area.querySelectorAll(selector);

        if (!inside) {
          cards.forEach((c) => c.style.setProperty('--glow-intensity', '0'));
          return;
        }

        cards.forEach((card) => {
          const r  = card.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const d  = Math.hypot(e.clientX - cx, e.clientY - cy) - Math.max(r.width, r.height) / 2;
          const eff = Math.max(0, d);

          let intensity = 0;
          if (eff <= proximity)          intensity = 1;
          else if (eff <= fadeDistance)  intensity = (fadeDistance - eff) / (fadeDistance - proximity);

          // Posición relativa del brillo dentro de la tarjeta
          const relX = ((e.clientX - r.left) / r.width) * 100;
          const relY = ((e.clientY - r.top) / r.height) * 100;
          card.style.setProperty('--glow-x', `${relX}%`);
          card.style.setProperty('--glow-y', `${relY}%`);
          card.style.setProperty('--glow-intensity', String(intensity));
          card.style.setProperty('--glow-radius', `${radius}px`);
        });
      });
    };

    const onLeave = () => {
      area.querySelectorAll(selector).forEach((c) => c.style.setProperty('--glow-intensity', '0'));
    };

    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);

    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [selector, radius]);

  return (
    <div ref={areaRef} className={`spotlight-area ${className}`}>
      {children}
    </div>
  );
}
