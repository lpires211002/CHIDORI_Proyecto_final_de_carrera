# Chidori · EDA etapa III · inventario

Extracción: 2026-11-08T17:07:27 · 34 sesiones · 10 sujetos · 399644 muestras

**Aptas para el EDA: 24 sesiones de 9 sujetos** (abdomen; los controles en otro sitio van aparte).

**Escala: calibración por cargas** (recta de banco 7,14 mV/Ω, -47 mV; antes del 27/09 × 1,85 por R9). Caída mediana de las aptas: 1,83 % con esta escala, 1,53 % con la Z de la base (cal 6).

## Motivos (una sesión puede tener varios)

| motivo | excluye | sesiones |
|---|---|---|
| cal_no_confirmada | aviso | 10 |
| sin_tomas_registradas | aviso | 7 |
| llenado_corto | sí | 4 |
| app:no_apta | sí | 4 |
| escalones | aviso | 3 |
| fin_con_artefactos | aviso | 3 |
| adc_lineal | sí | 2 |
| basal_con_artefactos | aviso | 2 |
| muy_corta | sí | 2 |
| posible_prueba | sí | 1 |
| sin_basal | sí | 1 |
| integridad_baja | aviso | 1 |
| duplicada | sí | 1 |

## Duplicados (copias de la misma medición; queda una)

| copia | se queda | muestras |
|---|---|---|
| P-009 s1 | P-009 s4 | 6388 |

Origen probable: `commitSession` sube sesión, mediciones y eventos en pasos separados y la cola reintenta todo si algo falla. Borrarlas de la base es opcional (irreversible): el análisis ya las saca.

## Por sujeto

| sujeto | sesiones | aptas |
|---|---|---|
| P-001 | 1 | 1 |
| P-002 | 5 | 4 |
| P-003 | 7 | 4 |
| P-004 | 7 | 6 |
| P-005 | 2 | 2 |
| P-006 | 2 | 0 |
| P-007 | 2 | 2 |
| P-008 | 3 | 2 |
| P-009 | 3 | 1 |
| P-010 | 2 | 2 |

## Sesiones aptas

Caída = (Z0 − Zf) / Z0. Z0 = mediana del minuto que empieza a los 10 min (después del asentamiento); Zf = mediana entre 90 y 30 s antes del fin o de la M (las ganas). «asent.» = lo que cayó Z antes de la basal; «desde inicio» = la caída si la basal fuera el primer minuto.

| sujeto | s | fecha | editada | fin por | basal→ganas (min) | agua (ml) | Z0 (Ω) | asent. % | caída % | desde inicio % | dB | %/h | artef. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P-001 | 1 | 06/08 | si | fin_registro | 15 | 300 | 292,7 | 3,0 | 1,1 | 4,1 | 0,10 | -9,82 | 0 % |
| P-002 | 2 | 31/08 |  | fin_registro | 17 | — | 129,8 | 1,0 | 0,1 | 1,2 | 0,01 | -0,02 | 2 % |
| P-002 | 3 | 02/10 |  | marca_M | 44 | 900 | 131,1 | 3,5 | 1,0 | 4,5 | 0,09 | -1,77 | 0 % |
| P-002 | 4 | 09/10 | si | fin_registro | 52 | 180 | 123,0 | 1,6 | 0,3 | 1,8 | 0,02 | -0,31 | 0 % |
| P-002 | 5 | 09/10 | si | marca_M | 46 | 300 | 132,0 | 0,7 | 2,6 | 3,3 | 0,23 | -3,34 | 0 % |
| P-003 | 3 | 21/08 |  | fin_registro | 38 | — | 155,7 | 1,2 | 5,0 | 6,2 | 0,45 | -8,97 | 17 % |
| P-003 | 4 | 30/08 |  | marca_M | 54 | — | 132,2 | 3,4 | 6,7 | 9,8 | 0,60 | -7,10 | 2 % |
| P-003 | 5 | 18/10 |  | fin_registro | 74 | 1450 | 147,9 | 1,2 | 3,7 | 4,9 | 0,33 | -2,97 | 0 % |
| P-003 | 6 | 30/10 | si | fin_registro | 15 | 100 | 156,6 | 1,5 | 1,7 | 3,1 | 0,15 | -7,02 | 0 % |
| P-004 | 1 | 18/08 | si | fin_registro | 48 | — | 134,0 | 5,5 | 4,5 | 9,8 | 0,40 | -6,86 | 19 % |
| P-004 | 5 | 02/09 | si | fin_registro | 88 | — | 166,4 | 0,4 | 3,3 | 3,7 | 0,29 | -2,25 | 0 % |
| P-004 | 9 | 27/09 | si | fin_registro | 78 | 1500 | 155,0 | -0,4 | 2,5 | 2,1 | 0,22 | -2,23 | 1 % |
| P-004 | 10 | 08/10 | si | fin_registro | 86 | 1750 | 163,0 | -0,3 | 3,3 | 3,0 | 0,29 | -2,65 | 0 % |
| P-004 | 11 | 05/11 | si | fin_registro | 65 | 1500 | 152,3 | -0,0 | 3,2 | 3,2 | 0,28 | -3,12 | 0 % |
| P-004 | — | 23/10 | si | fin_registro | 21 | 1250 | 134,3 | 0,1 | 0,6 | 0,7 | 0,05 | -1,23 | 0 % |
| P-005 | 1 | 08/10 | si | marca_M | 44 | 750 | 131,1 | 4,9 | -0,4 | 4,5 | -0,03 | -0,29 | 0 % |
| P-005 | 2 | 08/10 | si | marca_M | 59 | 550 | 128,2 | 1,8 | 1,5 | 3,3 | 0,14 | -1,45 | 0 % |
| P-007 | 1 | 10/10 |  | marca_M | 32 | 300 | 133,8 | 1,1 | 2,0 | 3,1 | 0,17 | -2,78 | 0 % |
| P-007 | 3 | 18/10 |  | marca_M | 65 | 750 | 140,7 | -0,5 | 0,6 | 0,2 | 0,05 | -1,42 | 1 % |
| P-008 | 1 | 15/10 |  | marca_M | 51 | 1400 | 189,3 | -0,7 | 1,7 | 1,0 | 0,15 | -3,75 | 1 % |
| P-008 | 3 | 24/10 | si | marca_M | 51 | 1250 | 145,7 | 1,6 | 2,7 | 4,3 | 0,24 | -2,83 | 0 % |
| P-009 | 4 | 21/10 | si | fin_registro | 60 | 750 | 187,9 | 1,2 | 2,2 | 3,4 | 0,19 | -1,76 | 0 % |
| P-010 | 1 | 26/10 | si | fin_registro | 59 | 450 | 151,8 | 3,6 | 0,3 | 4,0 | 0,03 | -0,01 | 0 % |
| P-010 | 2 | 04/11 | si | marca_M | 41 | 435 | 150,5 | 2,2 | 0,2 | 2,4 | 0,02 | 0,27 | 0 % |

