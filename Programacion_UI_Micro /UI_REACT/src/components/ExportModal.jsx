import React, { useState } from 'react';
import { jsPDF } from 'jspdf';
import { X, FileText, Table, FileType2 } from 'lucide-react';

/**
 * Export modal · PDF / CSV / TXT.
 *
 * Key changes vs the prior version:
 *  · Patient data is NO LONGER auto-synced on every keystroke. It is sent
 *    once when the user clicks "Guardar paciente" or proceeds to export.
 *  · PDF header uses neutral ink, not brand orange.
 *  · Microcopy reviewed for clinical tone.
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
  // Controla si los exports también persisten en Supabase. Default true.
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

  const savePatient = () => {
    if (!saveToDb) return; // checkbox desactivado: export solo local
    if (!onSavePatient) return;
    onSavePatient({ nombre, edad, sexo, peso, altura, circ, menstruacion });
    onShowAlert('Datos del paciente guardados en la nube', 'success');
  };

  const handleExportPDF = async () => {
    savePatient();
    const pdf = new jsPDF();
    const info = buildPatient();
    let y = 22;

    pdf.setFontSize(18);
    pdf.setTextColor(30);
    pdf.text('Chidori · Reporte de sesión', 20, y);
    y += 8;
    pdf.setFontSize(9);
    pdf.setTextColor(110);
    pdf.text(`Generado · ${new Date().toLocaleString('es-AR')}`, 20, y);
    y += 14;

    if (info) {
      pdf.setFontSize(12);
      pdf.setTextColor(30);
      pdf.text('Paciente', 20, y); y += 6;
      pdf.setFontSize(9.5);
      pdf.setTextColor(70);
      pdf.text(`Nombre: ${info.nombre}`, 22, y); y += 5;
      pdf.text(`Edad: ${info.edad} años`, 22, y); y += 5;
      pdf.text(`Sexo: ${info.sexo}`, 22, y); y += 5;
      pdf.text(`Peso: ${info.peso} kg · Altura: ${info.altura} m`, 22, y); y += 5;
      pdf.text(`Circunferencia suprailíaca: ${info.circ} cm`, 22, y); y += 5;
      if (info.sexo === 'Femenino') {
        pdf.text(`Última menstruación: ${info.menstruacion}`, 22, y); y += 5;
      }
      y += 6;
    }

    pdf.setFontSize(12);
    pdf.setTextColor(30);
    pdf.text('Sesión', 20, y); y += 6;
    pdf.setFontSize(9.5);
    pdf.setTextColor(70);
    pdf.text(`Z basal: ${initialValue ? initialValue.toFixed(2) : '—'} Ω`, 22, y); y += 5;
    pdf.text(`Z final: ${currentValue ? currentValue.toFixed(2) : '—'} Ω`, 22, y); y += 5;
    if (initialValue && currentValue) {
      const change = currentValue - initialValue;
      const percent = (change / initialValue) * 100;
      pdf.text(`Cambio total: ${change.toFixed(2)} Ω (${percent.toFixed(1)}%)`, 22, y); y += 5;
    }
    pdf.text(`Duración: ${elapsedTime}`, 22, y); y += 5;
    pdf.text(`Eventos marcados: ${eventCount}`, 22, y); y += 5;
    pdf.text(`Puntos registrados: ${data.length}`, 22, y); y += 10;

    if (window.mainChartInstance) {
      try {
        const img = window.mainChartInstance.toBase64Image();
        pdf.addImage(img, 'PNG', 20, y, 170, 80);
        y += 86;
      } catch (e) {
        console.error('Embed chart failed', e);
      }
    }

    if (events && events.length > 0) {
      if (y > 250) { pdf.addPage(); y = 20; }
      pdf.setFontSize(12);
      pdf.setTextColor(30);
      pdf.text('Eventos', 20, y); y += 6;
      pdf.setFontSize(9);
      pdf.setTextColor(70);
      events.forEach((evt) => {
        if (y > 280) { pdf.addPage(); y = 20; }
        const m = Math.floor(evt.time / 60);
        const s = Math.floor(evt.time % 60);
        pdf.text(`#${String(evt.id).padStart(2, '0')} · ${m}:${String(s).padStart(2, '0')} · ${evt.value.toFixed(2)} Ω`, 22, y);
        y += 5;
      });
    }

    pdf.save(`chidori_reporte_${new Date().toISOString().slice(0, 10)}.pdf`);
    onShowAlert('Reporte PDF generado', 'success');
    onClose();
  };

  const handleExportCSV = () => {
    savePatient();
    let csv = 'tiempo_s,impedancia_ohm,tasa_ohm_min\n';
    data.forEach((p, i) => {
      const r = rateData[i] ? rateData[i].y.toFixed(3) : '0.000';
      csv += `${p.x.toFixed(2)},${p.y.toFixed(3)},${r}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `chidori_datos_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    onShowAlert('Datos exportados en CSV', 'success');
    onClose();
  };

  const handleExportTXT = () => {
    savePatient();
    const info = buildPatient();
    let txt = '';
    if (info) {
      txt += '=== PACIENTE ===\n';
      txt += `Nombre: ${info.nombre}\nEdad: ${info.edad}\nSexo: ${info.sexo}\n`;
      txt += `Peso: ${info.peso} kg\nAltura: ${info.altura} m\n`;
      txt += `Circ. suprailíaca: ${info.circ} cm\n`;
      if (info.sexo === 'Femenino') txt += `Última menstruación: ${info.menstruacion}\n`;
      txt += '\n';
    }
    txt += '=== SESIÓN ===\n';
    txt += `Fecha: ${new Date().toLocaleString('es-AR')}\n`;
    txt += `Z basal: ${initialValue ? initialValue.toFixed(2) : '—'} Ω\n`;
    txt += `Z final: ${currentValue ? currentValue.toFixed(2) : '—'} Ω\n`;
    if (initialValue && currentValue) {
      const c = currentValue - initialValue;
      const p = (c / initialValue) * 100;
      txt += `Cambio total: ${c.toFixed(2)} Ω (${p.toFixed(1)}%)\n`;
    }
    txt += `Duración: ${elapsedTime}\nEventos: ${eventCount}\nPuntos: ${data.length}\n\n`;
    txt += '=== MEDICIONES ===\ntiempo_s\timpedancia_ohm\ttasa_ohm_min\n';
    data.forEach((p, i) => {
      const r = rateData[i] ? rateData[i].y.toFixed(3) : '0.000';
      txt += `${p.x.toFixed(2)}\t${p.y.toFixed(3)}\t${r}\n`;
    });
    if (events.length) {
      txt += '\n=== EVENTOS ===\n';
      events.forEach((e) => {
        const m = Math.floor(e.time / 60);
        const s = Math.floor(e.time % 60);
        txt += `#${e.id} · ${m}:${String(s).padStart(2, '0')} · ${e.value.toFixed(2)} Ω`;
        if (e.change != null) txt += ` · Δ ${e.change > 0 ? '+' : ''}${e.change.toFixed(2)} Ω`;
        txt += '\n';
      });
    }
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chidori_mediciones_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
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
              {data.length} puntos · {events.length} eventos
            </span>
          </div>

          {/* Toggle · guardar en la nube */}
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
              <input
                type="checkbox"
                checked={saveToDb}
                onChange={(e) => setSaveToDb(e.target.checked)}
              />
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
