import { jsPDF } from 'jspdf';

/**
 * Funciones puras de exportación. Las usan tanto ExportModal (clínico)
 * como SessionDetailModal del AdminView. Cada función produce un archivo
 * descargable y NO toca la base de datos.
 *
 *   exportPDF({ filename, patient, stats, measurements, events, chartImage })
 *   exportCSV({ filename, measurements })
 *   exportTXT({ filename, patient, stats, measurements, events })
 *
 *  - patient: { nombre, edad, sexo, peso, altura, circ, menstruacion } o null
 *  - stats:   { initialZ, finalZ, elapsedStr, eventCount, samples }
 *  - measurements: [{ elapsed_time | x, impedance | y, rate?: number }]
 *  - events: [{ id | event_number, time | elapsed_time, value | impedance, change | impedance_change }]
 *  - chartImage: dataURL PNG opcional (solo aplica a PDF)
 */

const ts = () => new Date().toISOString().slice(0, 10);

function normMeasurements(rows) {
  return (rows || []).map((r) => ({
    t:    r.elapsed_time ?? r.x ?? 0,
    z:    r.impedance    ?? r.y ?? 0,
    rate: r.rate         ?? 0,
  }));
}

function normEvents(rows) {
  return (rows || []).map((e) => ({
    id:     e.event_number ?? e.id,
    time:   e.elapsed_time ?? e.time,
    value:  e.impedance    ?? e.value,
    change: e.impedance_change ?? e.change ?? null,
    kind:   e.kind ?? 'mark',
  }));
}

/** Etiqueta legible para los eventos automáticos de enlace. */
function eventLabel(kind) {
  if (kind === 'disconnect') return 'DESCONEXION del dispositivo';
  if (kind === 'reconnect')  return 'RECONEXION del dispositivo';
  return null;
}

