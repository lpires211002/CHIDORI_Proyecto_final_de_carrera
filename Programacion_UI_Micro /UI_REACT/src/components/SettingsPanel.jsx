import React, { useEffect, useState } from 'react';
import { X, RefreshCw, Save } from 'lucide-react';

/**
 * Settings drawer · conexión al microcontrolador + diagnóstico del firmware.
 * La persistencia en la nube está hardcodeada (auth con Supabase).
 *
 * `device` proviene del mensaje STATUS del firmware:
 *   { state: 'MIDIENDO'|'INACTIVO'|null, rssi: dBm|null, heap: bytes|null, at: ts|null }
 */
export default function SettingsPanel({
  open,
  onClose,
  wsConfig,
  onSaveConfig,
  wsStatus,
  onReconnect,
  device = { state: null, rssi: null, heap: null, at: null },
  linkQuality = null,
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

  // ── Diagnóstico ──
  const connected   = wsStatus === 'CONNECTED';
  const hasReport    = device && device.state != null;
  const heapKb       = device?.heap != null ? Math.round(device.heap / 1024) : null;
  const estadoLabel  = device?.state === 'MIDIENDO' ? 'Midiendo'
                     : device?.state === 'INACTIVO' ? 'Inactivo'
                     : 'Desconocido';
  const estadoClass  = device?.state === 'MIDIENDO' ? 'pill pill-live'
                     : device?.state === 'INACTIVO' ? 'pill pill-off'
                     : 'pill pill-off';
  const fmtAgo = () => {
    if (!device?.at) return '—';
    const s = Math.max(0, Math.floor((Date.now() - device.at) / 1000));
    if (s < 5) return 'ahora';
    if (s < 60) return `hace ${s} s`;
    return `hace ${Math.floor(s / 60)} min`;
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

          {/* ── Diagnóstico del dispositivo · reportado por el firmware (STATUS) ── */}
          <div className="drawer-section">
            <div className="drawer-section-head">
              <h3 style={{ fontSize: 'var(--t-lg)' }}>Diagnóstico del dispositivo</h3>
              <span className={estadoClass}>
                <span className="pill-dot" />
                {estadoLabel}
              </span>
            </div>

            {connected && hasReport ? (
              <>
                <div className="step-summary" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <span>Enlace (RSSI)</span>
                  <span>Memoria libre</span>
                  <span>Última lectura</span>
                  <strong className="numeric">
                    {device.rssi != null ? `${device.rssi} dBm` : '—'}
                  </strong>
                  <strong className="numeric">
                    {heapKb != null ? `${heapKb} KB` : '—'}
                  </strong>
                  <strong className="numeric">{fmtAgo()}</strong>
                </div>
                {linkQuality && (
                  <span className="field-hint">
                    Calidad del enlace WiFi: {linkQuality}. El firmware fija la potencia
                    de transmisión en 8.5 dBm (fix de antena del ESP32-C3 Super Mini).
                  </span>
                )}
              </>
            ) : (
              <span className="field-hint">
                {connected
                  ? 'Esperando el primer reporte de estado del firmware…'
                  : 'Sin enlace al dispositivo. Los datos de diagnóstico aparecen cuando hay conexión.'}
              </span>
            )}
          </div>

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
