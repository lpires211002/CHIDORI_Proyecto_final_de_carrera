import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { X, FileText, BarChart, FileJson } from 'lucide-react';

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
  onSavePatient
}) {
  const [nombre, setNombre] = useState('');
  const [edad, setEdad] = useState('');
  const [sexo, setSexo] = useState('');
  const [peso, setPeso] = useState('');
  const [altura, setAltura] = useState('');
  const [circ, setCirc] = useState('');
  const [menstruacion, setMenstruacion] = useState('');

  // Auto-sync patient details to database as the user types
  useEffect(() => {
    if (onSavePatient && (nombre || edad || sexo || peso || altura || circ)) {
      onSavePatient({
        nombre,
        edad,
        sexo,
        peso,
        altura,
        circ,
        menstruacion
      });
    }
  }, [nombre, edad, sexo, peso, altura, circ, menstruacion]);

  if (!isOpen) return null;

  const getPatientInfo = () => {
    if (!nombre && !edad && !sexo && !peso && !altura && !circ) {
      return null;
    }
    return {
      nombre: nombre || 'N/A',
      edad: edad || 'N/A',
      sexo: sexo || 'N/A',
      peso: peso || 'N/A',
      altura: altura || 'N/A',
      circ: circ || 'N/A',
      menstruacion: menstruacion || 'N/A'
    };
  };

  // 1. PDF Report Export
  const handleExportPDF = async () => {
    const pdf = new jsPDF();
    const info = getPatientInfo();
    let y = 20;

    // Header
    pdf.setFontSize(20);
    pdf.setTextColor(255, 140, 66); // --accent-orange
    pdf.text('Chidori - Reporte de Bioimpedancia', 20, y);
    y += 10;

    pdf.setFontSize(10);
    pdf.setTextColor(100);
    pdf.text(`Fecha del Reporte: ${new Date().toLocaleString('es-AR')}`, 20, y);
    y += 15;

    // Patient Info Block
    if (info) {
      pdf.setFontSize(14);
      pdf.setTextColor(0);
      pdf.text('Información del Paciente', 20, y);
      y += 8;

      pdf.setFontSize(10);
      pdf.text(`Nombre: ${info.nombre}`, 25, y); y += 6;
      pdf.text(`Edad: ${info.edad} años`, 25, y); y += 6;
      pdf.text(`Sexo: ${info.sexo}`, 25, y); y += 6;
      pdf.text(`Peso: ${info.peso} kg`, 25, y); y += 6;
      pdf.text(`Altura: ${info.altura} m`, 25, y); y += 6;
      pdf.text(`Circunferencia Suprailíaca: ${info.circ} cm`, 25, y); y += 6;
      if (info.sexo === 'Femenino') {
        pdf.text(`Tiempo desde la última menstruación: ${info.menstruacion}`, 25, y); y += 6;
      }
      y += 10;
    }

    // Session Stats Block
    pdf.setFontSize(14);
    pdf.setTextColor(0);
    pdf.text('Estadísticas de la Sesión', 20, y);
    y += 8;

    pdf.setFontSize(10);
    pdf.text(`Valor Inicial: ${initialValue ? initialValue.toFixed(2) : '--'} Ohm`, 25, y); y += 6;
    pdf.text(`Valor Final: ${currentValue ? currentValue.toFixed(2) : '--'} Ohm`, 25, y); y += 6;
    
    if (initialValue && currentValue) {
      const change = currentValue - initialValue;
      const percent = (change / initialValue) * 100;
      pdf.text(`Cambio Total: ${change.toFixed(2)} Ohm (${percent.toFixed(1)}%)`, 25, y); y += 6;
    }
    
    pdf.text(`Duración de la Sesión: ${elapsedTime}`, 25, y); y += 6;
    pdf.text(`Eventos Marcados: ${eventCount}`, 25, y); y += 6;
    pdf.text(`Cantidad de Muestras: ${data.length}`, 25, y); y += 10;

    // Embed main Chart image from global window reference
    if (window.mainChartInstance) {
      try {
        const chartImage = window.mainChartInstance.toBase64Image();
        pdf.addImage(chartImage, 'PNG', 20, y, 170, 80);
        y += 85;
      } catch (error) {
        console.error('Error al incrustar el gráfico en el PDF:', error);
      }
    }

    // List marked events
    if (events && events.length > 0) {
      if (y > 250) {
        pdf.addPage();
        y = 20;
      }

      pdf.setFontSize(14);
      pdf.setTextColor(0);
      pdf.text('Eventos Registrados', 20, y);
      y += 8;

      pdf.setFontSize(9);
      events.forEach((evt) => {
        if (y > 280) {
          pdf.addPage();
          y = 20;
        }
        const mins = Math.floor(evt.time / 60);
        const secs = Math.floor(evt.time % 60);
        const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
        pdf.text(`#${evt.id} - ${timeStr} - Impedancia: ${evt.value.toFixed(2)} Ohm`, 25, y);
        y += 5;
      });
    }

    pdf.save(`reporte_chidori_${new Date().toISOString().slice(0, 10)}.pdf`);
    onShowAlert('Reporte PDF generado exitosamente', 'success');
    onClose();
  };

  // 2. CSV Data Export
  const handleExportCSV = () => {
    let csv = 'Tiempo(s),Impedancia(Ω),Tasa de Cambio(Ω/min)\n';
    
    data.forEach((point, index) => {
      const rate = rateData[index] ? rateData[index].y.toFixed(3) : '0.000';
      csv += `${point.x.toFixed(2)},${point.y.toFixed(3)},${rate}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `datos_chidori_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);

    onShowAlert('Datos exportados en formato CSV', 'success');
    onClose();
  };

  // 3. TXT Plain-Text Export
  const handleExportTXT = () => {
    const info = getPatientInfo();
    let txt = '';

    // Metadata header
    if (info) {
      txt += `=== INFORMACIÓN DEL PACIENTE ===\n`;
      txt += `Nombre: ${info.nombre}\n`;
      txt += `Edad: ${info.edad}\n`;
      txt += `Sexo: ${info.sexo}\n`;
      txt += `Peso: ${info.peso} kg\n`;
      txt += `Altura: ${info.altura} m\n`;
      txt += `Circ. Suprailíaca: ${info.circ} cm\n`;
      if (info.sexo === 'Femenino') {
        txt += `Última menstruación: ${info.menstruacion}\n`;
      }
      txt += '\n';
    }

    // Session statistics
    txt += `=== ESTADÍSTICAS DE LA SESIÓN ===\n`;
    txt += `Fecha: ${new Date().toLocaleString('es-AR')}\n`;
    txt += `Valor Inicial: ${initialValue ? initialValue.toFixed(2) : '--'} Ω\n`;
    txt += `Valor Final: ${currentValue ? currentValue.toFixed(2) : '--'} Ω\n`;
    if (initialValue && currentValue) {
      const change = currentValue - initialValue;
      const percent = (change / initialValue) * 100;
      txt += `Cambio Total: ${change.toFixed(2)} Ω (${percent.toFixed(1)}%)\n`;
    }
    txt += `Duración: ${elapsedTime}\n`;
    txt += `Eventos Marcados: ${eventCount}\n`;
    txt += `Puntos de Datos: ${data.length}\n\n`;

    // Measurement data
    txt += `=== MEDICIONES ===\n`;
    txt += `Tiempo(s)\tImpedancia(Ω)\tTasa(Ω/min)\n`;
    data.forEach((point, index) => {
      const rate = rateData[index] ? rateData[index].y.toFixed(3) : '0.000';
      txt += `${point.x.toFixed(2)}\t${point.y.toFixed(3)}\t${rate}\n`;
    });

    // Event list
    if (events.length) {
      txt += '\n=== EVENTOS REGISTRADOS ===\n';
      events.forEach((evt) => {
        const mins = Math.floor(evt.time / 60);
        const secs = Math.floor(evt.time % 60);
        const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
        txt += `Evento ${evt.id}: ${timeStr} - ${evt.value.toFixed(2)} Ω`;
        if (evt.change !== null) {
          txt += ` (Cambio: ${evt.change > 0 ? '+' : ''}${evt.change.toFixed(2)} Ω)`;
        }
        txt += '\n';
      });
    }

    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mediciones_chidori_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    onShowAlert('Archivo de texto generado exitosamente', 'success');
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Exportar Sesión de Monitoreo</h2>
          <button onClick={onClose} className="modal-close" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        <div className="export-grid">
          <div className="export-card" onClick={handleExportPDF}>
            <span className="export-icon" style={{ color: 'hsl(var(--accent-orange))' }}>📄</span>
            <span className="export-name">Reporte PDF</span>
            <span className="export-desc">Incluye datos del paciente y gráficos</span>
          </div>

          <div className="export-card" onClick={handleExportCSV}>
            <span className="export-icon" style={{ color: 'hsl(var(--accent-cyan))' }}>📊</span>
            <span className="export-name">Datos CSV</span>
            <span className="export-desc">Formato compatible con Excel</span>
          </div>

          <div className="export-card" onClick={handleExportTXT}>
            <span className="export-icon" style={{ color: 'hsl(var(--accent-purple))' }}>📝</span>
            <span className="export-name">Archivo TXT</span>
            <span className="export-desc">Datos estructurados en texto plano</span>
          </div>
        </div>

        <div className="modal-divider">
          <span>Información del Paciente (Opcional)</span>
        </div>

        <form className="modal-form" onSubmit={(e) => e.preventDefault()}>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="nombre">Nombre Completo</label>
              <input 
                type="text" 
                id="nombre" 
                className="input-field"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="edad">Edad (años)</label>
              <input 
                type="number" 
                id="edad" 
                className="input-field"
                value={edad}
                onChange={(e) => setEdad(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Sexo</label>
            <div className="radio-group">
              <label className="radio-row">
                <input 
                  type="radio" 
                  name="sexo" 
                  value="Masculino" 
                  checked={sexo === 'Masculino'}
                  onChange={() => setSexo('Masculino')}
                  style={{ display: 'none' }}
                />
                <span className="custom-radio"></span>
                <span>Masculino</span>
              </label>

              <label className="radio-row">
                <input 
                  type="radio" 
                  name="sexo" 
                  value="Femenino"
                  checked={sexo === 'Femenino'}
                  onChange={() => setSexo('Femenino')}
                  style={{ display: 'none' }}
                />
                <span className="custom-radio"></span>
                <span>Femenino</span>
              </label>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="peso">Peso (kg)</label>
              <input 
                type="number" 
                id="peso" 
                step="0.1"
                className="input-field"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="altura">Altura (m)</label>
              <input 
                type="number" 
                id="altura" 
                step="0.01"
                className="input-field"
                value={altura}
                onChange={(e) => setAltura(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="circSuprailica">Circunferencia Suprailíaca (cm)</label>
            <input 
              type="number" 
              id="circSuprailica" 
              step="0.1"
              className="input-field"
              value={circ}
              onChange={(e) => setCirc(e.target.value)}
            />
          </div>

          {sexo === 'Femenino' && (
            <div className="form-group" style={{ animation: 'fadeIn 0.3s ease-out' }}>
              <label htmlFor="tiempoMenstruacion">Tiempo desde la última menstruación</label>
              <input 
                type="text" 
                id="tiempoMenstruacion" 
                placeholder="Ej. 15 días"
                className="input-field"
                value={menstruacion}
                onChange={(e) => setMenstruacion(e.target.value)}
              />
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
