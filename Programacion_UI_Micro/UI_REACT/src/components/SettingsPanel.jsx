import React, { useEffect, useState } from 'react';
import { X, RefreshCw, Save, ChevronRight, RotateCcw, Wifi } from 'lucide-react';

/**
 * Settings drawer · conexión al microcontrolador + diagnóstico del firmware.
 * La persistencia en la nube está hardcodeada (auth con Supabase).
 *
 * `device` proviene del mensaje STATUS del firmware:
 *   { state: 'MIDIENDO'|'INACTIVO'|null, rssi: dBm|null, heap: bytes|null, at: ts|null }
 */
/** Valores de fábrica · el firmware corre en modo Access Point con IP fija. */
const DEFAULTS = { protocol: 'ws://', host: '192.168.4.1', port: '81' };

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
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  const handleReset = () => {
    setProtocol(DEFAULTS.protocol);
    setHost(DEFAULTS.host);
    setPort(DEFAULTS.port);
    onSaveConfig({ ...DEFAULTS });
  };

  // ¿La config actual es la de fábrica? Si no, lo avisamos en la vista simple.
  const isDefault = wsConfig.protocol === DEFAULTS.protocol
                 && wsConfig.host === DEFAULTS.host
                 && String(wsConfig.port) === DEFAULTS.port;

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

            {/* ── Vista simple · el equipo siempre es un Access Point fijo ── */}
            <div className="step-summary" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <span>Red WiFi del equipo</span>
              <span>Dirección</span>
              <strong>Chidori</strong>
              <strong className="numeric">{wsConfig.host}:{wsConfig.port}</strong>
            </div>

            <span className="field-hint">
              <Wifi size={12} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Encendé el Chidori y conectá esta computadora a la red WiFi <strong>Chidori</strong>
              {' '}(clave <strong>chidori123</strong>). La conexión es automática: no hay nada que configurar.
            </span>

            {!isDefault && (
              <span className="field-hint" style={{ color: 'var(--alarm)' }}>
                ⚠ La dirección no es la de fábrica ({DEFAULTS.host}:{DEFAULTS.port}).
                Si no conecta, usá “Restablecer valores por defecto”.
              </span>
            )}

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="button button-ghost" onClick={onReconnect} disabled={wsStatus === 'CONNECTING'}>
                <RefreshCw size={14} className={wsStatus === 'CONNECTING' ? 'rotating' : ''} />
                Reconectar
              </button>
            </div>

            {/* ── Opciones avanzadas · plegadas por defecto ── */}
            <button
              type="button"
              className="button button-ghost button-sm"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              style={{ alignSelf: 'flex-start', paddingLeft: 0 }}
            >
              <ChevronRight
                size={14}
                style={{ transform: showAdvanced ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}
              />
              Opciones avanzadas
            </button>

            {showAdvanced && (
              <>
                <span className="field-hint">
                  Solo para diagnóstico o para apuntar a un equipo en otra red. En uso normal
                  no hace falta tocar nada.
                </span>

                <div className="field">
                  <label className="field-label" htmlFor="proto">Protocolo</label>
                  <select id="proto" className="input" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
                    <option value="ws://">ws:// (red local)</option>
                    <option value="wss://">wss:// (TLS)</option>
                  </select>
                  <span className="field-hint">
                    El equipo usa ws://. wss:// solo aplica detrás de un proxy con TLS.
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
                    placeholder={DEFAULTS.host}
                    required
                  />
                  <span className="field-hint">
                    IP del equipo. En modo Access Point es siempre {DEFAULTS.host}.
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
                    placeholder={DEFAULTS.port}
                    required
                  />
                  <span className="field-hint">Puerto WebSocket. El firmware usa 81.</span>
                </div>

                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <button type="button" className="button button-ghost button-sm" onClick={handleReset}>
                    <RotateCcw size={14} />
                    Restablecer valores por defecto
                  </button>
                  <button type="submit" className="button button-primary">
                    <Save size={14} />
                    Guardar
                  </button>
                </div>
              </>
            )}
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
