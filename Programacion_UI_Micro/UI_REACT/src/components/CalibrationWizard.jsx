import React, { useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';

/**
 * Calibration wizard · 4 steps. Progress rail uses transform: scaleX
 * (no width transitions). Copy is clinical, without emojis.
 */
export default function CalibrationWizard({ currentValue, onSaveCalibration, onShowAlert }) {
  const [step, setStep] = useState(1);
  const [zEmpty, setZEmpty] = useState(null);
  const [zFull, setZFull]   = useState(null);
  const [dbCalc, setDbCalc] = useState(null);

  const fmtZ = (v) => (v == null ? '—' : `${v.toFixed(1)} Ω`);

  const measureEmpty = () => {
    if (currentValue === null) {
      onShowAlert('No hay mediciones en vivo. Conecte el dispositivo o active el simulador.', 'warn');
      return;
    }
    setZEmpty(currentValue);
    setStep(2);
    onShowAlert('Impedancia basal registrada', 'success');
  };

  const measureFull = () => {
    if (currentValue === null) {
      onShowAlert('No hay mediciones en vivo.', 'warn');
      return;
    }
    if (currentValue >= zEmpty) {
      onShowAlert('La impedancia actual no es menor a la basal. Verifique que la vejiga esté llena.', 'warn');
      return;
    }
    const db = 20 * Math.log10(currentValue / zEmpty);
    setZFull(currentValue);
    setDbCalc(db);
    onSaveCalibration({ zEmpty, zFull: currentValue, dbThreshold: db });
    setStep(4);
    onShowAlert('Calibración completada', 'success');
  };

  const reset = () => {
    setStep(1); setZEmpty(null); setZFull(null); setDbCalc(null);
  };

  return (
    <section className="surface surface-pad" aria-label="Asistente de calibración">
      <header className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h2>Calibración</h2>
          <span className="section-label" style={{ display: 'block', marginTop: 4 }}>
            Umbral preventivo personalizado por paciente
          </span>
        </div>
      </header>

      <div className="step-rail" aria-hidden="true">
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className={`step-rail-item ${s < step ? 'done' : ''} ${s === step ? 'active' : ''}`}
          />
        ))}
      </div>

      {step === 1 && (
        <div className="step-body">
          <p>
            <strong>Paso 1 · Basal con vejiga vacía.</strong> Solicite al paciente que orine
            completamente. Con los electrodos colocados y el paciente en reposo, registre la
            impedancia de referencia.
          </p>
          <div className="row-between">
            <span className="mute numeric" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
              Z actual: <strong style={{ color: 'var(--type-hi)' }}>{fmtZ(currentValue)}</strong>
            </span>
            <button type="button" className="button button-primary" onClick={measureEmpty} disabled={currentValue === null}>
              Registrar basal <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="step-body">
          <p>
            <strong>Paso 2 · Hidratación.</strong> Indique al paciente que ingiera aproximadamente
            500 ml de líquido. El llenado vesical comenzará a producir caídas progresivas en la
            impedancia. Avance cuando el paciente refiera sensación inicial de llenado.
          </p>
          <div className="row-between">
            <span className="mute numeric" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
              Basal: <strong style={{ color: 'var(--type-hi)' }}>{fmtZ(zEmpty)}</strong>
            </span>
            <button type="button" className="button button-primary" onClick={() => setStep(3)}>
              Continuar <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="step-body">
          <p>
            <strong>Paso 3 · Umbral con vejiga llena.</strong> Cuando el paciente refiera una
            necesidad clara de orinar pero aún tolerable, registre la impedancia mínima como
            límite preventivo.
          </p>
          <div className="row-between">
            <div className="stack-sm" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
              <span className="mute">Basal: <strong style={{ color: 'var(--type-hi)' }}>{fmtZ(zEmpty)}</strong></span>
              <span className="mute">En vivo: <strong style={{ color: 'var(--type-hi)' }}>{fmtZ(currentValue)}</strong></span>
            </div>
            <button type="button" className="button button-danger" onClick={measureFull} disabled={currentValue === null}>
              Registrar umbral
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="step-body">
          <p style={{ color: 'var(--confirm)' }}>
            <strong style={{ color: 'var(--confirm)' }}>Calibración guardada.</strong> El sistema activará
            la alarma cuando la impedancia descienda al nivel registrado o por debajo.
          </p>
          <div className="step-summary">
            <span>Basal vacía</span>
            <strong className="numeric">{fmtZ(zEmpty)}</strong>
            <span>Umbral llena</span>
            <strong className="numeric">{fmtZ(zFull)}</strong>
            <span>Atenuación</span>
            <strong className="numeric">{dbCalc != null ? `${dbCalc.toFixed(2)} dB` : '—'}</strong>
          </div>
          <button type="button" className="button button-ghost" onClick={reset} style={{ alignSelf: 'flex-start' }}>
            <RotateCcw size={14} />
            Recalibrar
          </button>
        </div>
      )}
    </section>
  );
}
