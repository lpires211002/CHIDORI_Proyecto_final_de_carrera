import React, { useState } from 'react';
import { Sliders, CheckCircle, HelpCircle, Activity, ArrowRight, RotateCcw } from 'lucide-react';

export default function CalibrationWizard({ 
  currentValue, 
  onSaveCalibration, 
  onShowAlert 
}) {
  const [step, setStep] = useState(1); // 1: Inicio/Vacío, 2: Ingesta, 3: Llena/Calibrar, 4: Resumen
  const [zEmpty, setZEmpty] = useState(null);
  const [zFull, setZFull] = useState(null);
  const [calculatedDb, setCalculatedDb] = useState(null);

  const handleMeasureEmpty = () => {
    if (currentValue === null) {
      onShowAlert('No hay mediciones en vivo. Conecta el dispositivo o activa el simulador.', 'warning');
      return;
    }
    setZEmpty(currentValue);
    setStep(2);
    onShowAlert('Impedancia basal (vejiga vacía) registrada exitosamente.', 'success');
  };

  const handleSkipHydration = () => {
    setStep(3);
  };

  const handleMeasureFull = () => {
    if (currentValue === null) {
      onShowAlert('No hay mediciones en vivo.', 'warning');
      return;
    }
    if (currentValue >= zEmpty) {
      onShowAlert('Error de calibración: la impedancia actual es mayor o igual a la basal. Asegúrate de medir con la vejiga realmente llena.', 'warning');
      return;
    }

    setZFull(currentValue);
    
    // Calculate dB atenuation
    const db = 20 * Math.log10(currentValue / zEmpty);
    setCalculatedDb(db);
    
    // Save to parent state (e.g. set the alarm threshold to currentValue and type to 'abs' or 'diff')
    onSaveCalibration({
      zEmpty,
      zFull,
      dbThreshold: db
    });

    setStep(4);
    onShowAlert('¡Calibración de alarma preventiva completada!', 'success');
  };

  const handleResetWizard = () => {
    setStep(1);
    setZEmpty(null);
    setZFull(null);
    setCalculatedDb(null);
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="card-header">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sliders size={20} style={{ color: 'hsl(var(--accent-cyan))' }} />
            Asistente de Calibración Vesical
          </h2>
          <span className="card-subtitle">Calibra los límites preventivos a la medida de tu cuerpo</span>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '16px', padding: '10px 0' }}>
        
        {/* Step Progress Indicators */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '10px', left: '10%', right: '10%', height: '2px', background: 'hsl(var(--border-color))', zIndex: 1 }}>
            <div style={{ height: '100%', background: 'hsl(var(--accent-cyan))', width: `${((step - 1) / 3) * 100}%`, transition: 'width 0.4s ease' }} />
          </div>
          
          {[1, 2, 3, 4].map(s => (
            <div 
              key={s} 
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: step >= s ? 'hsl(var(--accent-cyan))' : 'hsl(var(--bg-tertiary))',
                border: `2px solid ${step >= s ? 'hsl(var(--accent-cyan))' : 'hsl(var(--border-color))'}`,
                color: step >= s ? '#0f1419' : 'hsl(var(--text-secondary))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                fontWeight: 700,
                zIndex: 2,
                transition: 'all 0.4s ease'
              }}
            >
              {s === 4 && step === 4 ? '✓' : s}
            </div>
          ))}
        </div>

        {/* Step Content */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', animation: 'fadeIn 0.3s ease-out' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', background: 'hsl(var(--bg-secondary))', padding: '12px', borderRadius: '8px', border: '1px solid hsl(var(--border-color))' }}>
              <HelpCircle size={20} style={{ color: 'hsl(var(--accent-cyan))', flexShrink: 0, marginTop: '2px' }} />
              <p style={{ fontSize: '13px', color: 'hsl(var(--text-secondary))', lineHeight: '1.4' }}>
                <strong>Paso 1: Establecer la Base (Vejiga Vacía).</strong> Ve al baño y orina por completo. Luego, siéntate con los electrodos colocados y haz clic en medir para capturar tu impedancia basal en descanso.
              </p>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
              <span style={{ fontSize: '12px', color: 'hsl(var(--text-tertiary))', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Activity size={12} className="spin" style={{ animation: 'pulse 1.5s infinite' }} />
                Z actual: <strong>{currentValue ? `${currentValue.toFixed(1)} Ω` : '-- Ω'}</strong>
              </span>
              
              <button 
                onClick={handleMeasureEmpty} 
                className="btn btn-tertiary"
                style={{ padding: '8px 16px', fontSize: '13px' }}
                disabled={currentValue === null}
              >
                Medir Vacía
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', animation: 'fadeIn 0.3s ease-out' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', background: 'hsl(var(--bg-secondary))', padding: '12px', borderRadius: '8px', border: '1px solid hsl(var(--border-color))' }}>
              <span style={{ fontSize: '20px', flexShrink: 0 }}>💧</span>
              <p style={{ fontSize: '13px', color: 'hsl(var(--text-secondary))', lineHeight: '1.4' }}>
                <strong>Paso 2: Ingesta e Hidratación.</strong> Bebe aproximadamente **500 ml** de agua o té. El cuerpo tardará un tiempo en metabolizar el agua y comenzar el llenado de la vejiga. Puedes seguir monitoreando en la pantalla o hacer clic para avanzar al siguiente paso cuando sientas que tu vejiga empieza a cargarse.
              </p>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
              <span style={{ fontSize: '11px', color: 'hsl(var(--text-tertiary))' }}>
                Z basal vacía: <strong>{zEmpty ? `${zEmpty.toFixed(1)} Ω` : '-- Ω'}</strong>
              </span>
              
              <button 
                onClick={handleSkipHydration} 
                className="btn btn-primary"
                style={{ padding: '8px 16px', fontSize: '13px' }}
              >
                Siguiente Paso
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', animation: 'fadeIn 0.3s ease-out' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', background: 'hsl(var(--bg-secondary))', padding: '12px', borderRadius: '8px', border: '1px solid hsl(var(--border-color))' }}>
              <Activity size={20} style={{ color: 'hsl(var(--accent-red))', flexShrink: 0, marginTop: '2px' }} />
              <p style={{ fontSize: '13px', color: 'hsl(var(--text-secondary))', lineHeight: '1.4' }}>
                <strong>Paso 3: Establecer el Límite (Vejiga Llena).</strong> Cuando sientas una necesidad fuerte de orinar, no vayas al baño aún. Haz clic en "Medir Llena" para registrar el nivel mínimo de impedancia y calcular tu umbral personalizado.
              </p>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '11px', color: 'hsl(var(--text-tertiary))' }}>
                  Z basal vacía: <strong>{zEmpty ? `${zEmpty.toFixed(1)} Ω` : '-- Ω'}</strong>
                </span>
                <span style={{ fontSize: '11px', color: 'hsl(var(--text-tertiary))' }}>
                  Z en vivo: <strong>{currentValue ? `${currentValue.toFixed(1)} Ω` : '-- Ω'}</strong>
                </span>
              </div>
              
              <button 
                onClick={handleMeasureFull} 
                className="btn btn-danger"
                style={{ padding: '8px 16px', fontSize: '13px' }}
                disabled={currentValue === null}
              >
                Medir Llena
                <CheckCircle size={14} />
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', animation: 'fadeIn 0.3s ease-out' }}>
            <div style={{ background: 'hsl(var(--accent-green) / 0.05)', padding: '12px', borderRadius: '8px', border: '1px solid hsl(var(--accent-green) / 0.3)', display: 'flex', gap: '12px', alignItems: 'center' }}>
              <CheckCircle size={24} style={{ color: 'hsl(var(--accent-green))', flexShrink: 0 }} />
              <div>
                <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'hsl(var(--accent-green))' }}>¡Dispositivo Calibrado!</h4>
                <p style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))' }}>La alarma ha sido configurada con tus propios datos biológicos.</p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', background: 'hsl(var(--bg-secondary))', padding: '10px', borderRadius: '6px', border: '1px solid hsl(var(--border-color))' }}>
              <div>Basal Vacía: <strong>{zEmpty ? zEmpty.toFixed(1) : '--'} Ω</strong></div>
              <div>Límite Llena: <strong>{zFull ? zFull.toFixed(1) : '--'} Ω</strong></div>
              <div style={{ gridColumn: 'span 2', borderTop: '1px solid hsl(var(--border-color))', paddingTop: '6px', marginTop: '4px', color: 'hsl(var(--accent-orange))', fontWeight: 600 }}>
                Atenuación Límite: <strong>{calculatedDb ? calculatedDb.toFixed(2) : '--'} dB</strong>
              </div>
            </div>
            
            <button 
              onClick={handleResetWizard} 
              className="btn btn-ghost"
              style={{ width: '100%', padding: '8px', fontSize: '12px' }}
            >
              <RotateCcw size={14} />
              Recalibrar / Reiniciar Asistente
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
