import React from 'react';

/**
 * Event timeline · clinical row format.
 * No emojis, no decorative icons. Three columns: ID, value, delta.
 */
export default function Timeline({ events }) {
  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
  };

  return (
    <section className="surface surface-pad" aria-label="Eventos marcados">
      <header className="section-head" style={{ marginBottom: 14 }}>
        <div>
          <h2>Eventos</h2>
          <span className="section-label" style={{ display: 'block', marginTop: 4 }}>
            Marcas registradas durante la sesión
          </span>
        </div>
        <span className="pill pill-off">
          <span className="pill-dot" />
          {events.length}
        </span>
      </header>

      {events.length === 0 ? (
        <div className="timeline-empty">
          Sin eventos registrados. Use <span className="kbd">E</span> durante la
          adquisición para marcar hitos clínicos.
        </div>
      ) : (
        <ol className="timeline" aria-live="polite">
          {events.map((evt) => {
            const deltaClass = evt.change == null || evt.change === 0
              ? ''
              : evt.change < 0 ? 'neg' : 'pos';
            return (
              <li className="timeline-row" key={evt.id}>
                <span className="timeline-id">#{evt.id.toString().padStart(2, '0')} · {fmtTime(evt.time)}</span>
                <span className="timeline-z numeric">{evt.value.toFixed(2)} Ω</span>
                <span className={`timeline-delta numeric ${deltaClass}`}>
                  {evt.change != null
                    ? `${evt.change > 0 ? '+' : ''}${evt.change.toFixed(2)} Ω`
                    : '—'}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
