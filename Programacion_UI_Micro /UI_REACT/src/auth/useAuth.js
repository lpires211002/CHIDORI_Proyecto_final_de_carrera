import { useCallback, useEffect, useState } from 'react';
import { supabase, usernameToEmail } from '../supabaseClient';

/**
 * Auth hook · expone session, profile (con role + is_approved) y acciones.
 *
 * Estados posibles:
 *   loading             — todavía estamos resolviendo la sesión
 *   anon                — sin sesión activa (mostrar LoginScreen)
 *   pending-approval    — sesión válida pero profile.is_approved === false
 *   ready               — sesión válida y aprobada (mostrar dashboard / admin)
 */
export default function useAuth() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  /** Trae el profile del usuario actual desde la tabla `profiles` */
  const fetchProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      return null;
    }
    try {
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, role, is_approved, display_name, created_at')
        .eq('id', userId)
        .maybeSingle();
      if (err) throw err;
      setProfile(data);
      return data;
    } catch (e) {
      console.error('[useAuth] fetchProfile', e);
      setProfile(null);
      return null;
    }
  }, []);

  /** Resolver inicial + suscripción a onAuthStateChange */
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user?.id) fetchProfile(data.session.user.id);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (!mounted) return;
      setSession(sess);
      if (sess?.user?.id) fetchProfile(sess.user.id);
      else setProfile(null);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, [fetchProfile]);

  /** Login con usuario simple ("sa") o email completo. */
  const signIn = useCallback(async ({ username, password }) => {
    setError(null);
    const email = usernameToEmail(username);
    if (!email) {
      setError('Ingresá un usuario o email.');
      return false;
    }
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message || 'No se pudo iniciar sesión.');
      return false;
    }
    return true;
  }, []);

  /** Signup: crea cuenta + profile (queda en is_approved=false). */
  const signUp = useCallback(async ({ username, password, displayName }) => {
    setError(null);
    const email = usernameToEmail(username);
    if (!email) { setError('Elegí un nombre de usuario.'); return false; }
    if ((password || '').length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return false;
    }
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName || username } },
    });
    if (err) {
      setError(err.message || 'No se pudo crear la cuenta.');
      return false;
    }
    // El trigger SQL crea automáticamente la fila en `profiles` con is_approved=false
    return Boolean(data?.user);
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  }, []);

  /** Permite a un componente forzar refresh del profile (post aprobación). */
  const refreshProfile = useCallback(() => {
    if (session?.user?.id) return fetchProfile(session.user.id);
    return Promise.resolve(null);
  }, [session, fetchProfile]);

  // Derivar el estado de alto nivel
  let status = 'loading';
  if (!loading) {
    if (!session) status = 'anon';
    else if (!profile || profile.is_approved !== true) status = 'pending-approval';
    else status = 'ready';
  }

  const isAdmin = profile?.role === 'superadmin';

  return {
    status,
    session,
    profile,
    isAdmin,
    error,
    setError,
    signIn,
    signUp,
    signOut,
    refreshProfile,
  };
}
