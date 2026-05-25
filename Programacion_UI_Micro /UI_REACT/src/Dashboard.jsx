import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play, Pause, Bookmark, RotateCcw, Download, Moon, Sun,
  Settings as SettingsIcon, Cpu, LogOut, Shield,
} from 'lucide-react';

import SettingsPanel     from './components/SettingsPanel';
import StatsGrid         from './components/StatsGrid';
import RealTimeCharts    from './components/RealTimeCharts';
import Timeline          from './components/Timeline';
import ExportModal       from './components/ExportModal';
import BladderVisual     from './components/BladderVisual';
import CalibrationWizard from './components/CalibrationWizard';
import AlarmBanner       from './components/AlarmBanner';
import CloudSyncBadge    from './components/CloudSyncBadge';
import ConfirmModal      from './components/ConfirmModal';
import Toasts            from './components/Toasts';
import EmptyState        from './components/EmptyState';
import ConnectionGate    from './components/ConnectionGate';
import useCloudSync      from './components/useCloudSync';

import { supabase, emailToUsername } from './supabaseClient';

/**
 * Dashboard · vista principal del clínico autenticado.
 * El gate de auth está en App.jsx; acá ya sabemos que hay session y profile.
 */
export default function Dashboard({ session, profile, onSignOut, isAdmin = false, onSwitchToAdmin }) {
  const userId      = session.user.id;
  const displayName = profile?.display_name || emailToUsername(session.user.email);

  /* ── Theme ─────────────────────────────────────────────────────────── */
  const [theme, setTheme] = useState(() => localStorage.getItem('chidori-theme') || 'dark');
  useEffect(() => {
    document.body.classList.toggle('light-theme', theme === 'light');
    localStorage.setItem('chidori-theme', theme);
  }, [theme]);

  /* ── WebSocket ─────────────────────────────────────────────────────── */
  const [wsConfig, setWsConfig] = useState(() => {
    const saved = localStorage.getItem('chidori-ws-config');
    return saved ? JSON.parse(saved) : { protocol: 'ws://', host: 'chidori.local', port: '81' };
  });
  const [wsStatus, setWsStatus] = useState('DISCONNECTED');
  const socketRef = useRef(null);
  const reconnectIntervalRef = useRef(null);

  /* ── Cloud sync (Supabase) ────────────────────────────────────────── */
  const [sessionId, setSessionId] = useState(null);
  const cloud = useCloudSync(supabase);

  /* ── Simulator ────────────────────────────────────────────────────── */
  const [isSimulator, setIsSimulator] = useState(false);
  const simulatorIntervalRef = useRef(null);
  const simulatedZRef = useRef(150.0);

  /* ── Session state ────────────────────────────────────────────────── */
  const [measuring, setMeasuring]       = useState(false);
  const [startTime, setStartTime]       = useState(null);
  const [pausedDuration, setPausedDur]  = useState(0);
  const [pauseStart, setPauseStart]     = useState(null);
  const [elapsedTime, setElapsedTime]   = useState('00:00');
  const [data, setData]                 = useState([]);
  const [rateData, setRateData]         = useState([]);
  const [events, setEvents]             = useState([]);
  const [initialValue, setInitialValue] = useState(null);
  const [currentValue, setCurrentValue] = useState(null);
  const [rate, setRate]                 = useState(0);
  const [eventCount, setEventCount]     = useState(0);

  /* ── Alarm ─────────────────────────────────────────────────────────── */
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [alarmType, setAlarmType]       = useState('abs');
  const [alarmAbs, setAlarmAbs]         = useState('');
  const [alarmPercent, setAlarmPercent] = useState('');
  const [alarmDiff, setAlarmDiff]       = useState('');
  const [alarmFired, setAlarmFired]     = useState(false);
  const [alarmArmed, setAlarmArmed]     = useState(true);

  /* ── UI ────────────────────────────────────────────────────────────── */
  const [isExportOpen, setIsExportOpen]     = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [confirmReset, setConfirmReset]     = useState(false);
  const [toasts, setToasts]                 = useState([]);

  /* ── Refs ──────────────────────────────────────────────────────────── */
  const stateRef = useRef({});
  useEffect(() => {
    stateRef.current = {
      measuring, startTime, pausedDuration, data, initialValue, currentValue,
      alarmEnabled, alarmType, alarmAbs, alarmPercent, alarmDiff, alarmFired, alarmArmed,
      sessionId, eventCount, cloud,
    };
  });

  const toast = useCallback((text, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  /* ── WebSocket lifecycle ──────────────────────────────────────────── */
  const connectWebSocket = useCallback(() => {
    if (isSimulator) return;
    if (socketRef.current) socketRef.current.close();
    const { protocol, host, port } = wsConfig;
    const url = `${protocol}${host}:${port}/`;
    setWsStatus('CONNECTING');
    try {
      const ws = new WebSocket(url);
      socketRef.current = ws;
      ws.onopen = () => {
        setWsStatus('CONNECTED');
        toast('Microcontrolador conectado', 'success');
        if (reconnectIntervalRef.current) {
          clearInterval(reconnectIntervalRef.current);
          reconnectIntervalRef.current = null;
        }
      };
      ws.onclose = () => {
        setWsStatus('DISCONNECTED');
        if (!reconnectIntervalRef.current && !isSimulator) {
          reconnectIntervalRef.current = setInterval(() => connectWebSocket(), 5000);
        }
      };
      ws.onerror = () => setWsStatus('DISCONNECTED');
      ws.onmessage = (event) => {
        const val = parseFloat(event.data);
        if (!isNaN(val)) handleIncomingData(val);
      };
    } catch {
      setWsStatus('DISCONNECTED');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsConfig, isSimulator]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (socketRef.current) socketRef.current.close();
      if (reconnectIntervalRef.current) clearInterval(reconnectIntervalRef.current);
    };
  }, [wsConfig, isSimulator, connectWebSocket]);

  const handleSaveConfig = (newConfig) => {
    setWsConfig(newConfig);
    localStorage.setItem('chidori-ws-config', JSON.stringify(newConfig));
    toast('Conexión guardada', 'success');
  };

  /* ── Clock ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!measuring || !startTime) return;
    const interval = setInterval(() => {
      const e = (Date.now() - startTime - pausedDuration) / 1000;
      const m = Math.floor(e / 60);
      const s = Math.floor(e % 60);
      setElapsedTime(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    }, 250);
    return () => clearInterval(interval);
  }, [measuring, startTime, pausedDuration]);

  /* ── Data handler ──────────────────────────────────────────────────── */
  const handleIncomingData = (val) => {
    const cur = stateRef.current;
    if (!cur.measuring) return;

    let baseline = cur.initialValue;
    if (baseline === null) {
      baseline = val;
      setInitialValue(val);
    }
    setCurrentValue(val);

    const elapsed = (Date.now() - cur.startTime - cur.pausedDuration) / 1000;
    let computedRate = 0;

    setData((prev) => {
      const next = [...prev, { x: elapsed, y: val }];
      if (next.length >= 2) {
        const recent = next.slice(-10);
        const a = recent[0];
        const b = recent[recent.length - 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        computedRate = dx > 0 ? (dy / dx) * 60 : 0;
        setRate(computedRate);
        setRateData((p) => [...p, { x: elapsed, y: computedRate }]);
      } else {
        setRateData((p) => [...p, { x: elapsed, y: 0 }]);
      }
      return next;
    });

    // Cloud insert every ~10 s
    const sampleIndex = Math.round(elapsed);
    if (cur.sessionId && sampleIndex % 10 === 0) {
      cur.cloud?.enqueue({
        label: 'measurement',
        run: (client) => client.from('measurements').insert({
          session_id: cur.sessionId,
          elapsed_time: elapsed,
          impedance: val,
          rate: computedRate,
        }).throwOnError(),
      });
    }

    // Edge-triggered alarm
    if (cur.alarmEnabled) {
      let threshold = null;
      if (cur.alarmType === 'abs' && cur.alarmAbs) {
        threshold = parseFloat(cur.alarmAbs);
      } else if (cur.alarmType === 'percent' && cur.alarmPercent) {
        threshold = baseline * (parseFloat(cur.alarmPercent) / 100);
      } else if (cur.alarmType === 'diff' && cur.alarmDiff) {
        threshold = baseline - parseFloat(cur.alarmDiff);
      }
      if (threshold !== null && Number.isFinite(threshold)) {
        const margin = Math.max(0.5, Math.abs(threshold) * 0.02);
        if (val <= threshold) {
          if (cur.alarmArmed && !cur.alarmFired) {
            setAlarmFired(true);
            setAlarmArmed(false);
          }
        } else if (val >= threshold + margin) {
          if (!cur.alarmArmed && !cur.alarmFired) setAlarmArmed(true);
        }
      }
    }
  };

  /* ── Shortcuts ─────────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); toggleMeasuring(); }
      else if (e.key.toLowerCase() === 'e') { e.preventDefault(); handleMarkEvent(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuring, startTime, pausedDuration, data, initialValue, currentValue, eventCount, wsStatus, isSimulator]);

  /* ── Simulator ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (isSimulator && measuring) {
      simulatedZRef.current = initialValue !== null ? initialValue : 150.0;
      simulatorIntervalRef.current = setInterval(() => {
        const noise = (Math.random() - 0.5) * 0.08;
        const fillStep = 0.12;
        const nextZ = simulatedZRef.current - fillStep + noise;
        simulatedZRef.current = nextZ;
        handleIncomingData(nextZ);
      }, 1000);
    } else if (simulatorIntervalRef.current) {
      clearInterval(simulatorIntervalRef.current);
      simulatorIntervalRef.current = null;
    }
    return () => simulatorIntervalRef.current && clearInterval(simulatorIntervalRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSimulator, measuring]);

  const toggleSimulator = () => {
    if (measuring) { toast('Detenga la medición antes de alternar el simulador', 'warn'); return; }
    const next = !isSimulator;
    setIsSimulator(next);
    if (next) {
      setWsStatus('DISCONNECTED');
      if (socketRef.current) socketRef.current.close();
      toast('Simulador activado · curva fisiológica sintética', 'info');
    } else {
      toast('Simulador desactivado · reconectando dispositivo', 'info');
      connectWebSocket();
    }
  };

  /* ── Controls ──────────────────────────────────────────────────────── */
  const toggleMeasuring = async () => {
    if (wsStatus !== 'CONNECTED' && !isSimulator) {
      toast('Sin conexión. Active el simulador o configure el dispositivo.', 'warn');
      return;
    }

    if (!measuring) {
      let sTime = startTime;
      let pDur = pausedDuration;
      if (!sTime) { sTime = Date.now(); setStartTime(sTime); }
      if (pauseStart) { pDur += Date.now() - pauseStart; setPausedDur(pDur); setPauseStart(null); }

      if (!sessionId) {
        try {
          const { data: newSession, error } = await supabase
            .from('sessions')
            .insert({
              user_id:           userId,
              patient_name:      'Sesión sin identificar',
              initial_impedance: currentValue || 150.0,
            })
            .select()
            .single();
          if (error) throw error;
          if (newSession) setSessionId(newSession.id);
        } catch (err) {
          console.error('[session create]', err);
          toast('No se pudo crear la sesión en la nube. Mediciones locales continúan.', 'warn');
        }
      }

      if (!isSimulator && socketRef.current) socketRef.current.send('START');
      setMeasuring(true);

      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } else {
      if (!isSimulator && socketRef.current) socketRef.current.send('STOP');
      setMeasuring(false);
      setPauseStart(Date.now());
    }
  };

  const handleMarkEvent = () => {
    if (!measuring || !startTime) return;
    const elapsed = (Date.now() - startTime - pausedDuration) / 1000;
    const nextCount = eventCount + 1;
    setEventCount(nextCount);
    const changeVal = (initialValue !== null && currentValue !== null)
      ? currentValue - initialValue
      : null;
    setEvents((prev) => [{ id: nextCount, time: elapsed, value: currentValue || 0, change: changeVal }, ...prev]);

    if (sessionId) {
      cloud.enqueue({
        label: 'event',
        run: (client) => client.from('session_events').insert({
          session_id: sessionId,
          event_number: nextCount,
          elapsed_time: elapsed,
          impedance: currentValue || 0,
          impedance_change: changeVal,
        }).throwOnError(),
      });
    }
  };

  const handleReset = () => {
    if (socketRef.current && wsStatus === 'CONNECTED' && !isSimulator) {
      socketRef.current.send('RESET');
    }
    setMeasuring(false);
    setStartTime(null);
    setPausedDur(0);
    setPauseStart(null);
    setElapsedTime('00:00');
    setData([]);
    setRateData([]);
    setEvents([]);
    setInitialValue(null);
    setCurrentValue(null);
    setRate(0);
    setEventCount(0);
    setAlarmFired(false);
    setAlarmArmed(true);
    setSessionId(null);
    simulatedZRef.current = 150.0;
    setConfirmReset(false);
    toast('Sesión reiniciada', 'info');
  };

  const handleSaveCalibration = (calib) => {
    setInitialValue(calib.zEmpty);
    setAlarmType('abs');
    setAlarmAbs(calib.zFull.toString());
    setAlarmEnabled(true);
    setAlarmFired(false);
    setAlarmArmed(true);
  };

  const handleSavePatient = (patientInfo) => {
    if (!sessionId) {
      toast('Iniciá una sesión antes de guardar datos del paciente', 'info');
      return;
    }
    cloud.enqueue({
      label: 'patient',
      run: (client) => client.from('sessions').update({
        patient_name:       patientInfo.nombre || null,
        patient_age:        parseInt(patientInfo.edad) || null,
        patient_gender:     patientInfo.sexo || null,
        patient_weight:     parseFloat(patientInfo.peso) || null,
        patient_height:     parseFloat(patientInfo.altura) || null,
        patient_iliac_circ: parseFloat(patientInfo.circ) || null,
        menstruation_info:  patientInfo.menstruacion || null,
        final_impedance:    currentValue,
        elapsed_time_str:   elapsedTime,
        total_events:       eventCount,
      }).eq('id', sessionId).throwOnError(),
    });
  };

  const thresholdPreview = (() => {
    if (initialValue === null) return 0;
    if (alarmType === 'abs')     return parseFloat(alarmAbs) || 0;
    if (alarmType === 'percent') return initialValue * ((parseFloat(alarmPercent) || 0) / 100);
    if (alarmType === 'diff')    return initialValue - (parseFloat(alarmDiff) || 0);
    return 0;
  })();

  const hasAnyData = data.length > 0;
  const primaryButtonLabel = measuring ? 'Pausar' : (startTime ? 'Reanudar' : 'Iniciar adquisición');

  return (
    <div className="app-shell">
      <AlarmBanner
        active={alarmFired}
        message="Umbral preventivo alcanzado · la vejiga está próxima a su capacidad calibrada"
        hint="Sugiera al paciente que orine. La alarma seguirá activa hasta que se reconozca."
        onAcknowledge={() => setAlarmFired(false)}
      />

      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">Chidori</span>
          <span className="brand-tag">
            {isAdmin ? 'Modo medición · sesión administrativa' : 'Bioimpedancia vesical · v2'}
          </span>
        </div>

        <div className="app-actions">
          {isAdmin && onSwitchToAdmin && (
            <button
              type="button"
              className="button button-sm"
              onClick={onSwitchToAdmin}
              title="Volver al panel de administración"
            >
              <Shield size={14} />
              Panel admin
            </button>
          )}

          <span className={`pill ${
            isSimulator ? 'pill-syncing'
            : wsStatus === 'CONNECTED' ? 'pill-live'
            : wsStatus === 'CONNECTING' ? 'pill-syncing'
            : 'pill-alarm'
          }`}>
            <span className="pill-dot" />
            {isSimulator ? 'Simulador'
              : wsStatus === 'CONNECTED' ? (measuring ? 'Grabando' : 'En línea')
              : wsStatus === 'CONNECTING' ? 'Reintentando'
              : 'Sin enlace'}
          </span>

          <CloudSyncBadge
            state={cloud.state}
            lastSyncAt={cloud.lastSyncAt}
            queueSize={cloud.queueSize}
            onRetry={cloud.retry}
          />

          <span className="pill pill-off" title={`Sesión iniciada como ${displayName}`}>
            <span className="pill-dot" />
            {displayName}
          </span>

          <button type="button" className="icon-button" onClick={toggleSimulator} title="Alternar simulador">
            <Cpu size={15} />
          </button>

          <button type="button" className="icon-button" onClick={() => setIsSettingsOpen(true)} title="Configuración">
            <SettingsIcon size={15} />
          </button>

          <button
            type="button"
            className="icon-button"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title="Cambiar tema"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          <button type="button" className="icon-button" onClick={onSignOut} title="Cerrar sesión">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      <main className="app-main">
        <ConnectionGate
          wsStatus={wsStatus}
          isSimulator={isSimulator}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onReconnect={connectWebSocket}
        />

        <section className="surface" style={{ padding: '16px 22px' }}>
          <div className="row-between" style={{ gap: 16, flexWrap: 'wrap' }}>
            <div>
              <span className="section-label">Control</span>
              <h3 style={{ fontSize: 'var(--t-lg)', marginTop: 2 }}>Adquisición de bioimpedancia</h3>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <button
                type="button"
                className={`button button-lg ${measuring ? '' : 'button-primary'}`}
                onClick={toggleMeasuring}
              >
                {measuring ? <Pause size={16} /> : <Play size={16} />}
                {primaryButtonLabel}
              </button>
              <button type="button" className="button" onClick={handleMarkEvent} disabled={!measuring} title="Marcar evento (E)">
                <Bookmark size={15} />
                Marcar
              </button>
              <button type="button" className="button button-ghost" onClick={() => setConfirmReset(true)} disabled={!startTime && data.length === 0}>
                <RotateCcw size={14} />
                Reiniciar
              </button>
              <button type="button" className="button button-ghost" onClick={() => setIsExportOpen(true)}>
                <Download size={14} />
                Exportar
              </button>
            </div>
          </div>
        </section>

        {!hasAnyData && !measuring ? (
          <EmptyState
            wsStatus={wsStatus}
            isSimulator={isSimulator}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onToggleSimulator={toggleSimulator}
          />
        ) : (
          <>
            <StatsGrid
              initialValue={initialValue}
              currentValue={currentValue}
              elapsedTime={elapsedTime}
              eventCount={eventCount}
              rate={rate}
            />

            <RealTimeCharts data={data} rateData={rateData} events={events} theme={theme} />

            <div className="split">
              <BladderVisual
                initialValue={initialValue}
                currentValue={currentValue}
                alarmThreshold={thresholdPreview}
              />
              <div className="stack-md">
                <Timeline events={events} />
                <CalibrationWizard
                  currentValue={currentValue}
                  onSaveCalibration={handleSaveCalibration}
                  onShowAlert={toast}
                />
              </div>
            </div>

            <section className="surface surface-pad">
              <header className="section-head" style={{ marginBottom: 18 }}>
                <div>
                  <h2>Umbral de alarma</h2>
                  <span className="section-label" style={{ display: 'block', marginTop: 4 }}>
                    Condición que dispara el aviso preventivo durante la sesión
                  </span>
                </div>
                <label className="switch" title="Activar / desactivar alarma">
                  <input type="checkbox" checked={alarmEnabled} onChange={(e) => setAlarmEnabled(e.target.checked)} />
                  <span className="switch-track" />
                </label>
              </header>

              <div className="stack-md">
                <div className="segment" role="radiogroup" aria-label="Tipo de umbral">
                  {[
                    { v: 'abs',     label: 'Valor absoluto' },
                    { v: 'percent', label: '% del basal' },
                    { v: 'diff',    label: 'Δ respecto al basal' },
                  ].map(({ v, label }) => (
                    <button
                      key={v}
                      type="button"
                      className={`segment-item ${alarmType === v ? 'active' : ''}`}
                      onClick={() => setAlarmType(v)}
                      disabled={!alarmEnabled}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {alarmType === 'abs' && (
                  <div className="field">
                    <label className="field-label" htmlFor="th-abs">Impedancia mínima permitida</label>
                    <input id="th-abs" className="input" type="number" placeholder="120.5"
                      value={alarmAbs} onChange={(e) => setAlarmAbs(e.target.value)} disabled={!alarmEnabled} />
                    <span className="field-hint">La alarma dispara cuando Z desciende por debajo de este valor en ohmios.</span>
                  </div>
                )}

                {alarmType === 'percent' && (
                  <div className="field">
                    <label className="field-label" htmlFor="th-pct">% del valor basal</label>
                    <input id="th-pct" className="input" type="number" min="0" max="100" placeholder="85"
                      value={alarmPercent} onChange={(e) => setAlarmPercent(e.target.value)} disabled={!alarmEnabled} />
                    <span className="field-hint">
                      La alarma dispara cuando Z desciende a este porcentaje del valor basal
                      registrado al iniciar la sesión.
                    </span>
                  </div>
                )}

                {alarmType === 'diff' && (
                  <div className="field">
                    <label className="field-label" htmlFor="th-diff">Caída en ohmios</label>
                    <input id="th-diff" className="input" type="number" placeholder="35"
                      value={alarmDiff} onChange={(e) => setAlarmDiff(e.target.value)} disabled={!alarmEnabled} />
                    <span className="field-hint">La alarma dispara cuando Z desciende esta cantidad respecto al basal.</span>
                  </div>
                )}

                {alarmEnabled && initialValue !== null && (
                  <div className="step-summary" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                    <span>Basal</span>
                    <span>Umbral calculado</span>
                    <span>Margen restante</span>
                    <strong className="numeric">{initialValue.toFixed(2)} Ω</strong>
                    <strong className="numeric">{thresholdPreview.toFixed(2)} Ω</strong>
                    <strong className="numeric">
                      {currentValue != null ? `${(currentValue - thresholdPreview).toFixed(2)} Ω` : '—'}
                    </strong>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="app-footer">
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          <span><span className="kbd">Espacio</span> Iniciar / Pausar</span>
          <span><span className="kbd">E</span> Marcar evento</span>
        </div>
        <span>Chidori · Sesión de {displayName}</span>
      </footer>

      <Toasts items={toasts} />

      <SettingsPanel
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        wsConfig={wsConfig}
        onSaveConfig={handleSaveConfig}
        wsStatus={wsStatus}
        onReconnect={connectWebSocket}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        data={data}
        rateData={rateData}
        events={events}
        initialValue={initialValue}
        currentValue={currentValue}
        elapsedTime={elapsedTime}
        eventCount={eventCount}
        onShowAlert={toast}
        onSavePatient={handleSavePatient}
      />

      <ConfirmModal
        open={confirmReset}
        title="Reiniciar la sesión"
        body={
          <>
            <p style={{ marginBottom: 10 }}>
              Esta acción borra los datos en memoria y cierra la sesión actual. Los datos
              ya enviados a la nube quedan archivados allí.
            </p>
            <p>Mantenga presionado el botón para confirmar.</p>
          </>
        }
        actionLabel="Mantener para reiniciar"
        onCancel={() => setConfirmReset(false)}
        onConfirm={handleReset}
        holdMs={1500}
      />
    </div>
  );
}
