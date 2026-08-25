import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Pause, Bookmark, RotateCcw, Download, Moon, Sun,
  Settings as SettingsIcon, Cpu, LogOut, Shield, Menu,
  ZapOff, GlassWater, Toilet,
} from 'lucide-react';

import SettingsPanel     from './components/SettingsPanel';
import MobileMenu, { MobileMenuItem, MobileMenuSection } from './components/MobileMenu';
import HeaderMenu        from './components/HeaderMenu';
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
import SpotlightArea     from './components/SpotlightArea';
import LineTabs          from './components/LineTabs';
import PatientGate       from './components/PatientGate';
import ConnectionGate    from './components/ConnectionGate';
import useCloudSync      from './components/useCloudSync';
import usePendingSync    from './components/usePendingSync';

import { supabase, emailToUsername } from './supabaseClient';
import { commitSession, queuePendingSession } from './lib/sessionSync';
import { countSessions } from './lib/patients';

/* ─────────────────────────────────────────────────────────────────────
 * CONGRUENCIA CON EL FIRMWARE · Chidori_ESP32C3_WiFiManager
 *
 * Protocolo real del firmware (verificado contra el .ino):
 *   · TX numérico  · cadena "%.5f" (Z en Ω) cada ~250 ms (4 Hz), solo
 *     tras un warmup de 5 muestras y con al menos un cliente WS.
 *   · TX texto     · "PONG" (respuesta a PING) y
 *                    "STATUS estado=<MIDIENDO|INACTIVO> rssi=<int> heap=<uint> Z=<float>"
 *   · RX comandos  · START (ignorado si ya MIDIENDO), STOP, RESET, PING, STATUS
 *   · El BOTÓN FÍSICO (GPIO20) también arranca/para → el dispositivo puede
 *     cambiar de estado sin que la UI lo ordene. Por eso reconciliamos vía
 *     STATUS en cada conexión + polling.
 *
 * La Z ya viene fuertemente filtrada en el firmware (promedio de 128
 * muestras ADC + media móvil de 10). Acá agregamos una segunda línea de
 * defensa: límites de plausibilidad + rechazo de spikes con histéresis,
 * para que un glitch eléctrico o un frame corrupto no contamine la curva,
 * el basal ni la alarma.
 * ───────────────────────────────────────────────────────────────────── */
const BASELINE_WINDOW   = 5;       // mediana de las primeras N como basal
const Z_PLAUSIBLE_MIN   = 1;       // Ω · por debajo = desconexión/glitch
const Z_PLAUSIBLE_MAX   = 100000;  // Ω · por encima = saturación/ruido
const SPIKE_REL         = 0.30;    // salto >30% en un tick = sospechoso
const SPIKE_MIN_ABS     = 15;      // …pero tolerá al menos 15 Ω de cambio
const MAX_CONSEC_REJECT = 3;       // tras N rechazos seguidos, aceptá (resync)
const STATUS_POLL_MS    = 5000;    // consulta de estado/diagnóstico al firmware
const USER_ACTION_GRACE = 2000;    // ventana anti-race tras una acción del usuario

/* Señal congelada · el firmware transmite cada ~250 ms; si midiendo pasan
 * más de STALE_AFTER_MS sin datos con el socket abierto, el último valor en
 * pantalla ya no es confiable y hay que decirlo. */
const STALE_AFTER_MS    = 3000;
/* Microcortes · el firmware transmite cada 250 ms (4 Hz). Un hueco mayor a
 * esto implica muestras perdidas aunque el WebSocket nunca se haya cerrado
 * (típico de interferencia WiFi). Se registra como evento para que el vacío
 * en la curva quede documentado. */
const GAP_THRESHOLD_MS  = 1500;

/* Respaldo de sesión · snapshot periódico a localStorage para que un F5 o
 * un crash del navegador no pierdan una medición larga. */
const SESSION_BACKUP_KEY    = 'chidori-session-backup';
const BACKUP_INTERVAL_MS    = 30000;
const BACKUP_MAX_AGE_MS     = 24 * 3600 * 1000;

