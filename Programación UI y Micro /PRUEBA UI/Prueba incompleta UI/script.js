// script.js - Chidori: Bioimpedancia en Tiempo Real

// --- WebSocket setup ---
const socket = new WebSocket(`ws://172.20.10.3:81/`);

// --- State variables ---
let startTime = null;
let pausedDuration = 0;
let pauseStart = null;
let measuring = false;
let data = [];
let events = [];
let initialValue = null;
let alarmFired = false;
let eventCount = 0;
let currentValue = null;

// --- Advanced metrics ---
let rateData = [];
let min = Infinity;
let max = -Infinity;
let sum = 0;

// --- UI Elements ---
const statusBadge = document.getElementById('statusBadge');
const initialValueDisplay = document.getElementById('initialValueDisplay');
const currentValueDisplay = document.getElementById('currentValueDisplay');
const elapsedTimeDisplay = document.getElementById('elapsedTimeDisplay');
const eventCountDisplay = document.getElementById('eventCountDisplay');
const changeDisplay = document.getElementById('changeDisplay');
const changePercentage = document.getElementById('changePercentage');
const changeIndicator = document.getElementById('changeIndicator');
const rateDisplay = document.getElementById('rateDisplay');

// --- Theme Toggle ---
const themeToggle = document.getElementById('themeToggle');
const bodyElement = document.body;
let currentTheme = 'dark';

function initTheme() {
  applyTheme(currentTheme);
}

function applyTheme(theme) {
  currentTheme = theme;
  if (theme === 'light') {
    bodyElement.classList.add('light-theme');
    themeToggle.querySelector('.theme-icon').textContent = '☀️';
    console.log('Tema claro activado');
  } else {
    bodyElement.classList.remove('light-theme');
    themeToggle.querySelector('.theme-icon').textContent = '🌙';
    console.log('Tema oscuro activado');
  }
}

themeToggle.addEventListener('click', () => {
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  console.log('Cambiando a tema:', newTheme);
  applyTheme(newTheme);
});

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    switch (e.key.toLowerCase()) {
      case 's': // Ctrl+S para descargar
        e.preventDefault();
        downloadBtn.click();
        break;
      case 'r': // Ctrl+R para reset
        e.preventDefault();
        resetBtn.click();
        break;
      case 'e': // Ctrl+E para marcar evento
        e.preventDefault();
        markEventBtn.click();
        break;
    }
  }
  // Space para iniciar/pausar
  if (e.code === 'Space') {
    e.preventDefault();
    startStopBtn.click();
  }
});

