import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client · singleton hardcodeado a la instancia oficial de Chidori.
 *
 * Las credenciales vienen de variables de entorno (Vite las inyecta en build).
 * Para desarrollo local: copiar `.env.example` a `.env.local` y completar valores.
 * Para Vercel: agregar las mismas variables en Project Settings → Environment Variables.
 *
 * La anon/public key es segura para frontend (es pública por diseño en Supabase).
 * Las restricciones de acceso se aplican vía Row Level Security en el servidor.
 */
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const AUTH_LOCAL_DOMAIN =
  import.meta.env.VITE_AUTH_LOCAL_DOMAIN || 'chidori.local';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // En desarrollo, mostramos un mensaje claro. En producción, esto no debería ocurrir.
  console.error(
    '[Supabase] Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
    'Copiá .env.example a .env.local y completá los valores.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession:   true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

/**
 * Convierte un "username" simple a email interno.
 *   "sa"            → "sa@chidori.local"
 *   "juan"          → "juan@chidori.local"
 *   "ana@gmail.com" → "ana@gmail.com" (ya es email)
 */
export function usernameToEmail(username) {
  const u = (username || '').trim().toLowerCase();
  if (!u) return '';
  if (u.includes('@')) return u;
  return `${u}@${AUTH_LOCAL_DOMAIN}`;
}

/** Inverso: si el email es del dominio interno, devuelve solo el username. */
export function emailToUsername(email) {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at < 0) return email;
  const local  = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain === AUTH_LOCAL_DOMAIN) return local;
  return email;
}
