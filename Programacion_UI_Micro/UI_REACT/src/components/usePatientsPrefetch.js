import { useCallback, useEffect, useRef, useState } from 'react';
import { prefetchPacientes, pacientesGuardados } from '../lib/patients';

/** Refresco periódico mientras la app está abierta. */
const CADA_MS = 10 * 60 * 1000;
/** Al volver el foco a la ventana, como mucho un intento por minuto. */
const MIN_ENTRE_MS = 60 * 1000;

function resumen() {
  const g = pacientesGuardados();
  return g ? { n: g.filas.length, at: g.cache?.at ?? null } : null;
}

/**
 * Mantiene la lista de pacientes guardada en esta computadora.
 *
 * POR QUÉ: la red del Chidori no tiene internet. Antes, para elegir paciente
 * había que volver al WiFi de siempre, elegirlo y recién ahí pasarse al equipo.
 * Ahora la lista se descarga sola al abrir la app (con internet) y se refresca
 * cada tanto, así que estando ya en la red del Chidori se elige de lo guardado.
 *
 * Cuándo descarga: al montar, al volver internet ('online'), al volver el foco
 * a la ventana (máx. una vez por minuto) y cada 10 minutos. Sin internet falla
 * en silencio y queda lo último guardado.
 *
 * `enabled = false` la apaga del todo. El Dashboard la deja prendida solo en la
 * pantalla de preparación: durante una sesión (midiendo, en pausa o al guardar)
 * no hace ninguna consulta.
 *
 * Devuelve { guardados: { n, at } | null, actualizando, refrescar }.
 */
export default function usePatientsPrefetch(supabase, enabled = true) {
  const [guardados, setGuardados]       = useState(resumen);
  const [actualizando, setActualizando] = useState(false);
  const ultimoRef  = useRef(0);
  const enCursoRef = useRef(false);

  const refrescar = useCallback(async ({ forzar = false } = {}) => {
    if (!supabase || !enabled || enCursoRef.current) return;
    if (!forzar && Date.now() - ultimoRef.current < MIN_ENTRE_MS) return;
    enCursoRef.current = true;
    ultimoRef.current = Date.now();
    setActualizando(true);
    try {
      await prefetchPacientes(supabase);
    } catch {
      // Sin internet (o en la red del Chidori): queda lo último guardado.
    } finally {
      enCursoRef.current = false;
      setActualizando(false);
      setGuardados(resumen());
    }
  }, [supabase, enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    refrescar({ forzar: true });

    const onFoco   = () => { if (document.visibilityState !== 'hidden') refrescar(); };
    const onOnline = () => refrescar({ forzar: true });
    window.addEventListener('focus', onFoco);
    document.addEventListener('visibilitychange', onFoco);
    window.addEventListener('online', onOnline);
    const id = setInterval(() => refrescar({ forzar: true }), CADA_MS);

    return () => {
      window.removeEventListener('focus', onFoco);
      document.removeEventListener('visibilitychange', onFoco);
      window.removeEventListener('online', onOnline);
      clearInterval(id);
    };
  }, [enabled, refrescar]);

  return { guardados, actualizando, refrescar };
}
