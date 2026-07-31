import React, { useEffect, useMemo, useState } from 'react';
import { X, FileText, Table, FileType2 } from 'lucide-react';
import { exportPDF, exportCSV, exportTXT } from '../lib/exporters';
import DynamicFields from './DynamicFields';
import { fetchFields, patientLabel, coerceValues } from '../lib/patients';
import { renderChartPNG } from '../lib/chartImage';

/**
 * Cierre de la sesión · PDF / CSV / TXT + guardado en la nube.
 *
 * Acá se completan los datos de la sesión, no al empezar: la temperatura, la
 * humedad, lo que comió y sobre todo el AGUA recién se conocen al terminar.
 * El agua se precarga sumando las tomas marcadas como eventos durante la
 * medición, y se puede corregir a mano.
 *
 * Los campos que aparecen salen del catálogo configurable (ámbito 'session'),
 * así que se ajustan desde el panel de administración sin tocar este archivo.
 * Los datos estables de la persona viven en su ficha de paciente.
 */
export default function ExportModal({
  isOpen,
  onClose,
  supabase,
  patient,
  data,
  rateData,
  events,
  initialValue,
  currentValue,
  elapsedTime,
  eventCount,
  onShowAlert,
  onSavePatient,
}) {
  const [notas, setNotas]           = useState('');
  const [sessionFields, setFields]  = useState([]);
  const [sessionVals, setSessionVals] = useState({});
  const [saveToDb, setSaveToDb]     = useState(true);
  const [committing, setCommitting] = useState(false);

  // Agua total sumada de los eventos de ingesta marcados durante la sesión
  const waterEvents = useMemo(
    () => (events || []).filter((e) => e.kind === 'water' && Number.isFinite(Number(e.amount))),
    [events]);
  const waterFromEvents = useMemo(
    () => waterEvents.reduce((acc, e) => acc + Number(e.amount), 0),
    [waterEvents]);
  const waterCount = waterEvents.length;

  // Catálogo de campos + precarga del agua
  useEffect(() => {
    if (!isOpen || !supabase) return;
    let alive = true;
    (async () => {
      try {
        const all = await fetchFields(supabase);
        if (!alive) return;
        const ses = all.filter((f) => f.scope === 'session');
        setFields(ses);
        // Si hay un campo de agua y tomas marcadas, lo dejamos precargado
        const waterField = ses.find((f) => /water|agua/i.test(f.key));
        if (waterField && waterFromEvents > 0) {
          setSessionVals((prev) => ({ ...prev, [waterField.key]: prev[waterField.key] ?? waterFromEvents }));
        }
      } catch (e) {
        console.error('[ExportModal] fetchFields', e);
      }
    })();
    return () => { alive = false; };
  }, [isOpen, supabase, waterFromEvents]);

  if (!isOpen) return null;

  const buildPatient = () => {
    const vals = coerceValues(sessionFields, sessionVals);
    if (!patient && Object.keys(vals).length === 0 && !notas) return null;
    return {
      // Identificación (del paciente asociado)
      codigo:  patient?.code || 'N/A',
      nombre:  patient ? [patient.last_name, patient.first_name].filter(Boolean).join(', ') || 'N/A' : 'N/A',
      notas:   notas || '',
      // Campos dinámicos de la sesión, con su etiqueta para los reportes
      campos:  sessionFields
        .filter((f) => vals[f.key] !== undefined)
        .map((f) => ({ label: f.label, unit: f.unit, value: vals[f.key] })),
      // Valores crudos para la base
      sessionData: vals,
    };
  };

  const buildMeasurements = () => (data || []).map((p, i) => ({
    elapsed_time: p.x,
    impedance:    p.y,
    rate:         rateData?.[i]?.y ?? 0,
  }));

  const buildStats = () => ({
    initialZ:   initialValue,
    finalZ:     currentValue,
    elapsedStr: elapsedTime,
    eventCount,
    samples:    (data || []).length,
  });

  // El gráfico del PDF se rinde aparte, en paleta clara: el canvas en pantalla
  // es transparente y de tema oscuro, así que sobre la hoja blanca del reporte
  // quedaban la grilla y los ejes invisibles.
  const getChartImage = () => {
    try {
      return renderChartPNG({ measurements: data, events })
        || window.mainChartInstance?.toBase64Image()
        || null;
    } catch { return null; }
  };

  /**
   * Guardado en la nube · best-effort y en SEGUNDO PLANO. Nunca bloquea ni
   * aborta el export local: el archivo se descarga SIEMPRE. Si no hay internet
   * (modo AP), Dashboard muestra su aviso y el archivo local ya quedó guardado.
   */
  const fireCloudSave = () => {
    if (!saveToDb || !onSavePatient) return;
    Promise.resolve(
      onSavePatient({ notas, sessionData: coerceValues(sessionFields, sessionVals) })
    ).catch(() => { /* Dashboard ya togglea su propio toast de error */ });
  };

  const handleExportPDF = () => {
    exportPDF({
      patient:      buildPatient(),
      stats:        buildStats(),
      measurements: buildMeasurements(),
      events,
      chartImage:   getChartImage(),
    });
    onShowAlert('Reporte PDF generado', 'success');
    fireCloudSave();
    onClose();
  };

  const handleExportCSV = () => {
    exportCSV({ measurements: buildMeasurements() });
    onShowAlert('Datos exportados en CSV', 'success');
    fireCloudSave();
    onClose();
  };

  const handleExportTXT = () => {
    exportTXT({
      patient:      buildPatient(),
      stats:        buildStats(),
      measurements: buildMeasurements(),
      events,
    });
    onShowAlert('Archivo de texto generado', 'success');
    fireCloudSave();
    onClose();
  };

  const handleSavePatientOnly = () => {
    fireCloudSave();
    onShowAlert('Guardando en la nube… si no hay internet, usá un export local', 'info');
    onClose();
  };

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal-card modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Exportar sesión</h3>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <span className="section-label" style={{ display: 'block', marginBottom: 12 }}>
            Formato del reporte
          </span>
          <div className="readout" style={{ marginBottom: 24 }}>
            <button type="button" className="readout-cell" onClick={handleExportPDF} disabled={committing} style={{ cursor: committing ? 'progress' : 'pointer', textAlign: 'left', border: 0 }}>
              <span className="readout-label"><FileText size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />PDF</span>
              <span className="readout-value" style={{ fontSize: 'var(--t-lg)' }}>Reporte clínico</span>
              <span className="mute" style={{ fontSize: 'var(--t-xs)' }}>Paciente + estadísticas + curva embebida</span>
            </button>
            <button type="button" className="readout-cell" onClick={handleExportCSV} disabled={committing} style={{ cursor: committing ? 'progress' : 'pointer', textAlign: 'left', border: 0 }}>
              <span className="readout-label"><Table size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />CSV</span>
              <span className="readout-value" style={{ fontSize: 'var(--t-lg)' }}>Datos crudos</span>
              <span className="mute" style={{ fontSize: 'var(--t-xs)' }}>Compatible con Excel / Pandas</span>
            </button>
            <button type="button" className="readout-cell" onClick={handleExportTXT} disabled={committing} style={{ cursor: committing ? 'progress' : 'pointer', textAlign: 'left', border: 0 }}>
              <span className="readout-label"><FileType2 size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />TXT</span>
              <span className="readout-value" style={{ fontSize: 'var(--t-lg)' }}>Texto plano</span>
              <span className="mute" style={{ fontSize: 'var(--t-xs)' }}>Encabezado + tabla legible</span>
            </button>
            <span className="readout-cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--type-mute)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
              {committing
                ? 'Guardando en la nube…'
                : `${(data || []).length} puntos · ${(events || []).length} eventos`}
            </span>
          </div>

          {/* Toggle: guardar en la nube */}
          <div
            className="surface"
            style={{
              padding: '14px 18px',
              marginBottom: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div>
              <div style={{ color: 'var(--type-hi)', fontSize: 'var(--t-sm)', fontWeight: 500 }}>
                Guardar en la base de datos
              </div>
              <div className="mute" style={{ fontSize: 'var(--t-xs)', marginTop: 2, lineHeight: 1.5 }}>
                {saveToDb
                  ? 'Los datos del paciente se persisten en Supabase junto con la sesión y las mediciones.'
                  : 'Solo se exporta el archivo local. La sesión queda en Supabase como “sin identificar”.'}
              </div>
            </div>
            <label className="switch" title="Guardar datos del paciente en la nube">
              <input type="checkbox" checked={saveToDb} onChange={(e) => setSaveToDb(e.target.checked)} />
              <span className="switch-track" />
            </label>
          </div>

          <span className="section-label" style={{ display: 'block', marginBottom: 12 }}>
            Datos de esta sesión
          </span>

          <form onSubmit={(e) => { e.preventDefault(); handleSavePatientOnly(); }} className="stack-md">
            {/* Paciente asociado · viene del paso previo a la medición */}
            <div className="step-summary" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <span>Paciente</span>
              <span>Duración</span>
              <strong>{patient ? patientLabel(patient) : 'Sin asociar'}</strong>
              <strong className="numeric">{elapsedTime || '—'}</strong>
            </div>

            {!patient && (
              <span className="field-hint">
                Esta sesión no quedó asociada a ningún paciente. Se guarda igual, pero
                no va a agruparse con las demás mediciones de esa persona.
              </span>
            )}

            {/* Campos definidos en el panel de administración (ámbito sesión) */}
            <DynamicFields
              fields={sessionFields}
              values={sessionVals}
              onChange={(k, v) => setSessionVals((prev) => ({ ...prev, [k]: v }))}
              columns={3}
            />

            {waterFromEvents > 0 && (
              <span className="field-hint">
                Se sumaron <strong>{waterFromEvents} ml</strong> de las {waterCount} tomas
                marcadas durante la sesión. Podés corregir el total a mano.
              </span>
            )}

            {/* Observaciones libres · particularidades de esta sesión */}
            <div className="field">
              <label className="field-label" htmlFor="ex-notas">Notas de la sesión</label>
              <textarea
                id="ex-notas"
                className="input"
                rows={4}
                placeholder="Particularidades de la medición: posición del paciente, incidencias, cambios de electrodos, observaciones clínicas…"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                style={{ resize: 'vertical', minHeight: 84, lineHeight: 1.5, fontFamily: 'inherit' }}
              />
              <span className="field-hint">
                Se incluyen en el reporte PDF, en el TXT y se guardan con la sesión.
              </span>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="submit"
                className="button button-ghost"
                disabled={!saveToDb || committing}
                title={saveToDb ? 'Persistir datos del paciente en la nube' : 'Activá “Guardar en la base de datos” para habilitar'}
              >
                {committing ? 'Guardando…' : 'Guardar paciente'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
