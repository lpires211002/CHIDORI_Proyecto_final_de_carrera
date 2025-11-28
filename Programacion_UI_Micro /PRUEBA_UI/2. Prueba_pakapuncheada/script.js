// script.js - Enhanced Version

// --- WebSocket setup ---
const socket = new WebSocket(`ws://172.20.10.3:81/`);

// --- State variables ---
let startTime = null;
let pausedDuration = 0;
let pauseStart = null;
let measuring = false;
let data = [];          // { x: tiempo, y: valor }
let rateData = [];      // { x: tiempo, y: tasa de cambio }
let events = [];        // { id: número, time: tiempo, value: valor }
let initialValue = null;
let currentValue = null;
let alarmFired = false;
let eventCount = 0;
let lastValue = null;
let lastTime = null;

// --- UI Elements ---
const statusBadge = document.getElementById('statusBadge');
const initialValueDisplay = document.getElementById('initialValueDisplay');
const currentValueDisplay = document.getElementById('currentValueDisplay');
const elapsedTimeDisplay = document.getElementById('elapsedTimeDisplay');
const eventCountDisplay = document.getElementById('eventCountDisplay');
const changeDisplay = document.querySelector('.change-value');
const changeIndicator = document.getElementById('changeIndicator');
const changePercentage = document.getElementById('changePercentage');
const rateDisplay = document.getElementById('rateDisplay');
const themeToggle = document.getElementById('themeToggle');
const timelineContainer = document.getElementById('timelineContainer');

// --- Theme Management ---
function initTheme() {
  const savedTheme = localStorage.getItem('chidori-theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    themeToggle.querySelector('.theme-icon').textContent = '☀️';
  }
}

themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('light-theme');
  const isLight = document.body.classList.contains('light-theme');
  themeToggle.querySelector('.theme-icon').textContent = isLight ? '☀️' : '🌙';
  localStorage.setItem('chidori-theme', isLight ? 'light' : 'dark');
});

initTheme();

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
  // Space - Start/Stop
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    startStopBtn.click();
  }
  // E - Mark Event
  if (e.key === 'e' && e.target.tagName !== 'INPUT' && measuring) {
    markEventBtn.click();
  }
  // R - Reset (with Ctrl/Cmd)
  if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
    e.preventDefault();
    resetBtn.click();
  }
  // D - Download (with Ctrl/Cmd)
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    e.preventDefault();
    downloadBtn.click();
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

// --- Calculate rate of change ---
function calculateRate() {
  if (data.length < 2) return 0;
  const recent = data.slice(-10); // Last 10 points
  if (recent.length < 2) return 0;
  
  const first = recent[0];
  const last = recent[recent.length - 1];
  const deltaY = last.y - first.y;
  const deltaX = last.x - first.x;
  
  return deltaX > 0 ? (deltaY / deltaX) * 60 : 0; // Ω/min
}

// --- Update advanced metrics ---
function updateMetrics(val, elapsed) {
  if (initialValue === null) return;
  
  // Change
  const change = val - initialValue;
  changeDisplay.textContent = Math.abs(change).toFixed(2);
  
  // Percentage
  const percent = ((change / initialValue) * 100);
  changePercentage.textContent = `${percent.toFixed(1)} %`;
  
  // Indicator
  if (change > 0) {
    changeIndicator.textContent = '↑';
    changeIndicator.className = 'change-indicator positive';
  } else if (change < 0) {
    changeIndicator.textContent = '↓';
    changeIndicator.className = 'change-indicator negative';
  } else {
    changeIndicator.textContent = '→';
    changeIndicator.className = 'change-indicator';
  }
  
  // Rate
  const rate = calculateRate();
  rateDisplay.textContent = rate.toFixed(2);
  
  // Add to rate chart
  rateData.push({ x: elapsed, y: rate });
  rateChart.data.datasets[0].data.push({ x: elapsed, y: rate });
  rateChart.update('none');
}

// --- Main Chart Setup ---
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
      annotation: { annotations: {} },
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

