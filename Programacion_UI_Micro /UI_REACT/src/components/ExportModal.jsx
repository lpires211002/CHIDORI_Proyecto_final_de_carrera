import React, { useState } from 'react';
import { X, FileText, Table, FileType2 } from 'lucide-react';
import { exportPDF, exportCSV, exportTXT } from '../lib/exporters';

/**
 * Export modal · PDF / CSV / TXT.
 *
 * Usa los helpers puros en lib/exporters.js, compartidos con el AdminView.
 * El toggle "Guardar en la base de datos" controla si los exports también
 * persisten los datos del paciente en Supabase (por defecto sí).
 */
export default function ExportModal({
  isOpen,
  onClose,
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
  const [nombre, setNombre]             = useState('');
  const [edad, setEdad]                 = useState('');
  const [sexo, setSexo]                 = useState('');
  const [peso, setPeso]                 = useState('');
  const [altura, setAltura]             = useState('');
  const [circ, setCirc]                 = useState('');
  const [menstruacion, setMenstruacion] = useState('');
  const [saveToDb, setSaveToDb]         = useState(true);

  if (!isOpen) return null;

  const buildPatient = () => {
    if (!(nombre || edad || sexo || peso || altura || circ)) return null;
    return {
      nombre:        nombre || 'N/A',
      edad:          edad || 'N/A',
      sexo:          sexo || 'N/A',
      peso:          peso || 'N/A',
      altura:        altura || 'N/A',
      circ:          circ || 'N/A',
      menstruacion:  menstruacion || 'N/A',
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

  const getChartImage = () => {
    try { return window.mainChartInstance?.toBase64Image() || null; }
    catch { return null; }
  };

  const savePatient = () => {
    if (!saveToDb) return;
    if (!onSavePatient) return;
    onSavePatient({ nombre, edad, sexo, peso, altura, circ, menstruacion });
    onShowAlert('Datos del paciente guardados en la nube', 'success');
  };

  const handleExportPDF = () => {
    savePatient();
    exportPDF({
      patient:      buildPatient(),
      stats:        buildStats(),
      measurements: buildMeasurements(),
      events,
      chartImage:   getChartImage(),
    });
    onShowAlert('Reporte PDF generado', 'success');
    onClose();
  };

  const handleExportCSV = () => {
    savePatient();
    exportCSV({ measurements: buildMeasurements() });
    onShowAlert('Datos exportados en CSV', 'success');
    onClose();
  };

  const handleExportTXT = () => {
    savePatient();
    exportTXT({
      patient:      buildPatient(),
      stats:        buildStats(),
      measurements: buildMeasurements(),
      events,
    });
    onShowAlert('Archivo de texto generado', 'success');
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
            <button type="button" className="readout-cell" onClick={handleExportPDF} style={{ cursor: 'pointer', textAlign: 'left', border: 0 }}>
              <span className="readout-label"><FileText size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />PDF</span>
              <span className="readout-value" style={{ fontSize: 'var(--t-lg)' }}>Reporte clínico</span>
              <span className="mute" style={{ fontSize: 'var(--t-xs)' }}>Paciente + estadísticas + curva embebida</span>
            </button>
            <button type="button" className="readout-cell" onClick={handleExportCSV} style={{ cursor: 'pointer', textAlign: 'left', border: 0 }}>
              <span className="readout-label"><Table size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />CSV</span>
              <span className="readout-value" style={{ fontSize: 'var(--t-lg)' }}>Datos crudos</span>
              <span className="mute" style={{ fontSize: 'var(--t-xs)' }}>Compatible con Excel / Pandas</span>
            </button>
            <button type="button" className="readout-cell" onClick={handleExportTXT} style={{ cursor: 'pointer', textAlign: 'left', border: 0 }}>
              <span className="readout-label"><FileType2 size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />TXT</span>
              <span className="readout-value" style={{ fontSize: 'var(--t-lg)' }}>Texto plano</span>
              <span className="mute" style={{ fontSize: 'var(--t-xs)' }}>Encabezado + tabla legible</span>
            </button>
            <span className="readout-cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--type-mute)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
              {(data || []).length} puntos · {(events || []).length} eventos
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
            Información clínica del paciente (opcional)
          </span>

          <form onSubmit={(e) => { e.preventDefault(); savePatient(); }} className="stack-md">
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
              <div className="field">
                <label className="field-label" htmlFor="ex-nombre">Nombre</label>
                <input id="ex-nombre" className="input" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="ex-edad">Edad</label>
                <input id="ex-edad" className="input" type="number" value={edad} onChange={(e) => setEdad(e.target.value)} placeholder="años" />
              </div>
            </div>

            <div className="field">
              <span className="field-label">Sexo</span>
              <div className="segment">
                {['Femenino', 'Masculino', 'Otro / Prefiero no decirlo'].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`segment-item ${sexo === opt ? 'active' : ''}`}
                    onClick={() => setSexo(opt)}
                  >
                    {opt.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <div className="field">
                <label className="field-label" htmlFor="ex-peso">Peso (kg)</label>
                <input id="ex-peso" className="input" type="number" step="0.1" value={peso} onChange={(e) => setPeso(e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="ex-altura">Altura (m)</label>
                <input id="ex-altura" className="input" type="number" step="0.01" value={altura} onChange={(e) => setAltura(e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="ex-circ">Circ. suprailíaca (cm)</label>
                <input id="ex-circ" className="input" type="number" step="0.1" value={circ} onChange={(e) => setCirc(e.target.value)} />
              </div>
            </div>

            {sexo === 'Femenino' && (
              <div className="field">
                <label className="field-label" htmlFor="ex-menst">Tiempo desde la última menstruación</label>
                <input id="ex-menst" className="input" type="text" placeholder="p.ej. 15 días" value={menstruacion} onChange={(e) => setMenstruacion(e.target.value)} />
              </div>
            )}

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="submit"
                className="button button-ghost"
                disabled={!saveToDb}
                title={saveToDb ? 'Persistir datos del paciente en la nube' : 'Activá “Guardar en la base de datos” para habilitar'}
              >
                Guardar paciente
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
