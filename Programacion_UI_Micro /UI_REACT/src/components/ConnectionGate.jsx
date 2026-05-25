import React from 'react';
import { Plug, RefreshCw } from 'lucide-react';

/**
 * Persistent banner shown when WebSocket is down and the simulator is off.
 * Always-visible reminder that no data can be acquired in this state.
 */
export default function ConnectionGate({ wsStatus, isSimulator, onOpenSettings, onReconnect }) {
  if (isSimulator) return null;
  if (wsStatus === 'CONNECTED') return null;

  const reconnecting = wsStatus === 'CONNECTING';

  return (
    <div className="gate-banner" role="status">
      <div className="row" style={{ gap: 14 }}>
        <Plug size={18} style={{ color: 'var(--alarm)' }} />
        <div className="gate-banner-text">
          <strong>Sin conexión al microcontrolador.</strong>
          <span className="mute" style={{ fontSize: 'var(--t-xs)' }}>
            {reconnecting
              ? 'Reintentando automáticamente…'
              : 'No se están adquiriendo mediciones. Revise la dirección o use el simulador.'}
          </span>
        </div>
      </div>
      <div className="row">
        <button type="button" className="button button-ghost button-sm" onClick={onReconnect}>
          <RefreshCw size={13} className={reconnecting ? 'rotating' : ''} />
          Reconectar
        </button>
        <button type="button" className="button button-sm" onClick={onOpenSettings}>
          Abrir configuración
        </button>
      </div>
    </div>
  );
}
