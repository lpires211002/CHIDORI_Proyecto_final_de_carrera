"""
Chidori · Etapa III · decisiones del análisis en un solo lugar.

Todo lo que es una DECISIÓN (umbrales, ventanas, criterios) vive acá y no en
el código, para que quede versionado y se pueda citar en la tesis.
Si cambiás algo, re-corré `etiquetar.py` y `graficos.py`.

Diseño del experimento (confirmado por Luca, 19/10/2026):
  · hidratación LIBRE en todas las sesiones (tomas registradas con A);
  · no se mide el volumen orinado: el foco es la forma de la curva;
  · la sesión termina cuando el sujeto siente ganas al punto de incomodarle
    (equivale al "deseo fuerte de orinar" de la ICS). Ese es el punto final.
"""
import os
from pathlib import Path

AQUI = Path(__file__).resolve().parent

# ── Rutas ────────────────────────────────────────────────────────────────
# CHIDORI_DEMO=1 trabaja sobre datos sintéticos en demo/, sin tocar los reales.
DEMO = os.environ.get("CHIDORI_DEMO") == "1"
BASE = AQUI / "demo" if DEMO else AQUI
DATOS = BASE / "datos"            # caché local de la base (no se commitea)
SALIDAS = BASE / "salidas"        # tablas y figuras (no se commitea)
ETIQUETAS_MANUALES = BASE / "etiquetas_manuales.csv"   # SÍ se commitea (la real)
ENV_APP = AQUI.parent / "Programacion_UI_Micro" / "UI_REACT" / ".env.local"

# Placa física. Confirmado el 24/10: TODAS las sesiones guardadas se midieron
# con la placa 1 (la que tenía un componente que no amplificaba), y la base las
# lleva a la escala de la placa 3.1 (calibracion.sql rev 6, cal 6: K 0,0180 ·
# Vd 0,260). Si se carga `board_id` en la sesión, manda ese.
PLACA_FISICA_POR_DEFECTO = "placa_1"
# Pero esa placa cambió el 27/09: R9 de 2,2k a 1,2k (U4D ~×4,4 → ×8,15). La rev 6
# usa la misma K para antes y después, y en los datos se ve: el mismo sujeto da
# Z basal ~1,6× mayor desde el 27/09 (P-004: 81–95 Ω → 147–153 Ω; P-002 y P-003
# igual). La caída % no se entera (es un cociente de amplitudes), pero el valor
# absoluto de Z solo se compara dentro de una misma configuración.
FECHA_CAMBIO_R9 = "2026-09-27"    # P-004 s9 (27/09 22:40) ya es con 1,2k
PROTOCOLO_POR_DEFECTO = "libre"   # se puede pisar por sesión en etiquetas_manuales.csv
# Sitio de los electrodos: campo `electrode_site` de la sesión (si existe) o
# columna `sitio` del CSV manual. Lo que no es abdomen va como control.
SITIOS = {"abdomen": "abdomen", "abdomen (protocolo)": "abdomen", "muslo": "muslo",
          "muslo (control)": "muslo", "otro": "otro"}

# ── Señal ────────────────────────────────────────────────────────────────
VENTANA_TENDENCIA_S = 60      # mediana móvil CENTRADA (la app usa la misma, pero causal)
ARTEFACTO_K_SIGMA = 5         # |z − tendencia| > max(K·σ, MIN) → artefacto
ARTEFACTO_MIN_REL = 0.007     # σ = 1,4826 · MAD de los residuos. Piso relativo:
                              # 0,7 % de la tendencia (antes 0,05 Ω fijos, que con la
                              # escala 3.1, ~20 veces mayor, marcaba ruido como artefacto)
ARTEFACTO_DILATAR_S = 2       # se marca también ±2 s alrededor de cada artefacto

# ── Ventanas que definen el objetivo ─────────────────────────────────────
BASAL_VENTANA_S = 60              # Z0 = mediana [t_basal, t_basal + 60 s]
# La basal se toma a los 10 min del inicio, no en el primer minuto. Motivo
# (datos reales, 19/10): en varias sesiones Z cae 1 a 5 % en los primeros
# minutos, antes de cualquier toma, y después se aplana: es el asentamiento
# electrodo-piel, no llenado. Es lo que el protocolo escrito resolvía con 15
# min de estabilización, que en la práctica no se hizo. La caída desde el
# primer minuto se reporta igual (`caida_pct_desde_inicio`), y lo que pasa
# antes de la basal queda en `asentamiento_pct`.
BASAL_INICIO_S = 600
LLENADO_MINIMO_MIN = 15           # de la basal a las ganas; menos no alcanza para medir
# Zf = mediana entre 90 y 30 s ANTES del fin (o de la M / marca de ganas si
# existe): deja afuera el movimiento de pararse y despegar los electrodos.
PRE_FIN_VENTANA_S = (-90, -30)
BIN_PENDIENTE_S = 30              # la pendiente se ajusta sobre medianas de 30 s
HIPOTESIS_GANAS_DB = 1.5          # la app supone ganas a −1,5 dB (Z al 84,1 %)

# Eventos que, si existen, marcan sensaciones (propuesta: teclas nuevas en la app).
# El fin de la sesión ya es el "deseo fuerte".
SENSACIONES = {"fsf": "primera sensación", "fdv": "primer deseo"}

