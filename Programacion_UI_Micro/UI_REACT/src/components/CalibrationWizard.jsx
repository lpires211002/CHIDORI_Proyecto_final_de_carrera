import React, { useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';

/**
 * Calibration wizard · 4 steps. Progress rail uses transform: scaleX
 * (no width transitions). Copy is clinical, without emojis.
 */
export default function CalibrationWizard({
  currentValue,
  onSaveCalibration,
  onShowAlert,
  // Basal EN USO (fuente de verdad para el cambio y la alarma) + acciones para
  // re-fijarlo sin repetir todo el asistente.
  activeBaseline = null,
  onSetBaselineNow,
  onSetBaselineManual,
  baselineCandidate = null,
}) {
  const [step, setStep] = useState(1);
  const [manualBaseline, setManualBaseline] = useState('');
  const [zEmpty, setZEmpty] = useState(null);
  const [zFull, setZFull]   = useState(null);
  const [dbCalc, setDbCalc] = useState(null);

  const fmtZ = (v) => (v == null ? '—' : `${v.toFixed(1)} Ω`);

  /** Avanza usando el basal YA fijado (manual o de una calibración previa),
   *  sin sobrescribirlo con la lectura del momento. */
  const keepBaseline = () => {
    setZEmpty(activeBaseline);
    setStep(2);
  };

  const measureEmpty = () => {
    if (currentValue === null) {
      onShowAlert('No hay mediciones en vivo. Conectá el dispositivo o activá el simulador.', 'warn');
      return;
    }
    setZEmpty(currentValue);
    // Se aplica YA como basal activo: así el asistente y la franja de abajo
    // muestran siempre el mismo número (antes el wizard lo retenía hasta el
    // paso 4 y convivían dos valores distintos).
    onSetBaselineManual?.(String(currentValue));
    setStep(2);
  };

  const measureFull = () => {
    if (currentValue === null) {
      onShowAlert('No hay mediciones en vivo.', 'warn');
      return;
    }
    if (currentValue >= zEmpty) {
      onShowAlert('La impedancia actual no es menor que la basal. Verificá que la vejiga esté llena.', 'warn');
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
      <h2 className="panel-title" title="Umbral preventivo personalizado para este paciente">Calibración</h2>

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
            <strong>Basal con vejiga vacía.</strong> Pedile que orine y quede en reposo;
            después registrá la impedancia.
          </p>

          <div className="row-between">
            <span className="mute numeric" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
              Z actual: <strong style={{ color: 'var(--type-hi)' }}>{fmtZ(currentValue)}</strong>
            </span>

            <div className="row" style={{ gap: 8 }}>
              {/* Si ya hay basal (p. ej. cargado a mano), NO lo pisamos sin que
                  el usuario lo pida explícitamente. */}
              {activeBaseline != null && (
                <button type="button" className="button" onClick={keepBaseline}>
                  Continuar con {activeBaseline.toFixed(2)} Ω <ArrowRight size={14} />
                </button>
              )}
              <button
                type="button"
                className={activeBaseline != null ? 'button button-ghost' : 'button'}
                onClick={measureEmpty}
                disabled={currentValue === null}
              >
                {activeBaseline != null ? 'Registrar de nuevo' : 'Registrar basal'}
                {activeBaseline == null && <ArrowRight size={14} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="step-body">
          <p>
            <strong>Hidratación libre.</strong> Registrá cada toma con <span className="kbd">A</span> y
            cada micción con <span className="kbd">M</span>. Seguí cuando refiera las primeras ganas.
          </p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="button" onClick={() => setStep(3)}>
              Continuar <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="step-body">
          <p>
            <strong>Vejiga llena.</strong> Cuando la necesidad sea clara pero tolerable, registrá
            el umbral.
          </p>
          <div className="row-between">
            <div className="stack-sm" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
              <span className="mute">En vivo: <strong style={{ color: 'var(--type-hi)' }}>{fmtZ(currentValue)}</strong></span>
            </div>
            <button type="button" className="button" onClick={measureFull} disabled={currentValue === null}>
              Registrar umbral
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="step-body">
          <p style={{ color: 'var(--confirm)' }}>
            <strong style={{ color: 'var(--confirm)' }}>Calibración guardada.</strong> La alarma se
            activa al llegar a ese valor.
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

      {/* ── Basal activo · re-fijar sin repetir el asistente ──────────────
          Es el valor que realmente usan el cálculo de cambio y la alarma. */}
      <div className="baseline-strip">
        <div className="baseline-strip-head">
          <span className="section-label">Basal activo</span>
          <strong className="numeric baseline-strip-value">
            {activeBaseline != null ? `${activeBaseline.toFixed(2)} Ω` : 'sin fijar'}
          </strong>
        </div>

        <div className="baseline-strip-actions">
          <button
            type="button"
            className="button button-ghost button-sm"
            onClick={() => { onSetBaselineNow?.(); setManualBaseline(''); }}
            disabled={baselineCandidate == null}
            title="Si el paciente se acomodó después de calibrar. Usa la mediana de las últimas lecturas, así un pico de ruido no queda como referencia."
          >
            Re-fijar con la lectura actual
          </button>

          <div className="baseline-strip-manual">
            <input
              className="input input-xs numeric"
              type="number"
              step="0.01"
              min="0"
              placeholder="Ω exacto"
              value={manualBaseline}
              onChange={(e) => setManualBaseline(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (onSetBaselineManual?.(manualBaseline)) setManualBaseline('');
                }
              }}
              aria-label="Valor de basal exacto en ohmios"
            />
            <button
              type="button"
              className="button button-ghost button-sm"
              onClick={() => { if (onSetBaselineManual?.(manualBaseline)) setManualBaseline(''); }}
              disabled={manualBaseline.trim() === ''}
            >
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
