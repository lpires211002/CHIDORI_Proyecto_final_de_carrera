import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Pause, Bookmark, RotateCcw, Download, Moon, Sun,
  Settings as SettingsIcon, Cpu, LogOut, Shield, Menu,
} from 'lucide-react';

import SettingsPanel     from './components/SettingsPanel';
import MobileMenu, { MobileMenuItem, MobileMenuSection } from './components/MobileMenu';
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

  /* ── Cloud sync (Supabase) ────────────────────────────────────────────
   * NUEVO MODELO · "commit explícito":
   *   - Nada se guarda en Supabase mientras la sesión está activa.
   *   - Todas las mediciones y eventos viven en memoria local.
   *   - Cuando el clínico hace click en "Guardar paciente" o exporta con
   *     el switch "Guardar en BBDD" en ON, recién ahí se hace un único
   *     batch commit (sesión + measurements + events + datos del paciente).
   *   - persistedSessionId queda asignado tras el commit exitoso. Si se
   *     vuelve a "Guardar paciente" después, solo se hace UPDATE sobre esa
   *     sesión (no se duplican mediciones).
   * Esto evita guardar mediciones erróneas o sesiones de prueba.
   * ─────────────────────────────────────────────────────────────────── */
  const [persistedSessionId, setPersistedSessionId] = useState(null);
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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [confirmReset, setConfirmReset]     = useState(false);
  const [toasts, setToasts]                 = useState([]);

  /* ── Refs ──────────────────────────────────────────────────────────── */
  const stateRef = useRef({});
  useEffect(() => {
    stateRef.current = {
      measuring, startTime, pausedDuration, data, initialValue, currentValue,
      alarmEnabled, alarmType, alarmAbs, alarmPercent, alarmDiff, alarmFired, alarmArmed,
      persistedSessionId, eventCount, cloud,
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
  /**
   * Warmup window · descartar el primer dato no es suficiente porque puede
   * llegar uno bajo seguido de uno alto. Tomamos la MEDIANA de las primeras
   * BASELINE_WINDOW lecturas para que outliers no contaminen la referencia.
   * Esto es defensa secundaria: el firmware ya hace su propio warmup gate.
   */
  const BASELINE_WINDOW = 5;
  const baselineSamplesRef = useRef([]);

  const handleIncomingData = (val) => {
    const cur = stateRef.current;
    if (!cur.measuring) return;

    let baseline = cur.initialValue;
    if (baseline === null) {
      baselineSamplesRef.current.push(val);
      if (baselineSamplesRef.current.length >= BASELINE_WINDOW) {
        // Mediana de las primeras N: robusto contra outliers
        const sorted = [...baselineSamplesRef.current].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        baseline = median;
        setInitialValue(median);
      } else {
        // Aún no tenemos suficiente · ignoramos esta lectura para gráficos también
        return;
      }
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

    // NOTA · ya no insertamos en Supabase aquí. Todo queda en memoria
    // hasta que el clínico confirme el guardado desde el ExportModal.

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

      // NO se crea sesión en la nube acá. La creación es explícita y
      // sucede solo cuando el clínico confirma desde el ExportModal.

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
    // El evento se persiste recién en el batch commit del ExportModal.
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
    baselineSamplesRef.current = [];
    setCurrentValue(null);
    setRate(0);
    setEventCount(0);
    setAlarmFired(false);
    setAlarmArmed(true);
    setPersistedSessionId(null);
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

  /**
   * Commit explícito · crea la sesión + inserta TODAS las mediciones y eventos
   * acumulados en memoria, además de los datos del paciente. Idempotente:
   * si ya hay una persistedSessionId, hace UPDATE de la sesión sin reinsertar
   * mediciones (eso queda como snapshot del momento del primer guardado).
   */
  const handleSavePatient = async (patientInfo) => {
    if (data.length === 0) {
      toast('No hay mediciones para guardar', 'warn');
      throw new Error('no measurements');
    }

    const patientPayload = {
      patient_name:       patientInfo.nombre || null,
      patient_age:        patientInfo.edad === '' || patientInfo.edad == null ? null : parseInt(patientInfo.edad),
      patient_gender:     patientInfo.sexo || null,
      patient_weight:     patientInfo.peso === '' || patientInfo.peso == null ? null : parseFloat(patientInfo.peso),
      patient_height:     patientInfo.altura === '' || patientInfo.altura == null ? null : parseFloat(patientInfo.altura),
      patient_iliac_circ: patientInfo.circ === '' || patientInfo.circ == null ? null : parseFloat(patientInfo.circ),
      menstruation_info:  patientInfo.menstruacion || null,
    };

    // Sesión ya commiteada: solo update del paciente + stats finales
    if (persistedSessionId) {
      cloud.enqueue({
        label: 'patient-update',
        run: (client) => client.from('sessions').update({
          ...patientPayload,
          final_impedance: currentValue,
          elapsed_time_str: elapsedTime,
          total_events: eventCount,
        }).eq('id', persistedSessionId).throwOnError(),
      });
      return;
    }

    // Primera vez: full batch commit
    try {
      // 1 · Crear la sesión
      const { data: newSession, error: sErr } = await supabase
        .from('sessions')
        .insert({
          user_id:           userId,
          ...patientPayload,
          initial_impedance: initialValue,
          final_impedance:   currentValue,
          elapsed_time_str:  elapsedTime,
          total_events:      eventCount,
        })
        .select()
        .single();
      if (sErr) throw sErr;

      const sId = newSession.id;

      // 2 · Insertar mediciones en chunks (Postgres tiene límites por payload)
      const measRows = data.map((p, i) => ({
        session_id:   sId,
        elapsed_time: p.x,
        impedance:    p.y,
        rate:         rateData[i]?.y ?? 0,
      }));
      const CHUNK = 500;
      for (let i = 0; i < measRows.length; i += CHUNK) {
        const slice = measRows.slice(i, i + CHUNK);
        const { error: mErr } = await supabase.from('measurements').insert(slice);
        if (mErr) throw mErr;
      }

      // 3 · Insertar eventos (suelen ser pocos, en una sola query)
      if (events.length > 0) {
        const evRows = events.map((e) => ({
          session_id:        sId,
          event_number:      e.id,
          elapsed_time:      e.time,
          impedance:         e.value,
          impedance_change:  e.change,
        }));
        const { error: eErr } = await supabase.from('session_events').insert(evRows);
        if (eErr) throw eErr;
      }

      setPersistedSessionId(sId);
      toast(
        `Sesión guardada en la nube · ${measRows.length} mediciones, ${events.length} eventos`,
        'success'
      );
    } catch (err) {
      console.error('[batch commit]', err);
      toast('No se pudo guardar la sesión en la nube. Reintentá o exportá solo local.', 'warn');
      throw err;
    }
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

  // Estado mostrado en el CloudSyncBadge. Se sobreescribe a 'pending'
  // cuando hay mediciones en memoria sin commitear todavía.
  const cloudDisplayState = useMemo(() => {
    if (cloud.state === 'busy' || cloud.state === 'warn') return cloud.state;
    if (cloud.state === 'off') return 'off';
    if (data.length > 0 && !persistedSessionId) return 'pending';
    return cloud.state;
  }, [cloud.state, data.length, persistedSessionId]);

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

          <span className={`pill keep-mobile ${
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
            state={cloudDisplayState}
            lastSyncAt={cloud.lastSyncAt}
            queueSize={cloud.queueSize}
            pendingCount={data.length}
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

          {/* Hamburguesa · solo visible en mobile (CSS controla) */}
          <button
            type="button"
            className="mobile-toggle"
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu size={18} />
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
              zHistory={data}
              rateHistory={rateData}
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

      {/* Mobile menu · render condicional, CSS lo muestra solo en <720px */}
      <MobileMenu
        open={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        header={
          <div>
            <span className="brand-mark">Chidori</span>
            <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--type-mute)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {displayName}
            </div>
          </div>
        }
      >
        <MobileMenuSection>Sesión</MobileMenuSection>
        {isAdmin && onSwitchToAdmin && (
          <MobileMenuItem
            icon={Shield}
            label="Panel de administración"
            hint="Volver a la vista admin"
            onClick={() => { setIsMobileMenuOpen(false); onSwitchToAdmin(); }}
          />
        )}
        <MobileMenuItem
          icon={Cpu}
          label={isSimulator ? 'Desactivar simulador' : 'Activar simulador'}
          hint="Curva fisiológica sintética"
          onClick={() => { setIsMobileMenuOpen(false); toggleSimulator(); }}
        />

        <MobileMenuSection>Aplicación</MobileMenuSection>
        <MobileMenuItem
          icon={SettingsIcon}
          label="Configuración"
          hint="Microcontrolador y red"
          onClick={() => { setIsMobileMenuOpen(false); setIsSettingsOpen(true); }}
        />
        <MobileMenuItem
          icon={theme === 'dark' ? Sun : Moon}
          label={`Tema ${theme === 'dark' ? 'claro' : 'oscuro'}`}
          hint={theme === 'dark' ? 'Más legible con luz ambiente' : 'Más cómodo en quirófano'}
          onClick={() => { setIsMobileMenuOpen(false); setTheme((t) => (t === 'dark' ? 'light' : 'dark')); }}
        />

        <MobileMenuSection>Cuenta</MobileMenuSection>
        <MobileMenuItem
          icon={LogOut}
          label="Cerrar sesión"
          danger
          onClick={() => { setIsMobileMenuOpen(false); onSignOut(); }}
        />
      </MobileMenu>

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