// --- Rate Chart Setup ---
const rateCtx = document.getElementById('rateChart').getContext('2d');
const rateChart = new Chart(rateCtx, {
  type: 'line',
  data: {
    datasets: [{
      label: 'Tasa de Cambio',
      data: [],
      borderColor: '#4ecdc4',
      backgroundColor: 'rgba(78, 205, 196, 0.1)',
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 0,
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
          font: { size: 12 }
        },
        ticks: { color: '#6b7280', font: { size: 10 } },
        grid: { 
          color: 'rgba(255, 255, 255, 0.05)',
          borderColor: '#2d3748'
        }
      },
      y: {
        title: { 
          display: true, 
          text: 'Ω/min', 
          color: '#9ca3af',
          font: { size: 12 }
        },
        ticks: { color: '#6b7280', font: { size: 10 } },
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
        padding: 10,
        displayColors: false,
        callbacks: {
          label: function(context) {
            return `Tasa: ${context.parsed.y.toFixed(2)} Ω/min`;
          }
        }
      }
    }
  }
});

// --- Alarm configuration elements ---
const alarmEnable  = document.getElementById('alarmEnable');
const alarmTypeRad = Array.from(document.getElementsByName('alarmType'));
const inpAbs       = document.getElementById('alarmAbsValue');
const inpPct       = document.getElementById('alarmPercent');
const inpDiff      = document.getElementById('alarmDiff');
const alarmPreview = document.getElementById('alarmPreview');

// Enable/disable inputs based on selected alarm type
alarmTypeRad.forEach(radio => {
  radio.addEventListener('change', () => {
    inpAbs.disabled  = radio.value !== 'abs';
    inpPct.disabled  = radio.value !== 'percent';
    inpDiff.disabled = radio.value !== 'diff';
    updateAlarmPreview();
  });
});

// Show/hide alarm preview
alarmEnable.addEventListener('change', () => {
  alarmPreview.style.display = alarmEnable.checked ? 'block' : 'none';
  updateAlarmPreview();
});

[inpAbs, inpPct, inpDiff].forEach(input => {
  input.addEventListener('input', updateAlarmPreview);
});

function updateAlarmPreview() {
  if (!alarmEnable.checked || initialValue === null) return;
  
  const selected = alarmTypeRad.find(r => r.checked)?.value;
  let threshold = 0;
  
  if (selected === 'abs') {
    threshold = parseFloat(inpAbs.value) || 0;
  } else if (selected === 'percent') {
    const pct = parseFloat(inpPct.value) || 0;
    threshold = initialValue * (pct / 100);
  } else if (selected === 'diff') {
    const diff = parseFloat(inpDiff.value) || 0;
    threshold = initialValue - diff;
  }
  
  const percentage = initialValue > 0 ? (threshold / initialValue) * 100 : 0;
  const indicator = document.getElementById('alarmThresholdIndicator');
  if (indicator) {
    indicator.style.left = `${Math.max(0, Math.min(100, percentage))}%`;
  }
}

// --- Timeline Management ---
function updateTimeline() {
  if (events.length === 0) {
    timelineContainer.innerHTML = `
      <div class="timeline-empty">
        <span class="timeline-empty-icon">📋</span>
        <p>No hay eventos registrados aún</p>
        <small>Los eventos aparecerán aquí cuando los marques durante la medición</small>
      </div>
    `;
    return;
  }
  
  let html = '<div class="timeline">';
  events.forEach((evt, index) => {
    const minutes = Math.floor(evt.time / 60);
    const seconds = Math.floor(evt.time % 60);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    html += `
      <div class="timeline-item">
        <div class="timeline-content">
          <div class="timeline-header">
            <span class="timeline-title">Evento #${evt.id}</span>
            <span class="timeline-time">${timeStr}</span>
          </div>
          <div class="timeline-details">
            <div class="timeline-detail">
              <span>📊</span>
              <span>Impedancia: <strong>${evt.value.toFixed(2)} Ω</strong></span>
            </div>
            ${evt.change ? `
              <div class="timeline-detail">
                <span>${evt.change > 0 ? '↑' : '↓'}</span>
                <span>Cambio: <strong>${Math.abs(evt.change).toFixed(2)} Ω</strong></span>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  });
  html += '</div>';
  
  timelineContainer.innerHTML = html;
}

