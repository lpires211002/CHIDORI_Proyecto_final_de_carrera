import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Shield, LogOut, CheckCircle2, X, UserCheck, UserX, RefreshCw, Search, ChevronRight } from 'lucide-react';
import { supabase, emailToUsername } from '../supabaseClient';

/**
 * AdminView · vista del superadmin (sa).
 *
 * Dos paneles:
 *   1. Cuentas pendientes de aprobación · aprobar/rechazar
 *   2. Catálogo global de sesiones · drill-down a mediciones + eventos
 */
export default function AdminView({ profile, onSignOut }) {
  const [tab, setTab] = useState('sessions'); // sessions | accounts
  const [accounts, setAccounts] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [filter, setFilter] = useState('');

  /* ── Loaders ──────────────────────────────────────────────────────── */
  const loadAccounts = useCallback(async () => {
    setBusy(true);
    setError(null);
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
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('sessions')
        .select(`
          id, created_at, patient_name, patient_age, patient_gender,
          initial_impedance, final_impedance, elapsed_time_str, total_events,
          user_id,
          owner:profiles!sessions_user_id_fkey ( display_name, email )
        `)
        .order('created_at', { ascending: false })
        .limit(200);
      if (err) throw err;
      setSessions(data || []);
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

  /* ── Approvals ────────────────────────────────────────────────────── */
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

  /* ── Filtering ────────────────────────────────────────────────────── */
  const filteredSessions = useMemo(() => {
    if (!filter.trim()) return sessions;
    const f = filter.toLowerCase();
    return sessions.filter((s) =>
      [
        s.patient_name,
        s.owner?.display_name,
        s.owner?.email,
        s.elapsed_time_str,
      ].filter(Boolean).some((x) => x.toLowerCase().includes(f))
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
            allSessions={sessions}
            busy={busy}
            filter={filter}
            setFilter={setFilter}
            onReload={loadSessions}
            selectedSession={selectedSession}
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
        <span>Modo administrador · solo el superadmin ve este panel</span>
        <span>Chidori 2026</span>
      </footer>

      {selectedSession && (
        <SessionDetailModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */

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
        {accounts.length === 0 && !busy && (
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

/* ────────────────────────────────────────────────────────────────────── */

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
        {sessions.length === 0 && !busy && (
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
              <div style={{ fontSize: 'var(--t-sm)', color: 'var(--type-med)' }}>
                Clínico
              </div>
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

/* ────────────────────────────────────────────────────────────────────── */

function SessionDetailModal({ session, onClose }) {
  const [measurements, setMeasurements] = useState([]);
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(true);

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
          .limit(2000),
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

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal-card modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>{session.patient_name || 'Sesión sin identificar'}</h3>
            <span className="section-label" style={{ display: 'block', marginTop: 4 }}>
              {new Date(session.created_at).toLocaleString('es-AR')} ·
              clínico: {session.owner?.display_name || emailToUsername(session.owner?.email) || '—'}
            </span>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body stack-md">
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

          <div>
            <span className="section-label">Mediciones ({measurements.length})</span>
            <div className="surface" style={{ marginTop: 8, maxHeight: 280, overflowY: 'auto' }}>
              {busy && <div style={{ padding: 20, color: 'var(--type-mute)' }}>Cargando…</div>}
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

          {events.length > 0 && (
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
          )}
        </div>
      </div>
    </div>
  );
}
