import React, { useState, useEffect } from 'react';
import { Sliders, RefreshCw, Save, Wifi, WifiOff } from 'lucide-react';

export default function SettingsPanel({ 
  wsConfig, 
  onSaveConfig, 
  wsStatus, 
  onReconnect 
}) {
  const [host, setHost] = useState(wsConfig.host);
  const [port, setPort] = useState(wsConfig.port);
  const [protocol, setProtocol] = useState(wsConfig.protocol);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    setHost(wsConfig.host);
    setPort(wsConfig.port);
    setProtocol(wsConfig.protocol);
  }, [wsConfig]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSaveConfig({ host, port, protocol });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const getStatusText = () => {
    switch (wsStatus) {
      case 'CONNECTED': return 'Conectado';
      case 'DISCONNECTED': return 'Desconectado';
      case 'CONNECTING': return 'Reconectando...';
      default: return 'Desconocido';
    }
  };

  const getStatusClass = () => {
    switch (wsStatus) {
      case 'CONNECTED': return 'status-badge connected';
      case 'DISCONNECTED': return 'status-badge disconnected';
      case 'CONNECTING': return 'status-badge reconnecting';
      default: return 'status-badge';
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2>Conectividad de Chidori</h2>
          <span className="card-subtitle">Administra la dirección y puerto del microcontrolador</span>
        </div>
        <div className={getStatusClass()}>
          <span className="status-dot"></span>
          {getStatusText()}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="alarm-content" style={{ padding: 0 }}>
        <div className="alarm-options" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          
          <div className="alarm-card-option">
            <label className="form-group" style={{ margin: 0 }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', marginBottom: '6px' }}>Protocolo</span>
              <select 
                className="input-field" 
                value={protocol} 
                onChange={(e) => setProtocol(e.target.value)}
              >
                <option value="ws://">ws:// (Sin cifrar - Local)</option>
                <option value="wss://">wss:// (Cifrado - Remoto)</option>
              </select>
            </label>
            <span style={{ fontSize: '10px', color: 'hsl(var(--text-tertiary))' }}>
              Vercel requiere HTTPS/WSS, pero para IPs de red local usa ws://
            </span>
          </div>

          <div className="alarm-card-option">
            <label className="form-group" style={{ margin: 0 }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', marginBottom: '6px' }}>IP / Hostname</span>
              <input 
                type="text" 
                className="input-field" 
                placeholder="Ej. chidori.local o 192.168.0.126"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                required
              />
            </label>
            <span style={{ fontSize: '10px', color: 'hsl(var(--text-tertiary))' }}>
              Ingresa el host mDNS (chidori.local) o la IP asignada por DHCP.
            </span>
          </div>

          <div className="alarm-card-option">
            <label className="form-group" style={{ margin: 0 }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', marginBottom: '6px' }}>Puerto</span>
              <input 
                type="number" 
                className="input-field" 
                placeholder="Ej. 81"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                required
              />
            </label>
            <span style={{ fontSize: '10px', color: 'hsl(var(--text-tertiary))' }}>
              El puerto predeterminado del WebSocket del micro es 81.
            </span>
          </div>

        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
          <button 
            type="button" 
            onClick={onReconnect} 
            className="btn btn-tertiary"
            style={{ padding: '10px 16px', background: 'transparent', color: 'hsl(var(--text-primary))', border: '1px solid hsl(var(--border-color))', boxShadow: 'none' }}
            disabled={wsStatus === 'CONNECTING'}
          >
            <RefreshCw size={16} className={wsStatus === 'CONNECTING' ? 'spin' : ''} style={{ animation: wsStatus === 'CONNECTING' ? 'spin 1.5s linear infinite' : 'none' }} />
            Reconectar
          </button>
          
          <button 
            type="submit" 
            className="btn btn-primary"
            style={{ padding: '10px 20px' }}
          >
            <Save size={16} />
            {isSaved ? 'Guardado ✓' : 'Guardar Configuración'}
          </button>
        </div>
      </form>
    </div>
  );
}
