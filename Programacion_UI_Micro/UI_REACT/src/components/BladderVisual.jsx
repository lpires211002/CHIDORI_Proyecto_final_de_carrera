import React, { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

/**
 * Volumen vesical estimado · escala en dB sobre el basal.
 *
 * HIPÓTESIS DE TRABAJO: las ganas de orinar aparecen cuando la señal cae
 * `umbralDb` decibeles respecto del basal registrado con vejiga vacía. Ese
 * punto es el 100 % de la barra; el llenado es lineal en dB, no en ohmios.
 *
 *     caida_dB = -20 · log10(Z / Z_basal)          (Z e Z_basal en ohmios)
 *     llenado  = caida_dB / umbralDb
 *
 * Se usa 20·log10 y no 10·log10 porque la impedancia es una magnitud de
 * amplitud, no de potencia. Con 1,5 dB eso da un 15,9 % de caída (Z llega al
 * 84,1 % del basal); con la convención de potencia serían 29,2 %, casi el
 * doble. Si el criterio del ensayo fuera en potencia, hay que cambiar la
 * constante DB_FACTOR.
 *
 * Antes la escala salía del umbral de alarma configurado a mano: si ese
 * umbral quedaba cerca del basal, la barra saltaba a 100 % apenas empezaba.
 * Ahora la estimación depende solo de la hipótesis física, y la alarma
 * preventiva sigue siendo una configuración aparte.
 *
 * SIN BASAL NO HAY ESTIMACIÓN. La caída se mide contra el basal: sin esa
 * referencia el número no significa nada, así que el panel lo dice en vez de
 * mostrar un 0 % que se leería como "vejiga vacía".
 */

/** 20 para magnitudes de amplitud (|Z|, tensión); 10 sería para potencia. */
const DB_FACTOR = 20;

/** Caída en dB que, según la hipótesis, corresponde al 100 % de llenado. */
export const UMBRAL_GANAS_DB = 1.5;

/** Caída en dB de una impedancia respecto de su basal (positiva al bajar). */
export function caidaDb(z, zBasal) {
  if (!(z > 0) || !(zBasal > 0)) return null;
  return -DB_FACTOR * Math.log10(z / zBasal);
}

/** Impedancia a la que se alcanza el umbral, para mostrarla como referencia. */
export function zDelUmbral(zBasal, umbralDb = UMBRAL_GANAS_DB) {
  if (!(zBasal > 0)) return null;
  return zBasal * Math.pow(10, -umbralDb / DB_FACTOR);
}

export default function BladderVisual({
  initialValue,
  currentValue,
  capacityMl = 500,
  umbralDb = UMBRAL_GANAS_DB,
}) {
  const conBasal = initialValue !== null && initialValue > 0;
  const caida    = conBasal && currentValue !== null ? caidaDb(currentValue, initialValue) : null;
  const zUmbral  = conBasal ? zDelUmbral(initialValue, umbralDb) : null;

  const targetPct = caida === null
    ? 0
    : Math.max(0, Math.min(100, (caida / umbralDb) * 100));

  // Spring para el porcentaje en sí · suaviza el jitter de la señal en vivo
  const pctMV = useMotionValue(0);
  const pctSpring = useSpring(pctMV, { stiffness: 90, damping: 22, mass: 0.7 });
  const scaleY = useTransform(pctSpring, (v) => v / 100);
  const pctDisplay = useTransform(pctSpring, (v) => Math.max(0, Math.round(v)));
  const volDisplay = useTransform(pctSpring, (v) =>
    Math.max(0, Math.round((v / 100) * capacityMl)),
  );

  useEffect(() => { pctMV.set(targetPct); }, [targetPct, pctMV]);

  const alcanzado = targetPct >= 100;
  const cerca     = targetPct >= 80 && !alcanzado;

  return (
    <section className="surface surface-pad" aria-label="Volumen vesical estimado">
      <header className="section-head" style={{ marginBottom: 18 }}>
        <div>
          <h2>Volumen estimado</h2>
          <span className="section-label" style={{ display: 'block', marginTop: 4 }}>
            {conBasal
              ? `Caída de ${umbralDb} dB = 100 % · ${capacityMl} ml máx.`
              : 'Requiere el valor basal'}
          </span>
        </div>
      </header>

      {!conBasal ? (
        /* Sin basal la caída no se puede calcular: se dice, no se inventa un 0 %. */
        <div className="vessel-wrap">
          <div className="vessel is-idle" aria-hidden="true">
            <div className="vessel-grid" />
          </div>
          <div className="vessel-meta">
            <span className="section-label">Sin referencia</span>
            <span className="vessel-idle-msg">Esperando el valor basal</span>
            <div className="hairline" style={{ margin: '6px 0' }} />
            <span style={{ fontSize: 'var(--t-xs)', color: 'var(--type-mute)', lineHeight: 1.5 }}>
              Registre la impedancia con el paciente acomodado y la vejiga vacía,
              desde <strong>Calibración</strong>. La estimación se mide como caída
              respecto de ese valor.
            </span>
          </div>
        </div>
      ) : (
        <div className="vessel-wrap">
          <div className={`vessel ${alcanzado ? 'alarm' : ''}`} aria-hidden="true">
            <div className="vessel-grid" />
            <motion.div
              className="vessel-fill"
              style={{
                height: '100%',
                scaleY,
                transformOrigin: 'bottom',
                willChange: 'transform',
              }}
            />
          </div>

          <div className="vessel-meta">
            <span className="section-label">Llenado relativo</span>
            <span className="vessel-pct numeric">
              <motion.span>{pctDisplay}</motion.span>
              <span style={{ color: 'var(--type-low)', fontSize: 'var(--t-xl)' }}>%</span>
            </span>
            <span className="vessel-vol numeric">
              ≈ <motion.span>{volDisplay}</motion.span> ml de {capacityMl}
            </span>

            {/* La magnitud que sostiene la hipótesis, a la vista */}
            <div className="vessel-db">
              <span>
                caída <strong className="numeric">
                  {caida === null ? '—' : `${caida >= 0 ? '' : '−'}${Math.abs(caida).toFixed(2)}`}
                </strong> dB de {umbralDb}
              </span>
              <span className="mute">
                basal {initialValue.toFixed(2)} Ω → umbral {zUmbral.toFixed(2)} Ω
              </span>
            </div>

            <div className="hairline" style={{ margin: '6px 0' }} />
            <span style={{ fontSize: 'var(--t-xs)', color: 'var(--type-mute)', lineHeight: 1.5 }}>
              {alcanzado
                ? <>Se alcanzó la caída de {umbralDb} dB: según la hipótesis en estudio,
                    el punto en que aparecen las ganas. <strong>Falta validarlo</strong> contra
                    lo que refiere el paciente.</>
                : cerca
                  ? <>Cerca del umbral de {umbralDb} dB. Anote cuándo el paciente refiere ganas:
                      es el dato que valida la hipótesis.</>
                  : <>Hipótesis en estudio: las ganas aparecen con una caída de {umbralDb} dB
                      respecto del basal. No reemplaza a la sensación del paciente.</>}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
