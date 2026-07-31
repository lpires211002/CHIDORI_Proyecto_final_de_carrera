import React from 'react';

/**
 * Formulario generado a partir del catálogo de campos.
 *
 * Dibuja los campos que estén activos para un `scope` dado. Al agregar una
 * variable desde el panel de administración aparece acá sola, sin tocar código.
 *
 * Props:
 *   fields   · definiciones (de field_definitions, ya filtradas por scope)
 *   values   · { key: valor }
 *   onChange · (key, valor) => void
 *   columns  · cuántas columnas usar en pantallas anchas
 */
export default function DynamicFields({ fields = [], values = {}, onChange, columns = 2 }) {
  if (fields.length === 0) {
    return (
      <span className="field-hint">
        No hay campos configurados. Se definen desde el panel de administración.
      </span>
    );
  }

  const set = (key) => (e) => {
    const el = e.target;
    onChange?.(key, el.type === 'checkbox' ? el.checked : el.value);
  };

  return (
    <div className="dyn-grid" style={{ '--dyn-cols': columns }}>
      {fields.map((f) => {
        const id = `dyn-${f.scope}-${f.key}`;
        const val = values[f.key] ?? '';
        // Los campos de texto largo ocupan la fila completa
        const wide = f.type === 'textarea';

        return (
          <div key={f.key} className={`field ${wide ? 'dyn-wide' : ''}`}>
            <label className="field-label" htmlFor={id}>
              {f.label}
              {f.unit ? <span className="dyn-unit"> ({f.unit})</span> : null}
              {f.required ? <span className="dyn-req"> *</span> : null}
            </label>

            {f.type === 'textarea' ? (
              <textarea
                id={id}
                className="input"
                rows={3}
                value={val}
                onChange={set(f.key)}
                style={{ resize: 'vertical', minHeight: 68, lineHeight: 1.5, fontFamily: 'inherit' }}
              />
            ) : f.type === 'select' ? (
              <select id={id} className="input" value={val} onChange={set(f.key)}>
                <option value="">—</option>
                {(Array.isArray(f.options) ? f.options : []).map((op) => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>
            ) : f.type === 'boolean' ? (
              <label className="switch" style={{ marginTop: 4 }}>
                <input type="checkbox" checked={Boolean(values[f.key])} onChange={set(f.key)} />
                <span className="switch-track" />
              </label>
            ) : (
              <input
                id={id}
                className="input"
                type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                step={f.type === 'number' ? 'any' : undefined}
                value={val}
                onChange={set(f.key)}
              />
            )}

            {f.help ? <span className="field-hint">{f.help}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
