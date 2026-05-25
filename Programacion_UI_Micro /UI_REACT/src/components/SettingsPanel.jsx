import React, { useEffect, useState } from 'react';
import { X, RefreshCw, Save } from 'lucide-react';

/**
 * Settings drawer · WebSocket connection + Supabase credentials.
 * Lives behind a drawer toggle in the header. No longer competes with
 * the dashboard for vertical real estate.
 */
export default function SettingsPanel({
  open,
  onClose,
  wsConfig,
  onSaveConfig,
  wsStatus,
  onReconnect,
  supabaseConfig,
  onSaveSupabaseConfig,
}) {
  const [protocol, setProtocol] = useState(wsConfig.protocol);
  const [host, setHost]         = useState(wsConfig.host);
  const [port, setPort]         = useState(wsConfig.port);
  const [sbUrl, setSbUrl]       = useState(supabaseConfig?.url || '');
  const [sbKey, setSbKey]       = useState(supabaseConfig?.key || '');

  useEffect(() => {
    setProtocol(wsConfig.protocol);
    setHost(wsConfig.host);
    setPort(wsConfig.port);
  }, [wsConfig]);

  useEffect(() => {
    setSbUrl(supabaseConfig?.url || '');
    setSbKey(supabaseConfig?.key || '');
  }, [supabaseConfig]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const wsStatusLabel = {
    CONNECTED:    { className: 'pill pill-live',    text: 'Conectado' },
    CONNECTING:   { className: 'pill pill-syncing', text: 'Reintentando' },
    DISCONNECTED: { className: 'pill pill-alarm',   text: 'Desconectado' },
  }[wsStatus] || { className: 'pill pill-off', text: 'Desconocido' };

  const handleWsSubmit = (e) => {
    e.preventDefault();
    onSaveConfig({ protocol, host, port });
  };

  const handleSbSubmit = (e) => {
    e.preventDefault();
    onSaveSupabaseConfig({ url: sbUrl, key: sbKey });
  };

  return (
    <>
      <div className="drawer-veil" onClick={onClose} />
      <aside className="drawer-panel" role="dialog" aria-label="Configuración">
        <div className="drawer-head">
          <h2>Configuración</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>

        <div className="drawer-body">
          {/* --- WebSocket --- */}
          <form className="drawer-section" onSubmit={handleWsSubmit}>
            <div className="drawer-section-head">
              <h3 style={{ fontSize: 'var(--t-lg)' }}>Microcontrolador</h3>
              <span className={wsStatusLabel.className}>
                <span className="pill-dot" />
                {wsStatusLabel.text}
              </span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="proto">Protocolo</label>
              <select id="proto" className="input" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
                <option value="ws://">ws:// (red local)</option>
                <option value="wss://">wss:// (TLS, requerido en hosts HTTPS)</option>
              </select>
              <span className="field-hint">
                Vercel sirve por HTTPS y bloquea ws://. Use wss:// con un proxy seguro, o
                acceda al frontend localmente vía http://localhost para usar ws://.
              </span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="host">Dirección</label>
              <input
                id="host"
                className="input"
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="chidori.local"
                required
              />
              <span className="field-hint">
                Hostname mDNS publicado por el firmware (chidori.local) o IP de red local.
              </span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="port">Puerto</label>
              <input
                id="port"
                className="input"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="81"
                required
              />
              <span className="field-hint">Puerto WebSocket. El firmware usa 81 por defecto.</span>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="button button-ghost" onClick={onReconnect} disabled={wsStatus === 'CONNECTING'}>
                <RefreshCw size={14} className={wsStatus === 'CONNECTING' ? 'rotating' : ''} />
                Reconectar
              </button>
              <button type="submit" className="button button-primary">
                <Save size={14} />
                Guardar
              </button>
            </div>
          </form>

          <hr className="hairline" />

          {/* --- Supabase --- */}
          <form className="drawer-section" onSubmit={handleSbSubmit}>
            <div className="drawer-section-head">
              <h3 style={{ fontSize: 'var(--t-lg)' }}>Persistencia en la nube</h3>
              <span className={`pill ${supabaseConfig?.url && supabaseConfig?.key ? 'pill-confirm' : 'pill-off'}`}>
                <span className="pill-dot" />
                {supabaseConfig?.url && supabaseConfig?.key ? 'Configurado' : 'No configurado'}
              </span>
            </div>

            <span className="field-hint">
              Opcional. Guarda sesiones largas en Supabase para análisis posterior. Si lo
              omite, las mediciones siguen funcionando localmente (sin histórico en la nube).
            </span>

            <div className="field">
              <label className="field-label" htmlFor="sburl">Project URL</label>
              <input
                id="sburl"
                className="input"
                type="url"
                value={sbUrl}
                onChange={(e) => setSbUrl(e.target.value)}
                placeholder="https://xxxx.supabase.co"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="sbkey">Anon / Public Key</label>
              <input
                id="sbkey"
                className="input"
                type="password"
                value={sbKey}
                onChange={(e) => setSbKey(e.target.value)}
                placeholder="eyJhbGciOi…"
              />
              <span className="field-hint">
                Clave anónima pública (anon). Se almacena localmente en su navegador.
              </span>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="button button-primary">
                <Save size={14} />
                Guardar credenciales
              </button>
            </div>
          </form>
        </div>
      </aside>
    </>
  );
}
