import React, { useEffect, useState } from 'react';
import { X, RefreshCw, Save } from 'lucide-react';

/**
 * Settings drawer · WebSocket connection.
 * La persistencia en la nube ahora está hardcodeada (auth con Supabase),
 * por lo que este panel solo gestiona la conexión al microcontrolador.
 */
export default function SettingsPanel({
  open,
  onClose,
  wsConfig,
  onSaveConfig,
  wsStatus,
  onReconnect,
}) {
  const [protocol, setProtocol] = useState(wsConfig.protocol);
  const [host, setHost]         = useState(wsConfig.host);
  const [port, setPort]         = useState(wsConfig.port);

  useEffect(() => {
    setProtocol(wsConfig.protocol);
    setHost(wsConfig.host);
    setPort(wsConfig.port);
  }, [wsConfig]);

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

  const handleSubmit = (e) => {
    e.preventDefault();
    onSaveConfig({ protocol, host, port });
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
          <form className="drawer-section" onSubmit={handleSubmit}>
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

          <div className="drawer-section">
            <h3 style={{ fontSize: 'var(--t-lg)' }}>Persistencia en la nube</h3>
            <span className="field-hint">
              Las sesiones se guardan automáticamente en la base de datos oficial de
              Chidori. La autenticación gestiona qué usuario es dueño de cada sesión.
              No requiere configuración adicional.
            </span>
            <span className="pill pill-confirm" style={{ alignSelf: 'flex-start' }}>
              <span className="pill-dot" />
              Conectado a Supabase
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
