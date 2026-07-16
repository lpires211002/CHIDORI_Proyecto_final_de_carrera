import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * MobileMenu · drawer con acciones secundarias para mobile.
 * Solo se renderiza en mobile (CSS lo oculta en desktop).
 *
 * Props:
 *   open       · controlado
 *   onClose    · cerrar
 *   header     · contenido del header del drawer (logo, título, etc.)
 *   children   · ítems del menú · típicamente <MobileMenuItem ... />
 */
export default function MobileMenu({ open, onClose, header, children }) {
  // Esc cierra
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock scroll cuando está abierto
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="drawer-veil mobile-menu-veil" onClick={onClose} />
      <aside className="drawer-panel mobile-menu-panel" role="dialog" aria-label="Menú">
        <div className="drawer-head">
          {header || <span className="brand-mark">Chidori</span>}
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar menú">
            <X size={16} />
          </button>
        </div>
        <nav className="mobile-menu-nav" aria-label="Acciones rápidas">
          {children}
        </nav>
      </aside>
    </>
  );
}

/**
 * Ítem del menú · botón con icono + label + opcional pill al costado.
 */
export function MobileMenuItem({ icon: Icon, label, hint, accessory, onClick, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mobile-menu-item ${danger ? 'is-danger' : ''}`}
    >
      <span className="mobile-menu-item-icon">
        {Icon ? <Icon size={18} /> : null}
      </span>
      <span className="mobile-menu-item-body">
        <span className="mobile-menu-item-label">{label}</span>
        {hint && <span className="mobile-menu-item-hint">{hint}</span>}
      </span>
      {accessory && <span className="mobile-menu-item-accessory">{accessory}</span>}
    </button>
  );
}

/** Separador horizontal con label opcional. */
export function MobileMenuSection({ children }) {
  return <div className="mobile-menu-section-label">{children}</div>;
}