// --- Update elapsed time display ---
function updateElapsedTime() {
  if (!measuring || !startTime) return;
  const elapsed = (Date.now() - startTime - pausedDuration) / 1000;
  const minutes = Math.floor(elapsed / 60);
  const seconds = Math.floor(elapsed % 60);
  elapsedTimeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

let timeInterval = null;

// --- Chart.js setup - Main Chart ---
const ctx = document.getElementById('myChart').getContext('2d');
const chart = new Chart(ctx, {
  type: 'line',
  data: {
    datasets: [{
      label: 'Impedancia',
      data: [],
      borderColor: '#ff8c42',
      backgroundColor: 'rgba(255, 140, 66, 0.1)',
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 6,
      pointHoverBackgroundColor: '#ff8c42',
      pointHoverBorderColor: '#fff',
      pointHoverBorderWidth: 2,
      fill: true
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      intersect: false,
      mode: 'index'
    },
    scales: {
      x: {
        type: 'linear',
        title: {
          display: true,
          text: 'Tiempo (s)',
          color: '#9ca3af',
          font: { size: 14, weight: '500' }
        },
        ticks: { color: '#6b7280' },
        grid: {
          color: 'rgba(255, 255, 255, 0.05)',
          borderColor: '#2d3748'
        }
      },
      y: {
        title: {
          display: true,
          text: 'Módulo de Impedancia (Ω)',
          color: '#9ca3af',
          font: { size: 14, weight: '500' }
        },
        ticks: { color: '#6b7280' },
        grid: {
          color: 'rgba(255, 255, 255, 0.05)',
          borderColor: '#2d3748'
        }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1e2530',
        titleColor: '#e8eaed',
        bodyColor: '#9ca3af',
        borderColor: '#2d3748',
        borderWidth: 1,
        padding: 12,
        displayColors: false,
        callbacks: {
          label: function(context) {
            return `Impedancia: ${context.parsed.y.toFixed(2)} Ω`;
          }
        }
      }
    }
  }
});

// --- Rate of Change Chart ---
const rateCtx = document.getElementById('rateChart').getContext('2d');
const rateChart = new Chart(rateCtx, {
  type: 'bar',
  data: {
    datasets: [{
      label: 'Tasa de Cambio (Ω/min)',
      data: [],
      backgroundColor: 'rgba(78, 205, 196, 0.6)',
      borderColor: '#4ecdc4',
      borderWidth: 1,
      borderRadius: 4
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'Tiempo (s)', color: '#9ca3af' },
        ticks: { color: '#6b7280' },
        grid: { color: 'rgba(255, 255, 255, 0.05)' }
      },
      y: {
        title: { display: true, text: 'Ω/min', color: '#9ca3af' },
        ticks: { color: '#6b7280' },
        grid: { color: 'rgba(255, 255, 255, 0.05)' }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1e2530',
        titleColor: '#e8eaed',
        bodyColor: '#9ca3af',
        callbacks: {
          label: function(context) {
            return `Tasa: ${context.parsed.y.toFixed(3)} Ω/min`;
          }
        }
      }
    }
  }
});

// --- Alarm configuration elements ---
const alarmEnable = document.getElementById('alarmEnable');
const alarmTypeRad = Array.from(document.getElementsByName('alarmType'));
const inpAbs = document.getElementById('alarmAbsValue');
const inpPct = document.getElementById('alarmPercent');
const inpDiff = document.getElementById('alarmDiff');
const alarmPreview = document.getElementById('alarmPreview');
const alarmThresholdIndicator = document.getElementById('alarmThresholdIndicator');

// Enable/disable inputs based on selected alarm type
alarmTypeRad.forEach(radio => {
  radio.addEventListener('change', () => {
    inpAbs.disabled = radio.value !== 'abs';
    inpPct.disabled = radio.value !== 'percent';
    inpDiff.disabled = radio.value !== 'diff';
    updateAlarmPreview();
  });
});

// Update alarm preview
inpAbs.addEventListener('input', updateAlarmPreview);
inpPct.addEventListener('input', updateAlarmPreview);
inpDiff.addEventListener('input', updateAlarmPreview);

function updateAlarmPreview() {
  if (!initialValue) return;
  
  const selected = alarmTypeRad.find(r => r.checked)?.value;
  let threshold = null;

  if (selected === 'abs') {
    threshold = parseFloat(inpAbs.value);
  } else if (selected === 'percent') {
    const pct = parseFloat(inpPct.value);
    threshold = initialValue * (pct / 100);
  } else if (selected === 'diff') {
    const diff = parseFloat(inpDiff.value);
    threshold = initialValue - diff;
  }

  if (threshold && !isNaN(threshold) && max > min) {
    const range = max - min;
    const position = ((threshold - min) / range) * 100;
    alarmThresholdIndicator.style.width = position + '%';
    alarmPreview.style.display = 'block';
  } else {
    alarmPreview.style.display = 'none';
  }
}

// --- WebSocket message handling ---
socket.addEventListener('open', () => console.log('WebSocket conectado'));
socket.addEventListener('close', () => console.log('WebSocket desconectado'));
socket.addEventListener('error', e => console.error('WebSocket error', e));

socket.addEventListener('message', evt => {
  const val = parseFloat(evt.data);
  if (isNaN(val) || !measuring) return;

  // First measurement - capture initial value
  if (data.length === 0) {
    initialValue = val;
    initialValueDisplay.textContent = val.toFixed(2);
    min = val;
    max = val;
    console.log('Valor inicial registrado:', initialValue);
  }

  // Update min/max
  min = Math.min(min, val);
  max = Math.max(max, val);
  sum += val;

  // Update current value
  currentValue = val;
  currentValueDisplay.textContent = val.toFixed(2);

  // Compute elapsed time
  const elapsed = (Date.now() - startTime - pausedDuration) / 1000;

  // Save data and update chart
  data.push({ x: elapsed, y: val });
  chart.data.datasets[0].data.push({ x: elapsed, y: val });
  chart.update('none');

  // Calculate rate of change (every 10 points to reduce noise)
  if (data.length > 1 && data.length % 10 === 0) {
    const prevIdx = Math.max(0, data.length - 11);
    const timeWindow = elapsed - data[prevIdx].x;
    const valueWindow = val - data[prevIdx].y;
    const rate = timeWindow > 0 ? (valueWindow / timeWindow) * 60 : 0; // Ω/min
    
    rateData.push({ x: elapsed, y: rate });
    rateChart.data.datasets[0].data.push({ x: elapsed, y: rate });
    rateChart.update('none');
  }

  // Update change display
  updateMetrics();

  // Check alarm conditions
  if (alarmEnable.checked && !alarmFired) {
    let fire = false;
    const selected = alarmTypeRad.find(r => r.checked)?.value;

    if (selected === 'abs') {
      const threshold = parseFloat(inpAbs.value);
      if (!isNaN(threshold) && val <= threshold) fire = true;
    } else if (selected === 'percent') {
      const pct = parseFloat(inpPct.value);
      if (!isNaN(pct) && val <= initialValue * (pct / 100)) fire = true;
    } else if (selected === 'diff') {
      const diff = parseFloat(inpDiff.value);
      if (!isNaN(diff) && val <= initialValue - diff) fire = true;
    }

    if (fire) {
      alarmFired = true;
      showCustomAlert('⚠️ Es recomendable orinar');
    }
  }
});

// Update metrics display
function updateMetrics() {
  if (!initialValue || !currentValue) return;

  const change = currentValue - initialValue;
  const percentage = (change / initialValue) * 100;

  // Display change
  changeDisplay.querySelector('.change-value').textContent = change.toFixed(2);
  changePercentage.textContent = percentage.toFixed(2) + ' %';

  // Indicator
  changeIndicator.textContent = change > 0 ? '📈' : '📉';
  changeIndicator.className = change > 0 ? 'change-indicator positive' : 'change-indicator negative';

  // Rate
  if (data.length > 1) {
    const elapsed = (Date.now() - startTime - pausedDuration) / 1000;
    const rate = (change / elapsed) * 60; // Ω/min
    rateDisplay.textContent = rate.toFixed(3);
  }
}

// Custom alert function
function showCustomAlert(message) {
  const alertDiv = document.createElement('div');
  alertDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #ff6b6b, #ee5a52);
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(255, 107, 107, 0.4);
    z-index: 10000;
    font-weight: 500;
    animation: slideInRight 0.3s ease-out;
  `;
  alertDiv.textContent = message;
  document.body.appendChild(alertDiv);

  setTimeout(() => {
    alertDiv.style.animation = 'slideOutRight 0.3s ease-in';
    setTimeout(() => alertDiv.remove(), 300);
  }, 5000);
}

// Add animation keyframes
const style = document.createElement('style');
style.textContent = `
  @keyframes slideInRight {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  @keyframes slideOutRight {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(400px);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// --- Control buttons ---
const startStopBtn = document.getElementById('startStopBtn');
const markEventBtn = document.getElementById('markEventBtn');
const resetBtn = document.getElementById('resetBtn');
const downloadBtn = document.getElementById('downloadBtn');

startStopBtn.addEventListener('click', () => {
  if (!measuring) {
    if (!startTime) startTime = Date.now();
    if (pauseStart) {
      pausedDuration += Date.now() - pauseStart;
      pauseStart = null;
    }
    socket.send('START');
    measuring = true;
    startStopBtn.innerHTML = '<span class="btn-icon">⏸</span>Pausar Mediciones';
    statusBadge.classList.add('active');
    statusBadge.innerHTML = '<span class="status-dot"></span>Activo';

    timeInterval = setInterval(updateElapsedTime, 100);
  } else {
    socket.send('STOP');
    measuring = false;
    pauseStart = Date.now();
    startStopBtn.innerHTML = '<span class="btn-icon">▶</span>Reanudar Mediciones';
    statusBadge.classList.remove('active');
    statusBadge.innerHTML = '<span class="status-dot"></span>Pausado';

    if (timeInterval) {
      clearInterval(timeInterval);
      timeInterval = null;
    }
  }
});

markEventBtn.addEventListener('click', () => {
  if (!measuring || !startTime) return;
  const t = (Date.now() - startTime - pausedDuration) / 1000;
  const id = `evt${++eventCount}`;
  const value = currentValue || 0;

  events.push({ id: eventCount, time: t, value });
  eventCountDisplay.textContent = eventCount;

  // Add to timeline
  addTimelineItem(eventCount, t, value);

  // Add vertical line to chart (using visual indicator)
  const point = {
    x: t,
    y: value,
    pointRadius: 8,
    pointBackgroundColor: '#ff6b6b',
    pointBorderColor: '#fff',
    pointBorderWidth: 2
  };
});

// Timeline management
function addTimelineItem(id, time, value) {
  const container = document.getElementById('timelineContainer');

  if (container.querySelector('.timeline-empty')) {
    container.innerHTML = '';
  }

  if (!container.querySelector('.timeline')) {
    const timelineDiv = document.createElement('div');
    timelineDiv.className = 'timeline';
    container.appendChild(timelineDiv);
  }

  const timeline = container.querySelector('.timeline');
  const item = document.createElement('div');
  item.className = 'timeline-item';

  const content = document.createElement('div');
  content.className = 'timeline-content';

  const header = document.createElement('div');
  header.className = 'timeline-header';

  const title = document.createElement('div');
  title.className = 'timeline-title';
  title.textContent = `Evento #${id}`;

  const timeSpan = document.createElement('div');
  timeSpan.className = 'timeline-time';
  timeSpan.textContent = `${time.toFixed(2)}s`;

  header.appendChild(title);
  header.appendChild(timeSpan);

  const details = document.createElement('div');
  details.className = 'timeline-details';

  const valueDetail = document.createElement('div');
  valueDetail.className = 'timeline-detail';
  valueDetail.innerHTML = `Impedancia: <strong>${value.toFixed(2)} Ω</strong>`;

  details.appendChild(valueDetail);

  content.appendChild(header);
  content.appendChild(details);
  item.appendChild(content);
  timeline.appendChild(item);
}

resetBtn.addEventListener('click', () => {
  if (confirm('¿Estás seguro de que deseas reiniciar todas las mediciones?')) {
    socket.send('RESET');

    startTime = null;
    pausedDuration = 0;
    pauseStart = null;
    measuring = false;
    data = [];
    events = [];
    rateData = [];
    initialValue = null;
    currentValue = null;
    alarmFired = false;
    eventCount = 0;
    min = Infinity;
    max = -Infinity;
    sum = 0;

    initialValueDisplay.textContent = '--';
    currentValueDisplay.textContent = '--';
    elapsedTimeDisplay.textContent = '00:00';
    eventCountDisplay.textContent = '0';
    changeDisplay.querySelector('.change-value').textContent = '--';
    changePercentage.textContent = '-- %';
    rateDisplay.textContent = '--';
    statusBadge.classList.remove('active');
    statusBadge.innerHTML = '<span class="status-dot"></span>Inactivo';

    chart.data.datasets[0].data = [];
    chart.update();

    rateChart.data.datasets[0].data = [];
    rateChart.update();

    document.getElementById('timelineContainer').innerHTML = `
      <div class="timeline-empty">
        <span class="timeline-empty-icon">📋</span>
        <p>No hay eventos registrados aún</p>
        <small>Los eventos aparecerán aquí cuando los marques durante la medición</small>
      </div>
    `;

    startStopBtn.innerHTML = '<span class="btn-icon">▶</span>Iniciar Mediciones';

    if (timeInterval) {
      clearInterval(timeInterval);
      timeInterval = null;
    }
  }
});

// --- Export Chart as Image ---
const exportChartBtn = document.getElementById('exportChartBtn');
exportChartBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = chart.canvas.toDataURL('image/png');
  link.download = `grafico_${new Date().toISOString().slice(0, 10)}.png`;
  link.click();
});

// --- Download modal logic ---
const modal = document.getElementById('downloadModal');
const closeModalBtn = document.querySelector('.modal-close');
const infoForm = document.getElementById('infoForm');

downloadBtn.addEventListener('click', () => {
  modal.style.display = 'block';
});

closeModalBtn.addEventListener('click', () => {
  modal.style.display = 'none';
});

window.addEventListener('click', e => {
  if (e.target === modal) modal.style.display = 'none';
});

// Show/hide menstruation field
document.getElementById('femenino').addEventListener('change', () => {
  document.getElementById('menstruacionField').style.display = 'block';
});
document.getElementById('masculino').addEventListener('change', () => {
  document.getElementById('menstruacionField').style.display = 'none';
});

// Export options
document.getElementById('exportPDFBtn').addEventListener('click', () => {
  const formData = getFormData();
  downloadPDF(formData);
  modal.style.display = 'none';
});

document.getElementById('exportCSVBtn').addEventListener('click', () => {
  downloadCSV();
  modal.style.display = 'none';
});

document.getElementById('exportTXTBtn').addEventListener('click', () => {
  const formData = getFormData();
  downloadTxt(formData);
  modal.style.display = 'none';
});

// Get form data
function getFormData() {
  const form = document.getElementById('infoForm');
  return {
    nombre: form.nombre.value || 'Sin especificar',
    edad: form.edad.value || '--',
    sexo: document.querySelector('input[name="sexo"]:checked')?.value || '--',
    peso: form.peso.value || '--',
    altura: form.altura.value || '--',
    circ: form.circSuprailica.value || '--',
    menstruacion: form.tiempoMenstruacion.value || '--'
  };
}

// Download CSV
function downloadCSV() {
  let csv = 'Tiempo(s),Impedancia(Ω),Tasa(Ω/min)\n';
  data.forEach((p, i) => {
    const rate = rateData[i] ? rateData[i].y : '--';
    csv += `${p.x.toFixed(2)},${p.y.toFixed(3)},${rate}\n`;
  });

  if (events.length) {
    csv += '\n\nEventos\nID,Tiempo(s),Impedancia(Ω)\n';
    events.forEach(evt => {
      csv += `${evt.id},${evt.time.toFixed(2)},${evt.value.toFixed(2)}\n`;
    });
  }

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mediciones_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Download TXT
function downloadTxt(meta) {
  let txt = 'REPORTE DE BIOIMPEDANCIA - CHIDORI\n';
  txt += '==================================\n\n';

  txt += 'INFORMACIÓN DEL PACIENTE:\n';
  txt += `Nombre: ${meta.nombre}\n`;
  txt += `Edad: ${meta.edad}\n`;
  txt += `Sexo: ${meta.sexo}\n`;
  txt += `Peso: ${meta.peso} kg\n`;
  txt += `Altura: ${meta.altura} m\n`;
  txt += `Circunferencia Suprailíaca: ${meta.circ} cm\n`;
  if (meta.sexo === 'Femenino') {
    txt += `Última menstruación: ${meta.menstruacion}\n`;
  }

  txt += '\nRESUMEN DE MEDICIONES:\n';
  txt += `Valor Inicial: ${initialValue.toFixed(2)} Ω\n`;
  txt += `Valor Final: ${currentValue.toFixed(2)} Ω\n`;
  txt += `Cambio Total: ${(currentValue - initialValue).toFixed(2)} Ω\n`;
  txt += `Porcentaje Cambio: ${((currentValue - initialValue) / initialValue * 100).toFixed(2)} %\n`;
  txt += `Mínimo: ${min.toFixed(2)} Ω\n`;
  txt += `Máximo: ${max.toFixed(2)} Ω\n`;
  txt += `Promedio: ${(sum / data.length).toFixed(2)} Ω\n`;

  txt += '\nDATOS DETALLADOS:\n';
  txt += 'Tiempo(s)\tImpedancia(Ω)\n';
  data.forEach(p => {
    txt += `${p.x.toFixed(2)}\t${p.y.toFixed(3)}\n`;
  });

  if (events.length) {
    txt += '\nEVENTOS REGISTRADOS:\n';
    events.forEach(evt => {
      txt += `Evento ${evt.id}: ${evt.time.toFixed(2)}s - ${evt.value.toFixed(2)} Ω\n`;
    });
  }

  const blob = new Blob([txt], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mediciones_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// Download PDF
function downloadPDF(meta) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let yPosition = 20;

  // Title
  doc.setFontSize(20);
  doc.text('REPORTE BIOIMPEDANCIA', 20, yPosition);
  yPosition += 12;

  // Patient info
  doc.setFontSize(11);
  doc.text(`Paciente: ${meta.nombre}`, 20, yPosition);
  yPosition += 6;
  doc.text(`Edad: ${meta.edad} años | Sexo: ${meta.sexo}`, 20, yPosition);
  yPosition += 6;
  doc.text(`Peso: ${meta.peso} kg | Altura: ${meta.altura} m`, 20, yPosition);
  yPosition += 6;
  doc.text(`Fecha: ${new Date().toLocaleDateString('es-ES')}`, 20, yPosition);
  yPosition += 12;

  // Summary
  doc.setFontSize(12);
  doc.text('RESUMEN DE MEDICIONES', 20, yPosition);
  yPosition += 8;
  doc.setFontSize(10);
  doc.text(`Valor Inicial: ${initialValue.toFixed(2)} Ω`, 25, yPosition);
  yPosition += 5;
  doc.text(`Valor Final: ${currentValue.toFixed(2)} Ω`, 25, yPosition);
  yPosition += 5;
  doc.text(`Cambio Total: ${(currentValue - initialValue).toFixed(2)} Ω`, 25, yPosition);
  yPosition += 5;
  doc.text(`Porcentaje: ${((currentValue - initialValue) / initialValue * 100).toFixed(2)} %`, 25, yPosition);
  yPosition += 12;

  // Add chart image
  const chartImage = chart.canvas.toDataURL('image/png');
  doc.addImage(chartImage, 'PNG', 15, yPosition, 180, 60);
  yPosition += 70;

  // Check if we need a new page
  if (yPosition > 250) {
    doc.addPage();
    yPosition = 20;
  }

  // Data table header
  doc.text('DATOS DETALLADOS', 20, yPosition);
  yPosition += 8;

  doc.setFontSize(9);
  doc.text('Tiempo (s)', 25, yPosition);
  doc.text('Impedancia (Ω)', 70, yPosition);
  yPosition += 5;

  // Data rows (sample every 5th point to avoid huge documents)
  const step = Math.ceil(data.length / 30);
  data.forEach((p, i) => {
    if (i % step === 0) {
      if (yPosition > 280) {
        doc.addPage();
        yPosition = 20;
      }
      doc.text(p.x.toFixed(2), 25, yPosition);
      doc.text(p.y.toFixed(3), 70, yPosition);
      yPosition += 5;
    }
  });

  doc.save(`mediciones_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// Initialize
initTheme();