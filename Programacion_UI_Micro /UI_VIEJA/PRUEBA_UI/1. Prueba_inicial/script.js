// script.js

// --- WebSocket setup ---
const socket = new WebSocket(`ws://172.20.10.3:81/`);

// --- State variables ---
let startTime = null;
let pausedDuration = 0;
let pauseStart = null;
let measuring = false;
let data = [];          // { x: tiempo, y: valor }
let events = [];        // { id: número, time: tiempo }
let initialValue = null;
let alarmFired = false;
let eventCount = 0;
let currentValue = null;

// --- UI Elements ---
const statusBadge = document.getElementById('statusBadge');
const initialValueDisplay = document.getElementById('initialValueDisplay');
const currentValueDisplay = document.getElementById('currentValueDisplay');
const elapsedTimeDisplay = document.getElementById('elapsedTimeDisplay');
const eventCountDisplay = document.getElementById('eventCountDisplay');

// --- Update elapsed time display ---
function updateElapsedTime() {
  if (!measuring || !startTime) return;
  const elapsed = (Date.now() - startTime - pausedDuration) / 1000;
  const minutes = Math.floor(elapsed / 60);
  const seconds = Math.floor(elapsed % 60);
  elapsedTimeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

let timeInterval = null;

// --- Chart.js setup ---
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
      pointHoverBorderWidth: 2
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
      legend: { 
        display: false
      },
      annotation: { 
        annotations: {} 
      },
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

// --- Alarm configuration elements ---
const alarmEnable  = document.getElementById('alarmEnable');
const alarmTypeRad = Array.from(document.getElementsByName('alarmType'));
const inpAbs       = document.getElementById('alarmAbsValue');
const inpPct       = document.getElementById('alarmPercent');
const inpDiff      = document.getElementById('alarmDiff');

// Enable/disable inputs based on selected alarm type
alarmTypeRad.forEach(radio => {
  radio.addEventListener('change', () => {
    inpAbs.disabled  = radio.value !== 'abs';
    inpPct.disabled  = radio.value !== 'percent';
    inpDiff.disabled = radio.value !== 'diff';
  });
});

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
  chart.update('none'); // 'none' mode for better performance

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
      showCustomAlert("Es recomendable orinar");
    }
  }
});

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
  alertDiv.textContent = `⚠️ ${message}`;
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
  const id = `evt${++eventCount}`;
  events.push({ id: eventCount, time: t });

  // Update event count display
  eventCountDisplay.textContent = eventCount;

  // Add vertical line annotation
  chart.options.plugins.annotation.annotations[id] = {
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
    events = [];
    initialValue = null;
    currentValue = null;
    alarmFired = false;
    eventCount = 0;

    // Reset UI displays
    initialValueDisplay.textContent = '--';
    currentValueDisplay.textContent = '--';
    elapsedTimeDisplay.textContent = '00:00';
    eventCountDisplay.textContent = '0';
    statusBadge.classList.remove('active');
    statusBadge.innerHTML = '<span class="status-dot"></span>Inactivo';

    // Clear chart
    chart.data.datasets[0].data = [];
    chart.options.plugins.annotation.annotations = {};
    chart.update();

    startStopBtn.innerHTML = '<span class="btn-icon">▶</span>Iniciar Mediciones';
    
    // Stop time update
    if (timeInterval) {
      clearInterval(timeInterval);
      timeInterval = null;
    }
  }
});

// --- Download modal logic ---
const modal = document.getElementById('downloadModal');
const closeModalBtn = document.querySelector('.modal-close');
const infoForm = document.getElementById('infoForm');
const skipFormBtn = document.getElementById('skipFormBtn');

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

// Download only measurements
skipFormBtn.addEventListener('click', () => {
  downloadTxt(null);
  modal.style.display = 'none';
});

// Download with metadata
infoForm.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  const info = {
    nombre: form.nombre.value,
    edad: form.edad.value,
    sexo: form.sexo.value,
    peso: form.peso.value,
    altura: form.altura.value,
    circ: form.circSuprailica.value,
    menstruacion: form.tiempoMenstruacion.value
  };
  downloadTxt(info);
  modal.style.display = 'none';
  
  // Reset form
  form.reset();
});

// --- Function to generate and download TXT file ---
function downloadTxt(meta) {
  let txt = '';

  // Metadata header
  if (meta) {
    txt += `Nombre: ${meta.nombre}\n`;
    txt += `Edad: ${meta.edad}\n`;
    txt += `Sexo: ${meta.sexo}\n`;
    txt += `Peso: ${meta.peso} kg\n`;
    txt += `Altura: ${meta.altura} m\n`;
    txt += `Circ. Suprailíaca: ${meta.circ} cm\n`;
    if (meta.sexo === 'Femenino') {
      txt += `Última menstruación: ${meta.menstruacion}\n`;
    }
    txt += '\n';
  }

  // Measurement data
  txt += 'Mediciones:\nTiempo(s)\tValor\n';
  data.forEach(p => {
    txt += `${p.x.toFixed(2)}\t${p.y.toFixed(3)}\n`;
  });

  // Event list
  if (events.length) {
    txt += '\nEventos (Pichin Zeit):\n';
    events.forEach(evt => {
      txt += `Evento ${evt.id}: ${evt.time.toFixed(2)} segundos\n`;
    });
  }

  // Trigger download
  const blob = new Blob([txt], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `mediciones_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}