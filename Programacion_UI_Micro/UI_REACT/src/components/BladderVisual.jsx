import React, { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { X } from 'lucide-react';

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
  /* Fila de pie (estado de la alarma). Vive dentro del mismo panel para que
   * la columna lateral sea un solo bloque, del mismo alto que la señal. */
  footer = null,
  /* Panel desplegable: id para aria-controls y cierre desde su propio encabezado */
  id,
  onClose,
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

  /* La hipótesis se explica una vez, en el tooltip del título. En pantalla
   * solo aparece texto cuando pide una acción (cerca o en el umbral). */
  const hipotesis = `Hipótesis en estudio: las ganas aparecen con una caída de ${umbralDb} dB `
    + `respecto del basal (100 % = ${capacityMl} ml). No reemplaza a la sensación del paciente.`;

  return (
    <section id={id} className="surface surface-pad bladder-panel" aria-label="Volumen vesical estimado">
      <header className="section-head">
        <h2 className="panel-title" title={hipotesis}>Volumen estimado</h2>
        {onClose && (
          <button type="button" className="icon-button" onClick={onClose} aria-label="Plegar volumen estimado">
            <X size={15} />
          </button>
        )}
      </header>

      <div className="vessel-wrap">
        <div className={`vessel ${!conBasal ? 'is-idle' : alcanzado ? 'alarm' : ''}`} aria-hidden="true">
          <div className="vessel-grid" />
          {conBasal && (
            <motion.div
              className="vessel-fill"
              style={{
                height: '100%',
                scaleY,
                transformOrigin: 'bottom',
                willChange: 'transform',
              }}
            />
          )}
        </div>

        {!conBasal ? (
          /* Sin basal la caída no se puede calcular: se dice, no se inventa un 0 %. */
          <div className="vessel-meta">
            <span className="vessel-idle-msg">Esperando el basal</span>
            <span className="vessel-note">Fijalo desde Calibración, con la vejiga vacía.</span>
          </div>
        ) : (
          <div className="vessel-meta">
            <span className="vessel-pct numeric">
              <motion.span>{pctDisplay}</motion.span>
              <span className="vessel-pct-unit">%</span>
            </span>
            <span className="vessel-vol numeric">
              ≈ <motion.span>{volDisplay}</motion.span> ml
            </span>
            <dl className="vessel-facts">
              <dt>Caída</dt>
              <dd className="numeric">
                {caida === null ? '—' : `${caida >= 0 ? '' : '−'}${Math.abs(caida).toFixed(2)}`} / {umbralDb} dB
              </dd>
              <dt>Umbral</dt>
              <dd className="numeric">{zUmbral.toFixed(2)} Ω</dd>
            </dl>
            {(alcanzado || cerca) && (
              <span className={`vessel-note ${alcanzado ? 'is-alarm' : ''}`}>
                {alcanzado
                  ? 'Umbral alcanzado: confirmá con el paciente si tiene ganas.'
                  : 'Cerca del umbral: anotá cuándo refiere ganas.'}
              </span>
            )}
          </div>
        )}
      </div>

      {footer && <div className="bladder-footer">{footer}</div>}
    </section>
  );
}