// --- WebSocket message handling ---
socket.addEventListener('open',  () => console.log('WebSocket conectado'));
socket.addEventListener('close', () => console.log('WebSocket desconectado'));
socket.addEventListener('error', e => console.error('WebSocket error', e));

socket.addEventListener('message', evt => {
  const val = parseFloat(evt.data);
  if (isNaN(val) || !measuring) return;

  // If this is the very first measurement, capture it as initialValue
  if (data.length === 0) {
    initialValue = val;
    initialValueDisplay.textContent = val.toFixed(2);
    console.log('Valor inicial registrado:', initialValue);
  }

  // Update current value
  currentValue = val;
  currentValueDisplay.textContent = val.toFixed(2);

  // Compute elapsed time
  const elapsed = (Date.now() - startTime - pausedDuration) / 1000;

  // Save data and update chart
  data.push({ x: elapsed, y: val });
  chart.data.datasets[0].data.push({ x: elapsed, y: val });
  chart.update('none');
  
  // Update metrics
  updateMetrics(val, elapsed);

  // Check alarm conditions
  if (alarmEnable.checked && !alarmFired) {
    let fire = false;
    const selected = alarmTypeRad.find(r => r.checked)?.value;

    if (selected === 'abs') {
      const threshold = parseFloat(inpAbs.value);
      if (!isNaN(threshold) && val <= threshold) fire = true;
    }
    else if (selected === 'percent') {
      const pct = parseFloat(inpPct.value);
      if (!isNaN(pct) && val <= initialValue * (pct / 100)) fire = true;
    }
    else if (selected === 'diff') {
      const diff = parseFloat(inpDiff.value);
      if (!isNaN(diff) && val <= initialValue - diff) fire = true;
    }

    if (fire) {
      alarmFired = true;
      showCustomAlert("⚠️ Es recomendable orinar", "warning");
      playNotificationSound();
    }
  }
  
  lastValue = val;
  lastTime = elapsed;
});

// --- Custom notification system ---
function showCustomAlert(message, type = "info") {
  const colors = {
    info: { bg: 'linear-gradient(135deg, #4ecdc4, #42b8b0)', shadow: 'rgba(78, 205, 196, 0.4)' },
    warning: { bg: 'linear-gradient(135deg, #ff6b6b, #ee5a52)', shadow: 'rgba(255, 107, 107, 0.4)' },
    success: { bg: 'linear-gradient(135deg, #51cf66, #45b854)', shadow: 'rgba(81, 207, 102, 0.4)' }
  };
  
  const color = colors[type] || colors.info;
  
  const alertDiv = document.createElement('div');
  alertDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${color.bg};
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 8px 24px ${color.shadow};
    z-index: 10000;
    font-weight: 500;
    font-size: 15px;
    animation: slideInRight 0.3s ease-out;
    max-width: 400px;
  `;
  alertDiv.textContent = message;
  document.body.appendChild(alertDiv);
  
  setTimeout(() => {
    alertDiv.style.animation = 'slideOutRight 0.3s ease-in';
    setTimeout(() => alertDiv.remove(), 300);
  }, 5000);
}

// Simple notification sound
function playNotificationSound() {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.frequency.value = 800;
  oscillator.type = 'sine';
  
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
  
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.5);
}

// --- Control buttons ---
const startStopBtn = document.getElementById('startStopBtn');
const markEventBtn = document.getElementById('markEventBtn');
const resetBtn     = document.getElementById('resetBtn');
const downloadBtn  = document.getElementById('downloadBtn');

startStopBtn.addEventListener('click', () => {
  if (!measuring) {
    // Start or resume
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
    
    // Start time update interval
    timeInterval = setInterval(updateElapsedTime, 100);
  } else {
    // Pause
    socket.send('STOP');
    measuring = false;
    pauseStart = Date.now();
    startStopBtn.innerHTML = '<span class="btn-icon">▶</span>Reanudar Mediciones';
    statusBadge.classList.remove('active');
    statusBadge.innerHTML = '<span class="status-dot"></span>Pausado';
    
    // Stop time update
    if (timeInterval) {
      clearInterval(timeInterval);
      timeInterval = null;
    }
  }
});

markEventBtn.addEventListener('click', () => {
  if (!measuring || !startTime) return;
  const t = (Date.now() - startTime - pausedDuration) / 1000;
  const id = ++eventCount;
  
  const change = initialValue && currentValue ? currentValue - initialValue : null;
  
  events.push({ 
    id: id, 
    time: t,
    value: currentValue || 0,
    change: change
  });

  // Update event count display
  eventCountDisplay.textContent = eventCount;
  
  // Update timeline
  updateTimeline();

  // Add vertical line annotation
  chart.options.plugins.annotation.annotations[`evt${id}`] = {
    type: 'line',
    scaleID: 'x',
    value: t,
    borderColor: '#ff6b6b',
    borderWidth: 2,
    borderDash: [5, 5],
    label: {
      enabled: true,
      content: `#${eventCount}`,
      position: 'start',
      backgroundColor: '#ff6b6b',
      color: '#fff',
      font: {
        size: 11,
        weight: 'bold'
      },
      padding: 4
    }
  };
  chart.update();
  
  showCustomAlert(`Evento #${eventCount} marcado`, "success");
  playNotificationSound();
});

