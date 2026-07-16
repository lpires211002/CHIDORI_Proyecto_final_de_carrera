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

// --- Chart.js setup ---
const ctx = document.getElementById('myChart').getContext('2d');
const chart = new Chart(ctx, {
  type: 'line',
  data: {
    datasets: [{
      label: 'Valor del Sensor',
      data: [],
      borderColor: 'rgba(75,192,192,1)',
      tension: 0.1
    }]
  },
  options: {
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'Tiempo (s)', color: 'white' },
        ticks: { color: 'white' },
        grid: { color: 'rgba(255,255,255,0.2)', borderColor: 'white' }
      },
      y: {
        title: { display: true, text: 'MÓDULO DE IMPEDANCIA (Ω)', color: 'white' },
        ticks: { color: 'white' },
        grid: { color: 'rgba(255,255,255,0.2)', borderColor: 'white' }
      }
    },
    plugins: {
      legend: { labels: { color: 'white' } },
      annotation: { annotations: {} }
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
    console.log('Valor inicial registrado:', initialValue);
  }

  // Compute elapsed time
  const elapsed = (Date.now() - startTime - pausedDuration) / 1000;

  // Save data and update chart
  data.push({ x: elapsed, y: val });
  chart.data.datasets[0].data.push({ x: elapsed, y: val });
  chart.update();

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
      alert("Es recomendable orinar");
    }
  }
});

// --- Control buttons ---
const startStopBtn = document.getElementById('startStopBtn');
const markEventBtn = document.getElementById('markEventBtn');
const resetBtn     = document.getElementById('resetBtn');
const downloadBtn  = document.getElementById('downloadBtn');

startStopBtn.addEventListener('click', () => {
  if (!measuring) {
    // Start or resume
    if (!startTime)            startTime = Date.now();
    if (pauseStart) {
      pausedDuration += Date.now() - pauseStart;
      pauseStart = null;
    }
    socket.send('START');
    measuring = true;
    startStopBtn.textContent = 'Pausar Mediciones';
  } else {
    // Pause
    socket.send('STOP');
    measuring = false;
    pauseStart = Date.now();
    startStopBtn.textContent = 'Reanudar Mediciones';
  }
});

markEventBtn.addEventListener('click', () => {
  if (!measuring || !startTime) return;
  const t = (Date.now() - startTime - pausedDuration) / 1000;
  const id = `evt${++eventCount}`;
  events.push({ id: eventCount, time: t });

  // Add vertical line annotation
  chart.options.plugins.annotation.annotations[id] = {
    type: 'line',
    scaleID: 'x',
    value: t,
    borderColor: 'red',
    borderWidth: 2,
    label: {
      enabled: true,
      content: `Evento ${eventCount}`,
      position: 'start'
    }
  };
  chart.update();
});

resetBtn.addEventListener('click', () => {
  socket.send('RESET');
  // Reset all state
  startTime = null;
  pausedDuration = 0;
  pauseStart = null;
  measuring = false;
  data = [];
  events = [];
  initialValue = null;
  alarmFired = false;
  eventCount = 0;

  // Clear chart
  chart.data.datasets[0].data = [];
  chart.options.plugins.annotation.annotations = {};
  chart.update();

  startStopBtn.textContent = 'Iniciar Mediciones';
});

// --- Download modal logic ---
const modal       = document.getElementById('downloadModal');
const closeModal  = document.querySelector('.close');
const infoForm    = document.getElementById('infoForm');
const skipFormBtn = document.getElementById('skipFormBtn');

downloadBtn.addEventListener('click', () => {
  modal.style.display = 'block';
});
closeModal.addEventListener('click', () => {
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
    txt += `Circ. Suprailica: ${meta.circ} cm\n`;
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
