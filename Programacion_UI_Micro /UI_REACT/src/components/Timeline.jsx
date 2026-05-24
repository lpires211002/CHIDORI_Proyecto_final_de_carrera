import React from 'react';
import { ClipboardList, Award, TrendingUp, TrendingDown } from 'lucide-react';

export default function Timeline({ events }) {
  const formatTime = (timeInSecs) => {
    const minutes = Math.floor(timeInSecs / 60);
    const seconds = Math.floor(timeInSecs % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2>Línea de Tiempo del Paciente</h2>
          <span className="card-subtitle">Historial cronológico de eventos registrados en la sesión</span>
        </div>
      </div>

      <div className="timeline-container" style={{ minHeight: '120px', maxHeight: '350px', overflowY: 'auto' }}>
        {events.length === 0 ? (
          <div className="timeline-empty">
            <ClipboardList size={36} style={{ opacity: 0.4, marginBottom: '8px' }} />
            <p>No hay eventos registrados aún</p>
            <small>Haz clic en "📍 Marcar Evento" o presiona la tecla [E] durante la medición para guardar hitos.</small>
          </div>
        ) : (
          <div className="timeline-list">
            {events.map((evt) => (
              <div className="timeline-row" key={evt.id}>
                <div className="timeline-bubble">
                  <div className="timeline-meta">
                    <span className="timeline-title" style={{ color: 'hsl(var(--accent-orange))', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Award size={14} />
                      Evento #{evt.id}
                    </span>
                    <span className="timeline-time">{formatTime(evt.time)}</span>
                  </div>
                  <div className="timeline-details">
                    <div className="timeline-detail" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '14px' }}>📊</span>
                      <span>Impedancia: <strong>{evt.value.toFixed(2)} Ω</strong></span>
                    </div>
                    {evt.change !== null && (
                      <div className="timeline-detail" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {evt.change > 0 ? (
                          <TrendingUp size={14} style={{ color: 'hsl(var(--accent-red))' }} />
                        ) : (
                          <TrendingDown size={14} style={{ color: 'hsl(var(--accent-green))' }} />
                        )}
                        <span>Cambio: <strong>{evt.change > 0 ? '+' : ''}{evt.change.toFixed(2)} Ω</strong></span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
