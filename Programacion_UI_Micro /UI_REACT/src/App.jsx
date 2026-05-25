import React, { useState } from 'react';
import useAuth          from './auth/useAuth';
import AuthSplash       from './auth/AuthSplash';
import LoginScreen      from './auth/LoginScreen';
import PendingApproval  from './auth/PendingApproval';
import AdminView        from './admin/AdminView';
import Dashboard        from './Dashboard';

/**
 * App · auth gate + admin mode router.
 *
 * Estados:
 *   loading            → AuthSplash
 *   anon               → LoginScreen
 *   pending-approval   → PendingApproval
 *   ready + clinician  → Dashboard
 *   ready + admin      → Dashboard | AdminView (toggle persistente)
 *
 * El admin tiene acceso completo a ambas vistas. El modo se recuerda en
 * localStorage para que la próxima vez que entre arranque donde dejó.
 */
export default function App() {
  const {
    status, session, profile, isAdmin, error, setError,
    signIn, signUp, signOut, refreshProfile,
  } = useAuth();

  // Modo activo del admin: 'panel' (AdminView) | 'dashboard' (medición)
  const [adminMode, setAdminMode] = useState(
    () => localStorage.getItem('chidori-admin-mode') || 'panel'
  );

  const switchAdminMode = (mode) => {
    setAdminMode(mode);
    localStorage.setItem('chidori-admin-mode', mode);
  };

  if (status === 'loading') return <AuthSplash />;

  if (status === 'anon') {
    return (
      <LoginScreen
        onSignIn={signIn}
        onSignUp={signUp}
        error={error}
        setError={setError}
      />
    );
  }

  if (status === 'pending-approval') {
    return (
      <PendingApproval
        session={session}
        onSignOut={signOut}
        onRefresh={refreshProfile}
      />
    );
  }

  // Admin: ambas vistas disponibles, el toggle decide cuál mostrar
  if (isAdmin) {
    if (adminMode === 'panel') {
      return (
        <AdminView
          profile={profile}
          onSignOut={signOut}
          onSwitchToDashboard={() => switchAdminMode('dashboard')}
        />
      );
    }
    return (
      <Dashboard
        session={session}
        profile={profile}
        onSignOut={signOut}
        isAdmin
        onSwitchToAdmin={() => switchAdminMode('panel')}
      />
    );
  }

  // Clínico: solo dashboard
  return <Dashboard session={session} profile={profile} onSignOut={signOut} />;
}