resetBtn.addEventListener('click', () => {
  if (confirm('¿Estás seguro de que deseas reiniciar todas las mediciones?')) {
    socket.send('RESET');
    // Reset all state
    startTime = null;
    pausedDuration = 0;
    pauseStart = null;
    measuring = false;
    data = [];
    rateData = [];
    events = [];
    initialValue = null;
    currentValue = null;
    alarmFired = false;
    eventCount = 0;
    lastValue = null;
    lastTime = null;

    // Reset UI displays
    initialValueDisplay.textContent = '--';
    currentValueDisplay.textContent = '--';
    elapsedTimeDisplay.textContent = '00:00';
    eventCountDisplay.textContent = '0';
    changeDisplay.textContent = '--';
    changePercentage.textContent = '-- %';
    changeIndicator.textContent = '';
    changeIndicator.className = 'change-indicator';
    rateDisplay.textContent = '--';
    
    statusBadge.classList.remove('active');
    statusBadge.innerHTML = '<span class="status-dot"></span>Inactivo';

    // Clear charts
    chart.data.datasets[0].data = [];
    chart.options.plugins.annotation.annotations = {};
    chart.update();
    
    rateChart.data.datasets[0].data = [];
    rateChart.update();
    
    // Clear timeline
    updateTimeline();

    startStopBtn.innerHTML = '<span class="btn-icon">▶</span>Iniciar Mediciones';
    
    // Stop time update
    if (timeInterval) {
      clearInterval(timeInterval);
      timeInterval = null;
    }
    
    showCustomAlert("Mediciones reiniciadas", "info");
  }
});

// --- Export Chart as Image ---
document.getElementById('exportChartBtn').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `grafico_${new Date().toISOString().slice(0,10)}.png`;
  link.href = chart.toBase64Image();
  link.click();
  showCustomAlert("Gráfico exportado como imagen", "success");
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
  if (e.target.classList.contains('modal-overlay')) {
    modal.style.display = 'none';
  }
});

// Show/hide menstruation field
document.getElementById('femenino').addEventListener('change', () => {
  document.getElementById('menstruacionField').style.display = 'block';
});
document.getElementById('masculino').addEventListener('change', () => {
  document.getElementById('menstruacionField').style.display = 'none';
});

// --- Export Functions ---

// Get patient info from form
function getPatientInfo() {
  const form = infoForm;
  const nombre = form.nombre.value;
  const edad = form.edad.value;
  const sexo = form.querySelector('input[name="sexo"]:checked')?.value;
  const peso = form.peso.value;
  const altura = form.altura.value;
  const circ = form.circSuprailica.value;
  const menstruacion = form.tiempoMenstruacion.value;
  
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
}

