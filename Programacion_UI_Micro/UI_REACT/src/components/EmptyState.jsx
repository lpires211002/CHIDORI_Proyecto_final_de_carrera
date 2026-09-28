import React, { Suspense, lazy } from 'react';
import { Plug, RefreshCw, UserRound, Check, Play } from 'lucide-react';
import { patientLabel } from '../lib/patients';
import SpecularButton from './SpecularButton';

// La placa 3D · carga diferida: three.js + el modelo (~1 MB) solo en esta pantalla.
const DeviceModel = lazy(() => import('./DeviceModel'));

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
  /* Resumen de la alarma ya configurada ({ label, sub, tone }). Es lo único
     real que muestran las tarjetas flotantes antes de medir. */
  alarm = null,
}) {
  const enlazado     = wsStatus === 'CONNECTED' || isSimulator;
  const reconectando = wsStatus === 'CONNECTING';
  const listo        = enlazado && Boolean(patient);

  // El Chidori es un access point sin salida a internet: mientras estás
  // enlazado a él no se puede leer la lista de pacientes de Supabase. Hay que
  // elegir el paciente ANTES de cambiar de red, y la pantalla tiene que
  // decirlo — si no, el clínico descubre el problema recién al apretar Iniciar.
  const sinInternet = typeof navigator !== 'undefined' && navigator.onLine === false;
  const ordenAlReves = !patient && (enlazado || sinInternet) && !isSimulator;

  const destino = wsConfig
    ? `${wsConfig.host}:${wsConfig.port}`
    : 'sin dirección configurada';

  return (
    <div className="start-screen">
      {/* La columna de luz ya no vive acá: es el fondo de toda la app
          (AppBackdrop, en Dashboard) y sigue detrás del dashboard al medir. */}

      {/* Vista previa del dashboard · las mismas celdas que vas a ver al medir,
          vacías. Al iniciar, cada una vuela a su lugar (FLIP en Dashboard, por
          el atributo data-fly). Sin números inventados: en reposo no hay
          lectura, y una cifra de muestra se confundiría con una. */}
      {/* La placa se ilumina solo con el equipo real enlazado, no con el simulador. */}
      <StartPreview alarm={alarm} linked={wsStatus === 'CONNECTED'} />

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
                  : sinInternet
                    ? 'la lista se lee de la nube · sin internet'
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

        {/* El orden importa y no es obvio: la ficha vive en la nube, el equipo
            es una red sin internet. */}
        {ordenAlReves && (
          <div className="prep-orden" role="note">
            <strong>El paciente se elige antes de enlazar el equipo.</strong>
            <span>
              La red <strong>Chidori</strong> no tiene salida a internet, y la lista de
              pacientes se lee de la nube. Volvé a tu WiFi habitual, elegí el paciente,
              y recién ahí conectate al equipo. La medición se guarda igual sin internet:
              queda en cola y sube sola cuando vuelve.
            </span>
          </div>
        )}

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

/* Curva fantasma · forma de un llenado (la impedancia baja mientras la vejiga
   se llena). Es decorativa: no tiene ejes ni valores. */
const GHOST_PATH =
  'M0 34 C 26 33, 44 36, 64 38 S 104 44, 126 50 S 170 58, 196 66 S 240 78, 262 84 S 300 96, 320 100';

function FloatCard({ fly, label, value, unit, sub, tone, className = '', style }) {
  return (
    <div className={`float-card ${className}`} data-fly={fly} style={style}>
      <span className="readout-label">{label}</span>
      <span className={`readout-value ${tone ? `tone-${tone}` : ''}`}>
        {value}
        {unit && <span className="readout-unit">{unit}</span>}
      </span>
      {sub && <span className="readout-delta mute">{sub}</span>}
    </div>
  );
}

function StartPreview({ alarm, linked }) {
  const dash = <span className="mute">—</span>;
  return (
    <div className="start-float" aria-hidden="true">
      {/* La placa en el centro del collage; las tarjetas la rodean. */}
      <Suspense fallback={null}>
        <DeviceModel linked={linked} className="start-device" />
      </Suspense>

      <FloatCard fly="z"     className="fc-z"     label="Impedancia" value={dash} unit="Ω"     sub="esperando la primera muestra" style={{ '--i': 0 }} />
      <FloatCard fly="v"     className="fc-v"     label="Tensión"    value={dash} unit="V"     sub="sin dato del equipo"         style={{ '--i': 1 }} />
      <FloatCard fly="vol"   className="fc-vol"   label="Volumen"    value={dash} unit="%"     sub="sin basal"                   style={{ '--i': 2 }} />
      <FloatCard
        fly="alarm"
        className="fc-alarm"
        label="Alarma"
        value={<span className="is-word">{alarm?.label ?? 'Desactivada'}</span>}
        sub={alarm?.sub ?? 'sin configurar'}
        tone={alarm?.tone}
        style={{ '--i': 3 }}
      />
      <FloatCard fly="rate"  className="fc-rate"  label="Tasa"       value={dash} unit="Ω/min" sub="disponible a los 3 min"      style={{ '--i': 4 }} />

      <div className="float-card fc-chart" data-fly="chart" style={{ '--i': 5 }}>
        <span className="readout-label">Impedancia · tiempo real</span>
        <svg className="fc-chart-svg" viewBox="0 0 320 110" preserveAspectRatio="none">
          <line x1="0" y1="34" x2="320" y2="34" className="fc-chart-base" />
          <path d={GHOST_PATH} className="fc-chart-line" />
        </svg>
      </div>
    </div>
  );
}
