import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Event timeline · clinical row format.
 * Sin emojis, tres columnas: ID, valor, delta.
 *
 * Animaciones:
 *   - El nuevo evento entra con slide-down + opacity (spring suave).
 *   - Si se elimina (vía reset), sale con fade rápido.
 *   - La lista al cargar tiene stagger sutil.
 */
const itemVariants = {
  hidden:  { opacity: 0, y: -8, scale: 0.985 },
  visible: { opacity: 1, y: 0,  scale: 1 },
  exit:    { opacity: 0, y: -6, transition: { duration: 0.16 } },
};

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
        <ol className="timeline" aria-live="polite" style={{ listStyle: 'none' }}>
          <AnimatePresence initial={true}>
            {events.map((evt) => {
              const deltaClass = evt.change == null || evt.change === 0
                ? ''
                : evt.change < 0 ? 'neg' : 'pos';
              return (
                <motion.li
                  key={evt.id}
                  className="timeline-row"
                  layout
                  variants={itemVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  transition={{
                    type: 'spring',
                    stiffness: 240,
                    damping: 28,
                    mass: 0.6,
                  }}
                >
                  <span className="timeline-id">
                    #{evt.id.toString().padStart(2, '0')} · {fmtTime(evt.time)}
                  </span>
                  <span className="timeline-z numeric">{evt.value.toFixed(2)} Ω</span>
                  <span className={`timeline-delta numeric ${deltaClass}`}>
                    {evt.change != null
                      ? `${evt.change > 0 ? '+' : ''}${evt.change.toFixed(2)} Ω`
                      : '—'}
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </section>
  );
}