## Asentamiento de los primeros minutos

- mediana del asentamiento (0 a 10 min): 1,23 % · sesiones con más de 1 %: 16 de 24
- sesiones donde cayó más en los primeros 10 min que en todo el resto: 9 de 24
- fracción de la caída «desde el inicio» que es asentamiento (mediana): 37 %

Con la basal en el primer minuto, el asentamiento se cuenta como llenado. Para que no pase: esperar la estabilización antes de tocar Iniciar (o dejar que el análisis tome la basal más tarde, como acá).

## Z basal del mismo sujeto con cada configuración de hardware

Mediana de Z0 (Ω) de las sesiones con basal válida (aptas o no). Si la escala es consistente, cada fila debería dar parecido en todas las columnas.

| sujeto | placa 1 · R9 2,2k | placa 1 · R9 1,2k | placa 3.1 |
|---|---|---|---|
| P-002 | 129,8 | 131,1 | — |
| P-003 | 153,4 | 147,9 | 156,6 |
| P-004 | 160,6 | 155,0 | 152,3 |
| P-006 | — | 141,2 | 148,0 |
| P-009 | — | 187,9 | 194,1 |

Escala: recta de banco por cargas; la placa 1 con R9 2,2k además × 1,85. Con la Z de la base (cal 6) la columna de R9 2,2k daba 1,6–1,7 veces menos.

## ¿Cae siempre? (prueba de signos)

- por sesión: cae en 23 de 24 · p = 0,0000 (optimista: las sesiones de un mismo sujeto no son independientes)
- por sujeto (mediana de sus sesiones): cae en 9 de 9 · p = 0,0039 ← esta es la que se puede citar

## ¿Umbral universal o personal?

| sujeto | n | caída % media | DE | CV | caída dB mediana | hasta ganas (min) | %/h mediana |
|---|---|---|---|---|---|---|---|
| P-001 | 1 | 1,1 | — | — | 0,10 | 15 | -9,82 |
| P-002 | 4 | 1,0 | 1,1 | 1,13 | 0,06 | 45 | -1,04 |
| P-003 | 4 | 4,3 | 2,1 | 0,49 | 0,39 | 46 | -7,06 |
| P-004 | 6 | 2,9 | 1,3 | 0,45 | 0,29 | 71 | -2,45 |
| P-005 | 2 | 0,6 | 1,4 | 2,40 | 0,05 | 51 | -0,87 |
| P-007 | 2 | 1,3 | 1,0 | 0,74 | 0,11 | 49 | -2,10 |
| P-008 | 2 | 2,2 | 0,7 | 0,34 | 0,19 | 51 | -3,29 |
| P-009 | 1 | 2,2 | — | — | 0,19 | 60 | -1,76 |
| P-010 | 2 | 0,3 | 0,1 | 0,30 | 0,02 | 50 | 0,13 |

- DE dentro del sujeto (agrupada): 1,39 pp · DE entre sujetos (de las medias): 1,27 pp
- ICC(1) de la caída %: 0,39 (cerca de 1 = cada persona tiene su caída típica → umbral personal; cerca de 0 = la caída varía igual dentro que entre personas)
- Hipótesis de la app (ganas a 1,5 dB): mediana de los sujetos 0,11 dB · sesiones por encima de 1,5 dB: 0 de 24

## Respuesta a cada toma de agua

- tomas analizables: 58
- ΔZ a 5 min de la toma (mediana): -0,26 % del basal
- lo que explicaría la tendencia de fondo: -0,22 %
- exceso (mediana): -0,02 % · tomas con caída mayor que la tendencia: 32 de 58

Si el exceso es claramente negativo, parte de la caída aparece minutos después de tomar, antes de que haya diuresis: no es vejiga (intestino o redistribución).

## Antes de mirar correlaciones

- Variables del sujeto (sexo, edad, altura, IMC): n efectivo = 9 sujetos. Umbral aproximado de |ρ| para p < 0,05: 0,67.
- Variables de sesión: n = 24 sesiones, pero agrupadas por sujeto. Umbral aproximado: 0,40 (optimista).
- Con 10 covariables probadas, la chance de al menos un falso positivo es ~40 %.
- La caída % depende de la ordenada de la recta de calibración: caída = ΔVadc / (Vadc0 + 0,047) con la calibración por cargas (con la cal 6 era ΔVadc / (Vadc0 + 0,260)).
