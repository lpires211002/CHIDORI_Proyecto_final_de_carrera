import React, { useState, useEffect } from 'react';
import { Sliders, RefreshCw, Save, Database, Wifi } from 'lucide-react';

export default function SettingsPanel({ 
  wsConfig, 
  onSaveConfig, 
  wsStatus, 
  onReconnect,
  supabaseConfig,
  onSaveSupabaseConfig
}) {
  // WebSocket config states
  const [host, setHost] = useState(wsConfig.host);
  const [port, setPort] = useState(wsConfig.port);
  const [protocol, setProtocol] = useState(wsConfig.protocol);
  
  // Supabase config states
  const [sbUrl, setSbUrl] = useState(supabaseConfig?.url || '');
  const [sbKey, setSbKey] = useState(supabaseConfig?.key || '');

  const [isSaved, setIsSaved] = useState(false);
  const [isSbSaved, setIsSbSaved] = useState(false);

  useEffect(() => {
    setHost(wsConfig.host);
    setPort(wsConfig.port);
    setProtocol(wsConfig.protocol);
  }, [wsConfig]);

  useEffect(() => {
    setSbUrl(supabaseConfig?.url || '');
    setSbKey(supabaseConfig?.key || '');
  }, [supabaseConfig]);

  const handleWsSubmit = (e) => {
    e.preventDefault();
    onSaveConfig({ host, port, protocol });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleSbSubmit = (e) => {
    e.preventDefault();
    onSaveSupabaseConfig({ url: sbUrl, key: sbKey });
    setIsSbSaved(true);
    setTimeout(() => setIsSbSaved(false), 2000);
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '20px' }}>
      
      {/* 1. WebSocket configuration Card */}
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="card-header">
          <div>
            <h2>Conectividad de Chidori</h2>
            <span className="card-subtitle">Administra la dirección y puerto del microcontrolador local</span>
          </div>
          <div className={getStatusClass()}>
            <span className="status-dot"></span>
            {getStatusText()}
          </div>
        </div>

        <form onSubmit={handleWsSubmit} className="alarm-content" style={{ padding: 0 }}>
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
                Ingresa el host mDNS (chidori.local) o la IP asignada por el router.
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

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' }}>
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
              {isSaved ? 'Guardado ✓' : 'Guardar WebSocket'}
            </button>
          </div>
        </form>
      </div>

      {/* 2. Supabase Integration Card */}
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="card-header">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={20} style={{ color: 'hsl(var(--accent-purple))' }} />
              Base de Datos Cloud (Supabase)
            </h2>
            <span className="card-subtitle">Guarda mediciones largas (hasta 4hs) de forma segura y privada</span>
          </div>
          <div className={`status-badge ${supabaseConfig?.url && supabaseConfig?.key ? 'connected' : 'disconnected'}`}>
            <span className="status-dot"></span>
            {supabaseConfig?.url && supabaseConfig?.key ? 'Configurado' : 'Sin Conexión'}
          </div>
        </div>

        <form onSubmit={handleSbSubmit} className="alarm-content" style={{ padding: 0 }}>
          <div className="alarm-options" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            
            <div className="alarm-card-option">
              <label className="form-group" style={{ margin: 0 }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', marginBottom: '6px' }}>Supabase Project URL</span>
                <input 
                  type="url" 
                  className="input-field" 
                  placeholder="https://xyz.supabase.co"
                  value={sbUrl}
                  onChange={(e) => setSbUrl(e.target.value)}
                />
              </label>
              <span style={{ fontSize: '10px', color: 'hsl(var(--text-tertiary))' }}>
                Tu URL del proyecto disponible en Supabase settings / API.
              </span>
            </div>

            <div className="alarm-card-option">
              <label className="form-group" style={{ margin: 0 }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', marginBottom: '6px' }}>Supabase Anon/Public Key</span>
                <input 
                  type="password" 
                  className="input-field" 
                  placeholder="eyJhbGciOi..."
                  value={sbKey}
                  onChange={(e) => setSbKey(e.target.value)}
                />
              </label>
              <span style={{ fontSize: '10px', color: 'hsl(var(--text-tertiary))' }}>
                Clave pública anónima (anon public) guardada localmente en tu cliente.
              </span>
            </div>

          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' }}>
            <button 
              type="submit" 
              className="btn btn-accent"
              style={{ padding: '10px 20px' }}
            >
              <Save size={16} />
              {isSbSaved ? 'Guardado ✓' : 'Guardar Supabase'}
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}
