import React, { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { Camera } from 'lucide-react';

export default function RealTimeCharts({ data, rateData, events, theme }) {
  const mainChartRef = useRef(null);
  const rateChartRef = useRef(null);
  const mainChartInstance = useRef(null);
  const rateChartInstance = useRef(null);

  // Define inline plugin to draw event markers
  const eventLinesPlugin = {
    id: 'eventLines',
    afterDraw: (chart) => {
      if (!events || events.length === 0) return;
      const { ctx, chartArea, scales: { x } } = chart;
      if (!chartArea) return;
      
      ctx.save();
      events.forEach((evt) => {
        const xPixel = x.getPixelForValue(evt.time);
        if (xPixel >= chartArea.left && xPixel <= chartArea.right) {
          // Draw dashed red line
          ctx.beginPath();
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = 'hsl(354, 100%, 71%)'; // --accent-red
          ctx.moveTo(xPixel, chartArea.top);
          ctx.lineTo(xPixel, chartArea.bottom);
          ctx.stroke();

          // Draw pill label at top
          ctx.setLineDash([]);
          ctx.fillStyle = 'hsl(354, 100%, 71%)';
          const label = `#${evt.id}`;
          const labelWidth = ctx.measureText(label).width + 8;
          ctx.beginPath();
          ctx.roundRect(xPixel - labelWidth / 2, chartArea.top + 4, labelWidth, 16, 4);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9px Inter';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, xPixel, chartArea.top + 12);
        }
      });
      ctx.restore();
    }
  };

  // Handle Main Impedance Chart Creation / Update
  useEffect(() => {
    if (!mainChartRef.current) return;

    const ctx = mainChartRef.current.getContext('2d');
    
    // Create new chart instance if it doesn't exist
    if (!mainChartInstance.current) {
      mainChartInstance.current = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: [{
            label: 'Impedancia (Ω)',
            data: data,
            borderColor: '#ff8c42',
            backgroundColor: 'rgba(255, 140, 66, 0.08)',
            tension: 0.4,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: '#ff8c42',
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 2,
            fill: true
          }]
        },
        plugins: [eventLinesPlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 0 }, // Instant updates
          interaction: { intersect: false, mode: 'index' },
          scales: {
            x: {
              type: 'linear',
              title: {
                display: true,
                text: 'Tiempo (segundos)',
                color: theme === 'dark' ? '#9ca3af' : '#4a5568',
                font: { size: 12, weight: '600', family: 'Inter' }
              },
              ticks: { color: theme === 'dark' ? '#6b7280' : '#718096' },
              grid: { color: theme === 'dark' ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)' }
            },
            y: {
              type: 'linear',
              title: {
                display: true,
                text: 'Impedancia (Ω)',
                color: theme === 'dark' ? '#9ca3af' : '#4a5568',
                font: { size: 12, weight: '600', family: 'Inter' }
              },
              ticks: { color: theme === 'dark' ? '#6b7280' : '#718096' },
              grid: { color: theme === 'dark' ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)' }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: theme === 'dark' ? '#1a1f29' : '#ffffff',
              titleColor: theme === 'dark' ? '#e8eaed' : '#1a202c',
              bodyColor: theme === 'dark' ? '#9ca3af' : '#4a5568',
              borderColor: theme === 'dark' ? '#2d3748' : '#e2e8f0',
              borderWidth: 1,
              padding: 10,
              displayColors: false,
              callbacks: {
                label: (context) => `Impedancia: ${context.parsed.y.toFixed(2)} Ω`
              }
            }
          }
        }
      });
    } else {
      // Update data and options for theme change
      mainChartInstance.current.data.datasets[0].data = data;
      mainChartInstance.current.options.scales.x.title.color = theme === 'dark' ? '#9ca3af' : '#4a5568';
      mainChartInstance.current.options.scales.x.ticks.color = theme === 'dark' ? '#6b7280' : '#718096';
      mainChartInstance.current.options.scales.x.grid.color = theme === 'dark' ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)';
      mainChartInstance.current.options.scales.y.title.color = theme === 'dark' ? '#9ca3af' : '#4a5568';
      mainChartInstance.current.options.scales.y.ticks.color = theme === 'dark' ? '#6b7280' : '#718096';
      mainChartInstance.current.options.scales.y.grid.color = theme === 'dark' ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)';
      mainChartInstance.current.options.plugins.tooltip.backgroundColor = theme === 'dark' ? '#1a1f29' : '#ffffff';
      mainChartInstance.current.options.plugins.tooltip.titleColor = theme === 'dark' ? '#e8eaed' : '#1a202c';
      mainChartInstance.current.options.plugins.tooltip.bodyColor = theme === 'dark' ? '#9ca3af' : '#4a5568';
      mainChartInstance.current.options.plugins.tooltip.borderColor = theme === 'dark' ? '#2d3748' : '#e2e8f0';
      mainChartInstance.current.update();
    }
  }, [data, events, theme]);

  // Handle Rate of Change Chart Creation / Update
  useEffect(() => {
    if (!rateChartRef.current) return;

    const ctx = rateChartRef.current.getContext('2d');

    if (!rateChartInstance.current) {
      rateChartInstance.current = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: [{
            label: 'Velocidad (Ω/min)',
            data: rateData,
            borderColor: '#4ecdc4',
            backgroundColor: 'rgba(78, 205, 196, 0.08)',
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 0 },
          interaction: { intersect: false, mode: 'index' },
          scales: {
            x: {
              type: 'linear',
              title: {
                display: true,
                text: 'Tiempo (segundos)',
                color: theme === 'dark' ? '#9ca3af' : '#4a5568',
                font: { size: 10, weight: '600', family: 'Inter' }
              },
              ticks: { color: theme === 'dark' ? '#6b7280' : '#718096', font: { size: 9 } },
              grid: { color: theme === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)' }
            },
            y: {
              type: 'linear',
              title: {
                display: true,
                text: 'Tasa (Ω/min)',
                color: theme === 'dark' ? '#9ca3af' : '#4a5568',
                font: { size: 10, weight: '600', family: 'Inter' }
              },
              ticks: { color: theme === 'dark' ? '#6b7280' : '#718096', font: { size: 9 } },
              grid: { color: theme === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)' }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: theme === 'dark' ? '#1a1f29' : '#ffffff',
              titleColor: theme === 'dark' ? '#e8eaed' : '#1a202c',
              bodyColor: theme === 'dark' ? '#9ca3af' : '#4a5568',
              borderColor: theme === 'dark' ? '#2d3748' : '#e2e8f0',
              borderWidth: 1,
              padding: 8,
              displayColors: false,
              callbacks: {
                label: (context) => `Tasa: ${context.parsed.y.toFixed(2)} Ω/min`
              }
            }
          }
        }
      });
    } else {
      rateChartInstance.current.data.datasets[0].data = rateData;
      rateChartInstance.current.options.scales.x.title.color = theme === 'dark' ? '#9ca3af' : '#4a5568';
      rateChartInstance.current.options.scales.x.ticks.color = theme === 'dark' ? '#6b7280' : '#718096';
      rateChartInstance.current.options.scales.x.grid.color = theme === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)';
      rateChartInstance.current.options.scales.y.title.color = theme === 'dark' ? '#9ca3af' : '#4a5568';
      rateChartInstance.current.options.scales.y.ticks.color = theme === 'dark' ? '#6b7280' : '#718096';
      rateChartInstance.current.options.scales.y.grid.color = theme === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)';
      rateChartInstance.current.options.plugins.tooltip.backgroundColor = theme === 'dark' ? '#1a1f29' : '#ffffff';
      rateChartInstance.current.options.plugins.tooltip.titleColor = theme === 'dark' ? '#e8eaed' : '#1a202c';
      rateChartInstance.current.options.plugins.tooltip.bodyColor = theme === 'dark' ? '#9ca3af' : '#4a5568';
      rateChartInstance.current.options.plugins.tooltip.borderColor = theme === 'dark' ? '#2d3748' : '#e2e8f0';
      rateChartInstance.current.update();
    }
  }, [rateData, theme]);

  // Clean up chart instances on component unmount
  useEffect(() => {
    return () => {
      if (mainChartInstance.current) {
        mainChartInstance.current.destroy();
        mainChartInstance.current = null;
      }
      if (rateChartInstance.current) {
        rateChartInstance.current.destroy();
        rateChartInstance.current = null;
      }
    };
  }, []);

  const handleExportChart = () => {
    if (!mainChartInstance.current) return;
    const link = document.createElement('a');
    link.download = `grafico_impedancia_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = mainChartInstance.current.toBase64Image();
    link.click();
  };

  // Expose the main chart reference to windows/global object for jsPDF export if needed
  useEffect(() => {
    window.mainChartInstance = mainChartInstance.current;
    return () => {
      window.mainChartInstance = null;
    };
  }, [data, events]);

  return (
    <div className="charts-grid">
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="card-header">
          <div>
            <h2>Impedancia vs Tiempo</h2>
            <span className="card-subtitle">Mapeo del módulo de impedancia vesical en tiempo real</span>
          </div>
          <button 
            onClick={handleExportChart} 
            className="btn-icon-only" 
            title="Exportar Gráfico"
            style={{ borderRadius: '50%' }}
          >
            <Camera size={18} />
          </button>
        </div>
        <div className="chart-wrapper large">
          <canvas ref={mainChartRef}></canvas>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <div className="card-header">
          <div>
            <h2>Velocidad de Cambio</h2>
            <span className="card-subtitle">Derivada temporal de impedancia (Ω/min)</span>
          </div>
        </div>
        <div className="chart-wrapper">
          <canvas ref={rateChartRef}></canvas>
        </div>
      </div>
    </div>
  );
}
