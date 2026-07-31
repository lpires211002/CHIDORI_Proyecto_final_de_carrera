import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import {
  Shield, ShieldOff, LogOut, X, UserCheck, UserX, RefreshCw, Search, ChevronRight,
  Activity, Pencil, Trash2, Download, FileText, Table, FileType2, Save, Menu,
  ChevronDown,
} from 'lucide-react';
import { supabase, emailToUsername } from '../supabaseClient';
import ConfirmModal from '../components/ConfirmModal';
import ShimmerSkeleton from '../components/ShimmerSkeleton';
import MobileMenu, { MobileMenuItem, MobileMenuSection } from '../components/MobileMenu';
import { exportPDF, exportCSV, exportTXT } from '../lib/exporters';
import FieldsPanel from './FieldsPanel';
import SessionChart from './SessionChart';
import DynamicFields from '../components/DynamicFields';
import { fetchFields, coerceValues, updatePatient, patientLabel } from '../lib/patients';

const sessionLayoutId = (id) => `session-card-${id}`;

/* Roles · el frontend solo distingue 'superadmin' (panel completo) del resto.
 * Al quitar admin se vuelve a 'clinician' (rol por defecto del trigger de signup). */
const ROLE_ADMIN     = 'superadmin';
const ROLE_CLINICIAN = 'clinician';

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // Cambio de rol pendiente de confirmación: { account, nextRole } | null
  const [roleChange, setRoleChange] = useState(null);

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
          user_id, patient_id, session_number, session_data, notes,
          patient:patients ( id, code, first_name, last_name, data, notes )
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

  /**
   * setRole · promueve o degrada una cuenta.
   * Guardas:
   *   - Un admin no puede quitarse su propio rol (evita lock-out accidental;
   *     siempre queda al menos quien está operando el panel).
   *   - El cambio pasa por un ConfirmModal con hold (ver roleChange).
   */
  const setRole = async (id, role) => {
    if (id === profile?.id && role !== ROLE_ADMIN) {
      setError('No podés quitarte tu propio rol de administrador.');
      return;
    }
    try {
      const { data, error: err } = await supabase
        .from('profiles')
        .update({ role })
        .eq('id', id)
        .select('id, role');
      if (err) throw err;
      // RLS puede "aceptar" el update sin tocar filas (0 rows): verificamos.
      if (!data || data.length === 0 || data[0].role !== role) {
        throw new Error(
          'La base de datos rechazó el cambio de rol (política RLS). ' +
          'Revisá que la policy de UPDATE sobre profiles permita modificar role a los admins.'
        );
      }
      setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, role } : a)));
    } catch (e) {
      setError(e.message || 'No se pudo cambiar el rol.');
    }
  };

  /** Re-fetch una sesión y actualizar la lista (post-edit). */
  const refreshSession = async (sessionId) => {
    const { data, error: err } = await supabase
      .from('sessions')
      .select('id, created_at, patient_name, patient_age, patient_gender, patient_weight, patient_height, patient_iliac_circ, menstruation_info, initial_impedance, final_impedance, elapsed_time_str, total_events, user_id, patient_id, session_number, session_data, notes, patient:patients ( id, code, first_name, last_name, data, notes )')
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
      [s.patient?.code, s.patient?.last_name, s.patient?.first_name,
       s.patient_name, s.owner?.display_name, s.owner?.email, s.elapsed_time_str]
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
          <span className="pill pill-confirm keep-mobile">
            <span className="pill-dot" />
            {profile?.display_name || 'sa'}
          </span>
          <button type="button" className="icon-button" onClick={onSignOut} title="Cerrar sesión">
            <LogOut size={15} />
          </button>

          {/* Hamburguesa · solo visible en mobile */}
          <button
            type="button"
            className="mobile-toggle"
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu size={18} />
          </button>
        </div>
      </header>

      <MobileMenu
        open={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        header={
          <div>
            <span className="brand-mark">Chidori</span>
            <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--signal)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Administrador
            </div>
          </div>
        }
      >
        <MobileMenuSection>Vista</MobileMenuSection>
        <MobileMenuItem
          icon={Activity}
          label="Tomar mediciones"
          hint="Cambiar a la vista de medición"
          onClick={() => { setIsMobileMenuOpen(false); onSwitchToDashboard(); }}
        />

        <MobileMenuSection>Cuenta</MobileMenuSection>
        <MobileMenuItem
          icon={LogOut}
          label="Cerrar sesión"
          danger
          onClick={() => { setIsMobileMenuOpen(false); onSignOut(); }}
        />
      </MobileMenu>

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
          <button
            type="button"
            className={`segment-item ${tab === 'fields' ? 'active' : ''}`}
            onClick={() => setTab('fields')}
          >
            Campos que se miden
          </button>
        </div>

        {error && (
          <div className="auth-feedback err" role="alert" style={{ alignSelf: 'stretch' }}>
            {error}
          </div>
        )}

        {tab === 'sessions' && (
          // LayoutGroup aísla los layoutIds del morphing dialog para que no
          // crucen con otros motion components de la página.
          <LayoutGroup id="admin-sessions">

          <SessionsPanel
            sessions={filteredSessions}
            busy={busy}
            filter={filter}
            setFilter={setFilter}
            onReload={loadSessions}
            setSelectedSession={setSelectedSession}
            morphingId={selectedSession?.id || null}
          />

          <AnimatePresence>
            {selectedSession && (
              <SessionDetailModal
                key={selectedSession.id}
                session={selectedSession}
                onClose={() => setSelectedSession(null)}
                onSessionUpdated={refreshSession}
                onSessionDeleted={deleteSession}
              />
            )}
          </AnimatePresence>
          </LayoutGroup>
        )}

        {tab === 'fields' && (
          <FieldsPanel supabase={supabase} onAlert={(m, t) => setError(t === 'success' ? null : m)} />
        )}

        {tab === 'accounts' && (
          <AccountsPanel
            accounts={accounts}
            busy={busy}
            selfId={profile?.id}
            onReload={loadAccounts}
            onApprove={(id) => setApproval(id, true)}
            onRevoke={(id) => setApproval(id, false)}
            onRequestRoleChange={(account, nextRole) => setRoleChange({ account, nextRole })}
          />
        )}
      </main>

      <ConfirmModal
        open={Boolean(roleChange)}
        title={roleChange?.nextRole === ROLE_ADMIN ? 'Dar acceso de administrador' : 'Quitar acceso de administrador'}
        body={roleChange && (
          <>
            <p style={{ marginBottom: 10 }}>
              {roleChange.nextRole === ROLE_ADMIN ? (
                <>
                  <strong>{roleChange.account.display_name || emailToUsername(roleChange.account.email)}</strong>{' '}
                  pasará a ser administrador: tendrá acceso global a todas las sesiones,
                  podrá aprobar cuentas y otorgar o quitar este mismo rol.
                </>
              ) : (
                <>
                  <strong>{roleChange.account.display_name || emailToUsername(roleChange.account.email)}</strong>{' '}
                  dejará de ser administrador y volverá a operar como clínico
                  (solo sus propias sesiones).
                </>
              )}
            </p>
            <p>Mantenga presionado el botón para confirmar.</p>
          </>
        )}
        actionLabel={roleChange?.nextRole === ROLE_ADMIN ? 'Mantener para promover' : 'Mantener para quitar'}
        onCancel={() => setRoleChange(null)}
        onConfirm={async () => {
          const rc = roleChange;
          setRoleChange(null);
          if (rc) await setRole(rc.account.id, rc.nextRole);
        }}
        holdMs={1200}
      />

      <footer className="app-footer">
        <span>Modo administrador · acceso global a sesiones y cuentas</span>
        <span>Chidori 2026</span>
      </footer>

    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */

function AccountsPanel({ accounts, busy, selfId, onReload, onApprove, onRevoke, onRequestRoleChange }) {
  const pending  = accounts.filter((a) => !a.is_approved);
  const approved = accounts.filter((a) => a.is_approved);
  const admins   = accounts.filter((a) => a.role === ROLE_ADMIN);

  return (
    <section className="stack-md">
      <div className="row-between">
        <div>
          <h2>Cuentas</h2>
          <span className="section-label" style={{ display: 'block', marginTop: 4 }}>
            {pending.length} pendientes · {approved.length} aprobadas · {admins.length} admin{admins.length === 1 ? '' : 's'}
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
          const isAdminAcc = a.role === ROLE_ADMIN;
          const isSelf     = a.id === selfId;
          return (
            <div
              key={a.id}
              className="admin-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto auto',
                alignItems: 'center',
                gap: 14,
                padding: '14px 18px',
                borderBottom: '1px solid var(--hairline)',
              }}
            >
              <div>
                <div style={{ color: 'var(--type-hi)', fontWeight: 500 }}>
                  {a.display_name || username}
                  {isSelf && (
                    <span className="mute" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', marginLeft: 8 }}>
                      (vos)
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', color: 'var(--type-mute)' }}>
                  {username}
                </div>
              </div>
              <span className="mute" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
                {new Date(a.created_at).toLocaleDateString('es-AR')}
              </span>

              {/* Rol */}
              {isAdminAcc ? (
                <span className="pill pill-syncing" title="Acceso global: sesiones, cuentas y roles">
                  <Shield size={11} />
                  Admin
                </span>
              ) : (
                <span className="pill pill-off">
                  <span className="pill-dot" />
                  Clínico
                </span>
              )}

              {/* Aprobación */}
              {a.is_approved
                ? <span className="pill pill-confirm"><span className="pill-dot" />Aprobada</span>
                : <span className="pill pill-alarm"><span className="pill-dot" />Pendiente</span>}

              {/* Acciones */}
              <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                {/* Promover / quitar admin · solo cuentas aprobadas, nunca sobre uno mismo */}
                {a.is_approved && !isSelf && (
                  isAdminAcc ? (
                    <button
                      type="button"
                      className="button button-ghost button-sm"
                      title="Quitar el rol de administrador"
                      onClick={() => onRequestRoleChange(a, ROLE_CLINICIAN)}
                    >
                      <ShieldOff size={13} />
                      Quitar admin
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button button-ghost button-sm"
                      title="Dar acceso de administrador"
                      onClick={() => onRequestRoleChange(a, ROLE_ADMIN)}
                    >
                      <Shield size={13} />
                      Hacer admin
                    </button>
                  )
                )}

                {/* Aprobación de la cuenta */}
                {isSelf ? (
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
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────── */

function SessionsPanel({ sessions, busy, filter, setFilter, onReload, setSelectedSession, morphingId }) {
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
        {sessions.map((s) => {
          const isMorphing = morphingId === s.id;
          return (
          <motion.button
            key={s.id}
            layoutId={sessionLayoutId(s.id)}
            type="button"
            onClick={() => setSelectedSession(s)}
            className="admin-row"
            // Mientras esta fila está morpheando hacia el modal,
            // la hacemos invisible al render pero conservamos su espacio
            // — el modal "es" esta misma caja, así que no debe haber 2.
            animate={{ opacity: isMorphing ? 0 : 1 }}
            transition={{ duration: 0.15 }}
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
              borderRadius: 0,
              pointerEvents: isMorphing ? 'none' : 'auto',
            }}
          >
            <div>
              <div style={{ color: 'var(--type-hi)', fontWeight: 500 }}>
                {s.patient
                  ? `${s.patient.code}${[s.patient.last_name, s.patient.first_name].filter(Boolean).length
                      ? ` · ${[s.patient.last_name, s.patient.first_name].filter(Boolean).join(', ')}` : ''}`
                  : (s.patient_name || 'Sin paciente asociado')}
                {s.session_number ? <span className="patient-item-meta"> · sesión {s.session_number}</span> : null}
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
          </motion.button>
        );})}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────── */

/* Sesiones anteriores al catálogo de campos: los datos vivían en columnas
 * fijas de `sessions`. Se muestran como "datos heredados" para no perderlos,
 * pero no se ofrecen al cargar una sesión nueva. */
const LEGACY_COLS = [
  ['patient_name',       'Nombre',                 'text'],
  ['patient_age',        'Edad',                   'number', 'años'],
  ['patient_gender',     'Sexo',                   'text'],
  ['patient_weight',     'Peso',                   'number', 'kg'],
  ['patient_height',     'Altura',                 'number', 'm'],
  ['patient_iliac_circ', 'Circ. suprailíaca',      'number', 'cm'],
  ['menstruation_info',  'Última menstruación',    'text'],
];

const hasLegacy = (s) => LEGACY_COLS.some(([k]) => s[k] !== null && s[k] !== undefined && s[k] !== '');

/**
 * Trae TODAS las filas de una consulta, en páginas.
 *
 * PostgREST corta en 1000 filas por request y `.limit()` no lo sube: es un
 * tope del servidor. Una medición de 70 min a 4 Hz son ~17.000 muestras, así
 * que sin paginar se perdía el 94 % de la sesión (y los exports salían
 * truncados sin avisar).
 *
 * `build()` tiene que devolver una consulta nueva en cada llamada: los query
 * builders de supabase-js se consumen al ejecutarse.
 */
async function fetchAllRows(build, { page = 1000, max = 500000, onProgress } = {}) {
  const out = [];
  for (let from = 0; from < max; from += page) {
    const { data, error } = await build().range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    onProgress?.(out.length);
    if (data.length < page) break;   // última página
  }
  return out;
}

/**
 * Aplica los valores del formulario sin perder lo que el catálogo ya no
 * conoce. Un campo eliminado de `field_definitions` deja huérfano su valor en
 * el JSON: si se guardara solo lo del catálogo, esa medición se borraría al
 * primer "Guardar". Los huérfanos se conservan; los campos vigentes sí se
 * pisan (incluido vaciarlos).
 *
 * Con el catálogo vacío —todavía cargando, o falló la consulta— devuelve el
 * original: es preferible no guardar nada a guardar `{}`.
 */
function mergeVals(original, catalogFields, values) {
  if (!catalogFields || catalogFields.length === 0) return original || {};
  const conocidas = new Set(catalogFields.map((f) => f.key));
  const huerfanos = Object.fromEntries(
    Object.entries(original || {}).filter(([k]) => !conocidas.has(k)),
  );
  return { ...huerfanos, ...coerceValues(catalogFields, values) };
}

function SessionDetailModal({ session, onClose, onSessionUpdated, onSessionDeleted }) {
  const [measurements, setMeasurements] = useState([]);
  const [events, setEvents]             = useState([]);
  const [fields, setFields]             = useState([]);
  const [busy, setBusy]                 = useState(true);
  const [loaded, setLoaded]             = useState(0);      // progreso de descarga
  const [loadError, setLoadError]       = useState(null);
  const chartRef                        = useRef(null);     // para el PNG del PDF
  const [mode, setMode]                 = useState('view'); // view | edit
  const [saving, setSaving]             = useState(false);
  const [savingError, setSavingError]   = useState(null);
  const [askDelete, setAskDelete]       = useState(false);

  const patient = session.patient || null;
  const legacy  = hasLegacy(session);

  // El catálogo se pide incluyendo los ocultos: un campo dado de baja después
  // de la medición igual tiene que poder mostrar su etiqueta.
  const patientFields = useMemo(() => fields.filter((f) => f.scope === 'patient'), [fields]);
  const sessionFields = useMemo(() => fields.filter((f) => f.scope === 'session'), [fields]);

  // Formulario de edición · valores dinámicos + resumen numérico de la sesión
  const [patientVals, setPatientVals] = useState(() => ({ ...(patient?.data || {}) }));
  const [sessionVals, setSessionVals] = useState(() => ({ ...(session.session_data || {}) }));
  const [notes, setNotes]             = useState(session.notes || '');
  const [editFields, setEditFields]   = useState({
    initial_impedance: session.initial_impedance ?? '',
    final_impedance:   session.final_impedance   ?? '',
    elapsed_time_str:  session.elapsed_time_str  || '',
    total_events:      session.total_events      ?? 0,
    ...Object.fromEntries(LEGACY_COLS.map(([k]) => [k, session[k] ?? ''])),
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      setLoaded(0);
      setLoadError(null);

      // Los eventos se piden con tipo y volumen; si la base todavía no tiene
      // esas columnas (sesiones anteriores al protocolo) se reintenta con el
      // formato viejo en vez de dejar la lista vacía.
      const eventos = async () => {
        const q = (cols) => fetchAllRows(() => supabase
          .from('session_events')
          .select(cols)
          .eq('session_id', session.id)
          .order('event_number', { ascending: true }));
        try {
          return await q('event_number, elapsed_time, impedance, impedance_change, kind, amount_ml');
        } catch {
          return q('event_number, elapsed_time, impedance, impedance_change');
        }
      };

      // Una sesión de 4 h son ~57.000 muestras: hay que paginarlas. El orden
      // tiene que ser total o la paginación repite o saltea filas, así que se
      // desempata por `id`; si esa columna no existe se cae al orden simple
      // (a 4 Hz los tiempos no se repiten, es solo un seguro).
      const muestras = async () => {
        const build = (conId) => () => {
          const q = supabase
            .from('measurements')
            .select('elapsed_time, impedance, rate')
            .eq('session_id', session.id)
            .order('elapsed_time', { ascending: true });
          return conId ? q.order('id', { ascending: true }) : q;
        };
        const onProgress = (n) => { if (!cancelled) setLoaded(n); };
        try {
          return await fetchAllRows(build(true), { onProgress });
        } catch {
          return fetchAllRows(build(false), { onProgress });
        }
      };

      try {
        const [m, e, f] = await Promise.all([
          muestras(),
          eventos(),
          fetchFields(supabase, { includeInactive: true }).catch(() => []),
        ]);
        if (cancelled) return;
        setMeasurements(m);
        setEvents(e);
        setFields(f || []);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err.message || 'No se pudieron cargar las mediciones.');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session.id]);

  const fmt = (n, d = 2) => (n == null ? '—' : Number(n).toFixed(d));

  /** Agua total ingerida · se recalcula sumando los eventos, no se guarda suelta. */
  const aguaTotal = useMemo(() => {
    const ml = events
      .filter((e) => e.kind === 'water' && Number.isFinite(Number(e.amount_ml)))
      .reduce((acc, e) => acc + Number(e.amount_ml), 0);
    return ml > 0 ? ml : null;
  }, [events]);

  const handleSave = async () => {
    setSaving(true);
    setSavingError(null);
    try {
      const payload = {
        session_data:      mergeVals(session.session_data, sessionFields, sessionVals),
        notes:             notes.trim() || null,
        initial_impedance: editFields.initial_impedance === '' ? null : parseFloat(editFields.initial_impedance),
        final_impedance:   editFields.final_impedance === '' ? null : parseFloat(editFields.final_impedance),
        elapsed_time_str:  editFields.elapsed_time_str || null,
        total_events:      editFields.total_events === '' ? 0 : parseInt(editFields.total_events) || 0,
      };
      // Las columnas viejas solo se tocan si esta sesión las usaba
      if (legacy) {
        LEGACY_COLS.forEach(([k, , tipo]) => {
          const v = editFields[k];
          payload[k] = v === '' || v == null
            ? null
            : tipo === 'number' ? Number(v) : String(v);
        });
      }

      const { error: err } = await supabase
        .from('sessions')
        .update(payload)
        .eq('id', session.id);
      if (err) throw err;

      // La ficha del paciente es compartida por todas sus sesiones: se guarda
      // aparte, en `patients.data`.
      if (patient?.id && patientFields.length > 0) {
        await updatePatient(supabase, patient.id, {
          data: mergeVals(patient.data, patientFields, patientVals),
        });
      }

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

  // Mismo formato que usa el export en vivo: código, nombre, notas y la lista
  // de campos con su etiqueta. Se arma desde el catálogo, no desde columnas
  // fijas, para que los reportes reflejen lo que realmente se midió.
  const buildPatient = () => {
    const pData = patient?.data || {};
    const sData = session.session_data || {};

    const campos = [
      ...patientFields
        .filter((f) => pData[f.key] !== undefined && pData[f.key] !== '')
        .map((f) => ({ label: f.label, unit: f.unit, value: pData[f.key] })),
      ...sessionFields
        .filter((f) => sData[f.key] !== undefined && sData[f.key] !== '')
        .map((f) => ({ label: f.label, unit: f.unit, value: sData[f.key] })),
      ...(aguaTotal != null ? [{ label: 'Agua ingerida (eventos)', unit: 'ml', value: aguaTotal }] : []),
      // Sesiones viejas: se agregan al final para no perder el dato histórico
      ...(legacy ? LEGACY_COLS
        .filter(([k]) => session[k] !== null && session[k] !== undefined && session[k] !== '')
        .map(([k, label, , unit]) => ({ label, unit, value: session[k] })) : []),
    ];

    if (!patient && campos.length === 0 && !session.notes) return null;

    return {
      codigo: patient?.code || 'N/A',
      nombre: patient
        ? [patient.last_name, patient.first_name].filter(Boolean).join(', ') || 'N/A'
        : (session.patient_name || 'N/A'),
      notas:  session.notes || '',
      campos,
      sessionData: sData,
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
    // El código del paciente es el identificador del dataset; el nombre suelto
    // solo se usa para sesiones viejas sin ficha asociada.
    const base = patient?.code
      ? `${patient.code}${session.session_number ? `_s${session.session_number}` : ''}`
      : (session.patient_name || 'sin_identificar');
    const name = base
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
    // El gráfico se re-rinde en paleta clara: el canvas de pantalla es
    // transparente y de tema oscuro, ilegible sobre una hoja blanca.
    chartImage: chartRef.current?.toPNG() ?? null,
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
      <motion.div
        className="modal-veil"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        <motion.div
          layoutId={sessionLayoutId(session.id)}
          className="modal-card modal-wide morph-card"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: 820 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        >
          <div className="modal-head" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {session.patient
                  ? `${session.patient.code}${[session.patient.last_name, session.patient.first_name].filter(Boolean).length
                      ? ` · ${[session.patient.last_name, session.patient.first_name].filter(Boolean).join(', ')}` : ''}`
                  : (session.patient_name || 'Sesión sin paciente asociado')}
                {session.session_number ? ` · sesión ${session.session_number}` : ''}
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
                  disabled={busy}
                  title={busy ? 'Cargando los campos configurados…' : 'Editar esta sesión'}
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
            {loadError && (
              <div className="auth-feedback err">
                {loadError} · Se muestran {measurements.length.toLocaleString('es-AR')} muestras
                de las descargadas hasta el corte.
              </div>
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

                {/* La curva primero: es la lectura de la sesión. El resto son
                    los datos que la contextualizan, y el volcado crudo va
                    plegado al final. */}
                <SessionChart ref={chartRef} measurements={measurements} events={events} busy={busy} loaded={loaded} />

                <FieldGrid
                  title="Ficha del paciente"
                  fields={patientFields}
                  values={patient?.data}
                  empty={patient ? 'Sin datos cargados en la ficha.' : null}
                />

                <FieldGrid
                  title="Datos de esta sesión"
                  fields={sessionFields}
                  values={session.session_data}
                  extra={aguaTotal != null
                    ? [{ label: 'Agua ingerida', unit: 'ml', value: aguaTotal, hint: 'sumada de los eventos' }]
                    : []}
                  empty="No se completaron los datos de la sesión al exportar."
                />

                {/* Sesiones anteriores al catálogo de campos */}
                {legacy && (
                  <FieldGrid
                    title="Datos heredados"
                    hint="Cargados con el formato anterior, antes de los campos configurables."
                    extra={LEGACY_COLS
                      .filter(([k]) => session[k] !== null && session[k] !== undefined && session[k] !== '')
                      .map(([k, label, , unit]) => ({ label, unit, value: session[k] }))}
                  />
                )}

                {session.notes && (
                  <div>
                    <span className="section-label">Notas de la sesión</span>
                    <p className="notes-readout">{session.notes}</p>
                  </div>
                )}

                {events.length > 0 && <EventsList events={events} fmt={fmt} />}
                <MeasurementsTable busy={busy} measurements={measurements} fmt={fmt} loaded={loaded} />
              </>
            ) : (
              <EditForm
                editFields={editFields}
                setEditFields={setEditFields}
                patientFields={patientFields}
                patientVals={patientVals}
                setPatientVals={setPatientVals}
                sessionFields={sessionFields}
                sessionVals={sessionVals}
                setSessionVals={setSessionVals}
                notes={notes}
                setNotes={setNotes}
                patient={patient}
                legacy={legacy}
                saving={saving}
                onSave={handleSave}
              />
            )}
          </div>
        </motion.div>
      </motion.div>

      <ConfirmModal
        open={askDelete}
        title="Eliminar sesión"
        body={
          <>
            <p style={{ marginBottom: 10 }}>
              Esta acción elimina la sesión de{' '}
              <strong>{patientLabel(patient) || session.patient_name || 'paciente sin identificar'}</strong>,
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

/**
 * Tabla de muestras · virtualizada.
 *
 * Están TODAS las filas disponibles, pero solo se montan en el DOM las que
 * entran en la ventana visible más un margen. Una sesión de 4 h son ~57.000
 * muestras: pintarlas todas congela el navegador varios segundos y no aporta
 * nada, porque solo se ven doce a la vez.
 */
const ROW_H = 26;   // alto fijo · es lo que permite calcular qué filas mostrar

/**
 * Sección plegable.
 *
 * El detalle de una sesión es largo (curva + miles de muestras + eventos):
 * el listado crudo se guarda plegado para que lo primero que se vea sea la
 * lectura de la medición, no la planilla.
 */
function Collapsible({ title, meta, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        className="collapsible-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronDown
          size={14}
          style={{
            transform: `rotate(${open ? 0 : -90}deg)`,
            transition: 'transform var(--dur-fast, 120ms) ease',
            flexShrink: 0,
          }}
        />
        <span className="section-label" style={{ margin: 0 }}>{title}</span>
        {meta && <span className="field-hint" style={{ margin: 0 }}>{meta}</span>}
      </button>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}

function MeasurementsTable({ busy, measurements, fmt, loaded = 0 }) {
  const VIEW_H  = 280;
  const OVERSCAN = 12;
  const [scrollTop, setScrollTop] = useState(0);

  const total  = measurements.length;
  const first  = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const count  = Math.ceil(VIEW_H / ROW_H) + OVERSCAN * 2;
  const visible = measurements.slice(first, first + count);

  const cols = '1fr 1fr 1fr';
  const cell = { padding: '0 14px', display: 'flex', alignItems: 'center', height: ROW_H };

  return (
    <Collapsible
      title={`Mediciones (${total.toLocaleString('es-AR')})`}
      meta={busy
        ? (loaded > 0 ? `descargando ${loaded.toLocaleString('es-AR')}…` : 'descargando…')
        : 'ver la tabla de muestras'}
    >
      <div className="surface" style={{ overflow: 'hidden' }}>
        {/* Encabezado fuera del scroll: queda fijo sin trucos de sticky */}
        {!busy && total > 0 && (
          <div style={{
            display: 'grid', gridTemplateColumns: cols,
            fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)',
            color: 'var(--type-mute)', borderBottom: '1px solid var(--hairline)',
          }}>
            <span style={{ ...cell, height: 30 }}>t (s)</span>
            <span style={{ ...cell, height: 30, justifyContent: 'flex-end' }}>Z (Ω)</span>
            <span style={{ ...cell, height: 30, justifyContent: 'flex-end' }}>dZ/dt (Ω/min)</span>
          </div>
        )}

        {busy && (
          <div style={{ padding: '14px 18px' }}>
            <ShimmerSkeleton rows={5} height={12} gap={10} />
          </div>
        )}

        {!busy && total === 0 && (
          <div style={{ padding: 20, color: 'var(--type-mute)', fontSize: 'var(--t-xs)' }}>
            Sin mediciones registradas.
          </div>
        )}

        {!busy && total > 0 && (
          <div
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            style={{ maxHeight: VIEW_H, overflowY: 'auto' }}
          >
            {/* Espaciador del alto real: mantiene la barra de scroll honesta */}
            <div style={{ height: total * ROW_H, position: 'relative' }}>
              <div style={{
                position: 'absolute', top: first * ROW_H, left: 0, right: 0,
                fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)',
              }}>
                {visible.map((m, i) => (
                  <div
                    key={first + i}
                    style={{
                      display: 'grid', gridTemplateColumns: cols,
                      borderTop: '1px solid var(--hairline)',
                    }}
                  >
                    <span style={{ ...cell, color: 'var(--type-med)' }}>{fmt(m.elapsed_time, 1)}</span>
                    <span style={{ ...cell, justifyContent: 'flex-end', color: 'var(--type-hi)' }}>{fmt(m.impedance, 3)}</span>
                    <span style={{ ...cell, justifyContent: 'flex-end', color: 'var(--type-med)' }}>{fmt(m.rate, 2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Collapsible>
  );
}

function EventsList({ events, fmt }) {
  // Mismo código visual que la línea de tiempo en vivo: una sesión archivada
  // se lee igual que una recién tomada.
  // [clase de fila, clase del tag, texto]
  const tag = (e) => {
    const ml = Number(e.amount_ml);
    switch (e.kind) {
      case 'disconnect': return ['is-disconnect', 'is-down', 'Desconexión'];
      case 'reconnect':  return ['is-reconnect', 'is-up', 'Reconexión'];
      case 'gap':        return ['is-gap', 'is-gap', `Microcorte · ${fmt(e.impedance_change, 1)} s`];
      case 'water':      return ['is-water', 'is-water', `Ingesta${Number.isFinite(ml) ? ` · ${ml} ml` : ''}`];
      case 'void':       return ['is-void', 'is-void', `Micción${Number.isFinite(ml) ? ` · ${ml} ml` : ''}`];
      default:           return null;
    }
  };

  return (
    <Collapsible
      title={`Eventos marcados (${events.length})`}
      meta="marcas, ingestas, micciones y cortes"
      defaultOpen={events.length <= 12}
    >
      <div className="surface">
        <ol className="timeline" style={{ padding: '0 18px', maxHeight: 300, overflowY: 'auto' }}>
          {events.map((e) => {
            const t = tag(e);
            const sinZ = e.kind === 'disconnect' || e.kind === 'reconnect';
            return (
              <li className={`timeline-row${t ? ` ${t[0]}` : ''}`} key={e.event_number}>
                <span className="timeline-id">#{String(e.event_number).padStart(2, '0')} · {fmt(e.elapsed_time, 0)} s</span>
                <span className="timeline-z numeric">{sinZ ? '—' : `${fmt(e.impedance)} Ω`}</span>
                {t ? (
                  <span className={`timeline-tag ${t[1]}`}>{t[2]}</span>
                ) : (
                  <span className={`timeline-delta numeric ${e.impedance_change == null ? '' : (e.impedance_change < 0 ? 'neg' : 'pos')}`}>
                    {e.impedance_change != null
                      ? `${e.impedance_change > 0 ? '+' : ''}${fmt(e.impedance_change)} Ω`
                      : '—'}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </Collapsible>
  );
}

/**
 * Bloque de solo lectura generado desde el catálogo.
 *
 * `fields` + `values` dibuja los campos configurados; `extra` permite sumar
 * valores calculados (el agua total) o heredados sin inventarles una
 * definición en la tabla.
 */
function FieldGrid({ title, hint, fields = [], values = {}, extra = [], empty = null }) {
  const v = values || {};
  const items = [
    ...fields
      .filter((f) => v[f.key] !== undefined && v[f.key] !== null && v[f.key] !== '')
      .map((f) => ({ label: f.label, unit: f.unit, value: v[f.key], type: f.type })),
    ...extra,
  ];

  if (items.length === 0) {
    if (!empty) return null;
    return (
      <div>
        <span className="section-label">{title}</span>
        <span className="field-hint" style={{ display: 'block', marginTop: 6 }}>{empty}</span>
      </div>
    );
  }

  const render = (it) => {
    if (it.type === 'boolean' || typeof it.value === 'boolean') return it.value ? 'Sí' : 'No';
    return `${it.value}${it.unit ? ` ${it.unit}` : ''}`;
  };

  // Cada campo es una celda con su etiqueta arriba: así el bloque tolera
  // cualquier cantidad de campos (el catálogo es abierto) sin desalinearse.
  return (
    <div>
      <span className="section-label">{title}</span>
      {hint && <span className="field-hint" style={{ display: 'block', marginTop: 4 }}>{hint}</span>}
      <div className="fact-grid">
        {items.map((it) => (
          <div className="fact-cell" key={it.label}>
            <span className="fact-label">{it.label}</span>
            <strong className={typeof it.value === 'number' ? 'numeric' : ''}>{render(it)}</strong>
            {it.hint && <span className="field-hint">{it.hint}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Edición de una sesión archivada.
 *
 * Los formularios salen del catálogo de campos, igual que en la toma de datos:
 * lo que se agregue o quite desde "Campos que se miden" aparece acá solo. La
 * ficha del paciente se guarda en `patients` (la comparten todas sus sesiones)
 * y el resto en la sesión.
 */
function EditForm({
  editFields, setEditFields,
  patientFields, patientVals, setPatientVals,
  sessionFields, sessionVals, setSessionVals,
  notes, setNotes, patient, legacy, saving, onSave,
}) {
  const set = (k) => (e) => setEditFields((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="stack-md">
      {patient ? (
        <div>
          <span className="section-label">Ficha de {patientLabel(patient)}</span>
          <span className="field-hint" style={{ display: 'block', margin: '4px 0 10px' }}>
            Estos datos son del paciente: al cambiarlos se actualizan en todas sus sesiones.
          </span>
          <DynamicFields
            fields={patientFields}
            values={patientVals}
            onChange={(k, v) => setPatientVals((p) => ({ ...p, [k]: v }))}
            columns={3}
          />
        </div>
      ) : (
        <span className="field-hint">
          Esta sesión no está asociada a ninguna ficha de paciente.
        </span>
      )}

      <hr className="hairline" />

      <div>
        <span className="section-label">Datos de esta sesión</span>
        <span className="field-hint" style={{ display: 'block', margin: '4px 0 10px' }}>
          Los que cambian entre mediciones: peso, temperatura, humedad, comidas.
          El agua se totaliza sola con los eventos marcados.
        </span>
        <DynamicFields
          fields={sessionFields}
          values={sessionVals}
          onChange={(k, v) => setSessionVals((p) => ({ ...p, [k]: v }))}
          columns={3}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="ed-notes">Notas de la sesión</label>
        <textarea
          id="ed-notes"
          className="input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Particularidades de la medición, incidencias, observaciones…"
          style={{ resize: 'vertical', minHeight: 68, lineHeight: 1.5, fontFamily: 'inherit' }}
        />
      </div>

      {legacy && (
        <>
          <hr className="hairline" />
          <div>
            <span className="section-label">Datos heredados</span>
            <span className="field-hint" style={{ display: 'block', margin: '4px 0 10px' }}>
              Cargados con el formato anterior. Se pueden corregir, pero conviene
              pasarlos a los campos configurables.
            </span>
            <div className="dyn-grid" style={{ '--dyn-cols': 3 }}>
              {LEGACY_COLS.map(([k, label, tipo, unit]) => (
                <div className="field" key={k}>
                  <label className="field-label" htmlFor={`ed-${k}`}>
                    {label}{unit ? <span className="dyn-unit"> ({unit})</span> : null}
                  </label>
                  <input
                    id={`ed-${k}`}
                    className={`input ${tipo === 'number' ? 'numeric' : ''}`}
                    type={tipo === 'number' ? 'number' : 'text'}
                    step={tipo === 'number' ? 'any' : undefined}
                    value={editFields[k]}
                    onChange={set(k)}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <hr className="hairline" />

      <div>
        <span className="section-label">Resumen de la medición</span>
        <span className="field-hint" style={{ display: 'block', margin: '4px 0 10px' }}>
          Se calculan al cerrar la sesión: corregirlos acá no altera las muestras registradas.
        </span>
        <div className="dyn-grid" style={{ '--dyn-cols': 4 }}>
          <div className="field">
            <label className="field-label" htmlFor="ed-iz">Z basal (Ω)</label>
            <input id="ed-iz" className="input numeric" type="number" step="0.01" value={editFields.initial_impedance} onChange={set('initial_impedance')} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ed-fz">Z final (Ω)</label>
            <input id="ed-fz" className="input numeric" type="number" step="0.01" value={editFields.final_impedance} onChange={set('final_impedance')} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ed-dur">Duración (mm:ss)</label>
            <input id="ed-dur" className="input numeric" type="text" value={editFields.elapsed_time_str} onChange={set('elapsed_time_str')} placeholder="00:00" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ed-evts">Eventos totales</label>
            <input id="ed-evts" className="input numeric" type="number" value={editFields.total_events} onChange={set('total_events')} />
          </div>
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
