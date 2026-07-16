import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

/**
 * HeaderMenu · dropdown de acciones secundarias para desktop.
 *
 * El header quedó deliberadamente mínimo (marca + estado + usuario). Todo lo
 * demás —simulador, configuración, tema, panel admin, cerrar sesión— vive acá,
 * detrás de un único botón ⋯. Cierra con click-outside o Escape.
 *
 * items: Array<{
 *   icon, label, hint, onClick, danger?, divider?
 * }>
 * Un item con `divider: true` dibuja un separador (no es clickeable).
 */
export default function HeaderMenu({ items = [] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (fn) => { setOpen(false); fn?.(); };

  return (
    <div className="header-menu" ref={wrapRef}>
      <button
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

      {open && (
        <div className="header-menu-pop" role="menu">
          {items.map((it, i) => {
            if (it.divider) return <div key={`d${i}`} className="header-menu-divider" role="separator" />;
            const Icon = it.icon;
            return (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={`header-menu-item ${it.danger ? 'is-danger' : ''}`}
                onClick={() => run(it.onClick)}
              >
                <span className="header-menu-item-icon">{Icon ? <Icon size={16} /> : null}</span>
                <span className="header-menu-item-body">
                  <span className="header-menu-item-label">{it.label}</span>
                  {it.hint && <span className="header-menu-item-hint">{it.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
