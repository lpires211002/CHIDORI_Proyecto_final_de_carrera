import React from 'react';

/** Placeholder mientras se resuelve la sesión inicial. */
export default function AuthSplash() {
  return (
    <div className="auth-shell" aria-busy="true">
      <div className="auth-card surface" style={{ textAlign: 'center', padding: '48px 36px' }}>
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 18 }}>
          <span className="brand-mark">Chidori</span>
        </div>
        <p className="mute" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
          Resolviendo sesión…
        </p>
      </div>
    </div>
  );
}
