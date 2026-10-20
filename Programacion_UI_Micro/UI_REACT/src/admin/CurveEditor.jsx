import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Hand, ZoomIn, Scissors, Eraser, Flag, MessageSquare, MapPin, Trash2, Save,
  RotateCcw, Crosshair, AlertTriangle, Undo2,
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import EditorChart from './EditorChart';
import {
  aplicarEdicion, paramsVacios, normalizarParams, eventosDesdeBase, hayOperaciones,
  fmtTiempo, fmtDuracion, parseTiempo, periodoMuestreo, impar, ventanaDeClick,
  TIPOS_AGREGABLES, TIPOS_QUE_SOBREVIVEN_AL_RECORTE, NOMBRE_TIPO, TRAMO_AVISO_S, APOYO_S,
  VENTANA_CLICK_S, fusionarTramos,
} from '../lib/edicion';
import {
  guardarEdicion, borrarEdicion, guardarComentarios, nuevoId, diffComentarios,
} from '../lib/edicionDB';

/**
 * Editor de la curva de una sesión guardada.
 *
 * Nada de esto toca la sesión original: los cambios son parámetros (en la
 * base de tiempo ORIGINAL) y una serie nueva que se guarda aparte. Con
 * "Volver al original" se borra la edición y la sesión queda como se midió.
 *
 * Orden fijo del procesamiento (ver lib/edicion.js): recorte → tramos
 * sacados con relleno PCHIP → suavizado → basal/final → eventos.
 */

const HERRAMIENTAS = [
  { id: 'navegar',    label: 'Mover',      icon: Hand,
    hint: 'Arrastrá para desplazarte por la curva. Ctrl/⌘ + rueda acerca y aleja.' },
  { id: 'lupa',       label: 'Lupa',       icon: ZoomIn,
    hint: 'Arrastrá sobre un tramo para acercarte. Un click acerca al doble.' },
  { id: 'recorte',    label: 'Recortar',   icon: Scissors,
    hint: 'Arrastrá sobre la parte que se CONSERVA. Un click mueve el borde más cercano. El tiempo 0 pasa al nuevo inicio.' },
  { id: 'tramo',      label: 'Sacar tramo', icon: Eraser,
    hint: `Arrastrá sobre lo que hay que sacar: se rellena con una curva suave y monótona (PCHIP) apoyada en la mediana de ${APOYO_S} s de cada lado. Un click marca ±${VENTANA_CLICK_S} s.` },
  { id: 'basal',      label: 'Basal',      icon: Flag,
    hint: `Arrastrá la ventana de la basal; se toma la mediana. Un click marca ±${VENTANA_CLICK_S} s.` },
  { id: 'final',      label: 'Final',      icon: Flag,
    hint: `Arrastrá la ventana del valor final; se toma la mediana. Un click marca ±${VENTANA_CLICK_S} s.` },
  { id: 'comentario', label: 'Comentario', icon: MessageSquare,
    hint: 'Arrastrá para comentar un tramo, o click para un instante. Después escribís el texto abajo.' },
  { id: 'evento',     label: 'Evento',     icon: MapPin,
    hint: 'Click donde va el evento nuevo. El tipo se elige al lado.' },
];

const fmtZ = (z, d = 3) => (z == null || !Number.isFinite(Number(z)) ? '—' : `${Number(z).toFixed(d)} Ω`);
const r3 = (x) => Math.round(x * 1000) / 1000;

/* ── campo de tiempo mm:ss ───────────────────────────────────────────── */
function TiempoInput({ value, onChange, placeholder = 'mm:ss', ariaLabel, width = 92, vacioPermitido = false }) {
  // null = no se está escribiendo: se muestra el valor de afuera tal cual
  const [txt, setTxt] = useState(null);
  const [mal, setMal] = useState(false);
  const mostrado = txt ?? (value == null ? '' : fmtTiempo(value, 1));
  const confirmar = () => {
    if (txt == null) return;
    if (!txt.trim() && vacioPermitido) { setMal(false); setTxt(null); if (value != null) onChange(null); return; }
    const v = parseTiempo(txt);
    if (v == null) { setMal(true); return; }
    setMal(false);
    setTxt(null);
    if (value == null || Math.abs(v - value) > 1e-6) onChange(v);
  };
  return (
    <input
      className={`input numeric time-input${mal ? ' is-invalid' : ''}`}
      style={{ width, padding: '6px 8px' }}
      value={mostrado}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={mal || undefined}
      title="mm:ss · también h:mm:ss o segundos"
      onChange={(e) => setTxt(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
        if (e.key === 'Escape') { setTxt(null); setMal(false); }
      }}
    />
  );
}

