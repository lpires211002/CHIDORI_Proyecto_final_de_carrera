# Chidori · Análisis exploratorio (etapa III)

Baja la base, etiqueta cada sesión, calcula el objetivo y dibuja las figuras.
El código es solo de lectura: **no escribe nada en Supabase.**

```bash
cd Analisis_EDA
python extraer.py        # pide usuario y clave de Chidori (usá la cuenta superadmin)
python etiquetar.py      # → salidas/resumen.md, salidas/sesiones_etiquetadas.csv
python graficos.py       # → salidas/figuras/
```

Requiere pandas, numpy, matplotlib y requests (vienen con Anaconda). Probado con
pandas 1.5 y 3.0. Para probarlo sin tocar la base: `python demo/generar_sinteticos.py`
y después lo mismo con `CHIDORI_DEMO=1` adelante. Todo eso queda en `demo/`.

## El diseño que se analiza

- Hidratación **libre**: cada toma se registra con la tecla A (con los ml).
- No se mide el volumen orinado. El foco es la forma de la curva.
- La sesión **termina cuando el sujeto tiene ganas al punto de incomodarle**. En
  términos de la ICS, es el *deseo fuerte de orinar*. Ese es el punto final.

## El objetivo

**Caída % en las ganas** = 100 · (Z0 − Zf) / Z0

- **Z0**: mediana del minuto que empieza **a los 10 min** del inicio
  (`BASAL_INICIO_S`), sin artefactos. ¿Por qué no el primer minuto? En los datos
  reales, varias sesiones caen 1 a 5 % en los primeros minutos, antes de
  cualquier toma, y después se aplanan. Eso es asentamiento electrodo-piel, no
  llenado (P-005 s1: todo lo que cae, cae en esos 10 min). Lo que pasa antes de
  la basal queda en `asentamiento_pct`, y la caída "desde el primer minuto" en
  `caida_pct_desde_inicio`.
- **Zf**: mediana entre 90 y 30 s antes del fin del registro, o antes de la M
  si se apretó. Así queda afuera el movimiento de pararse. Si el registro
  termina con un salto (electrodos despegados), esa cola se corta primero
  (`cola_recortada_s`).
- Todo se calcula sobre la **tendencia** (mediana móvil centrada de 60 s), con
  los artefactos excluidos: |z − tendencia| > max(5σ, 0,05 Ω), σ = 1,4826·MAD.

Además se calculan:

- la caída en dB (como el indicador de la app);
- la pendiente robusta del llenado (Theil-Sen sobre medianas de 30 s, en %/h);
- el tiempo hasta las ganas;
- si hay marcas de sensación (`fsf`, `fdv`), la caída en ese momento.

La caída % no depende de K_CAL, así que no la afecta el ~12 % de incertidumbre
de la calibración. **Sí depende de V_det**: caída = ΔVadc / (Vadc0 + V_det). Por
eso la placa queda en cada fila (`v_det_placa`).

## Etiquetado

Hay dos capas, y la manual manda:

1. **Automática** (`auto_*`): se recalcula en cada corrida a partir de la base.
2. **Manual** (`etiquetas_manuales.csv`): se crea la primera vez con una fila
   por sesión. Lo que escribas ahí no se pisa nunca. Commitealo: es el registro
   de tus decisiones de análisis.

| columna manual | valores | efecto |
|---|---|---|
| `apta` | `si` / `no` / vacío | vacío = usa la automática |
| `motivo_manual` | texto | se suma a los motivos |
| `sitio` | `abdomen` / `muslo` / `otro` | lo que no es abdomen es un control: queda fuera del EDA principal |
| `fin_sesion` | `ganas` / `abortada` / `otro` | si no es `ganas`, no entra (el objetivo supone que terminó en las ganas) |
| `t_basal_s` | segundos | corre la ventana de la basal (p. ej. si los primeros minutos fueron de asentamiento) |
| `protocolo` | texto | por defecto `libre` |
| `notas_analisis` | texto | libre |

En la base va solo lo **observado** (mediciones, eventos, campos). Las
decisiones de análisis van en el CSV, versionadas junto al código.

### Lo que se marca en la app (panel admin, 1.10)

Desde el detalle de una sesión se puede **editar la curva** (recortar inicio y
fin, sacar tramos que se rellenan con PCHIP, suavizar, fijar basal/final a
mano, corregir eventos, comentar) y marcarla **apta / no apta**. `extraer.py`
lo baja (si la base tiene `sql/edicion_sesiones.sql` corrido) y `etiquetar.py`:

- analiza la serie **editada** en vez de la original, con sus eventos (en el
  tiempo de la editada: el 0 es el inicio del recorte). La original queda en
  la base y se sigue usando para detectar duplicados. Columna `editada` = `si`;
  `falta_serie` si la edición existe pero no se bajó su serie (se usó la
  original);
- la tendencia de 60 s, la basal a los 10 min y Zf se calculan igual que
  siempre, aunque la editada ya venga suavizada. La basal y el final que se
  fijaron en la app quedan como referencia en `basal_app_ohm` / `final_app_ohm`,
  no reemplazan a Z0 / Zf;
- **apta / no apta de la app manda sobre la columna `apta` del CSV.** "No apta"
  saca la sesión siempre (motivo `app:no_apta`, con la nota en `nota_app`);
  "apta" no salva una exclusión automática. Sesiones sin marcar en la app: el
  CSV sigue mandando como antes.
