import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

/**
 * HeaderMenu · acciones secundarias, a pantalla completa.
 *
 * El header quedó deliberadamente mínimo (marca + estado + usuario). Todo lo
 * demás —simulador, configuración, tema, panel admin, cerrar sesión— vive
 * detrás del botón ⋯.
 *
 * Al abrirse ocupa la pantalla y difumina lo que hay detrás en vez de colgar
 * un recuadro del header: son cinco acciones que sacan al usuario de lo que
 * está haciendo, así que el menú se toma el foco completo y la medición queda
 * legible pero claramente en segundo plano.
 *
 * La lista adopta la estética e interacción de LineSidebar (React Bits),
 * portada al proyecto igual que LineTabs:
 *   · Línea marcadora a la izquierda, con ticks cortos en los huecos, que
 *     crecen y se tiñen con el acento.
 *   · Índice numerado (01, 02…) delante de cada etiqueta.
 *   · Respuesta a la proximidad vertical del cursor: una sola variable
 *     `--effect` (0..1) por item, interpolada en un bucle rAF, alimenta color,
 *     desplazamiento y escala. Todo se mueve en conjunto, sin transiciones
 *     CSS que se desfasen.
 *   · El acento sale de `--signal`; el item destructivo usa `--alarm`, para no
 *     invitar a cerrar sesión con el mismo color que al resto.
 *   · El bucle se detiene solo al llegar a destino: no queda animando de fondo.
 *
 * Se navega con ↑ ↓ (y Home / End), se activa con Enter y se cierra con Escape
 * o clickeando el fondo. El original usa `li` con onClick, que no es accesible
 * por teclado.
 *
 * items: Array<{ icon, label, hint, onClick, danger?, divider? }>
 * Los `divider` se ignoran: el ritmo de ticks del marcador ya separa.
 */

const FALLOFF = {
  linear: (p) => p,
  smooth: (p) => p * p * (3 - 2 * p),
  sharp:  (p) => p * p * p,
};

