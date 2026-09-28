import { ChevronDown } from 'lucide-react';

/**
 * Sección plegable con resumen de una línea.
 *
 * Reemplaza a las pestañas "01 Configuración de sesión / 02 Eventos" de la
 * pantalla de medición. Plegada muestra solo el título y un resumen (p. ej.
 * "Basal 149.46 Ω · alarma desactivada"); el contenido completo aparece a
 * pedido. Así la preparación no compite con la señal durante la sesión.
 *
 * Accesibilidad: el encabezado es un <button> con aria-expanded y
 * aria-controls; el panel es una región etiquetada por ese botón. Se opera con
 * Enter / Espacio como cualquier botón.
 */
export default function Disclosure({ id, title, summary, open, onToggle, children }) {
  const panelId = `${id}-panel`;
  const btnId = `${id}-btn`;
  return (
    <div className={`disclosure ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        id={btnId}
        className="disclosure-head"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="disclosure-title">{title}</span>
        <span className="disclosure-summary">{summary}</span>
        <ChevronDown size={16} className="disclosure-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} role="region" aria-labelledby={btnId} className="disclosure-panel">
          {children}
        </div>
      )}
    </div>
  );
}