# ── Respuesta a cada toma de agua (ventanas relativas a la toma) ─────────
TOMA_REF_S = (-120, 0)       # referencia: 2 min antes de tomar
TOMA_5MIN_S = (240, 360)     # ~5 min después
TOMA_12MIN_S = (660, 780)    # ~12 min después
TOMA_CURVA_S = (-120, 900)   # tramo que se grafica alrededor de cada toma
# Una ventana que contiene otra toma no se usa (la mezclaría con la siguiente).

# ── Cola del registro ────────────────────────────────────────────────────
# Al terminar, despegar electrodos o pararse produce un salto final (P-004 s1:
# de 7 a 29 Ω en el último minuto). Si los últimos < 3 min se alejan más de
# 10 % del nivel previo, se cortan antes de calcular Zf.
COLA_REF_S = (-300, -120)
COLA_UMBRAL_REL = 0.10
COLA_MAX_S = 180

# ── Escalones ────────────────────────────────────────────────────────────
# Saltos de nivel que duran minutos (postura, electrodo que se mueve): la
# mediana de 60 s no los saca. Se cuenta un escalón cuando la tendencia cambia
# más de 1 % en 30 s (el llenado mueve ~0,02 % en 30 s). Con 3 o más, la caída
# entre dos puntos deja de significar algo: aviso para revisar a mano.
ESCALON_REL = 0.01
ESCALON_VENTANA_S = 30
ESCALONES_AVISO = 3

# ── Duplicados ───────────────────────────────────────────────────────────
# `commitSession` sube sesión, mediciones y eventos en pasos separados y la
# cola reintenta todo si algo falla: quedan copias de la misma medición. Se
# detectan por las primeras 200 marcas de tiempo + correlación de Z > 0,999
# (una copia reescalada sigue siendo la misma medición).
DUP_MUESTRAS = 200
DUP_CORR_MIN = 0.999

# ── Criterios automáticos de exclusión / aviso ───────────────────────────
DURACION_MINIMA_MIN = 20
MUESTRAS_MINIMAS = 200
INTEGRIDAD_MINIMA = 0.90          # 1 − segundos_perdidos / duración
FRACCION_ARTEFACTO_MAX = 0.20
# Techo del detector: con las dos placas el rango declarado cierra en Vadc ≈ 2,0 V
# (placa 3: 26 Ω · placa 5: 13 Ω). Muestras pegadas ahí son recorte.
VADC_TECHO_V = 2.0
FRACCION_RECORTE_MAX = 0.01
# Notas que sugieren que la sesión no es una medición de protocolo.
REGEX_PRUEBA = r"\b(prueba|test|banco|resist|simulador|calibr|debug|ensayo)\w*"

# Motivos que EXCLUYEN del EDA (los demás son solo aviso).
MOTIVOS_EXCLUYENTES = {
    "sin_paciente", "posible_prueba", "adc_lineal", "duplicada", "llenado_corto",
    "muy_corta", "pocas_muestras", "posible_recorte", "sin_mediciones", "sin_basal",
}

# ── Covariables ──────────────────────────────────────────────────────────
# nombre final  →  (clave en JSONB, columna legacy de `sessions`)
# Se toma el JSONB; si falta, la columna vieja. Queda registrado de dónde salió.
COVARIABLES = {
    "sexo":            ("pac_sex",            "patient_gender"),
    "altura_m":        ("pac_height_m",       "patient_height"),
    "peso_kg":         (("ses_weight_kg", "pac_weight_kg"), "patient_weight"),  # sesión, si no ficha
    "circ_iliaca_cm":  ("ses_iliac_circ_cm",  "patient_iliac_circ"),
    "temp_amb_c":      ("ses_temperature_c",  "temperature_c"),
    "humedad_pct":     ("ses_humidity_pct",   "humidity_pct"),
    "agua_declarada_ml": ("ses_water_ml",     "water_total_ml"),
    "ingesta_24h_txt": ("ses_food_24h",       "food_24h"),
}

# Covariables que se grafican contra el objetivo (solo las que tengan datos).
COVARIABLES_GRAFICO = [
    ("duracion_llenado_min", "Tiempo hasta las ganas (min)"),
    ("agua_eventos_ml", "Agua tomada en la sesión (ml)"),
    ("edad", "Edad (años)"),
    ("imc", "IMC (kg/m²)"),
    ("circ_iliaca_cm", "Circ. suprailíaca (cm)"),
    ("temp_amb_c", "Temp. ambiente (°C)"),
    ("humedad_pct", "Humedad ambiente (%)"),
    ("asentamiento_pct", "Asentamiento 0–10 min (%)"),
    # Z basal: solo las sesiones con R9 = 1,2k (desde el 27/09), las únicas
    # comparables entre sí en valor absoluto (ver FECHA_CAMBIO_R9).
    ("z0_ohm_r9_1k2", "Z basal (Ω) · solo desde el 27/09"),
    # Campos nuevos propuestos (aparecen solos cuando se carguen)
    ("ses_minutes_since_void", "Min desde la micción previa"),
    ("ses_fluid_24h_ml", "Líquido últimas 24 h (ml)"),
    ("ses_hours_no_fluid", "Horas sin líquido antes"),
    ("ses_urine_color", "Color de orina previa (1–8)"),
    ("ses_skin_temp_start_c", "Temp. piel inicio (°C)"),
    ("ses_abd_skinfold_mm", "Pliegue abdominal (mm)"),
]