// Export as PDF
document.getElementById('exportPDFBtn').addEventListener('click', async () => {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  
  const info = getPatientInfo();
  let y = 20;
  
  // Header
  pdf.setFontSize(20);
  pdf.setTextColor(255, 140, 66);
  pdf.text('Chidori - Reporte de Bioimpedancia', 20, y);
  y += 10;
  
  pdf.setFontSize(10);
  pdf.setTextColor(100);
  pdf.text(`Fecha: ${new Date().toLocaleString('es-AR')}`, 20, y);
  y += 15;
  
  // Patient info
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
      pdf.text(`Última menstruación: ${info.menstruacion}`, 25, y); y += 6;
    }
    y += 10;
  }
  
  // Statistics
  pdf.setFontSize(14);
  pdf.text('Estadísticas de la Sesión', 20, y);
  y += 8;
  
  pdf.setFontSize(10);
  pdf.text(`Valor Inicial: ${initialValue ? initialValue.toFixed(2) : '--'} Ω`, 25, y); y += 6;
  pdf.text(`Valor Final: ${currentValue ? currentValue.toFixed(2) : '--'} Ω`, 25, y); y += 6;
  if (initialValue && currentValue) {
    const change = currentValue - initialValue;
    const percent = (change / initialValue) * 100;
    pdf.text(`Cambio Total: ${change.toFixed(2)} Ω (${percent.toFixed(1)}%)`, 25, y); y += 6;
  }
  pdf.text(`Duración: ${elapsedTimeDisplay.textContent}`, 25, y); y += 6;
  pdf.text(`Eventos Marcados: ${eventCount}`, 25, y); y += 6;
  pdf.text(`Puntos de Datos: ${data.length}`, 25, y); y += 10;
  
  // Chart
  const chartImage = chart.toBase64Image();
  pdf.addImage(chartImage, 'PNG', 20, y, 170, 80);
  y += 85;
  
  // Events
  if (events.length > 0) {
    if (y > 250) {
      pdf.addPage();
      y = 20;
    }
    
    pdf.setFontSize(14);
    pdf.text('Eventos Registrados', 20, y);
    y += 8;
    
    pdf.setFontSize(9);
    events.forEach(evt => {
      if (y > 280) {
        pdf.addPage();
        y = 20;
      }
      const minutes = Math.floor(evt.time / 60);
      const seconds = Math.floor(evt.time % 60);
      pdf.text(`#${evt.id} - ${minutes}:${seconds.toString().padStart(2, '0')} - ${evt.value.toFixed(2)} Ω`, 25, y);
      y += 5;
    });
  }
  
  pdf.save(`reporte_chidori_${new Date().toISOString().slice(0,10)}.pdf`);
  modal.style.display = 'none';
  showCustomAlert("Reporte PDF generado exitosamente", "success");
});

// Export as CSV
document.getElementById('exportCSVBtn').addEventListener('click', () => {
  let csv = 'Tiempo(s),Impedancia(Ω),Tasa de Cambio(Ω/min)\n';
  
  data.forEach((point, index) => {
    const rate = rateData[index] ? rateData[index].y.toFixed(3) : '0.000';
    csv += `${point.x.toFixed(2)},${point.y.toFixed(3)},${rate}\n`;
  });
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `datos_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  
  modal.style.display = 'none';
  showCustomAlert("Datos exportados en formato CSV", "success");
});

// Export as TXT
document.getElementById('exportTXTBtn').addEventListener('click', () => {
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
  txt += `Duración: ${elapsedTimeDisplay.textContent}\n`;
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
    txt += '\n=== EVENTOS (PICHIN ZEIT) ===\n';
    events.forEach(evt => {
      const minutes = Math.floor(evt.time / 60);
      const seconds = Math.floor(evt.time % 60);
      const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      txt += `Evento ${evt.id}: ${timeStr} - ${evt.value.toFixed(2)} Ω`;
      if (evt.change !== null) {
        txt += ` (Cambio: ${evt.change > 0 ? '+' : ''}${evt.change.toFixed(2)} Ω)`;
      }
      txt += '\n';
    });
  }

  // Trigger download
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `mediciones_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  
  modal.style.display = 'none';
  showCustomAlert("Archivo de texto generado exitosamente", "success");
});