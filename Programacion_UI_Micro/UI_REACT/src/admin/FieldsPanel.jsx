import React, { useEffect, useState } from 'react';
import { Plus, Trash2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { fetchFields, upsertField, deleteField } from '../lib/patients';

/**
 * Gestión del catálogo de campos · define QUÉ se mide.
 *
 * Los formularios de paciente y de sesión se generan leyendo esta tabla, así
 * que agregar una variable acá la hace aparecer en la app sin tocar código ni
 * migrar la base.
 *
 * Ámbitos:
 *   paciente · estable, se carga una vez (sexo, altura, año de nacimiento)
 *   sesión   · cambia en cada medición (peso, temperatura, humedad, agua)
 *
 * Ocultar vs. eliminar: ocultar conserva los datos ya cargados y solo saca el
 * campo del formulario. Eliminar borra la definición (los valores históricos
 * quedan en el JSON de cada registro, pero dejan de mostrarse).
 */

const TIPOS = [
  ['number',   'Número'],
  ['text',     'Texto'],
  ['textarea', 'Texto largo'],
  ['select',   'Lista de opciones'],
  ['date',     'Fecha'],
  ['boolean',  'Sí / No'],
];

const VACIO = {
  scope: 'session', key: '', label: '', type: 'number',
  unit: '', options: '', required: false, active: true, sort_order: 100, help: '',
};

export default function FieldsPanel({ supabase, onAlert }) {
  const [fields, setFields] = useState([]);
  const [busy, setBusy]     = useState(true);
  const [draft, setDraft]   = useState(null);   // null = formulario cerrado

  const load = async () => {
    setBusy(true);
    try {
      setFields(await fetchFields(supabase, { includeInactive: true }));
    } catch (e) {
      onAlert?.('No se pudo cargar el catálogo. ¿Corriste el SQL de configuración?', 'warn');
      console.error('[FieldsPanel]', e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    const d = draft;
    if (!d.key.trim() || !d.label.trim()) {
      onAlert?.('La clave y la etiqueta son obligatorias', 'warn');
      return;
    }
    // La clave viaja al dataset: sin espacios ni mayúsculas
    const key = d.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    try {
      const payload = {
        ...(d.id ? { id: d.id } : {}),
        scope: d.scope,
        key,
        label: d.label.trim(),
        type: d.type,
        unit: d.unit?.trim() || null,
        options: d.type === 'select' && d.options
          ? String(d.options).split(',').map((s) => s.trim()).filter(Boolean)
          : null,
        required: Boolean(d.required),
        active: Boolean(d.active),
        sort_order: Number(d.sort_order) || 0,
        help: d.help?.trim() || null,
      };
      await upsertField(supabase, payload);
      onAlert?.(`Campo "${payload.label}" guardado`, 'success');
      setDraft(null);
      load();
    } catch (e) {
      const msg = String(e?.message || '');
      onAlert?.(
        /duplicate|unique/i.test(msg)
          ? `Ya existe un campo con la clave "${key}" en ese ámbito. Cambiá la clave o editá el existente.`
          : /row-level security|permission/i.test(msg)
            ? 'Solo un superadministrador puede modificar los campos.'
            : `No se pudo guardar: ${msg}`,
        'warn');
      console.error('[FieldsPanel] save', e);
    }
  };

  const toggleActive = async (f) => {
    try {
      await upsertField(supabase, { id: f.id, scope: f.scope, key: f.key, label: f.label, type: f.type, active: !f.active });
      load();
    } catch (e) {
      onAlert?.('No se pudo cambiar la visibilidad', 'warn');
      console.error(e);
    }
  };

  const remove = async (f) => {
    try {
      await deleteField(supabase, f.id);
      onAlert?.(`Campo "${f.label}" eliminado`, 'info');
      load();
    } catch (e) {
      onAlert?.('No se pudo eliminar', 'warn');
      console.error(e);
    }
  };

  const grupos = [
    ['patient', 'Ficha del paciente', 'Se cargan una vez. Son los datos que no cambian entre sesiones.'],
    ['session', 'Datos de cada sesión', 'Se completan en cada medición: pueden variar entre sesiones.'],
  ];

  return (
    <section className="surface surface-pad">
      <header className="section-head" style={{ marginBottom: 18 }}>
        <div>
          <h2>Campos que se miden</h2>
          <span className="section-label" style={{ display: 'block', marginTop: 4 }}>
            Definen los formularios de paciente y de sesión · {fields.length} campos
          </span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="button button-ghost button-sm" onClick={load} disabled={busy}>
            <RefreshCw size={14} className={busy ? 'rotating' : ''} />
            Recargar
          </button>
          <button type="button" className="button button-primary button-sm"
            onClick={() => setDraft({ ...VACIO })}>
            <Plus size={14} />
            Nuevo campo
          </button>
        </div>
      </header>

      {draft && (
        <div className="surface surface-pad" style={{ marginBottom: 18 }}>
          <span className="section-label">{draft.id ? 'Editar campo' : 'Nuevo campo'}</span>

          <div className="dyn-grid" style={{ '--dyn-cols': 3, marginTop: 12 }}>
            <div className="field">
              <label className="field-label">Ámbito</label>
              <select className="input" value={draft.scope}
                onChange={(e) => setDraft({ ...draft, scope: e.target.value })}>
                <option value="patient">Ficha del paciente</option>
                <option value="session">Datos de cada sesión</option>
              </select>
              {draft.id && (
                <span className="field-hint">
                  Si cambiás el ámbito, los valores ya cargados quedan guardados
                  donde estaban: aplica a los registros nuevos.
                </span>
              )}
            </div>
            <div className="field">
              <label className="field-label">Etiqueta</label>
              <input className="input" value={draft.label} placeholder="Presión arterial"
                onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">Clave (dataset)</label>
              <input className="input numeric" value={draft.key} placeholder="presion_arterial"
                onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
            </div>

            <div className="field">
              <label className="field-label">Tipo</label>
              <select className="input" value={draft.type}
                onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Unidad</label>
              <input className="input" value={draft.unit} placeholder="kg, cm, °C…"
                onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">Posición en el formulario</label>
              <input className="input numeric" type="number" value={draft.sort_order}
                onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} />
              <span className="field-hint">
                Menor número = aparece más arriba. Dejá huecos (10, 20, 30…) para poder
                intercalar campos después.
              </span>
            </div>

            {draft.type === 'select' && (
              <div className="field dyn-wide">
                <label className="field-label">Opciones (separadas por coma)</label>
                <input className="input" value={draft.options}
                  placeholder="Femenino, Masculino, Otro"
                  onChange={(e) => setDraft({ ...draft, options: e.target.value })} />
              </div>
            )}

            <div className="field dyn-wide">
              <label className="field-label">Ayuda (opcional)</label>
              <input className="input" value={draft.help}
                placeholder="Texto que aparece debajo del campo"
                onChange={(e) => setDraft({ ...draft, help: e.target.value })} />
            </div>
          </div>

          <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
            <label className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={draft.required}
                onChange={(e) => setDraft({ ...draft, required: e.target.checked })} />
              <span className="field-hint" style={{ margin: 0 }}>Obligatorio</span>
            </label>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="button button-ghost" onClick={() => setDraft(null)}>
                Cancelar
              </button>
              <button type="button" className="button button-primary" onClick={save}>
                Guardar campo
              </button>
            </div>
          </div>
        </div>
      )}

      {grupos.map(([scope, titulo, ayuda]) => {
        const lista = fields.filter((f) => f.scope === scope);
        return (
          <div key={scope} style={{ marginBottom: 22 }}>
            <span className="section-label">{titulo}</span>
            <span className="field-hint" style={{ display: 'block', marginBottom: 10 }}>{ayuda}</span>

            {lista.length === 0 ? (
              <span className="field-hint">Sin campos en este ámbito.</span>
            ) : (
              <div className="patient-list" style={{ maxHeight: 'none' }}>
                {lista.map((f) => (
                  <div key={f.id} className="patient-item" style={{ cursor: 'default', opacity: f.active ? 1 : 0.5 }}>
                    <span>
                      <span className="patient-item-code">{f.key}</span>
                      <span className="patient-item-name"> · {f.label}</span>
                      {f.unit ? <span className="patient-item-meta"> ({f.unit})</span> : null}
                      {f.required ? <span className="dyn-req"> *</span> : null}
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      <button type="button" className="button button-ghost button-sm"
                        onClick={() => setDraft({
                          ...f,
                          options: Array.isArray(f.options) ? f.options.join(', ') : '',
                          unit: f.unit || '', help: f.help || '',
                        })}>
                        Editar
                      </button>
                      <button type="button" className="button button-ghost button-sm"
                        onClick={() => toggleActive(f)}
                        title={f.active ? 'Ocultar del formulario (conserva los datos)' : 'Volver a mostrar'}>
                        {f.active ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <button type="button" className="button button-ghost button-sm"
                        onClick={() => remove(f)} title="Eliminar definición">
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
