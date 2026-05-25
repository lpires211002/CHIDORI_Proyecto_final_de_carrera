import React from 'react';
import { Cloud, CloudOff, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * Always-visible cloud sync state. Replaces the silent console.error pattern.
 *
 * Possible states:
 *   off    — Supabase not configured
 *   ok     — last write succeeded (shows time since)
 *   busy   — write in flight
 *   warn   — last write failed, retry queued
 */
export default function CloudSyncBadge({ state, lastSyncAt, queueSize, onRetry }) {
  const fmtAgo = () => {
    if (!lastSyncAt) return '—';
    const s = Math.max(0, Math.floor((Date.now() - lastSyncAt) / 1000));
    if (s < 5)    return 'ahora';
    if (s < 60)   return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h`;
  };

  if (state === 'off') {
    return (
      <span className="sync-badge is-off" title="Supabase no configurado">
        <span className="sync-icon"><CloudOff size={13} /></span>
        Nube · off
      </span>
    );
  }

  if (state === 'busy') {
    return (
      <span className="sync-badge is-busy" title="Sincronizando con Supabase">
        <span className="sync-icon"><RefreshCw size={13} className="rotating" /></span>
        Sincronizando…
      </span>
    );
  }

  if (state === 'warn') {
    return (
      <button
        type="button"
        className="sync-badge is-warn"
        title={`Pendientes: ${queueSize || 0}. Click para reintentar.`}
        onClick={onRetry}
        style={{ cursor: 'pointer' }}
      >
        <span className="sync-icon"><AlertTriangle size={13} /></span>
        Reintentar · {queueSize || 0}
      </button>
    );
  }

  // ok
  return (
    <span className="sync-badge is-ok" title={`Último sync exitoso hace ${fmtAgo()}`}>
      <span className="sync-icon"><CheckCircle2 size={13} /></span>
      Nube · {fmtAgo()}
    </span>
  );
}

/* Single rotating animation used here (transform-only, no layout). */
const style = document.createElement('style');
style.textContent = `
.rotating { animation: spin-slow 1.4s linear infinite; }
@keyframes spin-slow { to { transform: rotate(360deg); } }
`;
if (typeof document !== 'undefined' && !document.getElementById('chidori-sync-anim')) {
  style.id = 'chidori-sync-anim';
  document.head.appendChild(style);
}
