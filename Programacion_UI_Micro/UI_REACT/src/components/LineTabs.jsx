import React, { useCallback, useEffect, useRef } from 'react';

/**
 * LineTabs · adaptación HORIZONTAL de LineSidebar (React Bits).
 *
 * El original es una sidebar vertical; acá se porta su estética e interacción
 * a la barra de pestañas del dashboard:
 *   · Índice numerado (01, 02) antes de cada etiqueta.
 *   · Línea marcadora bajo cada pestaña que crece y se tiñe con el acento.
 *   · Respuesta a la proximidad del cursor medida en el eje X (no Y), con la
 *     misma curva de falloff y el mismo lerp por rAF: una sola variable
 *     `--effect` (0..1) alimenta color, escala y desplazamiento, así todo se
 *     mueve en conjunto sin transiciones CSS desfasadas.
 *   · La pestaña activa se mantiene siempre en efecto = 1.
 *   · Color de acento tomado del token `--signal` del proyecto.
 *   · El bucle rAF se detiene solo cuando todo llegó a destino (no queda
 *     animando de fondo durante una sesión larga).
 *
 * Props:
 *   items    · [{ key, label }]
 *   active   · key de la pestaña activa (controlado por el padre)
 *   onChange · (key) => void
 */

const FALLOFF = {
  linear: (p) => p,
  smooth: (p) => p * p * (3 - 2 * p),
  sharp:  (p) => p * p * p,
};

export default function LineTabs({
  items = [],
  active,
  onChange,
  proximityRadius = 140,   // px sobre el eje X
  maxShift = 0,            // desplazamiento; 0 = las pestañas no se mueven
  falloff = 'smooth',
  smoothing = 110,         // ms de suavizado
  showIndex = true,
  className = '',
}) {
  const listRef    = useRef(null);
  const itemRefs   = useRef([]);
  const targetsRef = useRef([]);
  const currentRef = useRef([]);
  const rafRef     = useRef(null);
  const lastRef    = useRef(0);
  const activeRef  = useRef(active);
  activeRef.current = active;

  const runFrame = useCallback((now) => {
    const dt = Math.min((now - lastRef.current) / 1000, 0.05);
    lastRef.current = now;
    const tau = Math.max(smoothing, 1) / 1000;
    const k = 1 - Math.exp(-dt / tau);

    let moving = false;
    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const isActive = items[i] && items[i].key === activeRef.current;
      const target = Math.max(targetsRef.current[i] || 0, isActive ? 1 : 0);
      const cur    = currentRef.current[i] || 0;
      const next   = cur + (target - cur) * k;
      const settled = Math.abs(target - next) < 0.0015;
      const value = settled ? target : next;
      currentRef.current[i] = value;
      el.style.setProperty('--effect', value.toFixed(4));
      if (!settled) moving = true;
    });

    rafRef.current = moving ? requestAnimationFrame(runFrame) : null;
  }, [items, smoothing]);

  const startLoop = useCallback(() => {
    if (rafRef.current != null) return;
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  const onPointerMove = useCallback((e) => {
    const list = listRef.current;
    if (!list) return;
    const rect = list.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const ease = FALLOFF[falloff] ?? FALLOFF.linear;

    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const center = el.offsetLeft + el.offsetWidth / 2;
      const distance = Math.abs(pointerX - center);
      targetsRef.current[i] = ease(Math.max(0, 1 - distance / proximityRadius));
    });
    startLoop();
  }, [falloff, proximityRadius, startLoop]);

  const onPointerLeave = useCallback(() => {
    targetsRef.current = targetsRef.current.map(() => 0);
    startLoop();
  }, [startLoop]);

  useEffect(() => { startLoop(); }, [active, startLoop]);
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div
      ref={listRef}
      className={`line-tabs ${className}`}
      role="tablist"
      style={{ '--max-shift': `${maxShift}px` }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {items.map((item, index) => (
        <button
          key={item.key}
          ref={(el) => { itemRefs.current[index] = el; }}
          type="button"
          role="tab"
          aria-selected={active === item.key}
          className={`line-tab ${active === item.key ? 'is-active' : ''}`}
          onClick={() => onChange?.(item.key)}
        >
          <span className="line-tab__label">
            {showIndex && (
              <span className="line-tab__index">{String(index + 1).padStart(2, '0')}</span>
            )}
            <span className="line-tab__text">{item.label}</span>
          </span>
          <span className="line-tab__marker" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
