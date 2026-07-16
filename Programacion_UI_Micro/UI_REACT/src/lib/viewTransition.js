/**
 * Pequeño helper para usar la View Transitions API cuando está disponible.
 * No requiere Framer Motion ni librerías adicionales. En navegadores sin
 * soporte (Firefox < 132 al momento de escribir), el callback corre igual
 * pero sin animación. Esa degradación silenciosa es deseable.
 *
 *   withViewTransition(() => setAdminMode('dashboard'))
 *
 * El callback se ejecuta de forma síncrona dentro de la transición; React
 * lo bachea normalmente.
 */
export function withViewTransition(callback) {
  // Respetar prefers-reduced-motion · sin animación, ejecutar directo
  const mq = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  if (mq?.matches) {
    callback();
    return;
  }

  if (typeof document !== 'undefined' && typeof document.startViewTransition === 'function') {
    document.startViewTransition(() => callback());
  } else {
    callback();
  }
}
