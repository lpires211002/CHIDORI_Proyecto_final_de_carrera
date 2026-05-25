import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Shield, LogOut, X, UserCheck, UserX, RefreshCw, Search, ChevronRight,
  Activity, Pencil, Trash2, Download, FileText, Table, FileType2, Save,
} from 'lucide-react';
import { supabase, emailToUsername } from '../supabaseClient';
import ConfirmModal from '../components/ConfirmModal';
import ShimmerSkeleton from '../components/ShimmerSkeleton';
import { exportPDF, exportCSV, exportTXT } from '../lib/exporters';

/**
 * AdminView · vista del superadmin.
 *
 *   tab "sessions"  → catálogo global de sesiones · drill-down con edit/delete/download
 *   tab "accounts"  → aprobaciones de cuentas pendientes
 */
export default function AdminView({ profile, onSignOut, onSwitchToDashboard }) {
  const [tab, setTab] = useState('sessions');
  const [accounts, setAccounts] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [filter, setFilter] = useState('');

  const loadAccounts = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, role, is_approved, display_name, created_at, email')
        .order('created_at', { ascending: false });
      if (err) throw err;
      setAccounts(data || []);
    } catch (e) {
      setError(e.message || 'No se pudieron leer las cuentas.');
    } finally {
      setBusy(false);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const { data: sessRows, error: err1 } = await supabase
        .from('sessions')
        .select(`
          id, created_at, patient_name, patient_age, patient_gender,
          patient_weight, patient_height, patient_iliac_circ, menstruation_info,
          initial_impedance, final_impedance, elapsed_time_str, total_events,
          user_id
        `)
        .order('created_at', { ascending: false })
        .limit(200);
      if (err1) throw err1;

      const ownerIds = [...new Set((sessRows || []).map((s) => s.user_id).filter(Boolean))];
      let ownersById = new Map();
      if (ownerIds.length > 0) {
        const { data: profRows, error: err2 } = await supabase
          .from('profiles')
          .select('id, display_name, email')
          .in('id', ownerIds);
        if (err2) throw err2;
        ownersById = new Map((profRows || []).map((p) => [p.id, p]));
      }

      const merged = (sessRows || []).map((s) => ({
        ...s,
        owner: s.user_id ? ownersById.get(s.user_id) || null : null,
      }));
      setSessions(merged);
    } catch (e) {
      setError(e.message || 'No se pudieron leer las sesiones.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'accounts') loadAccounts();
    else loadSessions();
  }, [tab, loadAccounts, loadSessions]);

  const setApproval = async (id, value) => {
    try {
      const { error: err } = await supabase
        .from('profiles')
        .update({ is_approved: value })
        .eq('id', id);
      if (err) throw err;
      setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, is_approved: value } : a)));
    } catch (e) {
      setError(e.message || 'No se pudo actualizar la cuenta.');
    }
  };

  /** Re-fetch una sesión y actualizar la lista (post-edit). */
  const refreshSession = async (sessionId) => {
    const { data, error: err } = await supabase
      .from('sessions')
      .select('id, created_at, patient_name, patient_age, patient_gender, patient_weight, patient_height, patient_iliac_circ, menstruation_info, initial_impedance, final_impedance, elapsed_time_str, total_events, user_id')
      .eq('id', sessionId)
      .maybeSingle();
    if (err || !data) return;
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, ...data } : s)));
    setSelectedSession((cur) => (cur && cur.id === sessionId ? { ...cur, ...data } : cur));
  };

  /** Borrar la sesión (cascade: measurements + events). */
  const deleteSession = async (sessionId) => {
    const { error: err } = await supabase.from('sessions').delete().eq('id', sessionId);
    if (err) {
      setError(err.message || 'No se pudo eliminar la sesión.');
      return false;
    }
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setSelectedSession(null);
    return true;
  };

  const filteredSessions = useMemo(() => {
    if (!filter.trim()) return sessions;
    const f = filter.toLowerCase();
    return sessions.filter((s) =>
      [s.patient_name, s.owner?.display_name, s.owner?.email, s.elapsed_time_str]
        .filter(Boolean).some((x) => x.toLowerCase().includes(f))
    );
  }, [sessions, filter]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">Chidori</span>
          <span className="brand-tag" style={{ color: 'var(--signal)' }}>
            <Shield size={11} style={{ verticalAlign: '-1px', marginRight: 6 }} />
            Panel de administración
          </span>
        </div>

        <div className="app-actions">
          <button
            type="button"
            className="button button-sm"
            onClick={onSwitchToDashboard}
            title="Cambiar a la vista de medición"
          >
            <Activity size={14} />
            Tomar mediciones
          </button>
          <span className="pill pill-confirm">
            <span className="pill-dot" />
            {profile?.display_name || 'sa'}
          </span>
          <button type="button" className="icon-button" onClick={onSignOut} title="Cerrar sesión">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="segment">
          <button
            type="button"
            className={`segment-item ${tab === 'sessions' ? 'active' : ''}`}
            onClick={() => setTab('sessions')}
          >
            Sesiones registradas
          </button>
          <button
            type="button"
            className={`segment-item ${tab === 'accounts' ? 'active' : ''}`}
            onClick={() => setTab('accounts')}
          >
            Cuentas de clínicos
          </button>
        </div>

        {error && (
          <div className="auth-feedback err" role="alert" style={{ alignSelf: 'stretch' }}>
            {error}
          </div>
        )}

        {tab === 'sessions' && (
          <SessionsPanel
            sessions={filteredSessions}
            busy={busy}
            filter={filter}
            setFilter={setFilter}
            onReload={loadSessions}
            setSelectedSession={setSelectedSession}
          />
        )}

        {tab === 'accounts' && (
          <AccountsPanel
            accounts={accounts}
            busy={busy}
            onReload={loadAccounts}
            onApprove={(id) => setApproval(id, true)}
            onRevoke={(id) => setApproval(id, false)}
          />
        )}
      </main>

      <footer className="app-footer">
        <span>Modo administrador · acceso global a sesiones y cuentas</span>
        <span>Chidori 2026</span>
      </footer>

      {selectedSession && (
        <SessionDetailModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          onSessionUpdated={refreshSession}
          onSessionDeleted={deleteSession}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */

function AccountsPanel({ accounts, busy, onReload, onApprove, onRevoke }) {
  const pending  = accounts.filter((a) => !a.is_approved);
  const approved = accounts.filter((a) => a.is_approved);

  return (
    <section className="stack-md">
      <div className="row-between">
        <div>
          <h2>Cuentas</h2>
          <span className="section-label" style={{ display: 'block', marginTop: 4 }}>
            {pending.length} pendientes · {approved.length} aprobadas
          </span>
        </div>
        <button type="button" className="button button-ghost button-sm" onClick={onReload} disabled={busy}>
          <RefreshCw size={13} className={busy ? 'rotating' : ''} />
          Recargar
        </button>
      </div>

      <div className="surface" style={{ overflow: 'hidden' }}>
        {busy && accounts.length === 0 && (
          <div style={{ padding: '14px 18px' }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--hairline)' }}>
                <div style={{ flex: 1 }}>
                  <ShimmerSkeleton width="40%" height={14} />
                  <div style={{ height: 6 }} />
                  <ShimmerSkeleton width="55%" height={11} />
                </div>
                <ShimmerSkeleton width={70} height={22} style={{ borderRadius: 999 }} />
                <ShimmerSkeleton width={86} height={28} />
              </div>
            ))}
          </div>
        )}
        {!busy && accounts.length === 0 && (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--type-mute)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
            Sin cuentas todavía.
          </div>
        )}
        {accounts.map((a) => {
          const username = emailToUsername(a.email);
          return (
            <div
              key={a.id}
              className="admin-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                alignItems: 'center',
                gap: 14,
                padding: '14px 18px',
                borderBottom: '1px solid var(--hairline)',
              }}
            >
              <div>
                <div style={{ color: 'var(--type-hi)', fontWeight: 500 }}>
                  {a.display_name || username}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', color: 'var(--type-mute)' }}>
                  {username} {a.role === 'superadmin' ? '· admin' : ''}
                </div>
              </div>
              <span className="mute" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
                {new Date(a.created_at).toLocaleDateString('es-AR')}
              </span>
              {a.is_approved
                ? <span className="pill pill-confirm"><span className="pill-dot" />Aprobada</span>
                : <span className="pill pill-alarm"><span className="pill-dot" />Pendiente</span>}

              {a.role === 'superadmin' ? (
                <span className="mute" style={{ fontSize: 'var(--t-xs)' }}>—</span>
              ) : a.is_approved ? (
                <button type="button" className="button button-ghost button-sm" onClick={() => onRevoke(a.id)}>
                  <UserX size={13} />
                  Revocar
                </button>
              ) : (
                <button type="button" className="button button-primary button-sm" onClick={() => onApprove(a.id)}>
                  <UserCheck size={13} />
                  Aprobar
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────── */

function SessionsPanel({ sessions, busy, filter, setFilter, onReload, setSelectedSession }) {
  return (
    <section className="stack-md">
      <div className="row-between" style={{ gap: 14, flexWrap: 'wrap' }}>
        <div>
          <h2>Sesiones registradas</h2>
          <span className="section-label" style={{ display: 'block', marginTop: 4 }}>
            {sessions.length} mostradas · ordenadas por fecha descendente
          </span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div className="field" style={{ gap: 0 }}>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--type-mute)' }} />
              <input
                className="input"
                style={{ paddingLeft: 30, minWidth: 240 }}
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrar por paciente o clínico"
              />
            </div>
          </div>
          <button type="button" className="button button-ghost button-sm" onClick={onReload} disabled={busy}>
            <RefreshCw size={13} className={busy ? 'rotating' : ''} />
            Recargar
          </button>
        </div>
      </div>

      <div className="surface" style={{ overflow: 'hidden' }}>
        {busy && sessions.length === 0 && (
          <div style={{ padding: '14px 18px' }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{
                display: 'grid',
                gridTemplateColumns: '1.6fr 1.4fr 1fr 1fr 16px',
                gap: 14,
                alignItems: 'center',
                padding: '14px 0',
                borderBottom: '1px solid var(--hairline)',
              }}>
                <div>
                  <ShimmerSkeleton width="65%" height={14} />
                  <div style={{ height: 6 }} />
                  <ShimmerSkeleton width="45%" height={11} />
                </div>
                <div>
                  <ShimmerSkeleton width="35%" height={11} />
                  <div style={{ height: 6 }} />
                  <ShimmerSkeleton width="60%" height={13} />
                </div>
                <div>
                  <ShimmerSkeleton width="45%" height={11} />
                  <div style={{ height: 6 }} />
                  <ShimmerSkeleton width="70%" height={13} />
                </div>
                <div>
                  <ShimmerSkeleton width="50%" height={11} />
                  <div style={{ height: 6 }} />
                  <ShimmerSkeleton width="60%" height={13} />
                </div>
                <ShimmerSkeleton width={16} height={16} />
              </div>
            ))}
          </div>
        )}
        {!busy && sessions.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--type-mute)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
            No hay sesiones que coincidan.
          </div>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSelectedSession(s)}
            className="admin-row"
            style={{
              width: '100%',
              display: 'grid',
              gridTemplateColumns: '1.6fr 1.4fr 1fr 1fr auto',
              alignItems: 'center',
              gap: 14,
              padding: '14px 18px',
              borderBottom: '1px solid var(--hairline)',
              background: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div>
              <div style={{ color: 'var(--type-hi)', fontWeight: 500 }}>
                {s.patient_name || 'Paciente sin identificar'}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', color: 'var(--type-mute)' }}>
                {new Date(s.created_at).toLocaleString('es-AR')}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--t-sm)', color: 'var(--type-med)' }}>Clínico</div>
              <div style={{ color: 'var(--type-hi)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
                {s.owner?.display_name || emailToUsername(s.owner?.email) || '—'}
              </div>
            </div>
            <div>
              <div className="section-label">Z basal</div>
              <div className="numeric" style={{ color: 'var(--type-hi)', fontFamily: 'var(--font-mono)' }}>
                {s.initial_impedance != null ? `${s.initial_impedance.toFixed(2)} Ω` : '—'}
              </div>
            </div>
            <div>
              <div className="section-label">Duración</div>
              <div className="numeric" style={{ color: 'var(--type-hi)', fontFamily: 'var(--font-mono)' }}>
                {s.elapsed_time_str || '—'}
              </div>
            </div>
            <ChevronRight size={16} style={{ color: 'var(--type-mute)' }} />
          </button>
        ))}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────── */

function SessionDetailModal({ session, onClose, onSessionUpdated, onSessionDeleted }) {
  const [measurements, setMeasurements] = useState([]);
  const [events, setEvents]             = useState([]);
  const [busy, setBusy]                 = useState(true);
  const [mode, setMode]                 = useState('view'); // view | edit
  const [saving, setSaving]             = useState(false);
  const [savingError, setSavingError]   = useState(null);
  const [askDelete, setAskDelete]       = useState(false);

  // Editable fields, pre-cargados desde la sesión
  const [editFields, setEditFields] = useState({
    patient_name:       session.patient_name       || '',
    patient_age:        session.patient_age        ?? '',
    patient_gender:     session.patient_gender     || '',
    patient_weight:     session.patient_weight     ?? '',
    patient_height:     session.patient_height     ?? '',
    patient_iliac_circ: session.patient_iliac_circ ?? '',
    menstruation_info:  session.menstruation_info  || '',
    initial_impedance:  session.initial_impedance  ?? '',
    final_impedance:    session.final_impedance    ?? '',
    elapsed_time_str:   session.elapsed_time_str   || '',
    total_events:       session.total_events       ?? 0,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      const [m, e] = await Promise.all([
        supabase
          .from('measurements')
          .select('elapsed_time, impedance, rate')
          .eq('session_id', session.id)
          .order('elapsed_time', { ascending: true })
          .limit(5000),
        supabase
          .from('session_events')
          .select('event_number, elapsed_time, impedance, impedance_change')
          .eq('session_id', session.id)
          .order('event_number', { ascending: true }),
      ]);
      if (cancelled) return;
      setMeasurements(m.data || []);
      setEvents(e.data || []);
      setBusy(false);
    })();
    return () => { cancelled = true; };
  }, [session.id]);

  const fmt = (n, d = 2) => (n == null ? '—' : Number(n).toFixed(d));

  const handleSave = async () => {
    setSaving(true);
    setSavingError(null);
    try {
      const payload = {
        patient_name:       editFields.patient_name        || null,
        patient_age:        editFields.patient_age   === '' ? null : parseInt(editFields.patient_age),
        patient_gender:     editFields.patient_gender      || null,
        patient_weight:     editFields.patient_weight === '' ? null : parseFloat(editFields.patient_weight),
        patient_height:     editFields.patient_height === '' ? null : parseFloat(editFields.patient_height),
        patient_iliac_circ: editFields.patient_iliac_circ === '' ? null : parseFloat(editFields.patient_iliac_circ),
        menstruation_info:  editFields.menstruation_info   || null,
        initial_impedance:  editFields.initial_impedance === '' ? null : parseFloat(editFields.initial_impedance),
        final_impedance:    editFields.final_impedance === '' ? null : parseFloat(editFields.final_impedance),
        elapsed_time_str:   editFields.elapsed_time_str    || null,
        total_events:       editFields.total_events === '' ? 0 : parseInt(editFields.total_events) || 0,
      };
      const { error: err } = await supabase
        .from('sessions')
        .update(payload)
        .eq('id', session.id);
      if (err) throw err;
      await onSessionUpdated?.(session.id);
      setMode('view');
    } catch (e) {
      setSavingError(e.message || 'No se pudieron guardar los cambios.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const ok = await onSessionDeleted?.(session.id);
    if (ok) setAskDelete(false);
  };

  /* ── Export handlers ────────────────────────────────────────────── */

  const buildPatient = () => {
    if (!session.patient_name && !session.patient_age) return null;
    return {
      nombre:        session.patient_name       || 'N/A',
      edad:          session.patient_age        ?? 'N/A',
      sexo:          session.patient_gender     || 'N/A',
      peso:          session.patient_weight     ?? 'N/A',
      altura:        session.patient_height     ?? 'N/A',
      circ:          session.patient_iliac_circ ?? 'N/A',
      menstruacion:  session.menstruation_info  || 'N/A',
    };
  };

  const buildStats = () => ({
    initialZ:   session.initial_impedance,
    finalZ:     session.final_impedance,
    elapsedStr: session.elapsed_time_str,
    eventCount: session.total_events ?? events.length,
    samples:    measurements.length,
  });

  const safeSlug = () => {
    const name = (session.patient_name || 'sin_identificar')
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const date = new Date(session.created_at).toISOString().slice(0, 10);
    return `${name}_${date}`;
  };

  const downloadPDF = () => exportPDF({
    filename: `chidori_${safeSlug()}.pdf`,
    patient: buildPatient(),
    stats: buildStats(),
    measurements,
    events,
  });

  const downloadCSV = () => exportCSV({
    filename: `chidori_${safeSlug()}.csv`,
    measurements,
  });

  const downloadTXT = () => exportTXT({
    filename: `chidori_${safeSlug()}.txt`,
    patient: buildPatient(),
    stats: buildStats(),
    measurements,
    events,
  });

  /* ── Render ─────────────────────────────────────────────────────── */

  return (
    <>
      <div className="modal-veil" onClick={onClose}>
        <div className="modal-card modal-wide" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820 }}>
          <div className="modal-head" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {session.patient_name || 'Sesión sin identificar'}
              </h3>
              <span className="section-label" style={{ display: 'block', marginTop: 4 }}>
                {new Date(session.created_at).toLocaleString('es-AR')} ·
                clínico: {session.owner?.display_name || emailToUsername(session.owner?.email) || '—'}
              </span>
            </div>

            <div className="row" style={{ gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
              {mode === 'view' ? (
                <button
                  type="button"
                  className="button button-ghost button-sm"
                  onClick={() => { setMode('edit'); setSavingError(null); }}
                >
                  <Pencil size={13} />
                  Editar
                </button>
              ) : (
                <button
                  type="button"
                  className="button button-ghost button-sm"
                  onClick={() => setMode('view')}
                  disabled={saving}
                >
                  Cancelar edición
                </button>
              )}

              {/* Download menu inline · 3 botones compactos */}
              {mode === 'view' && (
                <>
                  <button
                    type="button"
                    className="button button-ghost button-sm"
                    onClick={downloadPDF}
                    title="Descargar reporte PDF"
                  >
                    <FileText size={13} /> PDF
                  </button>
                  <button
                    type="button"
                    className="button button-ghost button-sm"
                    onClick={downloadCSV}
                    title="Descargar datos crudos (CSV)"
                  >
                    <Table size={13} /> CSV
                  </button>
                  <button
                    type="button"
                    className="button button-ghost button-sm"
                    onClick={downloadTXT}
                    title="Descargar texto plano"
                  >
                    <FileType2 size={13} /> TXT
                  </button>
                </>
              )}

              <button
                type="button"
                className="button button-sm"
                onClick={() => setAskDelete(true)}
                title="Eliminar esta sesión y sus datos"
                style={{ borderColor: 'var(--alarm-line)', color: 'var(--alarm)' }}
              >
                <Trash2 size={13} />
                Eliminar
              </button>

              <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="modal-body stack-md">
            {savingError && (
              <div className="auth-feedback err">{savingError}</div>
            )}

            {mode === 'view' ? (
              <>
                <div className="readout" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                  <div className="readout-cell">
                    <span className="readout-label">Z basal</span>
                    <span className="readout-value numeric" style={{ fontSize: 'var(--t-xl)' }}>{fmt(session.initial_impedance)} Ω</span>
                  </div>
                  <div className="readout-cell">
                    <span className="readout-label">Z final</span>
                    <span className="readout-value numeric" style={{ fontSize: 'var(--t-xl)' }}>{fmt(session.final_impedance)} Ω</span>
                  </div>
                  <div className="readout-cell">
                    <span className="readout-label">Duración</span>
                    <span className="readout-value numeric" style={{ fontSize: 'var(--t-xl)' }}>{session.elapsed_time_str || '—'}</span>
                  </div>
                  <div className="readout-cell">
                    <span className="readout-label">Eventos</span>
                    <span className="readout-value numeric" style={{ fontSize: 'var(--t-xl)' }}>{session.total_events ?? events.length}</span>
                  </div>
                </div>

                {/* Datos del paciente · solo si hay alguno */}
                {(session.patient_age || session.patient_gender || session.patient_weight) && (
                  <div className="step-summary" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
                    <span>Edad</span>
                    <span>Sexo</span>
                    <span>Peso</span>
                    <span>Altura</span>
                    <strong className="numeric">{session.patient_age ?? '—'} años</strong>
                    <strong>{session.patient_gender || '—'}</strong>
                    <strong className="numeric">{fmt(session.patient_weight, 1)} kg</strong>
                    <strong className="numeric">{fmt(session.patient_height, 2)} m</strong>
                  </div>
                )}

                <MeasurementsTable busy={busy} measurements={measurements} fmt={fmt} />
                {events.length > 0 && <EventsList events={events} fmt={fmt} />}
              </>
            ) : (
              <EditForm
                editFields={editFields}
                setEditFields={setEditFields}
                saving={saving}
                onSave={handleSave}
              />
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={askDelete}
        title="Eliminar sesión"
        body={
          <>
            <p style={{ marginBottom: 10 }}>
              Esta acción elimina la sesión <strong>{session.patient_name || 'sin identificar'}</strong>,
              todas sus mediciones ({measurements.length} puntos) y eventos asociados ({events.length}).
              No se puede deshacer.
            </p>
            <p>Mantenga presionado el botón para confirmar.</p>
          </>
        }
        actionLabel="Mantener para eliminar"
        onCancel={() => setAskDelete(false)}
        onConfirm={handleDelete}
        holdMs={1800}
      />
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────── */

function MeasurementsTable({ busy, measurements, fmt }) {
  return (
    <div>
      <span className="section-label">Mediciones ({measurements.length})</span>
      <div className="surface" style={{ marginTop: 8, maxHeight: 280, overflowY: 'auto' }}>
        {busy && (
          <div style={{ padding: '14px 18px' }}>
            <ShimmerSkeleton rows={5} height={12} gap={10} />
          </div>
        )}
        {!busy && measurements.length === 0 && (
          <div style={{ padding: 20, color: 'var(--type-mute)', fontSize: 'var(--t-xs)' }}>
            Sin mediciones registradas.
          </div>
        )}
        {!busy && measurements.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
            <thead>
              <tr style={{ color: 'var(--type-mute)' }}>
                <th style={{ textAlign: 'left',  padding: '8px 14px' }}>t (s)</th>
                <th style={{ textAlign: 'right', padding: '8px 14px' }}>Z (Ω)</th>
                <th style={{ textAlign: 'right', padding: '8px 14px' }}>dZ/dt (Ω/min)</th>
              </tr>
            </thead>
            <tbody>
              {measurements.map((m, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--hairline)' }}>
                  <td style={{ padding: '6px 14px', color: 'var(--type-med)' }}>{fmt(m.elapsed_time, 1)}</td>
                  <td style={{ padding: '6px 14px', textAlign: 'right', color: 'var(--type-hi)' }}>{fmt(m.impedance, 3)}</td>
                  <td style={{ padding: '6px 14px', textAlign: 'right', color: 'var(--type-med)' }}>{fmt(m.rate, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function EventsList({ events, fmt }) {
  return (
    <div>
      <span className="section-label">Eventos marcados ({events.length})</span>
      <div className="surface" style={{ marginTop: 8 }}>
        <ol className="timeline" style={{ padding: '0 18px' }}>
          {events.map((e) => (
            <li className="timeline-row" key={e.event_number}>
              <span className="timeline-id">#{String(e.event_number).padStart(2, '0')} · {fmt(e.elapsed_time, 0)} s</span>
              <span className="timeline-z numeric">{fmt(e.impedance)} Ω</span>
              <span className={`timeline-delta numeric ${e.impedance_change == null ? '' : (e.impedance_change < 0 ? 'neg' : 'pos')}`}>
                {e.impedance_change != null
                  ? `${e.impedance_change > 0 ? '+' : ''}${fmt(e.impedance_change)} Ω`
                  : '—'}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function EditForm({ editFields, setEditFields, saving, onSave }) {
  const set = (k) => (e) => setEditFields((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="stack-md">
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <div className="field">
          <label className="field-label" htmlFor="ed-name">Nombre del paciente</label>
          <input id="ed-name" className="input" type="text" value={editFields.patient_name} onChange={set('patient_name')} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="ed-age">Edad (años)</label>
          <input id="ed-age" className="input" type="number" value={editFields.patient_age} onChange={set('patient_age')} />
        </div>
      </div>

      <div className="field">
        <span className="field-label">Sexo</span>
        <div className="segment">
          {['Femenino', 'Masculino', 'Otro / Prefiero no decirlo'].map((opt) => (
            <button
              key={opt}
              type="button"
              className={`segment-item ${editFields.patient_gender === opt ? 'active' : ''}`}
              onClick={() => setEditFields((p) => ({ ...p, patient_gender: opt }))}
            >
              {opt.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <div className="field">
          <label className="field-label" htmlFor="ed-weight">Peso (kg)</label>
          <input id="ed-weight" className="input" type="number" step="0.1" value={editFields.patient_weight} onChange={set('patient_weight')} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="ed-height">Altura (m)</label>
          <input id="ed-height" className="input" type="number" step="0.01" value={editFields.patient_height} onChange={set('patient_height')} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="ed-iliac">Circ. suprailíaca (cm)</label>
          <input id="ed-iliac" className="input" type="number" step="0.1" value={editFields.patient_iliac_circ} onChange={set('patient_iliac_circ')} />
        </div>
      </div>

      {editFields.patient_gender === 'Femenino' && (
        <div className="field">
          <label className="field-label" htmlFor="ed-menst">Tiempo desde la última menstruación</label>
          <input id="ed-menst" className="input" type="text" value={editFields.menstruation_info} onChange={set('menstruation_info')} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 14 }}>
        <div className="field">
          <label className="field-label" htmlFor="ed-iz">Z basal (Ω)</label>
          <input id="ed-iz" className="input" type="number" step="0.01" value={editFields.initial_impedance} onChange={set('initial_impedance')} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="ed-fz">Z final (Ω)</label>
          <input id="ed-fz" className="input" type="number" step="0.01" value={editFields.final_impedance} onChange={set('final_impedance')} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="ed-dur">Duración (mm:ss)</label>
          <input id="ed-dur" className="input" type="text" value={editFields.elapsed_time_str} onChange={set('elapsed_time_str')} placeholder="00:00" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="ed-evts">Eventos totales</label>
          <input id="ed-evts" className="input" type="number" value={editFields.total_events} onChange={set('total_events')} />
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="button button-primary" disabled={saving}>
          <Save size={14} />
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