- `salidas/eventos_analizados.csv` son los eventos que se usaron; `graficos.py`
  dibuja esos.

### Motivos automáticos

| motivo | ¿excluye? | regla |
|---|---|---|
| `sin_paciente` | sí | la sesión no está atada a un P-00X |
| `posible_prueba` | sí | las notas dicen prueba / test / banco / resistencia / calibración… |
| `adc_lineal` | sí | anterior a v1.6.0: ADC leído como lineal, la conversión es aproximada |
| `muy_corta` | sí | < 20 min |
| `pocas_muestras` | sí | < 200 muestras |
| `posible_recorte` | sí | > 1 % de las muestras sin artefacto pegadas al techo del detector (Vadc ≈ 2,0 V) |
| `sin_mediciones` | sí | la sesión no tiene muestras |
| `duplicada` | sí | copia de otra sesión (mismas marcas de tiempo, Z correlacionada > 0,999). Queda la que tiene paciente, más muestras, más eventos y más campos. Nunca entra, ni a mano |
| `llenado_corto` | sí | menos de 15 min entre la basal y las ganas |
| `sin_basal` | sí | no hay datos suficientes en el minuto de la basal |
| `reescalada_en_analisis` | aviso | estaba en la escala del firmware (cal 4) y no en la de la placa (cal 5): se reescaló acá con la fórmula de `calibracion.sql` |
| `escalones` | aviso | 3 o más saltos de nivel (> 1 % en 30 s) que duran minutos: la caída entre dos puntos pierde sentido; revisar la figura y decidir a mano |
| `sin_tomas_registradas` | aviso | ninguna A en la sesión: el agua queda vacía, no en 0 ml |
| `cal_no_confirmada` | aviso | el equipo no reportó su K_CAL (firmware viejo) |
| `basal_con_artefactos` / `fin_con_artefactos` | aviso | la ventana tuvo que usar muestras marcadas |
| `integridad_baja` | aviso | más del 10 % del tiempo perdido en microcortes |
| `artefactos_altos` | aviso | más del 20 % de las muestras son artefacto |

Todos los umbrales están en `config.py`.

## Salidas

- `salidas/resumen.md`: inventario, tabla de sesiones aptas, prueba de signos
  (por sesión y por sujeto), y el análisis de umbral universal vs personal: DE
  dentro y entre sujetos, ICC(1) y la hipótesis de 1,5 dB de la app.
  También trae la respuesta a las tomas.
- `salidas/sesiones_etiquetadas.csv`: una fila por sesión. Columnas `pac_*` y
  `ses_*` = los campos JSONB tal cual. `covariables_de_legacy` dice qué
  covariables salieron de las columnas viejas de `sessions`, que la vista
  `v_dataset_modelo` no trae.
- `salidas/respuesta_tomas.csv`: por toma, ΔZ a ~5 y ~12 min contra los 2 min
  previos, y lo que explicaría la tendencia de fondo. Cada ventana se corta en
  la toma siguiente.
- `salidas/figuras/`:
  - `sesiones/`: una figura por sesión (crudo, tendencia, artefactos,
    ventanas Z0/Zf, eventos, agua acumulada);
  - `curvas_por_sujeto.png`;
  - `caida_por_sujeto.png`;
  - `caida_vs_covariables.png`;
  - `respuesta_tomas.png`.

## Cómo leer las correlaciones

- Sexo, edad, altura, IMC y circunferencia son **del sujeto**: el n efectivo es
  el número de sujetos, no de sesiones. La figura lo indica en cada panel.
- Con ~7 sujetos, |ρ| tiene que pasar ~0,79 para p < 0,05. Si probás 10
  covariables, hay ~40 % de chance de que alguna "dé" por azar. Todo esto es
  descriptivo.
- Las preguntas que este n sí puede contestar:
  - ¿cae siempre? (prueba de signos por sujeto);
  - ¿la caída en las ganas es reproducible en la misma persona? (ICC, CV);
  - ¿hay una caída rápida después de tomar, antes de que pueda haber diuresis?
    (`respuesta_tomas.png`).

## Notas técnicas

- `fecha` es cuándo se **guardó** la sesión (`created_at`), no cuándo empezó.
- El valor absoluto de Z solo se compara dentro de una misma `era_hw`
  (hardware previo al 15/09, placa 3, placa 5). Por eso Z basal no está entre
  las covariables.
- Los eventos llevan reloj de pared y las muestras el reloj del equipo. El
  desfase es de ~1 s, irrelevante a esta escala. La Z de cada evento se
  recalcula desde la serie: no se usa `session_events.impedance`, que es la
  lectura cruda instantánea.
- `extraer.py` guarda una caché. `--refrescar` vuelve a bajar las mediciones.
  Compara lo bajado con el conteo de la base y avisa si no coincide.
- Si `v_dataset_modelo` corta por tiempo (error 57014), `extraer.py` arma las
  mismas columnas desde `sessions`, `patients` y `session_events`.
  `--sin-vista` lo fuerza. `extraccion.json` registra de dónde salió
  (`fuente_sesiones`). La causa del corte es RLS evaluado fila por fila; la
  corrige `sql/mantenimiento/07_rls_rendimiento.sql`.
- Las mediciones se paginan por clave (`elapsed_time`, `id`), no por offset.
  Con offset, cada página de una sesión de 57 000 muestras volvía a recorrer
  todas las anteriores.
