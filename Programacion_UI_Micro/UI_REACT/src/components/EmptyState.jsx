import React, { Suspense, lazy } from 'react';
import { Plug, RefreshCw, UserRound, Check, Play } from 'lucide-react';
import { patientLabel } from '../lib/patients';
import SpecularButton from './SpecularButton';

// Carga diferida: three.js pesa, y así no demora el arranque de la app.
// Solo se descarga/monta en esta pantalla previa a la medición.
const LightPillar = lazy(() => import('./LightPillar'));

/**
 * Pantalla de inicio · antes de que llegue el primer dato.
 *
 * Muestra los dos requisitos reales para medir —el enlace con el dispositivo
 * y el paciente al que se le atribuye la sesión— como filas de estado en vivo,
 * y el botón de arranque debajo. Antes la conexión se anunciaba tres veces
 * (chip del header, banner rojo y este texto) y el paciente no se mencionaba:
 * el clínico se enteraba de que faltaba recién al apretar Iniciar.
 *
 * Sin recuadro: la columna de luz del fondo es el marco. Encerrar el contenido
 * en una tarjeta punteada sobre un fondo así deja dos bordes compitiendo.
 *
 * Props:
 *   wsStatus     · 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED'
 *   isSimulator  · con el simulador activo el enlace se da por resuelto
 *   wsConfig     · { protocol, host, port } · para mostrar a dónde apunta
 *   patient      · paciente activo o null
 *   sessionCount · sesiones previas de ese paciente (para "sesión N")
 *   canStart     · si el botón de arranque está habilitado
 */
export default function EmptyState({
  wsStatus,
  isSimulator,
  wsConfig,
  patient,
  sessionCount = 0,
  canStart = true,
  onOpenSettings,
  onToggleSimulator,
  onReconnect,
  onPickPatient,
  onStart,
}) {
  const enlazado     = wsStatus === 'CONNECTED' || isSimulator;
  const reconectando = wsStatus === 'CONNECTING';
  const listo        = enlazado && Boolean(patient);

  const destino = wsConfig
    ? `${wsConfig.host}:${wsConfig.port}`
    : 'sin dirección configurada';

  return (
    <div className="start-screen">
      {/* Fondo · columna de luz. Se desmonta al iniciar la medición (este
          componente deja de renderizarse), así que no consume GPU durante una
          sesión larga. */}
      <div className="start-screen__bg" aria-hidden="true">
        <Suspense fallback={null}>
          <LightPillar
            /* Los valores de fábrica: bajarlos apagaba los filamentos y el
               efecto quedaba como una mancha. Lo único propio son los colores
               —indigo de marca en vez del violeta/rosa— manteniendo el rango
               de luminancia del original, que es lo que da el relieve. */
            topColor="#b8cdff"
            bottomColor="#3c32da"
            intensity={1.0}
            rotationSpeed={0.28}
            glowAmount={0.005}
            pillarWidth={3.0}
            pillarHeight={0.4}
            noiseIntensity={0.4}
            /* Inclinado como en el ejemplo: los filamentos cruzan el cuadro en
               diagonal en vez de subir rectos por el medio. */
            pillarRotation={-16}
            mixBlendMode="screen"
          />
        </Suspense>
      </div>

      <div className="start-screen__content">
        <header className="start-screen__head">
          <span className="start-screen__eyebrow">
            {listo ? 'Listo' : 'Preparación'}
          </span>
          <h2>{listo ? 'Todo listo para medir' : 'Preparar la sesión'}</h2>
        </header>

        <div className="prep-list">
          {/* ── Dispositivo ─────────────────────────────────────────── */}
          <div className={`prep-row ${enlazado ? 'is-ok' : 'is-pending'}`}>
            <span className="prep-icon" aria-hidden="true">
              {enlazado ? <Check size={15} /> : <Plug size={15} />}
            </span>

            <div className="prep-text">
              <span className="prep-title">Dispositivo</span>
              <span className="prep-meta">
                {isSimulator ? 'simulador activo · datos sintéticos'
                  : enlazado ? `enlazado · ${destino}`
                  : reconectando ? `reintentando · ${destino}`
                  : `sin enlace · ${destino}`}
              </span>
            </div>

            {!enlazado && (
              <div className="prep-actions">
                <button type="button" className="button button-ghost button-sm" onClick={onReconnect}>
                  <RefreshCw size={13} className={reconectando ? 'rotating' : ''} />
                  Reconectar
                </button>
                <button type="button" className="button button-sm" onClick={onOpenSettings}>
                  Configurar
                </button>
              </div>
            )}
          </div>

          {/* ── Paciente ────────────────────────────────────────────── */}
          <div className={`prep-row ${patient ? 'is-ok' : 'is-pending'}`}>
            <span className="prep-icon" aria-hidden="true">
              {patient ? <Check size={15} /> : <UserRound size={15} />}
            </span>

            <div className="prep-text">
              <span className="prep-title">Paciente</span>
              <span className="prep-meta">
                {patient
                  ? `${patientLabel(patient)} · sesión ${sessionCount + 1}`
                  : 'sin seleccionar · la sesión queda sin atribuir'}
              </span>
            </div>

            <div className="prep-actions">
              <button
                type="button"
                className={`button button-sm ${patient ? 'button-ghost' : ''}`}
                onClick={onPickPatient}
              >
                {patient ? 'Cambiar' : 'Elegir paciente'}
              </button>
            </div>
          </div>
        </div>

        <div className="prep-launch">
          {/* Acción principal de la pantalla · el reflejo del borde responde
              al cursor antes de que llegues a tocarlo. */}
          <SpecularButton
            className="button button-primary button-lg"
            onClick={onStart}
            disabled={!canStart}
            radius={10}
            lineColor="#ffffff"
            baseColor="#2b2470"
            intensity={1.15}
            shineSize={12}
            shineFade={38}
            thickness={1.2}
            proximity={280}
            title={listo
              ? 'Comenzar la adquisición (Espacio)'
              : 'Falta resolver los puntos de arriba'}
          >
            <Play size={16} />
            Iniciar adquisición
          </SpecularButton>

          <button type="button" className="link-button" onClick={onToggleSimulator}>
            {isSimulator ? 'Desactivar simulador' : 'Usar simulador en su lugar'}
          </button>
        </div>
      </div>
    </div>
  );
}
