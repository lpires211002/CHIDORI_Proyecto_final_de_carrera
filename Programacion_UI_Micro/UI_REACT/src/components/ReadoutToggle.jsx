import { ChevronDown } from 'lucide-react';

/**
 * Celda plegable de la fila de lecturas (Volumen estimado, Alarma).
 *
 * Plegada es un resumen del mismo tamaño que una lectura: rótulo, valor y una
 * línea de detalle. Al tocarla se despliega el panel completo a la derecha del
 * gráfico, que se angosta para hacerle lugar; con todo plegado el gráfico usa
 * el ancho entero.
 *
 * Es un <button> con aria-expanded / aria-controls, así que se opera con
 * teclado como cualquier botón.
 *
 * tone: null | 'amber' | 'alarm' · colorea el valor según el estado.
 */
export default function ReadoutToggle({
  label,
  value,
  sub = null,
  open = false,
  onToggle,
  controls,
  tone = null,
  title,
  /* true si el valor es una palabra ("Desactivada") y no una cifra: va un
   * escalón más chico para que entre en la celda */
  word = false,
  /* Clave para la animación de entrada desde la pantalla de inicio */
  fly,
}) {
  return (
    <button
      type="button"
      className={`readout-cell readout-toggle ${open ? 'is-open' : ''}`}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      title={title}
      data-fly={fly}
    >
      <span className="readout-label">
        {label}
        <ChevronDown size={14} className="readout-toggle-chevron" aria-hidden="true" />
      </span>
      <span className={`readout-value readout-toggle-value ${word ? 'is-word' : 'numeric'} ${tone ? `tone-${tone}` : ''}`}>
        {value}
      </span>
      {sub != null && <span className="readout-delta mute">{sub}</span>}
    </button>
  );
}