function formatMmSs(secs) {
  const m = Math.floor((secs || 0) / 60);
  const s = Math.floor((secs || 0) % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ──────────────────────────────────────────────────────────────────── */

export function exportPDF({
  filename = `chidori_reporte_${ts()}.pdf`,
  patient,
  stats,
  measurements,
  events,
  chartImage,
} = {}) {
  const pdf = new jsPDF();
  const meas = normMeasurements(measurements);
  const evs  = normEvents(events);
  let y = 22;

  pdf.setFontSize(18);
  pdf.setTextColor(30);
  pdf.text('Chidori · Reporte de sesión', 20, y);
  y += 8;
  pdf.setFontSize(9);
  pdf.setTextColor(110);
  pdf.text(`Generado · ${new Date().toLocaleString('es-AR')}`, 20, y);
  y += 14;

  if (patient) {
    pdf.setFontSize(12); pdf.setTextColor(30); pdf.text('Paciente', 20, y); y += 6;
    pdf.setFontSize(9.5); pdf.setTextColor(70);
    pdf.text(`Nombre: ${patient.nombre || 'N/A'}`, 22, y); y += 5;
    pdf.text(`Edad: ${patient.edad || 'N/A'} años`, 22, y); y += 5;
    pdf.text(`Sexo: ${patient.sexo || 'N/A'}`, 22, y); y += 5;
    pdf.text(`Peso: ${patient.peso || 'N/A'} kg · Altura: ${patient.altura || 'N/A'} m`, 22, y); y += 5;
    pdf.text(`Circunferencia suprailíaca: ${patient.circ || 'N/A'} cm`, 22, y); y += 5;
    if (patient.sexo === 'Femenino' && patient.menstruacion) {
      pdf.text(`Última menstruación: ${patient.menstruacion}`, 22, y); y += 5;
    }
    y += 6;
  }

  pdf.setFontSize(12); pdf.setTextColor(30); pdf.text('Sesión', 20, y); y += 6;
  pdf.setFontSize(9.5); pdf.setTextColor(70);
  pdf.text(`Z basal: ${stats?.initialZ != null ? Number(stats.initialZ).toFixed(2) : '—'} Ω`, 22, y); y += 5;
  pdf.text(`Z final: ${stats?.finalZ   != null ? Number(stats.finalZ).toFixed(2)   : '—'} Ω`, 22, y); y += 5;
  if (stats?.initialZ != null && stats?.finalZ != null) {
    const change = stats.finalZ - stats.initialZ;
    const pct = (change / stats.initialZ) * 100;
    pdf.text(`Cambio total: ${change.toFixed(2)} Ω (${pct.toFixed(1)}%)`, 22, y); y += 5;
  }
  pdf.text(`Duración: ${stats?.elapsedStr || '—'}`, 22, y); y += 5;
  pdf.text(`Eventos marcados: ${stats?.eventCount ?? evs.length}`, 22, y); y += 5;
  pdf.text(`Puntos registrados: ${stats?.samples ?? meas.length}`, 22, y); y += 10;

  if (chartImage) {
    try {
      pdf.addImage(chartImage, 'PNG', 20, y, 170, 80);
      y += 86;
    } catch { /* noop */ }
  }

  if (evs.length > 0) {
    if (y > 250) { pdf.addPage(); y = 20; }
    pdf.setFontSize(12); pdf.setTextColor(30); pdf.text('Eventos', 20, y); y += 6;
    pdf.setFontSize(9); pdf.setTextColor(70);
    evs.forEach((e) => {
      if (y > 280) { pdf.addPage(); y = 20; }
      const label = eventLabel(e.kind);
      if (label) {
        // Eventos de enlace: resaltados en rojo/verde, sin valor de impedancia.
        if (e.kind === 'disconnect') pdf.setTextColor(200, 40, 40);
        else                          pdf.setTextColor(30, 130, 80);
        pdf.text(`#${String(e.id).padStart(2, '0')} · ${formatMmSs(e.time)} · ${label}`, 22, y);
        pdf.setTextColor(70);
      } else {
        pdf.text(
          `#${String(e.id).padStart(2, '0')} · ${formatMmSs(e.time)} · ${Number(e.value).toFixed(2)} Ω`,
          22, y,
        );
      }
      y += 5;
    });
  }

  pdf.save(filename);
}

/* ──────────────────────────────────────────────────────────────────── */

export function exportCSV({ filename = `chidori_datos_${ts()}.csv`, measurements } = {}) {
  const meas = normMeasurements(measurements);
  let csv = 'tiempo_s,impedancia_ohm,tasa_ohm_min\n';
  meas.forEach((m) => {
    csv += `${Number(m.t).toFixed(2)},${Number(m.z).toFixed(3)},${Number(m.rate).toFixed(3)}\n`;
  });
  triggerDownload(filename, csv, 'text/csv;charset=utf-8;');
}

/* ──────────────────────────────────────────────────────────────────── */

export function exportTXT({
  filename = `chidori_mediciones_${ts()}.txt`,
  patient,
  stats,
  measurements,
  events,
} = {}) {
  const meas = normMeasurements(measurements);
  const evs  = normEvents(events);
  let txt = '';

  if (patient) {
    txt += '=== PACIENTE ===\n';
    txt += `Nombre: ${patient.nombre || 'N/A'}\nEdad: ${patient.edad || 'N/A'}\nSexo: ${patient.sexo || 'N/A'}\n`;
    txt += `Peso: ${patient.peso || 'N/A'} kg\nAltura: ${patient.altura || 'N/A'} m\n`;
    txt += `Circ. suprailíaca: ${patient.circ || 'N/A'} cm\n`;
    if (patient.sexo === 'Femenino' && patient.menstruacion) {
      txt += `Última menstruación: ${patient.menstruacion}\n`;
    }
    txt += '\n';
  }

  txt += '=== SESIÓN ===\n';
  txt += `Fecha: ${new Date().toLocaleString('es-AR')}\n`;
  txt += `Z basal: ${stats?.initialZ != null ? Number(stats.initialZ).toFixed(2) : '—'} Ω\n`;
  txt += `Z final: ${stats?.finalZ   != null ? Number(stats.finalZ).toFixed(2)   : '—'} Ω\n`;
  if (stats?.initialZ != null && stats?.finalZ != null) {
    const c = stats.finalZ - stats.initialZ;
    const p = (c / stats.initialZ) * 100;
    txt += `Cambio total: ${c.toFixed(2)} Ω (${p.toFixed(1)}%)\n`;
  }
  txt += `Duración: ${stats?.elapsedStr || '—'}\nEventos: ${stats?.eventCount ?? evs.length}\n`;
  txt += `Puntos: ${stats?.samples ?? meas.length}\n\n`;

  txt += '=== MEDICIONES ===\ntiempo_s\timpedancia_ohm\ttasa_ohm_min\n';
  meas.forEach((m) => {
    txt += `${Number(m.t).toFixed(2)}\t${Number(m.z).toFixed(3)}\t${Number(m.rate).toFixed(3)}\n`;
  });

  if (evs.length > 0) {
    txt += '\n=== EVENTOS ===\n';
    evs.forEach((e) => {
      const label = eventLabel(e.kind);
      if (label) {
        txt += `#${e.id} · ${formatMmSs(e.time)} · ${label}\n`;
        return;
      }
      txt += `#${e.id} · ${formatMmSs(e.time)} · ${Number(e.value).toFixed(2)} Ω`;
      if (e.change != null) txt += ` · Δ ${e.change > 0 ? '+' : ''}${Number(e.change).toFixed(2)} Ω`;
      txt += '\n';
    });
  }

  triggerDownload(filename, txt, 'text/plain;charset=utf-8;');
}

/* ──────────────────────────────────────────────────────────────────── */

function triggerDownload(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
