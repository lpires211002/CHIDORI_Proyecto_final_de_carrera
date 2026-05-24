import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Download, Moon, Sun, ShieldAlert, ChevronRight, Settings, Activity, Database } from 'lucide-react';
import SettingsPanel from './components/SettingsPanel';
import StatsGrid from './components/StatsGrid';
import RealTimeCharts from './components/RealTimeCharts';
import Timeline from './components/Timeline';
import ExportModal from './components/ExportModal';
import BladderVisual from './components/BladderVisual';
import CalibrationWizard from './components/CalibrationWizard';
import { getSupabaseClient } from './supabaseClient';

export default function App() {
  // --- Theme State ---
  const [theme, setTheme] = useState(() => localStorage.getItem('chidori-theme') || 'dark');

  // --- WebSocket Connectivity Configuration ---
  const [wsConfig, setWsConfig] = useState(() => {
    const saved = localStorage.getItem('chidori-ws-config');
    return saved ? JSON.parse(saved) : {
      protocol: 'ws://',
      host: '192.168.0.126',
      port: '81'
    };
  });
  const [wsStatus, setWsStatus] = useState('DISCONNECTED'); // CONNECTED, DISCONNECTED, CONNECTING
  const socketRef = useRef(null);
  const reconnectIntervalRef = useRef(null);

  // --- Supabase Cloud Database Configuration ---
  const [supabaseConfig, setSupabaseConfig] = useState(() => {
    const saved = localStorage.getItem('chidori-supabase-config');
    return saved ? JSON.parse(saved) : { url: '', key: '' };
  });
  const [supabase, setSupabase] = useState(() => getSupabaseClient(supabaseConfig.url, supabaseConfig.key));
  const [sessionId, setSessionId] = useState(null);

  // --- Simulator Mode State ---
  const [isSimulatorActive, setIsSimulatorActive] = useState(false);
  const simulatorIntervalRef = useRef(null);
  const simulatedZRef = useRef(150.0);

  // --- Session State ---
  const [measuring, setMeasuring] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [pausedDuration, setPausedDuration] = useState(0);
  const [pauseStart, setPauseStart] = useState(null);
  const [elapsedTime, setElapsedTime] = useState('00:00');
  
  const [data, setData] = useState([]);          // [{ x: time, y: val }]
  const [rateData, setRateData] = useState([]);  // [{ x: time, y: rate }]
  const [events, setEvents] = useState([]);      // [{ id, time, value, change }]
  
  const [initialValue, setInitialValue] = useState(null);
  const [currentValue, setCurrentValue] = useState(null);
  const [rate, setRate] = useState(0);
  const [eventCount, setEventCount] = useState(0);

  // --- Alarm System States ---
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [alarmType, setAlarmType] = useState('abs'); // abs, percent, diff
  const [alarmAbs, setAlarmAbs] = useState('');
  const [alarmPercent, setAlarmPercent] = useState('');
  const [alarmDiff, setAlarmDiff] = useState('');
  const [alarmFired, setAlarmFired] = useState(false);

  // --- UI Modals & Notifications ---
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [alerts, setAlerts] = useState([]); // [{ id, text, type }]

  // Keep refs for callbacks to read fresh state without re-creating listeners
  const stateRef = useRef({ measuring, startTime, pausedDuration, pauseStart, data, initialValue, currentValue, alarmEnabled, alarmType, alarmAbs, alarmPercent, alarmDiff, alarmFired, supabase, sessionId, eventCount });
  
  useEffect(() => {
    stateRef.current = { measuring, startTime, pausedDuration, pauseStart, data, initialValue, currentValue, alarmEnabled, alarmType, alarmAbs, alarmPercent, alarmDiff, alarmFired, supabase, sessionId, eventCount };
  }, [measuring, startTime, pausedDuration, pauseStart, data, initialValue, currentValue, alarmEnabled, alarmType, alarmAbs, alarmPercent, alarmDiff, alarmFired, supabase, sessionId, eventCount]);

  // --- Custom Animated Alert Toast ---
  const triggerAlert = (text, type = 'info') => {
    const id = Date.now();
    setAlerts(prev => [...prev, { id, text, type }]);
    
    // Play alert sound if it's warning/success
    if (type === 'warning' || type === 'success') {
      playBeep();
    }

    setTimeout(() => {
      setAlerts(prev => prev.filter(a => a.id !== id));
    }, 4500);
  };

  // --- Web Audio Synthesized Notification ---
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.type = 'sine';
      osc.frequency.value = 820; // Highly noticeable frequency
      
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.45);
      
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.45);
    } catch (e) {
      console.warn('Fallo al inicializar Web Audio API:', e);
    }
  };

  // --- Theme Toggle ---
  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
    localStorage.setItem('chidori-theme', theme);
  }, [theme]);

  // --- WebSocket Connection Manager ---
  const connectWebSocket = () => {
    if (isSimulatorActive) return; // Skip WS if simulator is running

    if (socketRef.current) {
      socketRef.current.close();
    }

    const { protocol, host, port } = wsConfig;
    const url = `${protocol}${host}:${port}/`;
    
    setWsStatus('CONNECTING');
    
    try {
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.onopen = () => {
        setWsStatus('CONNECTED');
        triggerAlert('Conectado con el microcontrolador Chidori', 'success');
        if (reconnectIntervalRef.current) {
          clearInterval(reconnectIntervalRef.current);
          reconnectIntervalRef.current = null;
        }
      };

      ws.onclose = () => {
        setWsStatus('DISCONNECTED');
        // Start automatic reconnection interval if not already running
        if (!reconnectIntervalRef.current && !isSimulatorActive) {
          reconnectIntervalRef.current = setInterval(() => {
            console.log('Intentando reconexión automática...');
            connectWebSocket();
          }, 5000);
        }
      };

      ws.onerror = (e) => {
        console.error('WebSocket Error:', e);
        setWsStatus('DISCONNECTED');
      };

      ws.onmessage = (event) => {
        const val = parseFloat(event.data);
        if (isNaN(val)) return;

        handleIncomingData(val);
      };
    } catch (err) {
      console.error('Conexión fallida:', err);
      setWsStatus('DISCONNECTED');
    }
  };

  // Connect on Mount, cleanup on Unmount
  useEffect(() => {
    connectWebSocket();
    return () => {
      if (socketRef.current) socketRef.current.close();
      if (reconnectIntervalRef.current) clearInterval(reconnectIntervalRef.current);
    };
  }, [wsConfig, isSimulatorActive]);

  // Save WS Config to Local Storage
  const handleSaveConfig = (newConfig) => {
    setWsConfig(newConfig);
    localStorage.setItem('chidori-ws-config', JSON.stringify(newConfig));
  };

  // Save Supabase Config to Local Storage and initialize client
  const handleSaveSupabaseConfig = (newConfig) => {
    setSupabaseConfig(newConfig);
    localStorage.setItem('chidori-supabase-config', JSON.stringify(newConfig));
    const client = getSupabaseClient(newConfig.url, newConfig.key);
    setSupabase(client);
    if (client) {
      triggerAlert('Conexión con Supabase guardada exitosamente', 'success');
    } else {
      triggerAlert('Datos de Supabase borrados o inválidos', 'info');
    }
  };

  // --- Clock updates ---
  useEffect(() => {
    let interval = null;
    if (measuring && startTime) {
      interval = setInterval(() => {
        const elapsed = (Date.now() - startTime - pausedDuration) / 1000;
        const mins = Math.floor(elapsed / 60);
        const secs = Math.floor(elapsed % 60);
        setElapsedTime(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      }, 250);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [measuring, startTime, pausedDuration]);

  // --- Core Signal Data Handler ---
  const handleIncomingData = async (val) => {
    const current = stateRef.current;
    if (!current.measuring) return;

    // Save first value as baseline reference
    let baseline = current.initialValue;
    if (baseline === null) {
      baseline = val;
      setInitialValue(val);
    }

    setCurrentValue(val);

    // Calculate Elapsed Time
    const elapsed = (Date.now() - current.startTime - current.pausedDuration) / 1000;

    let computedRate = 0;

    // Save raw data point
    setData(prev => {
      const newData = [...prev, { x: elapsed, y: val }];
      
      // Calculate Rate of change (derivative) using last 10 points
      if (newData.length >= 2) {
        const recent = newData.slice(-10);
        const firstP = recent[0];
        const lastP = recent[recent.length - 1];
        const deltaX = lastP.x - firstP.x;
        const deltaY = lastP.y - firstP.y;
        computedRate = deltaX > 0 ? (deltaY / deltaX) * 60 : 0; // Ohm/min
        
        setRate(computedRate);
        setRateData(prevRates => [...prevRates, { x: elapsed, y: computedRate }]);
      } else {
        setRateData(prevRates => [...prevRates, { x: elapsed, y: 0 }]);
      }

      return newData;
    });

    // --- CLOUD DATABSE: Insert measurement in Supabase ---
    // We insert a point in Supabase every 10 seconds to keep it high-performance
    const sampleIndex = Math.round(elapsed);
    if (current.supabase && current.sessionId && sampleIndex % 10 === 0) {
      try {
        await current.supabase.from('measurements').insert({
          session_id: current.sessionId,
          elapsed_time: elapsed,
          impedance: val,
          rate: computedRate
        });
      } catch (err) {
        console.error('Error insertando mediciones en Supabase:', err);
      }
    }

    // Evaluate Alarm Constraints
    if (current.alarmEnabled && !current.alarmFired) {
      let trigger = false;
      
      if (current.alarmType === 'abs' && current.alarmAbs) {
        const limit = parseFloat(current.alarmAbs);
        if (val <= limit) trigger = true;
      } else if (current.alarmType === 'percent' && current.alarmPercent) {
        const limitPct = parseFloat(current.alarmPercent);
        if (val <= baseline * (limitPct / 100)) trigger = true;
      } else if (current.alarmType === 'diff' && current.alarmDiff) {
        const limitDiff = parseFloat(current.alarmDiff);
        if (val <= baseline - limitDiff) trigger = true;
      }

      if (trigger) {
        setAlarmFired(true);
        triggerAlert('⚠️ Es altamente recomendable orinar (Vejiga completa)', 'warning');
      }
    }
  };

  // --- Keyboard Shortcuts Listener ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      // Spacebar: Start / Pause
      if (e.code === 'Space') {
        e.preventDefault();
        toggleMeasuring();
      }
      // E: Mark Event
      if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        handleMarkEvent();
      }
      // Ctrl+R / Cmd+R: Reset (prevent reload)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        handleReset();
      }
      // Ctrl+D / Cmd+D: Open Export Modal
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setIsExportOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [measuring, startTime, pausedDuration, data, initialValue, currentValue, eventCount, wsStatus, isSimulatorActive]);

  // --- High-Fidelity Bladder Ingestion Simulator ---
  useEffect(() => {
    if (isSimulatorActive && measuring) {
      simulatedZRef.current = initialValue !== null ? initialValue : 150.0;
      
      simulatorIntervalRef.current = setInterval(() => {
        // Bladder filling reduces impedance slowly. 
        // Decrement by a realistic step of 0.12 Ohm/sec with a slight random noise
        const noise = (Math.random() - 0.5) * 0.08;
        const fillStep = 0.12; 
        const nextZ = simulatedZRef.current - fillStep + noise;
        
        simulatedZRef.current = nextZ;
        handleIncomingData(nextZ);
      }, 1000);
    } else {
      if (simulatorIntervalRef.current) {
        clearInterval(simulatorIntervalRef.current);
        simulatorIntervalRef.current = null;
      }
    }

    return () => {
      if (simulatorIntervalRef.current) clearInterval(simulatorIntervalRef.current);
    };
  }, [isSimulatorActive, measuring]);

  // Handle Simulation Toggle
  const toggleSimulator = () => {
    if (measuring) {
      triggerAlert('No puedes alternar el simulador mientras una medición está activa.', 'warning');
      return;
    }
    
    const nextState = !isSimulatorActive;
    setIsSimulatorActive(nextState);
    
    if (nextState) {
      setWsStatus('DISCONNECTED');
      if (socketRef.current) {
        socketRef.current.close();
      }
      triggerAlert('Modo Simulador de Hardware Activado (Curvas Fisiológicas)', 'success');
    } else {
      triggerAlert('Modo Simulador Desactivado. Reconectando WebSocket...', 'info');
      connectWebSocket();
    }
  };

  // --- Control Operations ---
  const toggleMeasuring = async () => {
    const current = stateRef.current;
    if (wsStatus !== 'CONNECTED' && !isSimulatorActive) {
      triggerAlert('Debes estar conectado al WebSocket o activar el Simulador para controlar las mediciones', 'warning');
      return;
    }

    if (!measuring) {
      // Start or Resume
      let sTime = startTime;
      let pDur = pausedDuration;
      let sId = sessionId;
      
      if (!sTime) {
        sTime = Date.now();
        setStartTime(sTime);
      }
      if (pauseStart) {
        pDur += Date.now() - pauseStart;
        setPausedDuration(pDur);
        setPauseStart(null);
      }

      // --- CLOUD DATABASE: Create a Session in Supabase ---
      if (current.supabase && !sId) {
        try {
          const { data: newSession, error } = await current.supabase
            .from('sessions')
            .insert({
              patient_name: 'Paciente Temporal',
              initial_impedance: currentValue || 150.0
            })
            .select()
            .single();

          if (error) throw error;
          if (newSession) {
            sId = newSession.id;
            setSessionId(sId);
            console.log('Sesión en la nube de Supabase inicializada con ID:', sId);
          }
        } catch (err) {
          console.error('Error al crear sesión en Supabase:', err);
        }
      }

      if (!isSimulatorActive && socketRef.current) {
        socketRef.current.send('START');
      }

      setMeasuring(true);
      triggerAlert('Adquisición de bioimpedancia iniciada', 'success');
    } else {
      // Pause
      if (!isSimulatorActive && socketRef.current) {
        socketRef.current.send('STOP');
      }
      setMeasuring(false);
      setPauseStart(Date.now());
      triggerAlert('Medición pausada temporalmente', 'info');
    }
  };

  const handleMarkEvent = async () => {
    const current = stateRef.current;
    if (!measuring || !startTime) return;
    
    const elapsed = (Date.now() - startTime - pausedDuration) / 1000;
    const nextCount = eventCount + 1;
    setEventCount(nextCount);

    const changeVal = initialValue !== null && currentValue !== null ? currentValue - initialValue : null;

    const newEvent = {
      id: nextCount,
      time: elapsed,
      value: currentValue || 0,
      change: changeVal
    };

    setEvents(prev => [newEvent, ...prev]);

    // --- CLOUD DATABASE: Insert Event in Supabase ---
    if (current.supabase && current.sessionId) {
      try {
        await current.supabase.from('session_events').insert({
          session_id: current.sessionId,
          event_number: nextCount,
          elapsed_time: elapsed,
          impedance: currentValue || 0,
          impedance_change: changeVal
        });
      } catch (err) {
        console.error('Error insertando evento en Supabase:', err);
      }
    }

    triggerAlert(`Evento #${nextCount} marcado con éxito`, 'success');
  };

  const handleReset = () => {
    if (window.confirm('¿Seguro que deseas reiniciar todas las mediciones de la sesión?')) {
      if (socketRef.current && wsStatus === 'CONNECTED' && !isSimulatorActive) {
        socketRef.current.send('RESET');
      }

      // Reset states
      setMeasuring(false);
      setStartTime(null);
      setPausedDuration(0);
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
      setSessionId(null);
      simulatedZRef.current = 150.0;

      triggerAlert('Sesión reiniciada. Datos vaciados.', 'info');
    }
  };

  // Callback from Calibration Wizard to update alarms
  const handleSaveCalibration = (calib) => {
    setInitialValue(calib.zEmpty);
    setAlarmType('abs');
    setAlarmAbs(calib.zFull.toString());
    setAlarmEnabled(true);
    setAlarmFired(false);
  };

  // Sync / Update patient info dynamically in Supabase when saving form
  const handleUpdateSupabasePatient = async (patientInfo) => {
    const current = stateRef.current;
    if (current.supabase && current.sessionId) {
      try {
        await current.supabase.from('sessions').update({
          patient_name: patientInfo.nombre,
          patient_age: parseInt(patientInfo.edad) || null,
          patient_gender: patientInfo.sexo,
          patient_weight: parseFloat(patientInfo.peso) || null,
          patient_height: parseFloat(patientInfo.altura) || null,
          patient_iliac_circ: parseFloat(patientInfo.circ) || null,
          menstruation_info: patientInfo.menstruacion,
          final_impedance: currentValue,
          elapsed_time: elapsedTime,
          total_events: eventCount
        }).eq('id', current.sessionId);
        
        console.log('Información clínica de la sesión de Supabase actualizada.');
      } catch (e) {
        console.error('Fallo al actualizar paciente en Supabase:', e);
      }
    }
  };

  // Get current alarm threshold for visual preview
  const getAlarmThreshold = () => {
    if (initialValue === null) return 0;
    if (alarmType === 'abs') return parseFloat(alarmAbs) || 0;
    if (alarmType === 'percent') return initialValue * ((parseFloat(alarmPercent) || 0) / 100);
    if (alarmType === 'diff') return initialValue - (parseFloat(alarmDiff) || 0);
    return 0;
  };

  const thresholdPreview = getAlarmThreshold();
  const thresholdPercentage = initialValue > 0 ? (thresholdPreview / initialValue) * 100 : 0;

  return (
    <div className="container">
      {/* Toast Alert Notifications */}
      <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {alerts.map(a => (
          <div 
            key={a.id} 
            style={{
              background: a.type === 'warning' ? 'linear-gradient(135deg, #ff6b6b, #ee5a52)' : a.type === 'success' ? 'linear-gradient(135deg, #51cf66, #45b854)' : 'linear-gradient(135deg, #4ecdc4, #42b8b0)',
              boxShadow: a.type === 'warning' ? '0 8px 24px rgba(255, 107, 107, 0.4)' : a.type === 'success' ? '0 8px 24px rgba(81, 207, 102, 0.4)' : '0 8px 24px rgba(78, 205, 196, 0.4)',
              color: 'white',
              padding: '14px 22px',
              borderRadius: '12px',
              fontWeight: 600,
              fontSize: '14px',
              animation: 'slideUp 0.3s ease-out',
              maxWidth: '360px',
              minWidth: '260px'
            }}
          >
            {a.text}
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="header">
        <div className="logo">
          <div className="logo-icon">⚡</div>
          <h1>Chidori</h1>
        </div>
        <div className="header-actions">
          {/* Simulator Toggle Button */}
          <button 
            onClick={toggleSimulator} 
            className={`btn ${isSimulatorActive ? 'btn-accent' : 'btn-ghost'}`}
            style={{ padding: '8px 16px', fontSize: '12px', border: '1px solid hsl(var(--border-color))' }}
          >
            <Activity size={14} className={isSimulatorActive ? 'spin' : ''} style={{ animation: isSimulatorActive ? 'pulse 1.5s infinite' : 'none' }} />
            {isSimulatorActive ? 'Modo Simulador: ON' : 'Simular Hardware'}
          </button>
          
          <button 
            onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')} 
            className="btn-icon-only" 
            title="Cambiar Tema"
            style={{ borderRadius: '50%' }}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <main>
        {/* Settings & Connectivity (WS & Supabase) */}
        <SettingsPanel 
          wsConfig={wsConfig} 
          onSaveConfig={handleSaveConfig} 
          wsStatus={wsStatus} 
          onReconnect={connectWebSocket} 
          supabaseConfig={supabaseConfig}
          onSaveSupabaseConfig={handleSaveSupabaseConfig}
        />

        {/* Control Card */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2>Control de Adquisición</h2>
              <span className="card-subtitle">Gestiona la adquisición de impedancia y marcado de eventos de llenado</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '4px' }}>
            <button 
              onClick={toggleMeasuring} 
              className={`btn ${measuring ? 'btn-secondary' : 'btn-primary'}`}
              style={{ flex: 2, minWidth: '220px' }}
            >
              {measuring ? <Pause size={18} /> : <Play size={18} />}
              {measuring ? 'Pausar Mediciones' : 'Iniciar Mediciones'}
            </button>

            <button 
              onClick={handleMarkEvent} 
              className="btn btn-tertiary"
              style={{ flex: 1, minWidth: '180px' }}
              disabled={!measuring}
            >
              <span>📍</span>
              Marcar Evento [E]
            </button>

            <button 
              onClick={handleReset} 
              className="btn"
              style={{ background: 'hsl(var(--bg-tertiary))', border: '1px solid hsl(var(--border-color))', color: 'hsl(var(--text-primary))', flex: 1, minWidth: '130px' }}
            >
              <RotateCcw size={16} />
              Reiniciar
            </button>

            <button 
              onClick={() => setIsExportOpen(true)} 
              className="btn btn-accent"
              style={{ flex: 1, minWidth: '130px' }}
            >
              <Download size={16} />
              Exportar...
            </button>
          </div>
        </div>

        {/* Dashboard Grid */}
        <StatsGrid 
          initialValue={initialValue}
          currentValue={currentValue}
          elapsedTime={elapsedTime}
          eventCount={eventCount}
          rate={rate}
        />

        {/* Option A & C Dynamic Medical Widgets Block */}
        <div className="grid-3" style={{ marginBottom: '20px' }}>
          <BladderVisual 
            initialValue={initialValue} 
            currentValue={currentValue} 
            alarmThreshold={thresholdPreview} 
          />
          
          <Timeline events={events} />
          
          <CalibrationWizard 
            currentValue={currentValue}
            onSaveCalibration={handleSaveCalibration}
            onShowAlert={triggerAlert}
          />
        </div>

        {/* Charts Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '20px' }}>
          <RealTimeCharts 
            data={data}
            rateData={rateData}
            events={events}
            theme={theme}
          />
          
          {/* Advanced Alarm configuration card */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldAlert size={20} style={{ color: 'hsl(var(--accent-orange))' }} />
                  Configuración de Alarma Vesical
                </h2>
                <span className="card-subtitle">Establece límites preventivos de atenuación vesical</span>
              </div>
            </div>

            <div className="alarm-content" style={{ padding: 0 }}>
              <div className="alarm-row">
                <span className="alarm-toggle-label">Activar alertas preventivas</span>
                <label className="switch">
                  <input 
                    type="checkbox" 
                    checked={alarmEnabled} 
                    onChange={(e) => setAlarmEnabled(e.target.checked)} 
                  />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="alarm-options" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                
                <div className={`alarm-card-option ${alarmEnabled && alarmType === 'abs' ? 'active' : ''}`}>
                  <label className="radio-row">
                    <input 
                      type="radio" 
                      name="alarmType" 
                      value="abs" 
                      checked={alarmType === 'abs'} 
                      onChange={() => setAlarmType('abs')}
                      disabled={!alarmEnabled}
                      style={{ display: 'none' }}
                    />
                    <span className="custom-radio"></span>
                    <span>Valor Absoluto de Impedancia</span>
                  </label>
                  <input 
                    type="number" 
                    className="input-field" 
                    placeholder="Ej. 120.5 Ω"
                    value={alarmAbs}
                    onChange={(e) => setAlarmAbs(e.target.value)}
                    disabled={!alarmEnabled || alarmType !== 'abs'}
                  />
                </div>

                <div className={`alarm-card-option ${alarmEnabled && alarmType === 'percent' ? 'active' : ''}`}>
                  <label className="radio-row">
                    <input 
                      type="radio" 
                      name="alarmType" 
                      value="percent" 
                      checked={alarmType === 'percent'} 
                      onChange={() => setAlarmType('percent')}
                      disabled={!alarmEnabled}
                      style={{ display: 'none' }}
                    />
                    <span className="custom-radio"></span>
                    <span>Porcentaje del Valor Inicial</span>
                  </label>
                  <input 
                    type="number" 
                    className="input-field" 
                    placeholder="0 - 100 %"
                    min="0"
                    max="100"
                    value={alarmPercent}
                    onChange={(e) => setAlarmPercent(e.target.value)}
                    disabled={!alarmEnabled || alarmType !== 'percent'}
                  />
                </div>

                <div className={`alarm-card-option ${alarmEnabled && alarmType === 'diff' ? 'active' : ''}`}>
                  <label className="radio-row">
                    <input 
                      type="radio" 
                      name="alarmType" 
                      value="diff" 
                      checked={alarmType === 'diff'} 
                      onChange={() => setAlarmType('diff')}
                      disabled={!alarmEnabled}
                      style={{ display: 'none' }}
                    />
                    <span className="custom-radio"></span>
                    <span>Diferencia Respecto al Inicial</span>
                  </label>
                  <input 
                    type="number" 
                    className="input-field" 
                    placeholder="Diferencia en Ω"
                    value={alarmDiff}
                    onChange={(e) => setAlarmDiff(e.target.value)}
                    disabled={!alarmEnabled || alarmType !== 'diff'}
                  />
                </div>

              </div>

              {alarmEnabled && initialValue !== null && (
                <div className="alarm-preview" style={{ marginTop: '16px', animation: 'fadeIn 0.3s ease-out' }}>
                  <div className="alarm-preview-label" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'hsl(var(--text-secondary))' }}>
                    <span>Zona segura (100%): <strong>{initialValue.toFixed(1)} Ω</strong></span>
                    <span>Límite preventivo: <strong>{thresholdPreview.toFixed(1)} Ω</strong></span>
                  </div>
                  <div className="alarm-preview-bar" style={{ height: '14px', background: 'linear-gradient(90deg, hsl(var(--accent-red) / 0.3) 0%, hsl(var(--accent-green) / 0.3) 100%)', position: 'relative', borderRadius: '7px', marginTop: '6px', overflow: 'hidden' }}>
                    <div 
                      className="alarm-threshold" 
                      style={{ 
                        position: 'absolute', 
                        left: `${Math.max(0, Math.min(100, thresholdPercentage))}%`, 
                        top: 0, 
                        bottom: 0, 
                        width: '3px', 
                        background: 'white',
                        boxShadow: '0 0 6px white'
                      }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Keyboard Shortcuts Footer */}
      <footer className="shortcuts-footer">
        <span>Accesos rápidos: </span>
        <span className="shortcut-badge">Espacio</span> Iniciar/Pausar | 
        <span className="shortcut-badge">E</span> Marcar Evento | 
        <span className="shortcut-badge">Ctrl + R</span> Reiniciar | 
        <span className="shortcut-badge">Ctrl + D</span> Exportar
      </footer>

      {/* Export & Patient Info Modal */}
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
        onShowAlert={triggerAlert}
        onSavePatient={handleUpdateSupabasePatient}
      />
    </div>
  );
}