export default function HeaderMenu({
  items = [],
  proximityRadius = 110,   // px sobre el eje Y
  maxShift = 22,           // desplazamiento máximo de la fila
  falloff = 'smooth',
  smoothing = 120,         // ms de suavizado
  showIndex = true,
}) {
  const [open, setOpen] = useState(false);

  // Los separadores no son entradas: se descartan para que la numeración
  // quede continua.
  const entries = items.filter((it) => !it.divider);

  const listRef    = useRef(null);
  const itemRefs   = useRef([]);
  const btnRefs    = useRef([]);
  const targetsRef = useRef([]);
  const currentRef = useRef([]);
  const rafRef     = useRef(null);
  const lastRef    = useRef(0);
  const triggerRef = useRef(null);

  /* ── Teclado y bloqueo del scroll ────────────────────────────────── */
  useEffect(() => {
    if (!open) return;

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }

      const foco = btnRefs.current.filter(Boolean);
      if (foco.length === 0) return;
      const i = foco.indexOf(document.activeElement);

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const paso = e.key === 'ArrowDown' ? 1 : -1;
        const next = i < 0
          ? (paso === 1 ? 0 : foco.length - 1)
          : (i + paso + foco.length) % foco.length;
        foco[next].focus();
      } else if (e.key === 'Home') {
        e.preventDefault(); foco[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault(); foco[foco.length - 1].focus();
      }
    };

    window.addEventListener('keydown', onKey);
    // El menú tapa la pantalla: que el fondo no siga scrolleando detrás.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Primer item al foco, para poder navegar con el teclado desde el arranque
    const t = setTimeout(() => btnRefs.current[0]?.focus(), 40);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open]);

  // Al cerrar, el foco vuelve al botón que abrió el menú
  useEffect(() => {
    if (!open) triggerRef.current?.focus?.({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* ── Lerp de proximidad ──────────────────────────────────────────── */
  const runFrame = useCallback((now) => {
    const dt = Math.min((now - lastRef.current) / 1000, 0.05);
    lastRef.current = now;
    const tau = Math.max(smoothing, 1) / 1000;
    const k = 1 - Math.exp(-dt / tau);

    let moving = false;
    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const target  = targetsRef.current[i] || 0;
      const cur     = currentRef.current[i] || 0;
      const next    = cur + (target - cur) * k;
      const settled = Math.abs(target - next) < 0.0015;
      const value   = settled ? target : next;
      currentRef.current[i] = value;
      el.style.setProperty('--effect', value.toFixed(4));
      if (!settled) moving = true;
    });

    rafRef.current = moving ? requestAnimationFrame(runFrame) : null;
  }, [smoothing]);

  const startLoop = useCallback(() => {
    if (rafRef.current != null) return;
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  const aplicarProximidad = useCallback((clientY) => {
    const list = listRef.current;
    if (!list) return;
    const rect = list.getBoundingClientRect();
    const pointerY = clientY - rect.top;
    const ease = FALLOFF[falloff] ?? FALLOFF.linear;

    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const center = el.offsetTop + el.offsetHeight / 2;
      const distance = Math.abs(pointerY - center);
      targetsRef.current[i] = ease(Math.max(0, 1 - distance / proximityRadius));
    });
    startLoop();
  }, [falloff, proximityRadius, startLoop]);

  // El puntero se escucha en TODA la superficie, no solo sobre la lista: el
  // menú ahora ocupa la pantalla y las filas tienen que reaccionar aunque el
  // cursor pase por el costado.
  const onPointerMove = useCallback((e) => aplicarProximidad(e.clientY), [aplicarProximidad]);

  const onPointerLeave = useCallback(() => {
    targetsRef.current = targetsRef.current.map(() => 0);
    startLoop();
  }, [startLoop]);

  // El teclado también mueve el efecto: si no, navegar con ↑ ↓ no destacaría
  // nada.
  const onItemFocus = useCallback((index) => {
    targetsRef.current = targetsRef.current.map((_, i) => (i === index ? 1 : 0));
    startLoop();
  }, [startLoop]);

  // Al cerrarse se desmonta la lista: hay que soltar el rAF y limpiar los
  // valores, o al reabrir arranca desde el estado viejo.
  useEffect(() => {
    if (open) return;
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    itemRefs.current = [];
    btnRefs.current = [];
    targetsRef.current = [];
    currentRef.current = [];
  }, [open]);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const run = (fn) => { setOpen(false); fn?.(); };

  const overlay = (
    <div
      className="menu-overlay"
      role="menu"
      aria-label="Más acciones"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <ul
        ref={listRef}
        className="line-menu"
        style={{ '--max-shift': `${maxShift}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        {entries.map((it, index) => {
          const Icon = it.icon;
          return (
            <li
              key={it.label}
              ref={(el) => { itemRefs.current[index] = el; }}
              className={`line-menu__item ${it.danger ? 'is-danger' : ''}`}
              style={{ '--stagger': `${index * 45}ms` }}
            >
              <span className="line-menu__marker" aria-hidden="true" />
              <button
                ref={(el) => { btnRefs.current[index] = el; }}
                type="button"
                role="menuitem"
                className="line-menu__button"
                onClick={() => run(it.onClick)}
                onFocus={() => onItemFocus(index)}
              >
                {showIndex && (
                  <span className="line-menu__index">{String(index + 1).padStart(2, '0')}</span>
                )}
                {Icon && (
                  <span className="line-menu__icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                )}
                <span className="line-menu__body">
                  <span className="line-menu__text">{it.label}</span>
                  {it.hint && <span className="line-menu__hint">{it.hint}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <span className="menu-overlay__hint">
        <span className="kbd">Esc</span> para cerrar
      </span>
    </div>
  );

  return (
    <div className="header-menu">
      <button
        ref={triggerRef}
        type="button"
        className={`icon-button ${open ? 'is-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Más acciones"
        title="Más acciones"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(overlay, document.body)}
    </div>
  );
}
