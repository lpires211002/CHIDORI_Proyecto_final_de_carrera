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
 *  - version:  { etiqueta: 'Editada' | 'Original', lineas: [texto] } opcional ·
 *              una sesión editada nunca tiene que leerse como la cruda
 *  - comments: comentarios anclados [{ t_from, t_to | null, body }], en la
 *              misma base de tiempo que measurements
 */

const ts = () => new Date().toISOString().slice(0, 10);

function normMeasurements(rows) {
  return (rows || []).map((r) => ({
    t:    r.elapsed_time ?? r.x ?? 0,
    z:    r.impedance    ?? r.y ?? 0,
    rate: r.rate         ?? 0,
    interp: Boolean(r.interpolated),
  }));
}

function normComments(rows) {
  return (rows || [])
    .map((c, i) => ({
      n: c.n ?? i + 1,
      desde: Number(c.t_from),
      hasta: c.t_to == null ? null : Number(c.t_to),
      texto: String(c.body || '').trim(),
    }))
    .filter((c) => Number.isFinite(c.desde) && c.texto);
}

const rangoComentario = (c) => (c.hasta != null
  ? `${formatMmSs(c.desde)}–${formatMmSs(c.hasta)}`
  : formatMmSs(c.desde));

/** Texto de cada comentario en la muestra más cercana a su inicio (para el CSV/TXT). */
function comentariosPorMuestra(meas, comments) {
  const out = new Map();
  if (!meas.length) return out;
  normComments(comments).forEach((c) => {
    let lo = 0;
    let hi = meas.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (Number(meas[mid].t) < c.desde) lo = mid + 1; else hi = mid; }
    if (lo > 0 && Math.abs(meas[lo - 1].t - c.desde) < Math.abs(meas[lo].t - c.desde)) lo -= 1;
    const txt = `C${c.n}: ${c.texto}${c.hasta != null ? ` (hasta ${formatMmSs(c.hasta)})` : ''}`;
    out.set(lo, out.has(lo) ? `${out.get(lo)} | ${txt}` : txt);
  });
  return out;
}

