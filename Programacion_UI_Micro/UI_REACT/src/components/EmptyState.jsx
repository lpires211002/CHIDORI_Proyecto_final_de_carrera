import React, { Suspense, lazy } from 'react';

// Carga diferida: three.js pesa, y así no demora el arranque de la app.
// Solo se descarga/monta en esta pantalla previa a la medición.
const Antigravity = lazy(() => import('./Antigravity'));

/**
 * Empty state shown before any data has arrived.
 * Three-step onboarding: connect → calibrate → start.
 */
export default function EmptyState({ wsStatus, isSimulator, onOpenSettings, onToggleSimulator }) {
  const connected = wsStatus === 'CONNECTED' || isSimulator;

  return (
    <div className="empty-state">
      {/* Fondo animado · decorativo. Se desmonta al iniciar la medición
          (este componente deja de renderizarse), así que no consume GPU
          durante una sesión larga. */}
      <div className="empty-state-bg" aria-hidden="true">
        <Suspense fallback={null}>
          <Antigravity
            count={260}
            magnetRadius={9}
            ringRadius={7.5}
            waveSpeed={0.4}
            waveAmplitude={1}
            particleSize={1.4}
            lerpSpeed={0.05}
            autoAnimate
            particleVariance={1}
            rotationSpeed={0.05}
            pulseSpeed={2.4}
            fieldStrength={10}
          />
        </Suspense>
      </div>

      <h2>Listo para registrar una sesión</h2>
      <p>
        Encienda el Chidori y conecte esta computadora a su red WiFi, calibre los umbrales del
        paciente y comience la adquisición. Si todavía no hay hardware disponible, puede activar
        el simulador de curva fisiológica para familiarizarse con la interfaz.
      </p>

      <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
        {connected ? null : (
          <button type="button" className="button button-primary" onClick={onOpenSettings}>
            Revisar conexión
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
            Encienda el Chidori y, desde el WiFi de esta computadora, conéctese a la red
            <strong> Chidori</strong> (clave <strong>chidori123</strong>). El enlace se
            establece solo.
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
