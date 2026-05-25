import React from 'react';
import useAuth        from './auth/useAuth';
import AuthSplash     from './auth/AuthSplash';
import LoginScreen    from './auth/LoginScreen';
import PendingApproval from './auth/PendingApproval';
import AdminView      from './admin/AdminView';
import Dashboard      from './Dashboard';

/**
 * App · auth gate.
 *
 *   loading            → AuthSplash
 *   anon               → LoginScreen
 *   pending-approval   → PendingApproval
 *   ready + isAdmin    → AdminView
 *   ready + clinician  → Dashboard
 */
export default function App() {
  const {
    status, session, profile, isAdmin, error, setError,
    signIn, signUp, signOut, refreshProfile,
  } = useAuth();

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

  if (isAdmin) {
    return <AdminView profile={profile} onSignOut={signOut} />;
  }

  return <Dashboard session={session} profile={profile} onSignOut={signOut} />;
}