/**
 * Dashboard · vista principal del clínico autenticado.
 * El gate de auth está en App.jsx; acá ya sabemos que hay session y profile.
 *
 * ARQUITECTURA (rediseño v3):
 *   header     · mínimo · marca + estado + usuario + menú ⋯ (acciones 2as)
 *   command    · barra sticky · control primario + cronómetro + acciones
 *   monitor    · grid · [readout + señal en vivo] | [vejiga hero + alarma]
 *   setup      · tabs · Configuración (calibración + alarma) / Eventos
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
    return saved ? JSON.parse(saved) : { protocol: 'ws://', host: '192.168.4.1', port: '81' };
  });
  const [wsStatus, setWsStatus] = useState('DISCONNECTED');
  // Diagnóstico reportado por el firmware vía STATUS (estado real del equipo,
  // RSSI del enlace, heap libre). null = todavía no informado.
  const [device, setDevice] = useState({ state: null, rssi: null, heap: null, at: null });
  const socketRef = useRef(null);
  const reconnectIntervalRef = useRef(null);
  const statusPollRef        = useRef(null);   // intervalo de consulta STATUS
  const lastUserActionRef    = useRef(0);      // timestamp última acción del clínico
  const lastAcceptedZRef     = useRef(null);   // último Z aceptado (guard de spikes)
  const consecRejectRef      = useRef(0);      // rechazos consecutivos del guard
  const lastDataAtRef        = useRef(null);   // timestamp del último dato (staleness)

  /* Buffers espejo de data/rateData. Fuente de verdad síncrona para el
   * data handler: permite calcular la tasa SIN side effects dentro de los
   * updaters de setState (que deben ser puros — StrictMode los invoca 2x). */
  const dataBufRef = useRef([]);
  const rateBufRef = useRef([]);

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
  /* Corte simulado · hasta este timestamp el simulador no emite muestras.
   * Sirve para probar la detección de microcortes sin desenchufar el equipo. */
  const simGapUntilRef = useRef(0);
  const SIM_GAP_SAMPLES = 6;          // el simulador emite 1 muestra/segundo
  // Factor V/Ω del simulador · aproxima I_iny x G_receptor del circuito real
  const SIM_V_PER_OHM = 0.0576;

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
  // Tension de lectura (Vpp del detector) reportada por el firmware · referencia
  const [voltage, setVoltage]           = useState(null);
  const [voltageData, setVoltageData]   = useState([]);   // serie graficable
  // true si el firmware manda la continua cruda de A0 (3er campo). Cambia el
  // rótulo: no es lo mismo un valor medido que uno reconstruido.
  const [voltageIsRaw, setVoltageIsRaw] = useState(false);
  /* Captura de volumen para eventos del protocolo (ingesta / micción). */
  const [volumeModal, setVolumeModal]   = useState(null);  // 'water' | 'void' | null
  const [volumeInput, setVolumeInput]   = useState('');
  /* Protocolo · la sesión se ata a un paciente ANTES de medir. */
  const [activePatient, setActivePatient] = useState(null);
  const [sessionData, setSessionData]     = useState({});
  const [gateOpen, setGateOpen]           = useState(false);
  // Sesiones ya registradas del paciente · para anunciar "sesión N" antes de
  // empezar. El protocolo son 4-6 por persona, así que saber en cuál se está
  // parado importa.
  const [patientSessionCount, setPatientSessionCount] = useState(0);
  /* Sesión "armada": ya se entró al panel de medición al menos una vez.
   * Se mantiene aunque no haya datos, para que Reiniciar deje el cronómetro en
   * cero SIN devolverte a la pantalla de preparación (y obligarte a rehacer
   * enlace y paciente). Solo la marca del header lo desarma. */
  const [armado, setArmado] = useState(false);
  const voltageBufRef = useRef([]);
  const lastVoltageRef = useRef(null);
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
  // Volver a inicio desde la marca · misma operación que reiniciar, pero se
  // confirma aparte para poder explicar por qué se pregunta.
  const [confirmHome, setConfirmHome]       = useState(false);
  const [setupTab, setSetupTab]             = useState('config'); // 'config' | 'events'
  const [toasts, setToasts]                 = useState([]);
  const [signalStale, setSignalStale]       = useState(false);
  // Respaldo recuperable · lazy init desde localStorage (evita setState en effect)
  const [recovery, setRecovery]             = useState(() => {
    try {
      const raw = localStorage.getItem(SESSION_BACKUP_KEY);
      if (!raw) return null;
      const b = JSON.parse(raw);
      const valid = b && b.v === 1 && Array.isArray(b.data) && b.data.length > 0
        && Date.now() - (b.savedAt || 0) < BACKUP_MAX_AGE_MS;
      if (!valid) { localStorage.removeItem(SESSION_BACKUP_KEY); return null; }
      return b;
    } catch { return null; }
  });

  /* ── Refs ──────────────────────────────────────────────────────────── */
  const stateRef = useRef({});
  useEffect(() => {
    stateRef.current = {
      measuring, startTime, pausedDuration, pauseStart, data, initialValue, currentValue,
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
    // Si el socket ya está abierto, no interrumpir la conexión existente.
    // Esto evita que callbacks encolados del reconnect interval cierren
    // un socket que acaba de conectarse exitosamente.
    if (socketRef.current?.readyState === WebSocket.OPEN) return;
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
        // Consultar el estado real del equipo al instante y luego en intervalos.
        // Esto reconcilia el botón físico y trae RSSI/heap para diagnóstico.
        try { ws.send('STATUS'); } catch { /* socket cerrándose */ }
        if (statusPollRef.current) clearInterval(statusPollRef.current);
        statusPollRef.current = setInterval(() => {
          const sock = socketRef.current;
          if (sock && sock.readyState === WebSocket.OPEN) {
            try { sock.send('STATUS'); } catch { /* noop */ }
          }
        }, STATUS_POLL_MS);
      };
      ws.onclose = () => {
        setWsStatus('DISCONNECTED');
        setDevice((d) => ({ ...d, state: null }));   // estado del equipo desconocido
        if (statusPollRef.current) {
          clearInterval(statusPollRef.current);
          statusPollRef.current = null;
        }
        if (!reconnectIntervalRef.current && !isSimulator) {
          reconnectIntervalRef.current = setInterval(() => connectWebSocket(), 5000);
        }
      };
      ws.onerror = () => setWsStatus('DISCONNECTED');
      ws.onmessage = (event) => handleSocketMessage(event.data);
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
      if (statusPollRef.current) clearInterval(statusPollRef.current);
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

  /* ── Watchdog de señal congelada ──────────────────────────────────────
   * El firmware transmite ~4 Hz. Si estamos midiendo con enlace activo y
   * pasan STALE_AFTER_MS sin datos, el último valor en pantalla ya no es
   * actual (el firmware pausa la TX si su WiFi cae, pero sigue midiendo).
   * Marcamos el readout como obsoleto y avisamos UNA vez por episodio. */
  useEffect(() => {
    if (!measuring || isSimulator || wsStatus !== 'CONNECTED') {
      setSignalStale(false);
      return;
    }
    const iv = setInterval(() => {
      const last = lastDataAtRef.current;
      const stale = last != null && Date.now() - last > STALE_AFTER_MS;
      setSignalStale((prev) => {
        if (stale && !prev) toast('Señal interrumpida · sin datos del dispositivo', 'warn');
        if (!stale && prev) toast('Señal restablecida', 'success');
        return stale;
      });
    }, 1000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuring, isSimulator, wsStatus]);

  /* ── Respaldo de sesión (anti-F5) ─────────────────────────────────────
   * Snapshot compacto a localStorage cada BACKUP_INTERVAL_MS mientras se
   * mide. Coordenadas redondeadas a 3 decimales en arrays de pares para
   * mantener una sesión de horas dentro del límite de ~5 MB. */
  const writeBackup = useCallback(() => {
    const cur = stateRef.current;
    if (dataBufRef.current.length === 0) return;
    try {
      const r3 = (n) => Math.round(n * 1000) / 1000;
      const payload = {
        v: 1,
        savedAt: Date.now(),
        startTime: cur.startTime,
        pausedDuration: cur.pausedDuration,
        initialValue: cur.initialValue,
        eventCount: cur.eventCount,
        data: dataBufRef.current.map((p) => [r3(p.x), r3(p.y)]),
        rate: rateBufRef.current.map((p) => [r3(p.x), r3(p.y)]),
        events: (events || []).map((e) => [e.id, r3(e.time), r3(e.value), e.change == null ? null : r3(e.change), e.kind || 'mark', e.amount ?? null]),
      };
      localStorage.setItem(SESSION_BACKUP_KEY, JSON.stringify(payload));
    } catch (err) {
      // Cuota llena u otro error · el backup es best-effort, no frena la medición
      console.warn('[backup]', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  useEffect(() => {
    if (!measuring) return;
    const iv = setInterval(writeBackup, BACKUP_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [measuring, writeBackup]);

  const restoreFromBackup = () => {
    const b = recovery;
    if (!b) return;
    const dataPts = b.data.map(([x, y]) => ({ x, y }));
    const ratePts = (b.rate || []).map(([x, y]) => ({ x, y }));
    dataBufRef.current = dataPts;
    rateBufRef.current = ratePts;
    setData(dataPts.slice());
    setRateData(ratePts.slice());
    setEvents((b.events || []).map(([id, time, value, change, kind, amount]) => ({ id, time, value, change, kind: kind || 'mark', amount: amount ?? null })));
    setEventCount(b.eventCount || 0);
    setInitialValue(b.initialValue ?? null);
    const last = dataPts[dataPts.length - 1];
    setCurrentValue(last ? last.y : null);
    lastAcceptedZRef.current = last ? last.y : null;
    // La sesión restaurada queda PAUSADA en el tiempo del último punto:
    // startTime sintético para que el cronómetro retome coherente al reanudar.
    const lastX = last ? last.x : 0;
    setStartTime(Date.now() - lastX * 1000);
    setPausedDur(0);
    setPauseStart(Date.now());
    setMeasuring(false);
    const m = Math.floor(lastX / 60);
    const s = Math.floor(lastX % 60);
    setElapsedTime(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    setRecovery(null);
    toast(`Sesión recuperada · ${dataPts.length} puntos. Está en pausa: Reanudar para continuar.`, 'success');
  };

  const discardBackup = () => {
    try { localStorage.removeItem(SESSION_BACKUP_KEY); } catch { /* noop */ }
    setRecovery(null);
  };

  /* ── Data handler ──────────────────────────────────────────────────── */
  /**
   * Warmup window · descartar el primer dato no es suficiente porque puede
   * llegar uno bajo seguido de uno alto. Tomamos la MEDIANA de las primeras
   * BASELINE_WINDOW lecturas para que outliers no contaminen la referencia.
   * Esto es defensa secundaria: el firmware ya hace su propio warmup gate.
   */
  const baselineSamplesRef = useRef([]);

  /**
   * sanitizeZ · segunda línea de defensa sobre la lectura cruda.
   *   1. Descarta no-finitos (NaN, ±Infinity).
   *   2. Descarta fuera de rango plausible (desconexión, saturación).
   *   3. Rechaza spikes: un salto > max(SPIKE_MIN_ABS, |last|·SPIKE_REL)
   *      respecto al último valor aceptado se considera glitch. Con
   *      histéresis: tras MAX_CONSEC_REJECT rechazos seguidos asume que
   *      el cambio es real (p. ej. la vejiga se vació) y resincroniza.
   * Devuelve el valor limpio o null si hay que ignorarlo.
   */
  const sanitizeZ = (raw) => {
    const v = Number(raw);
    if (!Number.isFinite(v)) return null;
    if (v < Z_PLAUSIBLE_MIN || v > Z_PLAUSIBLE_MAX) return null;

    const last = lastAcceptedZRef.current;
    if (last != null) {
      const maxStep = Math.max(SPIKE_MIN_ABS, Math.abs(last) * SPIKE_REL);
      if (Math.abs(v - last) > maxStep && consecRejectRef.current < MAX_CONSEC_REJECT) {
        consecRejectRef.current += 1;
        return null;
      }
    }
    consecRejectRef.current = 0;
    lastAcceptedZRef.current = v;
    return v;
  };

  const handleIncomingData = (raw) => {
    const cur = stateRef.current;
    if (!cur.measuring) return;

    const val = sanitizeZ(raw);
    if (val === null) return;

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

    // ── Microcorte · hueco entre muestras consecutivas ────────────────────
    const nowTs = Date.now();
    const prevTs = lastDataAtRef.current;
    lastDataAtRef.current = nowTs;

    const elapsed = (nowTs - cur.startTime - cur.pausedDuration) / 1000;

    if (prevTs != null && nowTs - prevTs > GAP_THRESHOLD_MS) {
      const gapSec = (nowTs - prevTs) / 1000;
      const lost = Math.max(0, Math.round(gapSec * 4) - 1);   // ~4 Hz
      setEventCount((n) => {
        const next = n + 1;
        setEvents((prevEv) => [{
          id: next,
          time: elapsed,
          value: val,
          change: gapSec,        // duración del hueco, en segundos
          kind: 'gap',
        }, ...prevEv]);
        return next;
      });
      console.warn(`[microcorte] ${gapSec.toFixed(1)} s sin datos · ~${lost} muestras perdidas`);
    }

    // ── Buffers síncronos · la tasa se calcula acá, no dentro de un updater ──
    const buf = dataBufRef.current;
    buf.push({ x: elapsed, y: val });

    let computedRate = 0;
    if (buf.length >= 2) {
      const recent = buf.slice(-10);
      const a = recent[0];
      const b = recent[recent.length - 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      computedRate = dx > 0 ? (dy / dx) * 60 : 0;
    }
    rateBufRef.current.push({ x: elapsed, y: computedRate });
    // Serie de tensión · misma base temporal que Z (solo si el firmware la reporta)
    if (lastVoltageRef.current != null) {
      voltageBufRef.current.push({ x: elapsed, y: lastVoltageRef.current });
    }

    // Updaters puros: copia superficial para nueva identidad de referencia.
    setRate(computedRate);
    setData(buf.slice());
    setRateData(rateBufRef.current.slice());
    if (voltageBufRef.current.length) setVoltageData(voltageBufRef.current.slice());

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

  /* ── Router de mensajes WS ──────────────────────────────────────────
   * El firmware mezcla en el mismo socket datos numéricos (Z) y mensajes
   * de texto (STATUS, PONG). Clasificamos explícitamente en vez de confiar
   * en que parseFloat devuelva NaN para el texto. */
  /**
   * reconcileMeasuring · alinea el estado de la UI con el del firmware.
   * Cubre el caso del botón físico y el de refrescar la página a mitad de
   * una medición. Una ventana de gracia evita pisar una acción que el
   * clínico acaba de hacer (race entre el comando y el siguiente STATUS).
   */
  const reconcileMeasuring = (estado) => {
    if (isSimulator || !estado) return;
    if (Date.now() - lastUserActionRef.current < USER_ACTION_GRACE) return;
    const cur = stateRef.current;

    if (estado === 'MIDIENDO' && !cur.measuring) {
      // El equipo ya estaba midiendo (botón físico o refresh de la página).
      lastAcceptedZRef.current = null;
      consecRejectRef.current  = 0;
      baselineSamplesRef.current = [];
      lastDataAtRef.current = Date.now();
      if (!cur.startTime) setStartTime(Date.now());
      if (cur.pauseStart) { setPausedDur((d) => d + (Date.now() - cur.pauseStart)); setPauseStart(null); }
      setMeasuring(true);
      toast('Sincronizado · el dispositivo ya estaba midiendo', 'info');
    } else if (estado === 'INACTIVO' && cur.measuring) {
      // El equipo se detuvo por su cuenta (botón físico).
      setMeasuring(false);
      setPauseStart(Date.now());
      toast('El dispositivo detuvo la medición', 'warn');
    }
  };

  const applyDeviceStatus = (s) => {
    const field = (k) => {
      const m = s.match(new RegExp(`${k}=([^\\s]+)`));
      return m ? m[1] : null;
    };
    const estado = field('estado');
    const rssi   = field('rssi') != null ? parseInt(field('rssi'), 10) : null;
    const heap   = field('heap') != null ? parseInt(field('heap'), 10) : null;
    const volt   = field('v') != null ? parseFloat(field('v')) : null;
    if (Number.isFinite(volt)) setVoltage(volt);
    setDevice({
      state: estado,
      rssi:  Number.isFinite(rssi) ? rssi : null,
      heap:  Number.isFinite(heap) ? heap : null,
      at:    Date.now(),
    });
    reconcileMeasuring(estado);
  };

  const handleSocketMessage = (rawData) => {
    if (typeof rawData !== 'string') return;
    const s = rawData.trim();
    if (s === '' || s === 'PONG') return;          // liveness · sin efecto
    if (s.startsWith('STATUS')) { applyDeviceStatus(s); return; }
    // Formato del firmware, por versión:
    //   "<Z>"                  · viejo
    //   "<Z> <Vpp>"            · + tensión reconstruida
    //   "<Z> <Vpp> <Vadc>"     · + continua medida en A0
    //
    // Se muestra Vadc cuando viene, porque es el único de los tres que
    // corresponde a un nodo real: se puede contrastar con el tester en el pin.
    // La Vpp es una reconstrucción (×2 + caída del Schottky) y no es medible
    // en ningún punto del circuito.
    const parts = s.split(/\s+/);
    const v = Number(parts[0]);                     // estricto: "1.2.3" → NaN
    if (Number.isFinite(v)) {
      const vadc = parts.length > 2 ? Number(parts[2]) : NaN;
      const vpp  = parts.length > 1 ? Number(parts[1]) : NaN;
      const volt = Number.isFinite(vadc) ? vadc : vpp;
      if (Number.isFinite(volt)) {
        setVoltage(volt);
        lastVoltageRef.current = volt;
        setVoltageIsRaw(Number.isFinite(vadc));
      }
      handleIncomingData(v);
    }
    // cualquier otro texto desconocido se ignora (forward-compat)
  };

  /* ── Shortcuts ─────────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      // Un modal abierto se queda con el teclado
      if (volumeModal || gateOpen) return;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') { e.preventDefault(); toggleMeasuring(); }
      else if (k === 'e') { e.preventDefault(); handleMarkEvent(); }
      // Protocolo · A abre la carga de volumen, M registra micción directa
      else if (k === 'a') {
        e.preventDefault();
        if (measuring) { setVolumeInput(''); setVolumeModal('water'); }
      }
      else if (k === 'm') {
        e.preventDefault();
        if (measuring) addProtocolEvent('void', NaN);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuring, startTime, pausedDuration, data, initialValue, currentValue, eventCount, wsStatus, isSimulator, volumeModal, gateOpen]);

  /* Al iniciar o reanudar, la referencia de "última muestra" se reinicia:
   * el tiempo en pausa no es un microcorte. */
  useEffect(() => {
    if (measuring) lastDataAtRef.current = null;
  }, [measuring]);

  /* ── Simulator ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (isSimulator && measuring) {
      simulatedZRef.current = initialValue !== null ? initialValue : 150.0;
      simulatorIntervalRef.current = setInterval(() => {
        // Corte simulado en curso: el simulador "no transmite" y el hueco
        // queda registrado por la detección de microcortes al volver.
        if (Date.now() < simGapUntilRef.current) return;

        const noise = (Math.random() - 0.5) * 0.08;
        const fillStep = 0.12;
        const nextZ = simulatedZRef.current - fillStep + noise;
        simulatedZRef.current = nextZ;
        // Tensión sintética coherente con la Z (V = Z x I x G del circuito real),
        // para poder ver/probar la celda de tensión sin el hardware conectado.
        const simV = nextZ * SIM_V_PER_OHM;
        setVoltage(simV);
        lastVoltageRef.current = simV;
        handleIncomingData(nextZ);
      }, 1000);
    } else if (simulatorIntervalRef.current) {
      clearInterval(simulatorIntervalRef.current);
      simulatorIntervalRef.current = null;
    }
    return () => simulatorIntervalRef.current && clearInterval(simulatorIntervalRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSimulator, measuring]);

  /** Fuerza un hueco de SIM_GAP_SAMPLES muestras en el simulador. */
  const simulateMicroGap = () => {
    if (!isSimulator || !measuring) return;
    const ms = SIM_GAP_SAMPLES * 1000;          // 1 muestra/segundo
    simGapUntilRef.current = Date.now() + ms;
    toast(`Simulando corte de ${SIM_GAP_SAMPLES} muestras (${ms / 1000} s)…`, 'info');
  };

  // Cuántas sesiones lleva el paciente elegido · falla en silencio porque es
  // informativo: sin internet igual se puede medir.
  useEffect(() => {
    if (!activePatient?.id) { setPatientSessionCount(0); return; }
    let vivo = true;
    countSessions(supabase, activePatient.id)
      .then((n) => { if (vivo) setPatientSessionCount(n); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [activePatient?.id]);

  /** Antes de la primera muestra hay que tener paciente asociado. */
  const requirePatient = () => {
    // También en simulador: sirve para ensayar el protocolo completo antes
    // de medir con una persona real.
    if (activePatient) return true;
    setGateOpen(true);
    return false;
  };

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
  // Envío seguro de comando WS · evita throw si el socket no está abierto.
  const sendCommand = (cmd) => {
    const sock = socketRef.current;
    if (!isSimulator && sock && sock.readyState === WebSocket.OPEN) {
      try { sock.send(cmd); return true; } catch { /* noop */ }
    }
    return false;
  };

  const toggleMeasuring = async () => {
    if (wsStatus !== 'CONNECTED' && !isSimulator) {
      toast('Sin conexión. Active el simulador o configure el dispositivo.', 'warn');
      return;
    }

    // Protocolo · una sesión NUEVA exige paciente asociado (salvo simulador).
    if (!measuring && !startTime && !requirePatient()) return;

    // Marca la acción para que el reconciliador no la pise con un STATUS en vuelo.
    lastUserActionRef.current = Date.now();
    setArmado(true);          // a partir de acá Reiniciar no devuelve al inicio

    if (!measuring) {
      let sTime = startTime;
      let pDur = pausedDuration;
      if (!sTime) {
        // Sesión nueva: reseteamos el guard de spikes para que el primer
        // valor fije la referencia sin falsos rechazos.
        sTime = Date.now();
        setStartTime(sTime);
        lastAcceptedZRef.current = null;
        consecRejectRef.current  = 0;
        baselineSamplesRef.current = [];
        dataBufRef.current = [];
        rateBufRef.current = [];
      }
      lastDataAtRef.current = Date.now();   // el watchdog cuenta desde el start
      if (pauseStart) { pDur += Date.now() - pauseStart; setPausedDur(pDur); setPauseStart(null); }

      // NO se crea sesión en la nube acá. La creación es explícita y
      // sucede solo cuando el clínico confirma desde el ExportModal.

      sendCommand('START');
      setMeasuring(true);

      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } else {
      sendCommand('STOP');
      setMeasuring(false);
      setPauseStart(Date.now());
      writeBackup();   // snapshot fresco al pausar (el intervalo se corta acá)
    }
  };

  /* ── Basal manual ────────────────────────────────────────────────────
   * Permite fijar la referencia cuando el paciente YA está acomodado, en vez
   * de depender de la calibración automática de las primeras muestras.
   */
  const BASELINE_MANUAL_WINDOW = 8;

  /** Valor que aplicaría "Re-fijar": la MISMA mediana que usa handleSetBaselineNow.
   *  Se expone para que el botón muestre exactamente lo que va a fijar (antes
   *  mostraba la lectura instantánea y aplicaba otra cosa). */
  const baselineCandidate = useMemo(() => {
    const buf = dataBufRef.current;
    if (!buf || buf.length === 0) return null;
    const last   = buf.slice(-BASELINE_MANUAL_WINDOW).map((p) => p.y);
    const sorted = [...last].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentValue]);

  const handleSetBaselineNow = () => {
    const buf = dataBufRef.current;
    if (!buf || buf.length === 0) {
      toast('Todavía no hay lecturas para fijar el basal', 'warn');
      return;
    }
    // Mediana de las últimas muestras: evita que un pico puntual quede como referencia.
    const last   = buf.slice(-BASELINE_MANUAL_WINDOW).map((p) => p.y);
    const sorted = [...last].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    setInitialValue(median);
    toast(`Basal fijado en ${median.toFixed(2)} Ω (mediana de ${last.length} lecturas)`, 'success');
  };

  const handleSetBaselineManual = (raw) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v <= 0) {
      toast('Ingresá un valor de basal válido en Ω', 'warn');
      return false;
    }
    setInitialValue(v);
    toast(`Basal fijado en ${v.toFixed(2)} Ω`, 'success');
    return true;
  };

  /** Registra un evento del protocolo con volumen asociado (ml).
   *  kind: 'water' (ingesta) | 'void' (micción) */
  const addProtocolEvent = (kind, ml) => {
    if (!measuring || !startTime) return;
    const elapsed = (Date.now() - startTime - pausedDuration) / 1000;
    setEventCount((n) => {
      const next = n + 1;
      setEvents((prev) => [{
        id: next,
        time: elapsed,
        value: currentValue || 0,
        change: null,
        kind,
        amount: Number.isFinite(ml) ? ml : null,
      }, ...prev]);
      return next;
    });
    const etiqueta = kind === 'water' ? 'Ingesta' : 'Micción';
    toast(`${etiqueta} registrada${Number.isFinite(ml) ? ` · ${ml} ml` : ''}`, 'success');
  };

  const confirmVolume = () => {
    const ml = parseFloat(volumeInput);
    // En micción el volumen es opcional (a veces se mide después, con balanza)
    if (volumeModal === 'water' && (!Number.isFinite(ml) || ml <= 0)) {
      toast('Ingresá el volumen en ml', 'warn');
      return;
    }
    addProtocolEvent(volumeModal, ml);
    setVolumeModal(null);
    setVolumeInput('');
  };

  const handleMarkEvent = () => {
    if (!measuring || !startTime) return;
    const elapsed = (Date.now() - startTime - pausedDuration) / 1000;
    const nextCount = eventCount + 1;
    setEventCount(nextCount);
    const changeVal = (initialValue !== null && currentValue !== null)
      ? currentValue - initialValue
      : null;
    setEvents((prev) => [{ id: nextCount, time: elapsed, value: currentValue || 0, change: changeVal, kind: 'mark' }, ...prev]);
    // El evento se persiste recién en el batch commit del ExportModal.
  };

  /* ── Eventos automáticos de enlace ───────────────────────────────────
   * Si el microcontrolador se desconecta EN MEDIO de una medición, queda
   * registrado como evento (rojo) y su reconexión (verde). Así el hueco de
   * datos es trazable en la lista, en el PDF y en la nube.
   * No aplica al simulador ni fuera de una sesión activa.
   */
  const prevWsRef = useRef(wsStatus);
  useEffect(() => {
    const prev = prevWsRef.current;
    prevWsRef.current = wsStatus;
    if (isSimulator) return;
    if (!measuring || !startTime) return;
    if (prev === wsStatus) return;

    const wasUp = prev === 'CONNECTED';
    const isUp  = wsStatus === 'CONNECTED';
    if (wasUp === isUp) return;                 // solo transiciones reales

    const kind = isUp ? 'reconnect' : 'disconnect';
    const elapsed = (Date.now() - startTime - pausedDuration) / 1000;

    setEventCount((n) => {
      const next = n + 1;
      setEvents((prevEv) => [{
        id: next,
        time: elapsed,
        value: currentValue || 0,
        change: null,
        kind,
      }, ...prevEv]);
      return next;
    });
  }, [wsStatus, measuring, startTime, pausedDuration, currentValue, isSimulator]);

  /**
   * Descarta la sesión en memoria y deja el cronómetro en 00:00, en pausa.
   *
   * @param mantenerSetup  true  · Reiniciar · conserva paciente y basal, se
   *                               queda en el panel listo para dar play. Es el
   *                               caso de "algo salió mal, arranco de nuevo":
   *                               no tiene sentido rehacer la conexión ni la
   *                               calibración para volver a medir a la misma
   *                               persona.
   *                       false · Volver al inicio · suelta todo.
   */
  const resetSesion = ({ mantenerSetup } = { mantenerSetup: false }) => {
    lastUserActionRef.current = Date.now();
    sendCommand('RESET');
    setMeasuring(false);
    setStartTime(null);
    setPausedDur(0);
    setPauseStart(null);
    setElapsedTime('00:00');
    setData([]);
    setRateData([]);
    setEvents([]);
    if (!mantenerSetup) {
      setInitialValue(null);
      setActivePatient(null);
      setArmado(false);
    }
    setSessionData({});
    setVoltage(null);
    setVoltageData([]);
    voltageBufRef.current = [];
    lastVoltageRef.current = null;
    baselineSamplesRef.current = [];
    lastAcceptedZRef.current   = null;
    consecRejectRef.current    = 0;
    dataBufRef.current = [];
    rateBufRef.current = [];
    lastDataAtRef.current = null;
    try { localStorage.removeItem(SESSION_BACKUP_KEY); } catch { /* noop */ }
    setCurrentValue(null);
    setRate(0);
    setEventCount(0);
    setAlarmFired(false);
    setAlarmArmed(true);
    setPersistedSessionId(null);
    simulatedZRef.current = 150.0;
    setConfirmReset(false);
    setConfirmHome(false);
    toast(mantenerSetup
      ? 'Mediciones descartadas · mismo paciente, listo para empezar'
      : 'Sesión reiniciada', 'info');
  };

  /** Reiniciar · misma persona, mismo setup, cronómetro en cero. */
  const handleReset = () => resetSesion({ mantenerSetup: true });

  /**
   * Volver a la pantalla de inicio desde la marca del header.
   *
   * "Inicio" es el estado en reposo, así que implica descartar la sesión en
   * memoria: es la misma operación que Reiniciar. Si hay algo que perder
   * —midiendo o con muestras cargadas— pasa por confirmación; si no, va
   * directo, porque no hay nada que confirmar.
   */
  const goHome = () => {
    if (idle) return;
    if (measuring || hasAnyData) { setConfirmHome(true); return; }
    resetSesion({ mantenerSetup: false });
  };

  const handleSaveCalibration = (calib) => {
    setInitialValue(calib.zEmpty);
    setAlarmType('abs');
    setAlarmAbs(calib.zFull.toString());
    setAlarmEnabled(true);
    setAlarmFired(false);
    setAlarmArmed(true);
  };

  // Cola de sesiones medidas offline (modo AP): se suben solas al volver internet.
  const pendingSync = usePendingSync(supabase, ({ synced }) => {
    toast(`${synced} sesión${synced === 1 ? '' : 'es'} subida${synced === 1 ? '' : 's'} a la nube`, 'success');
  });

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

    // Los datos de la persona viven en su ficha (tabla patients); acá solo
    // van el vínculo, las observaciones y los campos variables de la sesión.
    const patientPayload = {
      notes:        patientInfo.notas || null,
      patient_id:   activePatient?.id ?? null,
      session_data: patientInfo.sessionData ?? {},
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

    // Primera vez: armamos el payload completo y lo commiteamos vía helper.
    const measurements = data.map((p, i) => ({
      elapsed_time: p.x,
      impedance:    p.y,
      rate:         rateData[i]?.y ?? 0,
    }));
    const payload = {
      userId,
      patientPayload,
      stats: { initialZ: initialValue, finalZ: currentValue, elapsedStr: elapsedTime, eventCount },
      measurements,
      events,
    };

    try {
      const sId = await commitSession(supabase, payload);
      setPersistedSessionId(sId);
      toast(
        `Sesión guardada en la nube · ${measurements.length} mediciones, ${events.length} eventos`,
        'success'
      );
    } catch (err) {
      console.error('[batch commit]', err);
      // Sin internet (modo AP) o error de red: NO se pierde. La encolamos en
      // IndexedDB y se sube sola al volver internet. El CSV local ya es respaldo.
      try {
        await queuePendingSession(payload);
        await pendingSync.refresh();
        toast('Sin internet: la sesión quedó en cola y se subirá sola al reconectar.', 'info');
      } catch (qerr) {
        console.error('[queue pending]', qerr);
        toast('No se pudo guardar en la nube ni encolar. Exportá el CSV local como respaldo.', 'warn');
      }
      // No re-lanzamos: con la cola, el export local no debe abortar.
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
  // Reposo · todavía no empezó ninguna sesión. Manda la pantalla de
  // preparación: no hay cronómetro, ni eventos, ni nada que exportar.
  const idle = !hasAnyData && !measuring && !armado;
  const primaryButtonLabel = measuring ? 'Pausar' : (startTime ? 'Reanudar' : 'Iniciar adquisición');

  // Estado mostrado en el CloudSyncBadge. Se sobreescribe a 'pending'
  // cuando hay mediciones en memoria sin commitear todavía.
  const cloudDisplayState = useMemo(() => {
    if (cloud.state === 'busy' || cloud.state === 'warn') return cloud.state;
    if (cloud.state === 'off') return 'off';
    if (data.length > 0 && !persistedSessionId) return 'pending';
    return cloud.state;
  }, [cloud.state, data.length, persistedSessionId]);

  // Estado resumido de la alarma para el panel lateral
  const alarmStatus = !alarmEnabled
    ? { label: 'Desactivada', cls: 'pill-off', tag: 'Off' }
    : alarmFired
      ? { label: 'Disparada', cls: 'pill-alarm', tag: 'Activa' }
      : alarmArmed
        ? { label: 'Armada', cls: 'pill-amber', tag: 'Preventiva' }
        : { label: 'En espera', cls: 'pill-off', tag: 'Rearmando' };

  // Calidad de enlace derivada del RSSI reportado por el firmware.
  const linkQuality = device.rssi == null ? null
    : device.rssi >= -60 ? 'señal fuerte'
    : device.rssi >= -70 ? 'señal buena'
    : device.rssi >= -80 ? 'señal débil'
    : 'señal muy débil';

  const connectionTitle = isSimulator
    ? 'Simulador activo · sin hardware'
    : wsStatus === 'CONNECTED'
      ? (device.rssi != null ? `Enlace ${device.rssi} dBm · ${linkQuality}` : 'Enlace activo')
      : wsStatus === 'CONNECTING'
        ? 'Reintentando conexión…'
        : 'Sin enlace al microcontrolador';

  // Acciones secundarias · viven en el menú ⋯ (desktop) y en el MobileMenu.
  // Acciones del menú ⋯ · sin separadores: el ritmo de ticks del marcador ya
  // separa las entradas (ver HeaderMenu).
  const overflowItems = [
    ...(isAdmin && onSwitchToAdmin
      ? [{ icon: Shield, label: 'Panel de administración', hint: 'Volver a la vista admin', onClick: onSwitchToAdmin }]
      : []),
    {
      icon: Cpu,
      label: isSimulator ? 'Desactivar simulador' : 'Activar simulador',
      hint: 'Curva fisiológica sintética',
      onClick: toggleSimulator,
    },
    {
      icon: SettingsIcon,
      label: 'Configuración',
      hint: 'Microcontrolador y red',
      onClick: () => setIsSettingsOpen(true),
    },
    {
      icon: theme === 'dark' ? Sun : Moon,
      label: `Tema ${theme === 'dark' ? 'claro' : 'oscuro'}`,
      hint: theme === 'dark' ? 'Más legible con luz ambiente' : 'Más cómodo en quirófano',
      onClick: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    },
    { icon: LogOut, label: 'Cerrar sesión', hint: 'Salir de la cuenta', danger: true, onClick: onSignOut },
  ];

  return (
    <div className="app-shell">
      <AlarmBanner
        active={alarmFired}
        message="Umbral preventivo alcanzado · la vejiga está próxima a su capacidad calibrada"
        hint="Sugiera al paciente que orine. La alarma seguirá activa hasta que se reconozca."
        onAcknowledge={() => setAlarmFired(false)}
      />

      <header className="app-header">
        {/* En reposo no se usa `disabled`: la regla global lo bajaría al 50 %
            de opacidad y la marca no puede verse apagada. Se marca con una
            clase, y goHome ya corta solo. */}
        <button
          type="button"
          className={`brand brand-home ${idle ? 'is-home' : ''}`}
          onClick={goHome}
          aria-disabled={idle || undefined}
          aria-label={idle ? 'Chidori · ya está en la pantalla de inicio' : 'Volver a la pantalla de inicio'}
          title={idle ? 'Pantalla de inicio' : 'Volver a la pantalla de inicio'}
        >
          <span className="brand-mark">Chidori</span>
          <span className="brand-tag">
            {isAdmin ? 'Modo medición · sesión administrativa' : 'Bioimpedancia vesical · v2'}
          </span>
        </button>

        <div className="app-actions">
          <span
            className={`pill keep-mobile ${
              isSimulator ? 'pill-syncing'
              : signalStale ? 'pill-alarm'
              : wsStatus === 'CONNECTED' ? 'pill-live'
              : wsStatus === 'CONNECTING' ? 'pill-syncing'
              : 'pill-alarm'
            }`}
            title={signalStale ? 'Socket abierto pero sin datos del firmware' : connectionTitle}
          >
            <span className="pill-dot" />
            {isSimulator ? 'Simulador'
              : signalStale ? 'Sin datos'
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
            pendingUploads={pendingSync.pending}
            onUpload={pendingSync.flush}
          />

          {activePatient && (
            <button
              type="button"
              className="pill pill-live"
              onClick={() => setGateOpen(true)}
              title="Paciente de esta sesión · click para cambiar"
              style={{ cursor: 'pointer' }}
            >
              <span className="pill-dot" />
              {activePatient.code}
            </button>
          )}

          <span className="pill pill-off" title={`Sesión iniciada como ${displayName}`}>
            <span className="pill-dot" />
            {displayName}
          </span>

          {/* Menú ⋯ · acciones secundarias · solo desktop (CSS oculta en mobile) */}
          <HeaderMenu items={overflowItems} />

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
        {/* El banner solo aparece con una sesión en curso: en reposo la
            tarjeta de preparación ya muestra el estado del enlace, y anunciarlo
            en los dos lados era ruido. Durante la medición sí hace falta, es
            cuando el corte importa. */}
        {!idle && (
          <ConnectionGate
            wsStatus={wsStatus}
            isSimulator={isSimulator}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onReconnect={connectWebSocket}
          />
        )}

        {/* Sesión interrumpida recuperable · solo si todavía no hay datos nuevos */}
        {recovery && !hasAnyData && (
          <div className="gate-banner recovery-banner" role="status">
            <div className="gate-banner-text">
              <strong>Sesión interrumpida encontrada.</strong>
              <span className="mute" style={{ fontSize: 'var(--t-xs)' }}>
                {recovery.data.length} puntos · guardada{' '}
                {new Date(recovery.savedAt).toLocaleString('es-AR')}. Se restaura en pausa.
              </span>
            </div>
            <div className="row">
              <button type="button" className="button button-ghost button-sm" onClick={discardBackup}>
                Descartar
              </button>
              <button type="button" className="button button-primary button-sm" onClick={restoreFromBackup}>
                Recuperar sesión
              </button>
            </div>
          </div>
        )}

        {/* ── Barra de comando · control primario + cronómetro + acciones ──
            Oculta en reposo: sin sesión el cronómetro marca 00:00 y Marcar,
            Agua, Micción, Reiniciar y Exportar no tienen sobre qué operar. El
            arranque vive en la tarjeta de preparación. */}
        {!idle && (
        <section className="command-bar">
          <div className="command-primary">
            <button
              type="button"
              className={`button button-lg ${measuring ? '' : 'button-primary'}`}
              onClick={toggleMeasuring}
            >
              {measuring ? <Pause size={16} /> : <Play size={16} />}
              {primaryButtonLabel}
            </button>
            <div className="command-clock">
              <span className="section-label">Sesión</span>
              <span className="command-clock-value numeric">{elapsedTime || '00:00'}</span>
            </div>
          </div>
          <div className="command-actions">
            <button type="button" className="button" onClick={handleMarkEvent} disabled={!measuring} title="Marcar evento (E)">
              <Bookmark size={15} />
              Marcar
            </button>
            {/* Protocolo experimental · ingesta y micción */}
            <button
              type="button"
              className="button"
              onClick={() => { setVolumeInput(''); setVolumeModal('water'); }}
              disabled={!measuring}
              title="Registrar ingesta de agua (A)"
            >
              <GlassWater size={15} />
              Agua
            </button>
            <button
              type="button"
              className="button"
              onClick={() => addProtocolEvent('void', NaN)}
              disabled={!measuring}
              title="Registrar micción (M) · el volumen se puede cargar después"
            >
              <Toilet size={15} />
              Micción
            </button>

            {/* Solo en simulador · prueba de la detección de microcortes */}
            {isSimulator && (
              <button
                type="button"
                className="button button-ghost"
                onClick={simulateMicroGap}
                disabled={!measuring}
                title={`Corta la transmisión simulada durante ${SIM_GAP_SAMPLES} muestras`}
              >
                <ZapOff size={14} />
                Simular corte
              </button>
            )}
            <button type="button" className="button button-ghost" onClick={() => setConfirmReset(true)} disabled={!startTime && data.length === 0}>
              <RotateCcw size={14} />
              Reiniciar
            </button>
            <button type="button" className="button button-ghost" onClick={() => setIsExportOpen(true)}>
              <Download size={14} />
              Exportar
            </button>
          </div>
        </section>
        )}

        {idle ? (
          <EmptyState
            wsStatus={wsStatus}
            isSimulator={isSimulator}
            wsConfig={wsConfig}
            patient={activePatient}
            sessionCount={patientSessionCount}
            canStart={wsStatus === 'CONNECTED' || isSimulator}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onToggleSimulator={toggleSimulator}
            onReconnect={connectWebSocket}
            onPickPatient={() => setGateOpen(true)}
            onStart={toggleMeasuring}
          />
        ) : (
          /* Foco + borde luminoso sobre las tarjetas reales de medición.
             Es solo presentación: no altera datos ni interacción. */
          <SpotlightArea>
            {/* ── Grid de monitoreo · señal (izq) + vejiga hero (der) ── */}
            <div className="monitor-grid">
              <div className="monitor-main">
                <StatsGrid
                  voltage={voltage}
                  voltageIsRaw={voltageIsRaw}
                  initialValue={initialValue}
                  currentValue={currentValue}
                  rate={rate}
                  zHistory={data}
                  rateHistory={rateData}
                  stale={signalStale}
                />
                <RealTimeCharts data={data} rateData={rateData} voltageData={voltageData} events={events} theme={theme} />
              </div>

              <div className="monitor-side">
                {/* Ya no depende del umbral de alarma: la escala es la
                    hipótesis de los 1,5 dB sobre el basal. */}
                <BladderVisual
                  initialValue={initialValue}
                  currentValue={currentValue}
                />

                {/* Resumen de alarma · vivo, siempre a la vista */}
                <section className="surface surface-pad alarm-mini" aria-label="Estado de la alarma">
                  <div className="row-between" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <span className="section-label">Alarma preventiva</span>
                      <h3 style={{ fontSize: 'var(--t-lg)', marginTop: 2 }}>{alarmStatus.label}</h3>
                    </div>
                    <span className={`pill ${alarmStatus.cls}`}>
                      <span className="pill-dot" />
                      {alarmStatus.tag}
                    </span>
                  </div>

                  {alarmEnabled && initialValue !== null ? (
                    <div className="alarm-mini-grid">
                      <div>
                        <span className="field-label">Umbral</span>
                        <strong className="numeric">{thresholdPreview.toFixed(2)} Ω</strong>
                      </div>
                      <div>
                        <span className="field-label">Margen</span>
                        <strong className="numeric">
                          {currentValue != null ? `${(currentValue - thresholdPreview).toFixed(2)} Ω` : '—'}
                        </strong>
                      </div>
                    </div>
                  ) : (
                    <span className="field-hint" style={{ marginTop: 4 }}>
                      Configure el umbral en la pestaña <strong>Configuración</strong> para activar
                      el aviso preventivo durante la sesión.
                    </span>
                  )}
                </section>
              </div>
            </div>

            {/* ── Zona de setup · tabs Configuración / Eventos ── */}
            <section className="setup-section">
              <LineTabs
                items={[
                  { key: 'config', label: 'Configuración de sesión' },
                  { key: 'events', label: `Eventos · ${String(eventCount).padStart(2, '0')}` },
                ]}
                active={setupTab}
                onChange={setSetupTab}
              />

              {setupTab === 'config' ? (
                <div className="setup-grid">
                  <CalibrationWizard
                    currentValue={currentValue}
                    onSaveCalibration={handleSaveCalibration}
                    onShowAlert={toast}
                    activeBaseline={initialValue}
                    onSetBaselineNow={handleSetBaselineNow}
                    baselineCandidate={baselineCandidate}
                    onSetBaselineManual={handleSetBaselineManual}
                  />


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
                </div>
              ) : (
                <Timeline events={events} />
              )}
            </section>
          </SpotlightArea>
        )}
      </main>

      <footer className="app-footer">
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          <span><span className="kbd">Espacio</span> Iniciar / Pausar</span>
          <span><span className="kbd">E</span> Marcar evento</span>
          <span><span className="kbd">A</span> Ingesta de agua</span>
          <span><span className="kbd">M</span> Micción</span>
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
        device={device}
        linkQuality={linkQuality}
      />

      {gateOpen && (
        <PatientGate
          supabase={supabase}
          onCancel={() => setGateOpen(false)}
          onError={(msg) => toast(msg, 'warn')}
          onReady={({ patient, sessionData: sd }) => {
            setActivePatient(patient);
            setSessionData(sd || {});
            setGateOpen(false);
            toast(`Sesión asociada a ${patient.code}`, 'success');
          }}
        />
      )}

      {/* Captura rápida de volumen · ingesta y micción del protocolo */}
      {volumeModal && (
        <div className="modal-veil" onClick={() => setVolumeModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="modal-head">
              <h3>Registrar ingesta</h3>
              <button type="button" className="icon-button" onClick={() => setVolumeModal(null)} aria-label="Cerrar">×</button>
            </div>
            <div className="stack-md" style={{ padding: '18px 22px 22px' }}>
              <div className="field">
                <label className="field-label" htmlFor="vol-ml">Volumen (ml)</label>
                <input
                  id="vol-ml"
                  className="input"
                  type="number"
                  min="0"
                  step="10"
                  autoFocus
                  placeholder="p. ej. 250"
                  value={volumeInput}
                  onChange={(e) => setVolumeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); confirmVolume(); }
                    if (e.key === 'Escape') setVolumeModal(null);
                  }}
                />
                <span className="field-hint">
                  Queda marcado en el minuto exacto de la sesión.
                </span>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="button button-ghost" onClick={() => setVolumeModal(null)}>
                  Cancelar
                </button>
                <button type="button" className="button button-primary" onClick={confirmVolume}>
                  Registrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ExportModal
        supabase={supabase}
        patient={activePatient}
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
        title="Empezar de nuevo"
        body={
          <>
            <p style={{ marginBottom: 10 }}>
              Se descartan las {data.length.toLocaleString('es-AR')} muestras en memoria
              y los {eventCount} eventos. El cronómetro vuelve a 00:00 y queda en pausa,
              listo para arrancar.
            </p>
            <p style={{ marginBottom: 10 }}>
              <strong>Se conservan el paciente{activePatient ? ` (${activePatient.code})` : ''} y
              el basal{initialValue != null ? ` (${initialValue.toFixed(2)} Ω)` : ''}</strong>, así
              no hay que rehacer el enlace ni la calibración.
              {persistedSessionId
                ? ' Lo ya guardado en la nube queda archivado allí.'
                : ' Todavía no se guardó nada en la nube.'}
            </p>
            <p>Mantenga presionado el botón para confirmar.</p>
          </>
        }
        actionLabel="Mantener para empezar de nuevo"
        onCancel={() => setConfirmReset(false)}
        onConfirm={handleReset}
        holdMs={1500}
      />

      <ConfirmModal
        open={confirmHome}
        title={measuring ? 'Hay una medición en curso' : 'Volver al inicio'}
        body={
          <>
            <p style={{ marginBottom: 10 }}>
              {measuring
                ? <>La adquisición está corriendo. Volver al inicio la <strong>detiene</strong> y
                    descarta las {data.length.toLocaleString('es-AR')} muestras que hay en memoria.</>
                : <>Se descartan las {data.length.toLocaleString('es-AR')} muestras que hay en memoria
                    y la sesión queda cerrada.</>}
            </p>
            <p style={{ marginBottom: 10 }}>
              {persistedSessionId
                ? 'Lo que ya se guardó en la nube queda archivado allí.'
                : 'Todavía no se guardó nada en la nube. Si querés conservarla, cancelá y usá Exportar.'}
            </p>
            <p>Mantenga presionado el botón para confirmar.</p>
          </>
        }
        actionLabel="Mantener para volver al inicio"
        onCancel={() => setConfirmHome(false)}
        onConfirm={() => resetSesion({ mantenerSetup: false })}
        holdMs={measuring ? 1800 : 1200}
      />
    </div>
  );
}
