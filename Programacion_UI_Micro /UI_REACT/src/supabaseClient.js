import { createClient } from '@supabase/supabase-js';

/**
 * Dynamically initializes and returns a Supabase client.
 * Returns null if the credentials are not configured or invalid.
 */
export function getSupabaseClient(url, key) {
  if (!url || !key) return null;
  try {
    return createClient(url, key);
  } catch (e) {
    console.error('Error al inicializar cliente dinámico de Supabase:', e);
    return null;
  }
}
