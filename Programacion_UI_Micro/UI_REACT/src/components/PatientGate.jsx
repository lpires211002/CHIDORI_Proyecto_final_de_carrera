import React, { useEffect, useMemo, useState } from 'react';
import { UserPlus, ArrowLeft, Check } from 'lucide-react';
import DynamicFields from './DynamicFields';
import {
  fetchFields, fetchPatients, createPatient, nextPatientCode,
  pacientesGuardados, camposGuardados, conteoGuardado,
  patientLabel, coerceValues, missingRequired,
} from '../lib/patients';
import { describirAntiguedad } from '../lib/patientsCache';
import { contarSesionesPaciente } from '../lib/sessionSync';

/**
 * Paso previo a la medición: elegir (o crear) el paciente y completar los
 * datos variables de ESTA sesión.
 *
 * Por qué existe: el protocolo mide 4-6 veces a la misma persona. Si la
 * asociación se hiciera al final, es fácil terminar con sesiones huérfanas o
 * mal atribuidas. Acá queda atada antes de que entre el primer dato.
 *
 * Props:
 *   supabase · cliente
 *   onReady  · ({ patient, sessionData }) => void   · confirma y habilita medir
 *   onCancel · () => void
 *   onError  · (msg) => void
 */
export default function PatientGate({ supabase, onReady, onCancel, onError }) {
  // Lo guardado en esta computadora se muestra AL INSTANTE, sin esperar a la
  // red: en la red del Chidori la consulta a la nube no llega nunca, y antes
  // eso dejaba el selector en "Cargando…" o obligaba a cambiar de WiFi.
  // La lista la mantiene al día usePatientsPrefetch (Dashboard).
  const [guardado] = useState(() => pacientesGuardados());

  const [step, setStep]         = useState('pick');   // 'pick' | 'new' | 'session'
  const [fields, setFields]     = useState(() => camposGuardados());
  const [patients, setPatients] = useState(() => guardado?.filas || []);
  const [search, setSearch]     = useState('');
  // Sin nada guardado no hay qué mostrar hasta que responda la nube.
  const [loading, setLoading]   = useState(() => !guardado);
  // Buscando cambios en la nube mientras ya se muestra lo guardado.
  const [actualizando, setActualizando] = useState(true);
  // Etiqueta de antigüedad si la lista salió del caché · null si vino de la nube
  const [desdeCache, setDesdeCache] = useState(null);

  const [selected, setSelected]       = useState(null);
  const [sessionCount, setSessionCount] = useState(0);

  // Alta de paciente
  const [newCode, setNewCode]   = useState('');
  const [firstName, setFirst]   = useState('');
  const [lastName, setLast]     = useState('');
  const [patientVals, setPVals] = useState({});

  const patientFields = useMemo(() => fields.filter((f) => f.scope === 'patient'), [fields]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [fs, ps] = await Promise.all([
          fetchFields(supabase, { soloNube: true }),
          fetchPatients(supabase, { soloNube: true }),
        ]);
        if (!alive) return;
        setFields(fs);
        setPatients(ps.filas);
        setDesdeCache(null);
      } catch (e) {
        if (!alive) return;
        if (guardado) {
          // Sin internet: se sigue con lo guardado, y se dice de cuándo es.
          setDesdeCache(describirAntiguedad(guardado.cache) || 'sin fecha');
        } else {
          onError?.('Sin internet y sin lista guardada en esta computadora. Abrí la app una vez con internet: la lista se descarga sola.');
          console.error('[PatientGate]', e);
        }
      } finally {
        if (alive) { setLoading(false); setActualizando(false); }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return patients;
    return patients.filter((p) =>
      [p.code, p.first_name, p.last_name].filter(Boolean).join(' ').toLowerCase().includes(s));
  }, [patients, search]);

  // El paso siguiente se muestra ya, con el último conteo guardado, y se
  // corrige cuando contesta la nube (o la cola local, sin internet).
  const choose = (p) => {
    setSelected(p);
    setSessionCount(conteoGuardado(p.id));
    setStep('session');
    contarSesionesPaciente(supabase, p.id).then((n) => setSessionCount(n)).catch(() => {});
  };

  const startNew = async () => {
    setNewCode(await nextPatientCode(supabase));
    setFirst(''); setLast(''); setPVals({});
    setStep('new');
  };

  const saveNew = async () => {
    const faltan = missingRequired(patientFields, patientVals);
    if (faltan.length > 0) { onError?.(`Faltan campos: ${faltan.join(', ')}`); return; }
    if (!newCode.trim()) { onError?.('El código es obligatorio'); return; }
    try {
      const p = await createPatient(supabase, {
        code: newCode.trim(),
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        data: coerceValues(patientFields, patientVals),
      });
      setPatients((prev) => [...prev, p].sort((a, b) => a.code.localeCompare(b.code)));
      setSelected(p);
      setSessionCount(0);
      setStep('session');
    } catch (e) {
      onError?.(e?.message?.includes('duplicate') ? 'Ese código ya existe' : 'No se pudo crear el paciente');
      console.error('[PatientGate] createPatient', e);
    }
  };

  // Los datos de la sesión (temperatura, humedad, agua, comidas) se cargan al
  // EXPORTAR: recién ahí se conocen, y el agua se calcula sumando los eventos.
  // Acá solo se ata la medición al paciente.
  const confirm = () => onReady?.({ patient: selected });

  return (
    <div className="modal-veil" onClick={onCancel}>
      <div className="modal-card modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            {step === 'pick'    && 'Seleccionar paciente'}
            {step === 'new'     && 'Nuevo paciente'}
            {step === 'session' && `Sesión de ${patientLabel(selected)}`}
          </h3>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Cerrar">×</button>
        </div>

        <div className="drawer-body">
          {loading ? (
            <span className="field-hint">Cargando…</span>
          ) : step === 'pick' ? (
            <div className="patient-gate">
              <span className="field-hint">
                La medición queda asociada al paciente antes de empezar, para que las
                sesiones repetidas de una misma persona queden agrupadas.
              </span>

              {/* Enlazado al equipo no hay internet: se trabaja con la última
                  lista descargada. Hay que decirlo, o parecería que faltan
                  pacientes. */}
              {desdeCache && (
                <div className="cache-aviso" role="note">
                  <strong>Lista guardada en esta computadora · actualizada {desdeCache}</strong>
                  <span>
                    Sin conexión a la nube, normal en la red del Chidori. Podés elegir y
                    crear pacientes igual: lo nuevo sube solo cuando vuelva internet. Un
                    paciente cargado en otra computadora después de esa hora todavía no
                    aparece.
                  </span>
                </div>
              )}
              {!desdeCache && actualizando && guardado && (
                <span className="field-hint">Buscando cambios en la nube…</span>
              )}

              <div className="field">
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    placeholder="Buscar por código, nombre o apellido"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                  />
                  <button type="button" className="button button-primary" onClick={startNew}>
                    <UserPlus size={14} />
                    Nuevo
                  </button>
                </div>
              </div>

              {filtered.length === 0 ? (
                <span className="field-hint">
                  {patients.length === 0
                    ? 'Todavía no hay pacientes cargados. Creá el primero con “Nuevo”.'
                    : 'Sin resultados para esa búsqueda.'}
                </span>
              ) : (
                <div className="patient-list">
                  {filtered.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="patient-item"
                      onClick={() => choose(p)}
                    >
                      <span>
                        <span className="patient-item-code">{p.code}</span>
                        {(p.last_name || p.first_name) && (
                          <span className="patient-item-name">
                            {' · '}{[p.last_name, p.first_name].filter(Boolean).join(', ')}
                          </span>
                        )}
                      </span>
                      <span className="patient-item-meta">
                        {p._pendiente ? 'sin subir · ' : ''}Seleccionar →
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : step === 'new' ? (
            <div className="stack-md">
              <div className="dyn-grid" style={{ '--dyn-cols': 3 }}>
                <div className="field">
                  <label className="field-label" htmlFor="np-code">Código *</label>
                  <input id="np-code" className="input numeric" value={newCode}
                    onChange={(e) => setNewCode(e.target.value)} />
                  <span className="field-hint">Identifica al paciente en el dataset.</span>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="np-last">Apellido</label>
                  <input id="np-last" className="input" value={lastName} onChange={(e) => setLast(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="np-first">Nombre</label>
                  <input id="np-first" className="input" value={firstName} onChange={(e) => setFirst(e.target.value)} />
                </div>
              </div>

              <hr className="hairline" />
              <span className="section-label">Datos del paciente</span>
              <span className="field-hint">
                Se cargan una sola vez: son los que no cambian entre sesiones.
              </span>

              <DynamicFields
                fields={patientFields}
                values={patientVals}
                onChange={(k, v) => setPVals((prev) => ({ ...prev, [k]: v }))}
                columns={3}
              />

              <div className="row" style={{ justifyContent: 'space-between' }}>
                <button type="button" className="button button-ghost" onClick={() => setStep('pick')}>
                  <ArrowLeft size={14} />
                  Volver
                </button>
                <button type="button" className="button button-primary" onClick={saveNew}>
                  <Check size={14} />
                  Crear y continuar
                </button>
              </div>
            </div>
          ) : (
            <div className="stack-md">
              <div className="step-summary" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <span>Paciente</span>
                <span>Sesión</span>
                <strong>{patientLabel(selected)}</strong>
                <strong className="numeric">N.º {sessionCount + 1}</strong>
              </div>

              <span className="field-hint">
                Los datos de la sesión (temperatura, humedad, agua ingerida, comidas)
                se completan al finalizar, desde <strong>Exportar</strong>: recién ahí
                se conocen, y el agua se totaliza sola con las tomas que marques.
              </span>

              <div className="row" style={{ justifyContent: 'space-between' }}>
                <button type="button" className="button button-ghost" onClick={() => { setSelected(null); setStep('pick'); }}>
                  <ArrowLeft size={14} />
                  Cambiar paciente
                </button>
                <button type="button" className="button button-primary" onClick={confirm}>
                  <Check size={14} />
                  Confirmar y habilitar medición
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
