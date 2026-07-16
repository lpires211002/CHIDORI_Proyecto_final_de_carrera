import { useCallback, useEffect, useState } from 'react';
import { countPendingSessions, flushPendingSessions } from '../lib/sessionSync';

/**
 * Cola de sesiones medidas offline (modo AP). Cuenta las pendientes y las sube
 * a Supabase cuando hay internet: al montar, al evento 'online' (cambio de
 * red) y de forma manual. El commit solo prospera con internet real; si falla,
 * quedan en la cola para el próximo intento.
 *
 * onResult({ synced, remaining }) se llama tras un flush con al menos 1 subida.
 */
export default function usePendingSync(supabase, onResult) {
  const [pending, setPending] = useState(0);
  const [busy, setBusy]       = useState(false);

  const refresh = useCallback(async () => {
    setPending(await countPendingSessions());
  }, []);

  const flush = useCallback(async () => {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      const res = await flushPendingSessions(supabase);
      setPending(res.remaining);
      if (res.synced > 0 && typeof onResult === 'function') onResult(res);
    } finally {
      setBusy(false);
    }
  }, [supabase, busy, onResult]);

  useEffect(() => {
    refresh();
    flush();
    const onOnline = () => flush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  return { pending, busy, flush, refresh };
}
