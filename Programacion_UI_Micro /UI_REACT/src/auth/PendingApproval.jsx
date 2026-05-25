import React, { useEffect } from 'react';
import { Clock, LogOut, RefreshCw } from 'lucide-react';
import { emailToUsername } from '../supabaseClient';

/**
 * Mostrada cuando hay sesión pero el profile aún no está aprobado.
 * El usuario espera, o cierra sesión, o pide refresh manual.
 */
export default function PendingApproval({ session, onSignOut, onRefresh }) {
  const username = emailToUsername(session?.user?.email);

  // Auto-refresh cada 20s por si el admin ya aprobó
  useEffect(() => {
    const t = setInterval(() => onRefresh?.(), 20000);
    return () => clearInterval(t);
  }, [onRefresh]);

  return (
    <div className="auth-shell">
      <div className="auth-card surface">
        <header className="auth-head">
          <div className="brand">
            <span className="brand-mark">Chidori</span>
          </div>
          <span className="section-label" style={{ display: 'block', marginTop: 6 }}>
            Cuenta pendiente de aprobación
          </span>
        </header>

        <div className="row" style={{ gap: 14, marginBottom: 18 }}>
          <Clock size={22} style={{ color: 'var(--signal)' }} />
          <div>
            <p style={{ color: 'var(--type-hi)', marginBottom: 6 }}>
              Hola, <strong>{username}</strong>.
            </p>
            <p className="mute" style={{ lineHeight: 1.55, fontSize: 'var(--t-sm)' }}>
              Tu cuenta fue creada correctamente, pero todavía no está habilitada.
              El administrador debe aprobarla antes de que puedas registrar sesiones
              clínicas. Esta pantalla se va a actualizar sola cada 20 segundos.
            </p>
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="button button-ghost" onClick={onRefresh}>
            <RefreshCw size={14} />
            Comprobar ahora
          </button>
          <button type="button" className="button" onClick={onSignOut}>
            <LogOut size={14} />
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