function Panel({ titulo, accion, children, hint }) {
  return (
    <section className="editor-panel">
      <div className="row-between" style={{ marginBottom: 8, gap: 8 }}>
        <span className="section-label">{titulo}</span>
        {accion}
      </div>
      {hint && <span className="field-hint" style={{ display: 'block', marginBottom: 8 }}>{hint}</span>}
      {children}
    </section>
  );
}

export default function CurveEditor({
  supabase,
  session,
  original,            // measurements (con voltage_v)
  eventosOriginales,   // session_events
  edicion,             // fila de session_edits | null
  comentarios: comentariosIniciales = [],
  comentariosCargados = true,   // false = no se pudieron leer: no se tocan
  onCancel,
  onSaved,             // async ({ accion }) => void · el padre recarga
}) {
  const [params, setParams] = useState(() => (edicion?.params ? normalizarParams(edicion.params) : paramsVacios()));
  const [comentarios, setComentarios] = useState(() => comentariosIniciales.map((c) => ({ ...c })));
  const [notas, setNotas] = useState(session.notes || '');
  const [herramienta, setHerramienta] = useState('navegar');
  const [tipoEvento, setTipoEvento] = useState('water');
  const [mlEvento, setMlEvento] = useState('');
  const [enfocarComentario, setEnfocarComentario] = useState(null);
  const [pedidoVista, setPedidoVista] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [progreso, setProgreso] = useState(null);
  const [error, setError] = useState(null);
  const [confirmarOriginal, setConfirmarOriginal] = useState(false);
  const historial = useRef([]);   // para deshacer el último cambio de params
  const [nHistorial, setNHistorial] = useState(0);

  const periodo = useMemo(() => periodoMuestreo(original), [original]);
  const resultado = useMemo(
    () => aplicarEdicion(original, eventosOriginales, params),
    [original, eventosOriginales, params],
  );
  const tMin = original.length ? Number(original[0].elapsed_time) : 0;
  const tMax = original.length ? Number(original[original.length - 1].elapsed_time) : 0;
  const { lo, hi, tCero, stats } = resultado;
  const conOperaciones = hayOperaciones(params, eventosOriginales);

  const cambiar = useCallback((fn) => {
    setParams((prev) => {
      historial.current.push(prev);
      if (historial.current.length > 60) historial.current.shift();
      return normalizarParams(typeof fn === 'function' ? fn(prev) : fn);
    });
    setNHistorial(Math.min(60, historial.current.length + 1));
  }, []);
  const deshacer = () => {
    const prev = historial.current.pop();
    if (prev) setParams(prev);
    setNHistorial(historial.current.length);
  };

  /* ── eventos editables (base original) ──────────────────────────────── */
  const eventosParam = useMemo(
    () => params.eventos ?? eventosDesdeBase(eventosOriginales),
    [params.eventos, eventosOriginales],
  );
  const cambiarEventos = (fn) => cambiar((p) => ({ ...p, eventos: fn(p.eventos ?? eventosDesdeBase(eventosOriginales)) }));
  const proximoId = () => Math.max(0, ...eventosParam.map((e) => e.id), ...eventosOriginales.map((e) => Number(e.event_number) || 0)) + 1;
  const agregarEvento = (t) => {
    const ml = parseFloat(String(mlEvento).replace(',', '.'));
    cambiarEventos((lista) => [...lista, {
      id: proximoId(), kind: tipoEvento, t: r3(t),
      ml: tipoEvento !== 'mark' && Number.isFinite(ml) ? ml : null, gap_s: null, origen: 'agregado',
    }]);
  };

  /* ── selección en el gráfico ────────────────────────────────────────── */
  const onSeleccion = useCallback(({ desde, hasta, click, t }) => {
    const ventana = click ? ventanaDeClick(t, tMin, tMax) : { desde, hasta };
    const v = { desde: r3(ventana.desde), hasta: r3(ventana.hasta) };
    switch (herramienta) {
      case 'recorte':
        if (click) {
          cambiar((p) => {
            const r = p.recorte || { desde: tMin, hasta: tMax };
            const alInicio = Math.abs(t - r.desde) <= Math.abs(t - r.hasta);
            return { ...p, recorte: alInicio ? { desde: r3(t), hasta: r.hasta } : { desde: r.desde, hasta: r3(t) } };
          });
        } else {
          cambiar((p) => ({ ...p, recorte: { desde: r3(desde), hasta: r3(hasta) } }));
        }
        break;
      case 'tramo': cambiar((p) => ({ ...p, tramos: [...p.tramos, v] })); break;
      case 'basal': cambiar((p) => ({ ...p, basal: v })); break;
      case 'final': cambiar((p) => ({ ...p, final: v })); break;
      case 'comentario': {
        if (!comentariosCargados) break;
        const id = nuevoId();
        setComentarios((cs) => [...cs, { id, t_from: click ? r3(t) : v.desde, t_to: click ? null : v.hasta, body: '' }]
          .sort((a, b) => a.t_from - b.t_from));
        setEnfocarComentario(id);
        break;
      }
      case 'evento': agregarEvento(t); break;
      default: break;
    }
  // agregarEvento depende de tipoEvento/mlEvento/eventosParam: se rehace con ellos
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [herramienta, tMin, tMax, cambiar, tipoEvento, mlEvento, eventosParam, comentariosCargados]);

  /* ── capas del gráfico (base original) ──────────────────────────────── */
  const overlay = useMemo(() => ({
    lo: params.recorte ? lo : null,
    hi: params.recorte ? hi : null,
    tramos: resultado.tramos,
    basal: stats.basalVentana ? [stats.basalVentana[0] + tCero, stats.basalVentana[1] + tCero] : null,
    final: stats.finalVentana ? [stats.finalVentana[0] + tCero, stats.finalVentana[1] + tCero] : null,
  }), [params.recorte, lo, hi, resultado.tramos, stats.basalVentana, stats.finalVentana, tCero]);

  const eventosGrafico = useMemo(
    () => eventosParam.map((e) => ({
      event_number: e.id, elapsed_time: e.t, kind: e.kind,
      impedance_change: e.kind === 'gap' ? e.gap_s : null,
    })),
    [eventosParam],
  );
  // Siempre ordenados por tiempo: C3 es C3 acá, en el detalle y en el PDF
  const comentariosOrd = useMemo(
    () => [...comentarios].sort((a, b) => a.t_from - b.t_from).map((c, i) => ({ ...c, n: i + 1 })),
    [comentarios],
  );
  const comentariosGrafico = comentariosOrd;
  // Tramos unidos pero SIN recortar: si después se agranda el recorte, vuelven a valer
  const tramosLista = useMemo(() => fusionarTramos(params.tramos), [params.tramos]);

  /* ── guardar ────────────────────────────────────────────────────────── */
  const errores = resultado.errores;
  const notasCambiaron = (notas.trim() || null) !== (session.notes?.trim() || null);

  const guardarNotas = async () => {
    if (!notasCambiaron) return;
    const { error: e } = await supabase.from('sessions')
      .update({ notes: notas.trim() || null }).eq('id', session.id);
    if (e) throw e;
  };

  const guardar = async () => {
    if (errores.length) {
      setError('Hay cosas marcadas en rojo que impiden calcular la curva: corregilas antes de guardar.');
      return;
    }
    setGuardando(true);
    setError(null);
    setProgreso(null);
    try {
      let accion;
      const cambiosComentarios = comentariosCargados ? diffComentarios(comentariosIniciales, comentarios) : null;
      if (conOperaciones) {
        await guardarEdicion(supabase, {
          sessionId: session.id,
          resultado,
          params,
          comentarios: cambiosComentarios,
          onProgress: (n, total) => setProgreso({ n, total }),
        });
        accion = 'activar';
      } else if (edicion) {
        await borrarEdicion(supabase, session.id, cambiosComentarios);
        accion = 'borrar';
      } else {
        await guardarComentarios(supabase, session.id, cambiosComentarios);
        accion = 'mantener';
      }
      await guardarNotas();
      await onSaved?.({ accion });
    } catch (e) {
      setError(e.message || 'No se pudo guardar la edición.');
    } finally {
      setGuardando(false);
      setProgreso(null);
    }
  };

  const volverAlOriginal = async () => {
    setConfirmarOriginal(false);
    setGuardando(true);
    setError(null);
    try {
      await borrarEdicion(supabase, session.id);
      await onSaved?.({ accion: 'borrar' });
    } catch (e) {
      setError(e.message || 'No se pudo volver al original.');
    } finally {
      setGuardando(false);
    }
  };

  const herr = HERRAMIENTAS.find((h) => h.id === herramienta);
  const enEditada = (t) => fmtTiempo(t - tCero);
  const seg = (n) => (periodo ? `≈ ${(n * periodo).toFixed(1).replace('.', ',')} s` : '');

  return (
    <div className="curve-editor stack-md">
      {/* ── herramientas ─────────────────────────────────────────────── */}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div className="segment tool-segment" role="toolbar" aria-label="Herramientas">
          {HERRAMIENTAS.map((h) => {
            const Icono = h.icon;
            return (
              <button
                key={h.id}
                type="button"
                className={`segment-item ${herramienta === h.id ? 'active' : ''}`}
                onClick={() => setHerramienta(h.id)}
                title={h.hint}
                aria-pressed={herramienta === h.id}
              >
                <Icono size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                {h.label}
              </button>
            );
          })}
        </div>
        <button type="button" className="button button-ghost button-sm" onClick={deshacer}
          disabled={nHistorial === 0} title="Deshacer el último cambio de la curva">
          <Undo2 size={13} /> Deshacer
        </button>
      </div>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap', minHeight: 30 }}>
        <span className="field-hint" style={{ flex: '1 1 320px' }}>{herr?.hint}</span>
        {herramienta === 'evento' && (
          <div className="row" style={{ gap: 6 }}>
            <select className="input" style={{ width: 'auto', padding: '6px 8px' }} value={tipoEvento}
              onChange={(e) => setTipoEvento(e.target.value)} aria-label="Tipo de evento">
              {TIPOS_AGREGABLES.map((k) => <option key={k} value={k}>{NOMBRE_TIPO[k]}</option>)}
            </select>
            {tipoEvento !== 'mark' && (
              <input className="input numeric" style={{ width: 80, padding: '6px 8px' }} placeholder="ml"
                value={mlEvento} onChange={(e) => setMlEvento(e.target.value)} aria-label="Volumen en ml" />
            )}
          </div>
        )}
      </div>

      {/* ── gráfico ──────────────────────────────────────────────────── */}
      <div className="surface surface-pad">
        <EditorChart
          original={original}
          editada={resultado.serie}
          eventos={eventosGrafico}
          comentarios={comentariosGrafico}
          overlay={overlay}
          herramienta={herramienta}
          onSeleccion={onSeleccion}
          pedidoVista={pedidoVista}
        />
        <span className="field-hint" style={{ display: 'block', marginTop: 6 }}>
          Gris: la curva original · color: cómo queda · velo: lo que se recorta · ámbar: tramos
          rellenados · verde: ventanas de basal y final. Los tiempos del editor son los del
          registro original; la sesión editada arranca en 00:00.
        </span>
      </div>

      {/* ── resumen ──────────────────────────────────────────────────── */}
      <div className="readout" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="readout-cell">
          <span className="readout-label">Z basal · {stats.basalModo === 'manual' ? 'a mano' : 'primer minuto'}</span>
          <span className="readout-value numeric" style={{ fontSize: 'var(--t-lg)' }}>{fmtZ(stats.basal, 2)}</span>
        </div>
        <div className="readout-cell">
          <span className="readout-label">Z final · {stats.finalModo === 'manual' ? 'a mano' : 'último minuto'}</span>
          <span className="readout-value numeric" style={{ fontSize: 'var(--t-lg)' }}>{fmtZ(stats.final, 2)}</span>
        </div>
        <div className="readout-cell">
          <span className="readout-label">Cambio</span>
          <span className="readout-value numeric" style={{ fontSize: 'var(--t-lg)' }}>
            {stats.delta != null ? `${stats.delta > 0 ? '+' : ''}${stats.delta.toFixed(2)} Ω` : '—'}
            {stats.deltaPct != null && <span className="field-hint"> {stats.deltaPct.toFixed(1)} %</span>}
          </span>
        </div>
        <div className="readout-cell">
          <span className="readout-label">Duración</span>
          <span className="readout-value numeric" style={{ fontSize: 'var(--t-lg)' }}>{stats.elapsedStr}</span>
        </div>
        <div className="readout-cell">
          <span className="readout-label">Muestras</span>
          <span className="readout-value numeric" style={{ fontSize: 'var(--t-lg)' }}>
            {stats.samples.toLocaleString('es-AR')}
            {stats.interpoladas > 0 && <span className="field-hint"> · {stats.interpoladas.toLocaleString('es-AR')} interp.</span>}
          </span>
        </div>
      </div>

      {(errores.length > 0 || resultado.avisos.length > 0) && (
        <div className="stack-md" style={{ gap: 6 }}>
          {errores.map((m) => <div key={m} className="auth-feedback err">{m}</div>)}
          {resultado.avisos.map((m) => (
            <div key={m} className="editor-aviso"><AlertTriangle size={13} /> {m}</div>
          ))}
        </div>
      )}

      {/* ── paneles ──────────────────────────────────────────────────── */}
      <div className="editor-grid">
        <Panel
          titulo="Recorte de inicio y fin"
          accion={params.recorte && (
            <button type="button" className="button button-ghost button-sm"
              onClick={() => cambiar((p) => ({ ...p, recorte: null }))}>Sin recorte</button>
          )}
          hint={params.recorte
            ? `Se conservan ${fmtDuracion(hi - lo)} de ${fmtDuracion(tMax - tMin)}. El ${fmtTiempo(lo)} original pasa a ser el 00:00.`
            : 'Sin recorte: la sesión entera.'}
        >
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="field-label" style={{ margin: 0 }}>Desde</label>
            <TiempoInput ariaLabel="Recorte desde" value={params.recorte?.desde ?? tMin}
              onChange={(v) => cambiar((p) => ({ ...p, recorte: { desde: v, hasta: p.recorte?.hasta ?? tMax } }))} />
            <label className="field-label" style={{ margin: 0 }}>Hasta</label>
            <TiempoInput ariaLabel="Recorte hasta" value={params.recorte?.hasta ?? tMax}
              onChange={(v) => cambiar((p) => ({ ...p, recorte: { desde: p.recorte?.desde ?? tMin, hasta: v } }))} />
          </div>
        </Panel>

        <Panel
          titulo={`Tramos sacados (${tramosLista.length})`}
          hint={tramosLista.length === 0
            ? 'Ninguno. Con la herramienta "Sacar tramo" se marcan en el gráfico.'
            : `Rellenados con PCHIP sobre Z y Vadc. Los puntos rellenados cuentan en los cálculos y quedan marcados como interpolados.`}
        >
          {tramosLista.length > 0 && (
            <div className="editor-list">
              {tramosLista.map((r, i) => (
                <div className={`editor-row${r.hasta < lo || r.desde > hi ? ' is-descartado' : ''}`} key={`${r.desde}-${r.hasta}`}>
                  <span className="numeric" style={{ minWidth: 26 }}>{i + 1}</span>
                  <TiempoInput ariaLabel="Tramo desde" value={r.desde}
                    onChange={(v) => cambiar((p) => ({ ...p, tramos: tramosLista.map((x, j) => (j === i ? { ...x, desde: v } : x)) }))} />
                  <span className="mute">–</span>
                  <TiempoInput ariaLabel="Tramo hasta" value={r.hasta}
                    onChange={(v) => cambiar((p) => ({ ...p, tramos: tramosLista.map((x, j) => (j === i ? { ...x, hasta: v } : x)) }))} />
                  <span className={`field-hint${r.hasta - r.desde > TRAMO_AVISO_S ? ' texto-amber' : ''}`}>
                    {fmtDuracion(r.hasta - r.desde)}
                    {(r.hasta < lo || r.desde > hi) && ' · fuera del recorte, no hace nada'}
                  </span>
                  <span style={{ marginLeft: 'auto' }} className="row">
                    <button type="button" className="icon-button" title="Ver en el gráfico"
                      onClick={() => setPedidoVista({ ...r })}><Crosshair size={14} /></button>
                    <button type="button" className="icon-button" title="Quitar este tramo"
                      onClick={() => cambiar((p) => ({ ...p, tramos: tramosLista.filter((_, j) => j !== i) }))}>
                      <Trash2 size={14} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          titulo="Suavizado"
          hint="Filtro centrado de n muestras sobre Z y Vadc (después de rellenar los tramos). Lo suavizado es lo que entra al análisis."
        >
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select className="input" style={{ width: 'auto', padding: '6px 8px' }}
              value={params.suavizado?.tipo || ''} aria-label="Tipo de filtro"
              onChange={(e) => {
                const tipo = e.target.value;
                cambiar((p) => ({ ...p, suavizado: tipo ? { tipo, n: p.suavizado?.n || 9 } : null }));
              }}>
              <option value="">Sin suavizar</option>
              <option value="mediana">Mediana móvil</option>
              <option value="media">Media móvil</option>
            </select>
            {params.suavizado && (
              <>
                <input
                  className="input numeric"
                  style={{ width: 80, padding: '6px 8px' }}
                  type="number" min={3} step={2}
                  value={params.suavizado.n}
                  aria-label="Muestras de la ventana"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 3) cambiar((p) => ({ ...p, suavizado: { ...p.suavizado, n: impar(n) } }));
                  }}
                />
                <span className="field-hint">muestras · {seg(params.suavizado.n)}</span>
              </>
            )}
          </div>
        </Panel>

        <Panel
          titulo="Basal y final"
          hint="Sin ventana a mano valen las reglas de siempre sobre la curva editada: mediana del primer minuto y del último."
        >
          {['basal', 'final'].map((k) => {
            const r = params[k];
            return (
              <div className="editor-row" key={k}>
                <span className="field-label" style={{ minWidth: 44, margin: 0 }}>{k}</span>
                {r ? (
                  <>
                    <TiempoInput ariaLabel={`${k} desde`} value={r.desde}
                      onChange={(v) => cambiar((p) => ({ ...p, [k]: { ...p[k], desde: v } }))} />
                    <span className="mute">–</span>
                    <TiempoInput ariaLabel={`${k} hasta`} value={r.hasta}
                      onChange={(v) => cambiar((p) => ({ ...p, [k]: { ...p[k], hasta: v } }))} />
                    <button type="button" className="button button-ghost button-sm" style={{ marginLeft: 'auto' }}
                      onClick={() => cambiar((p) => ({ ...p, [k]: null }))}>Automática</button>
                  </>
                ) : (
                  <span className="field-hint">
                    automática · {k === 'basal' ? 'primer minuto' : 'último minuto'} · marcala con la herramienta “{k === 'basal' ? 'Basal' : 'Final'}”
                  </span>
                )}
              </div>
            );
          })}
        </Panel>

        <Panel
          titulo={`Eventos (${eventosParam.length})`}
          accion={params.eventos && (
            <button type="button" className="button button-ghost button-sm"
              onClick={() => cambiar((p) => ({ ...p, eventos: null }))}>
              <RotateCcw size={12} /> Los originales
            </button>
          )}
          hint="Fuera del recorte se conservan las ingestas y micciones (cuentan para lo que pasa después); las marcas y los cortes se descartan."
        >
          <div className="editor-list" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {eventosParam.length === 0 && <span className="field-hint">Sin eventos.</span>}
            {[...eventosParam].sort((a, b) => a.t - b.t).map((e) => {
              const fuera = e.t < lo || e.t > hi;
              const sobrevive = !fuera || TIPOS_QUE_SOBREVIVEN_AL_RECORTE.has(e.kind);
              const conMl = e.kind === 'water' || e.kind === 'void';
              const editable = TIPOS_AGREGABLES.includes(e.kind);
              return (
                <div className={`editor-row${sobrevive ? '' : ' is-descartado'}`} key={`${e.id}-${e.kind}`}>
                  <span className="numeric" style={{ minWidth: 26 }}>#{e.id}</span>
                  <span style={{ minWidth: 86 }}>{NOMBRE_TIPO[e.kind] || e.kind}</span>
                  {editable ? (
                    <TiempoInput ariaLabel="Tiempo del evento" value={e.t}
                      onChange={(v) => cambiarEventos((l) => l.map((x) => (x.id === e.id && x.kind === e.kind ? { ...x, t: v } : x)))} />
                  ) : <span className="numeric" style={{ width: 92 }}>{fmtTiempo(e.t, 1)}</span>}
                  {conMl ? (
                    <input className="input numeric" style={{ width: 72, padding: '6px 8px' }}
                      defaultValue={e.ml ?? ''} placeholder="ml" aria-label="Volumen en ml"
                      onBlur={(ev) => {
                        const ml = ev.target.value.trim() === '' ? null : Number(ev.target.value.replace(',', '.'));
                        if (ml !== null && !Number.isFinite(ml)) { ev.target.value = e.ml ?? ''; return; }
                        if ((ml ?? null) !== (e.ml ?? null)) cambiarEventos((l) => l.map((x) => (x.id === e.id && x.kind === e.kind ? { ...x, ml } : x)));
                      }} />
                  ) : <span style={{ width: 72 }} className="field-hint">{e.kind === 'gap' && e.gap_s != null ? `${Number(e.gap_s).toFixed(1)} s` : ''}</span>}
                  <span className="field-hint" style={{ flex: '1 1 120px', minWidth: 0 }}>
                    {!sobrevive ? 'se descarta' : fuera ? 'fuera del recorte · se conserva' : `en la editada ${enEditada(e.t)}`}
                    {e.origen === 'agregado' ? ' · agregado' : ''}
                  </span>
                  <span style={{ marginLeft: 'auto' }} className="row">
                    <button type="button" className="icon-button" title="Ver en el gráfico"
                      onClick={() => setPedidoVista({ desde: e.t - 30, hasta: e.t + 30 })}><Crosshair size={14} /></button>
                    <button type="button" className="icon-button" title="Borrar este evento"
                      onClick={() => cambiarEventos((l) => l.filter((x) => !(x.id === e.id && x.kind === e.kind)))}>
                      <Trash2 size={14} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          <span className="field-hint" style={{ display: 'block', marginTop: 6 }}>
            Para agregar uno: herramienta “Evento” y click en el gráfico.
          </span>
        </Panel>

        <Panel
          titulo={`Comentarios en la curva (${comentarios.length})`}
          hint={comentariosCargados
            ? 'Anclados a un instante o a un tramo. No dependen de la edición: si se vuelve al original, quedan.'
            : 'No se pudieron leer los comentarios guardados: no se muestran ni se tocan. Cerrá y volvé a abrir la sesión para editarlos.'}
        >
          <div className="editor-list" style={{ maxHeight: 300, overflowY: 'auto' }}>
            {comentariosCargados && comentarios.length === 0 && <span className="field-hint">Ninguno. Herramienta “Comentario” y click o arrastre en el gráfico.</span>}
            {comentariosOrd.map((c) => (
              <div className="editor-comment" key={c.id}>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className="editor-badge">C{c.n}</span>
                  <TiempoInput ariaLabel="Comentario desde" value={c.t_from}
                    onChange={(v) => setComentarios((cs) => cs.map((x) => (x.id === c.id ? { ...x, t_from: v, t_to: x.t_to != null && x.t_to < v ? v : x.t_to } : x)))} />
                  <span className="mute">–</span>
                  <TiempoInput ariaLabel="Comentario hasta" value={c.t_to} vacioPermitido placeholder="instante"
                    onChange={(v) => setComentarios((cs) => cs.map((x) => (x.id === c.id ? { ...x, t_to: v != null && v < x.t_from ? x.t_from : v } : x)))} />
                  <span style={{ marginLeft: 'auto' }} className="row">
                    <button type="button" className="icon-button" title="Ver en el gráfico"
                      onClick={() => setPedidoVista({ desde: c.t_from, hasta: c.t_to ?? c.t_from })}><Crosshair size={14} /></button>
                    <button type="button" className="icon-button" title="Borrar el comentario"
                      onClick={() => setComentarios((cs) => cs.filter((x) => x.id !== c.id))}><Trash2 size={14} /></button>
                  </span>
                </div>
                <textarea
                  className="input"
                  rows={2}
                  value={c.body}
                  placeholder="Qué pasó acá…"
                  ref={(el) => { if (el && enfocarComentario === c.id) { el.focus(); setEnfocarComentario(null); } }}
                  onChange={(e) => setComentarios((cs) => cs.map((x) => (x.id === c.id ? { ...x, body: e.target.value } : x)))}
                  style={{ resize: 'vertical', marginTop: 6, fontFamily: 'inherit', lineHeight: 1.45 }}
                />
                {!c.body.trim() && <span className="field-hint">Sin texto no se guarda.</span>}
              </div>
            ))}
          </div>
        </Panel>

        <Panel titulo="Comentario general (notas de la sesión)">
          <textarea
            className="input"
            rows={3}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Particularidades de la medición, incidencias, observaciones…"
            style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
          />
          <span className="field-hint" style={{ display: 'block', marginTop: 6 }}>
            Es el mismo campo “Notas de la sesión” del formulario de edición.
          </span>
        </Panel>
      </div>

      {/* ── guardar ──────────────────────────────────────────────────── */}
      {error && <div className="auth-feedback err" role="alert">{error}</div>}
      <div className="editor-savebar">
        <span className="field-hint" style={{ flex: '1 1 260px' }}>
          {progreso
            ? `Subiendo la curva editada · ${progreso.n.toLocaleString('es-AR')} de ${progreso.total.toLocaleString('es-AR')} muestras…`
            : conOperaciones
              ? 'Al guardar, la editada pasa a ser la principal de la sesión. La original queda intacta.'
              : edicion
                ? 'No queda ninguna operación sobre la curva: guardar vuelve al original.'
                : 'Sin operaciones sobre la curva: se guardan solo los comentarios y las notas.'}
        </span>
        {edicion && (
          <button type="button" className="button button-sm" disabled={guardando}
            onClick={() => setConfirmarOriginal(true)}
            style={{ borderColor: 'var(--alarm-line)', color: 'var(--alarm)' }}>
            <RotateCcw size={13} /> Volver al original
          </button>
        )}
        <button type="button" className="button button-ghost" onClick={onCancel} disabled={guardando}>
          Descartar cambios
        </button>
        <button type="button" className="button button-primary" onClick={guardar}
          disabled={guardando || errores.length > 0}>
          <Save size={14} />
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      <ConfirmModal
        open={confirmarOriginal}
        title="Volver al original"
        body={(
          <>
            <p style={{ marginBottom: 10 }}>
              Se borra la edición de esta sesión (recorte, tramos, suavizado, basal/final y eventos
              corregidos) y vuelve a valer la curva como se midió. Los comentarios en la curva y el
              apta / no apta se conservan.
            </p>
            <p>Mantenga presionado el botón para confirmar.</p>
          </>
        )}
        actionLabel="Mantener para volver"
        onCancel={() => setConfirmarOriginal(false)}
        onConfirm={volverAlOriginal}
        holdMs={1200}
      />
    </div>
  );
}
