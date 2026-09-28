import { Suspense, lazy } from 'react';

// Carga diferida: three.js pesa y así no demora el arranque de la app.
const LightPillar = lazy(() => import('./LightPillar'));

/**
 * AppBackdrop · la columna de luz como fondo de TODA la app.
 *
 * Antes vivía dentro de la pantalla de inicio y se desmontaba al empezar a
 * medir: el pilar se cortaba de golpe. Ahora es una capa fija detrás de todo
 * y el paso de la preparación al dashboard es continuo: las tarjetas vuelan
 * por encima de la misma luz, que se queda de fondo detrás de los paneles.
 *
 * mode
 *   'start' · pantalla de inicio: luz plena.
 *   'dash'  · midiendo: se atenúa (velo del color del papel encima) y pasa a
 *             modo liviano (24 fps, media resolución), pensado para sesiones
 *             de horas. Los paneles son opacos: se ve en los márgenes y entre
 *             ellos, no debajo de los datos.
 *
 * Detalle de composición: en oscuro el pilar se suma con `screen`, y eso solo
 * funciona si el contexto de apilado que lo contiene tiene el papel de fondo.
 * Por eso la capa lleva `background: var(--paper)` y el atenuado es un velo
 * encima, no `opacity` sobre el pilar (que lo aislaría y dejaría ver el negro
 * del lienzo).
 */
export default function AppBackdrop({ theme = 'dark', mode = 'start' }) {
  const claro = theme === 'light';
  const dash = mode === 'dash';
  return (
    <div className={`app-backdrop ${dash ? 'is-dash' : 'is-start'}`} aria-hidden="true">
      <div className="app-backdrop__pillar">
        <Suspense fallback={null}>
          <LightPillar
            /* Los valores de fábrica: bajarlos apagaba los filamentos y el
               efecto quedaba como una mancha. Lo único propio son los colores
               —indigo de marca en vez del violeta/rosa— manteniendo el rango
               de luminancia del original, que es lo que da el relieve. */
            topColor="#b8cdff"
            bottomColor="#3c32da"
            intensity={1.0}
            rotationSpeed={dash ? 0.18 : 0.28}
            glowAmount={0.005}
            pillarWidth={3.0}
            pillarHeight={0.4}
            noiseIntensity={0.4}
            /* Inclinado: los filamentos cruzan el cuadro en diagonal */
            pillarRotation={-16}
            /* Oscuro · luz sobre negro, sumada al papel con `screen`.
               Claro · la misma forma como tinta índigo sobre fondo transparente. */
            ink={claro ? '#4a4fd8' : null}
            inkAlpha={0.5}
            mixBlendMode={claro ? 'normal' : 'screen'}
            lite={dash}
          />
        </Suspense>
      </div>
      <div className="app-backdrop__veil" />
    </div>
  );
}