const csvTexto = (txt) => `"${String(txt).replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

function normEvents(rows) {
  return (rows || []).map((e) => ({
    id:     e.event_number ?? e.id,
    time:   e.elapsed_time ?? e.time,
    value:  e.impedance    ?? e.value,
    change: e.impedance_change ?? e.change ?? null,
    kind:   e.kind ?? 'mark',
    amount: e.amount_ml ?? e.amount ?? null,
    // versión editada: agua / micción de antes del inicio o después del fin
    fuera:  Boolean(e.fuera_del_recorte),
  }));
}

/** Etiqueta legible para los eventos automáticos de enlace. */
function eventLabel(kind, e) {
  const base = eventLabelBase(kind, e);
  return base && e?.fuera ? `${base} · fuera del recorte` : base;
}

function eventLabelBase(kind, e) {
  if (kind === 'disconnect') return 'DESCONEXION del dispositivo';
  if (kind === 'reconnect')  return 'RECONEXION del dispositivo';
  if (kind === 'water' || kind === 'void') {
    const ml = Number(e?.amount);
    const base = kind === 'water' ? 'INGESTA de agua' : 'MICCION';
    return Number.isFinite(ml) ? `${base} · ${ml} ml` : base;
  }
  if (kind === 'gap') {
    const secs = Number(e?.change);
    if (!Number.isFinite(secs)) return 'MICROCORTE en la transmision';
    const lost = Math.max(0, Math.round(secs * 4) - 1);   // firmware a ~4 Hz
    return `MICROCORTE · ${secs.toFixed(1)} s sin datos (~${lost} muestras perdidas)`;
  }
  return null;
}

function formatMmSs(secs) {
  const v = Number(secs) || 0;
  const a = Math.abs(v);
  const m = Math.floor(a / 60);
  const s = Math.floor(a % 60);
  return `${v < 0 ? '-' : ''}${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Texto seguro para las fuentes base del PDF.
 *
 * jsPDF usa las 14 fuentes estándar, que codifican en WinAnsi: los caracteres
 * griegos no existen ahí y salen como otro glifo (la Ω se imprimía como ©).
 * En vez de embeber una fuente completa —sumaría cientos de kB al bundle— se
 * transliteran los pocos símbolos que usamos.
 */
const PDF_REEMPLAZOS = [
  [/[ΩΩ]/g, 'ohm'],   // U+03A9 (omega griega) y U+2126 (signo ohm)
  [/μ/g, 'u'],
  [/Δ/g, 'delta'],
  [/≈/g, '~'],
  [/−/g, '-'],      // U+2212 (signo menos tipográfico)
];

function pdfSafe(txt) {
  let s = String(txt ?? '');
  PDF_REEMPLAZOS.forEach(([re, rep]) => { s = s.replace(re, rep); });
  return s;
}

/** Envuelve el documento para que TODO lo que se escriba pase por pdfSafe. */
function sanitizar(pdf) {
  const text  = pdf.text.bind(pdf);
  const split = pdf.splitTextToSize.bind(pdf);
  pdf.text = (t, ...rest) => text(Array.isArray(t) ? t.map(pdfSafe) : pdfSafe(t), ...rest);
  pdf.splitTextToSize = (t, ...rest) => split(pdfSafe(t), ...rest);
  return pdf;
}

/* ──────────────────────────────────────────────────────────────────── */

export function exportPDF({
  filename = `chidori_reporte_${ts()}.pdf`,
  patient,
  stats,
  measurements,
  events,
  chartImage,
  calibration,          // { kcal, vdet, matched } · con que se midio la sesion
  version = null,       // { etiqueta, lineas } · original o editada
  comments = null,      // comentarios anclados
} = {}) {
  const pdf = sanitizar(new jsPDF());
  const meas = normMeasurements(measurements);
  const evs  = normEvents(events);
  const coms = normComments(comments);
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
    pdf.text(`Código: ${patient.codigo || 'N/A'}`, 22, y); y += 5;
    if (patient.nombre && patient.nombre !== 'N/A') {
      pdf.text(`Nombre: ${patient.nombre}`, 22, y); y += 5;
    }
    y += 4;

    // Campos de la sesión · vienen del catálogo configurable
    if (Array.isArray(patient.campos) && patient.campos.length > 0) {
      pdf.setFontSize(12); pdf.setTextColor(30); pdf.text('Datos registrados', 20, y); y += 6;
      pdf.setFontSize(9.5); pdf.setTextColor(70);
      patient.campos.forEach((c) => {
        if (y > 275) { pdf.addPage(); y = 20; }
        const val = `${c.value}${c.unit ? ` ${c.unit}` : ''}`;
        // Los textos largos se parten para no salirse de la hoja
        if (String(c.value).length > 60) {
          pdf.text(`${c.label}:`, 22, y); y += 5;
          pdf.splitTextToSize(String(c.value), 168).forEach((line) => {
            if (y > 280) { pdf.addPage(); y = 20; }
            pdf.text(line, 24, y); y += 5;
          });
        } else {
          pdf.text(`${c.label}: ${val}`, 22, y); y += 5;
        }
      });
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
  pdf.text(`Puntos registrados: ${stats?.samples ?? meas.length}`, 22, y); y += 5;
  const nInterp = meas.filter((m) => m.interp).length;
  if (nInterp > 0) { pdf.text(`Puntos interpolados (tramos sacados): ${nInterp}`, 22, y); y += 5; }
  y += 5;

  /* Versión · un reporte de la curva editada dice qué se le hizo */
  if (version) {
    if (y > 250) { pdf.addPage(); y = 20; }
    pdf.setFontSize(12); pdf.setTextColor(30); pdf.text(`Versión: ${version.etiqueta}`, 20, y); y += 6;
    pdf.setFontSize(9.5); pdf.setTextColor(70);
    (version.lineas || []).forEach((linea) => {
      pdf.splitTextToSize(String(linea), 168).forEach((l) => {
        if (y > 280) { pdf.addPage(); y = 20; }
        pdf.text(l, 22, y); y += 5;
      });
    });
    y += 5;
  }

  /* Calibracion · sin esto, dos reportes con escalas distintas se ven iguales.
   * Es el bloque que evita que alguien compare un PDF viejo con uno nuevo y
   * concluya que el paciente cambio, cuando lo que cambio fue la constante. */
  pdf.setFontSize(12); pdf.setTextColor(30); pdf.text('Calibracion', 20, y); y += 6;
  pdf.setFontSize(9.5); pdf.setTextColor(70);
  if (calibration?.kcal != null) {
    pdf.text(`K_CAL: ${Number(calibration.kcal).toFixed(5)}`
      + (calibration.vdet != null ? `   ·   V_det: ${Number(calibration.vdet).toFixed(3)} V` : ''),
      22, y); y += 5;
    pdf.text('Z = 2 x (Vadc + V_det) / K_CAL', 22, y); y += 5;
    if (calibration.label) { pdf.text(`Escala: ${calibration.label}`, 22, y); y += 5; }
    if (calibration.kcalFirmware != null) {
      pdf.text(`El equipo calculo con K_CAL ${Number(calibration.kcalFirmware).toFixed(5)}; los ohms de este`, 22, y); y += 5;
      pdf.text('reporte estan corregidos a la ganancia real de la placa.', 22, y); y += 5;
    } else if (calibration.reescalada) {
      pdf.text('Reescalada desde un firmware que no reportaba su calibracion.', 22, y); y += 5;
    }
    if (calibration.matched === false && !calibration.reescalada) {
      pdf.text('Atencion: la calibracion no fue verificada contra el catalogo.', 22, y); y += 5;
    }
  } else {
    pdf.text('El equipo no reporto su calibracion (firmware anterior a 1.8.0).', 22, y); y += 5;
    pdf.text('Los ohms de este reporte dependen de la constante que tuviera el', 22, y); y += 5;
    pdf.text('equipo al medir, que no quedo registrada.', 22, y); y += 5;
  }
  pdf.text('Exactitud estimada: +-13 % mientras la escala se derive de la cadena', 22, y); y += 5;
  pdf.text('de ganancias y no de resistencias patron.', 22, y); y += 10;

  // Curva de la sesión · se respeta la relación de aspecto del PNG para que
  // el trazo no salga estirado.
  if (chartImage) {
    try {
      const ancho = 170;
      let alto = 80;
      try {
        const props = pdf.getImageProperties(chartImage);
        if (props?.width && props?.height) {
          alto = Math.round((ancho * props.height) / props.width);
        }
      } catch { /* si no se pueden leer, queda el alto por defecto */ }

      if (y + alto + 12 > 285) { pdf.addPage(); y = 20; }
      pdf.setFontSize(12); pdf.setTextColor(30); pdf.text('Curva de la sesión', 20, y); y += 6;
      pdf.addImage(chartImage, 'PNG', 20, y, ancho, alto);
      y += alto + 8;
    } catch { /* noop */ }
  }

  // Observaciones libres de la sesión
  if (patient?.notas) {
    if (y > 240) { pdf.addPage(); y = 20; }
    pdf.setFontSize(12); pdf.setTextColor(30); pdf.text('Notas de la sesión', 20, y); y += 6;
    pdf.setFontSize(9); pdf.setTextColor(70);
    // split para que el texto largo no se salga de la hoja
    const wrapped = pdf.splitTextToSize(String(patient.notas), 170);
    wrapped.forEach((line) => {
      if (y > 280) { pdf.addPage(); y = 20; }
      pdf.text(line, 22, y);
      y += 5;
    });
    y += 5;
  }

  // Comentarios anclados a la curva (C1, C2… en el gráfico)
  if (coms.length > 0) {
    if (y > 250) { pdf.addPage(); y = 20; }
    pdf.setFontSize(12); pdf.setTextColor(30); pdf.text('Comentarios en la curva', 20, y); y += 6;
    pdf.setFontSize(9); pdf.setTextColor(70);
    coms.forEach((c) => {
      pdf.splitTextToSize(`C${c.n} · ${rangoComentario(c)} · ${c.texto}`, 168).forEach((l) => {
        if (y > 280) { pdf.addPage(); y = 20; }
        pdf.text(l, 22, y); y += 5;
      });
    });
    y += 5;
  }

  if (evs.length > 0) {
    if (y > 250) { pdf.addPage(); y = 20; }
    pdf.setFontSize(12); pdf.setTextColor(30); pdf.text('Eventos', 20, y); y += 6;
    pdf.setFontSize(9); pdf.setTextColor(70);
    evs.forEach((e) => {
      if (y > 280) { pdf.addPage(); y = 20; }
      const label = eventLabel(e.kind, e);
      if (label) {
        // Eventos de enlace: resaltados en rojo/verde, sin valor de impedancia.
        if (e.kind === 'disconnect') pdf.setTextColor(200, 40, 40);
        else if (e.kind === 'gap')   pdf.setTextColor(190, 120, 20);
        else if (e.kind === 'water')  pdf.setTextColor(30, 90, 170);
        else if (e.kind === 'void')   pdf.setTextColor(120, 80, 160);
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

export function exportCSV({
  filename = `chidori_datos_${ts()}.csv`,
  measurements,
  comments = null,
  editada = false,      // agrega la columna `interpolado` (1 = punto rellenado)
} = {}) {
  const meas = normMeasurements(measurements);
  const porMuestra = comentariosPorMuestra(meas, comments);
  const conComentarios = porMuestra.size > 0;
  let csv = 'tiempo_s,impedancia_ohm,tasa_ohm_min'
    + (editada ? ',interpolado' : '')
    + (conComentarios ? ',comentario' : '')
    + '\n';
  meas.forEach((m, i) => {
    csv += `${Number(m.t).toFixed(2)},${Number(m.z).toFixed(3)},${Number(m.rate).toFixed(3)}`;
    if (editada) csv += `,${m.interp ? 1 : 0}`;
    if (conComentarios) csv += `,${porMuestra.has(i) ? csvTexto(porMuestra.get(i)) : ''}`;
    csv += '\n';
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
  version = null,
  comments = null,
} = {}) {
  const meas = normMeasurements(measurements);
  const evs  = normEvents(events);
  const coms = normComments(comments);
  const editada = meas.some((m) => m.interp) || version?.etiqueta === 'Editada';
  let txt = '';

  if (patient) {
    txt += '=== PACIENTE ===\n';
    txt += `Código: ${patient.codigo || 'N/A'}\n`;
    if (patient.nombre && patient.nombre !== 'N/A') txt += `Nombre: ${patient.nombre}\n`;
    txt += '\n';

    if (Array.isArray(patient.campos) && patient.campos.length > 0) {
      txt += '=== DATOS REGISTRADOS ===\n';
      patient.campos.forEach((c) => {
        txt += `${c.label}: ${c.value}${c.unit ? ` ${c.unit}` : ''}\n`;
      });
      txt += '\n';
    }
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
  txt += `Puntos: ${stats?.samples ?? meas.length}\n`;
  const nInterp = meas.filter((m) => m.interp).length;
  if (nInterp > 0) txt += `Puntos interpolados (tramos sacados): ${nInterp}\n`;
  txt += '\n';

  if (version) {
    txt += `=== VERSIÓN: ${String(version.etiqueta).toUpperCase()} ===\n`;
    (version.lineas || []).forEach((l) => { txt += `${l}\n`; });
    txt += '\n';
  }

  txt += `=== MEDICIONES ===\ntiempo_s\timpedancia_ohm\ttasa_ohm_min${editada ? '\tinterpolado' : ''}\n`;
  meas.forEach((m) => {
    txt += `${Number(m.t).toFixed(2)}\t${Number(m.z).toFixed(3)}\t${Number(m.rate).toFixed(3)}`;
    if (editada) txt += `\t${m.interp ? 1 : 0}`;
    txt += '\n';
  });

  if (patient?.notas) {
    txt += '\n=== NOTAS DE LA SESIÓN ===\n';
    txt += `${patient.notas}\n`;
  }

  if (coms.length > 0) {
    txt += '\n=== COMENTARIOS EN LA CURVA ===\n';
    coms.forEach((c) => { txt += `C${c.n} · ${rangoComentario(c)} · ${c.texto}\n`; });
  }

  if (evs.length > 0) {
    txt += '\n=== EVENTOS ===\n';
    evs.forEach((e) => {
      const label = eventLabel(e.kind, e);
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
