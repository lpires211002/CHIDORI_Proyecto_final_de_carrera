import React, { useState } from 'react';
import { LogIn, UserPlus, AlertTriangle } from 'lucide-react';

/**
 * LoginScreen · accepta usuario simple ("sa") o email completo.
 * Modos: signin (login) y signup (alta).
 */
export default function LoginScreen({ onSignIn, onSignUp, error, setError }) {
  const [mode, setMode]           = useState('signin'); // signin | signup
  const [username, setUsername]   = useState('');
  const [displayName, setDisplay] = useState('');
  const [password, setPassword]   = useState('');
  const [busy, setBusy]           = useState(false);
  const [info, setInfo]           = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        const ok = await onSignIn({ username, password });
        if (!ok) return;
      } else {
        const ok = await onSignUp({ username, password, displayName });
        if (!ok) return;
        setInfo('Cuenta creada. Esperá la aprobación del administrador para poder ingresar.');
        setMode('signin');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card surface">
        <header className="auth-head">
          <div className="brand">
            <span className="brand-mark">Chidori</span>
          </div>
          <span className="section-label" style={{ display: 'block', marginTop: 6 }}>
            Instrumento de bioimpedancia vesical
          </span>
        </header>

        <div className="segment" style={{ marginBottom: 22 }}>
          <button
            type="button"
            className={`segment-item ${mode === 'signin' ? 'active' : ''}`}
            onClick={() => { setMode('signin'); setError(null); setInfo(null); }}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            className={`segment-item ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => { setMode('signup'); setError(null); setInfo(null); }}
          >
            Crear cuenta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="stack-md">
          <div className="field">
            <label className="field-label" htmlFor="auth-user">Usuario o email</label>
            <input
              id="auth-user"
              className="input"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="sa, juan, o usuario@dominio.com"
              required
              autoFocus
            />
            <span className="field-hint">
              Si no incluís dominio, se asume <code>@chidori.local</code>.
            </span>
          </div>

          {mode === 'signup' && (
            <div className="field">
              <label className="field-label" htmlFor="auth-display">Nombre visible</label>
              <input
                id="auth-display"
                className="input"
                type="text"
                value={displayName}
                onChange={(e) => setDisplay(e.target.value)}
                placeholder="Nombre del clínico"
              />
              <span className="field-hint">
                Se mostrará en la lista de sesiones del administrador.
              </span>
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor="auth-pass">Contraseña</label>
            <input
              id="auth-pass"
              className="input"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'signup' ? 6 : 1}
            />
            {mode === 'signup' && (
              <span className="field-hint">Mínimo 6 caracteres.</span>
            )}
          </div>

          {error && (
            <div className="auth-feedback err" role="alert">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}
          {info && (
            <div className="auth-feedback ok" role="status">
              <span>{info}</span>
            </div>
          )}

          <button type="submit" className="button button-primary button-lg" disabled={busy}>
            {mode === 'signin'
              ? <><LogIn size={16} /> Ingresar</>
              : <><UserPlus size={16} /> Crear cuenta</>}
          </button>

          <p className="mute" style={{ fontSize: 'var(--t-xs)', textAlign: 'center', marginTop: 8 }}>
            {mode === 'signin'
              ? 'Las cuentas nuevas requieren aprobación del administrador antes de poder ingresar.'
              : 'Tu cuenta quedará pendiente de aprobación hasta que el administrador la habilite.'}
          </p>
        </form>
      </div>

      <p className="mute" style={{
        position: 'fixed', bottom: 18, left: 0, right: 0, textAlign: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)',
      }}>
        Chidori · Instrumento clínico · Proyecto Final de Carrera 2026
      </p>
    </div>
  );
}
