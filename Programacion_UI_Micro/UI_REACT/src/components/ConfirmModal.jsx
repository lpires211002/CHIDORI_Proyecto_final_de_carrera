import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Custom confirm modal with hold-to-confirm action.
 * Replaces window.confirm for destructive operations (RESET).
 *
 * Props:
 *   open      — boolean
 *   title     — string
 *   body      — node (description / context for the user)
 *   holdMs    — milliseconds to hold the action button (default 1500)
 *   actionLabel — string on the danger button
 *   onCancel  — () => void
 *   onConfirm — () => void
 */
export default function ConfirmModal({
  open,
  title,
  body,
  holdMs = 1500,
  actionLabel = 'Confirmar',
  onCancel,
  onConfirm,
}) {
  const [progress, setProgress] = useState(0);
  const startedAtRef = useRef(null);
  const rafRef = useRef(null);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setProgress(0);
      startedAtRef.current = null;
      completedRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
  }, [open]);

  // Esc closes (cancel)
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const tick = () => {
    if (!startedAtRef.current || completedRef.current) return;
    const elapsed = performance.now() - startedAtRef.current;
    const pct = Math.min(1, elapsed / holdMs);
    setProgress(pct);
    if (pct >= 1) {
      completedRef.current = true;
      onConfirm?.();
    } else {
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  const startHold = () => {
    if (completedRef.current) return;
    startedAtRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
  };

  const stopHold = () => {
    startedAtRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (!completedRef.current) setProgress(0);
  };

  if (!open) return null;

  const holding = progress > 0 && progress < 1;

  return (
    <div className="modal-veil" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Cancelar">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ color: 'var(--type-med)', lineHeight: 1.55, fontSize: 'var(--t-sm)' }}>
            {body}
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="button button-ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className={`hold-button ${holding ? 'holding' : ''}`}
            onMouseDown={startHold}
            onMouseUp={stopHold}
            onMouseLeave={stopHold}
            onTouchStart={startHold}
            onTouchEnd={stopHold}
            style={{ '--hold': progress }}
          >
            <span className="hold-button-fill" />
            <span className="hold-button-label">
              {holding ? 'Mantenga presionado…' : actionLabel}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
