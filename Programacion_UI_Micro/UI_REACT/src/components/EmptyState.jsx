import React from 'react';

/**
 * Empty state shown before any data has arrived.
 * Three-step onboarding: connect → calibrate → start.
 */
export default function EmptyState({ wsStatus, isSimulator, onOpenSettings, onToggleSimulator }) {
  const connected = wsStatus === 'CONNECTED' || isSimulator;

  return (
    <div className="empty-state">
      <h2>Listo para registrar una sesión</h2>
      <p>
        Conecte el microcontrolador Chidori (vía mDNS o IP de red local), calibre los umbrales del
        paciente y comience la adquisición. Si todavía no hay hardware disponible, puede activar
        el simulador de curva fisiológica para familiarizarse con la interfaz.
      </p>

      <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
        {connected ? null : (
          <button type="button" className="button button-primary" onClick={onOpenSettings}>
            Configurar conexión
          </button>
        )}
        <button type="button" className="button button-ghost" onClick={onToggleSimulator}>
          {isSimulator ? 'Desactivar simulador' : 'Usar simulador'}
        </button>
      </div>

      <div className="empty-steps">
        <div className="empty-step">
          <span className="empty-step-num">1</span>
          <span className="empty-step-title">Conectar el dispositivo</span>
          <span className="empty-step-body">
            Abra el panel de configuración y verifique la dirección del microcontrolador
            (chidori.local · puerto 81 por defecto).
          </span>
        </div>
        <div className="empty-step">
          <span className="empty-step-num">2</span>
          <span className="empty-step-title">Calibrar al paciente</span>
          <span className="empty-step-body">
            Use el asistente de calibración para registrar la impedancia basal en vejiga
            vacía y establecer un umbral personalizado.
          </span>
        </div>
        <div className="empty-step">
          <span className="empty-step-num">3</span>
          <span className="empty-step-title">Comenzar la sesión</span>
          <span className="empty-step-body">
            Inicie la adquisición con la barra espaciadora. Marque eventos relevantes con
            la tecla E y exporte el reporte clínico al finalizar.
          </span>
        </div>
      </div>
    </div>
  );
}
