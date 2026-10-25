"""
Chidori · Etapa III · paso 2: etiquetar cada sesión y calcular el objetivo.

    python etiquetar.py

Lee la caché de `extraer.py` (datos/) y `etiquetas_manuales.csv`, y escribe:

    salidas/sesiones_etiquetadas.csv   una fila por sesión: etiquetas, objetivo,
                                       features y covariables (ver README)
    salidas/respuesta_tomas.csv        una fila por toma de agua
    salidas/respuesta_tomas_curvas.csv Z alrededor de cada toma (para graficar)
    salidas/series/<id>.csv.gz         serie procesada: t, z, tendencia, artefacto
    salidas/resumen.md                 inventario y primeras respuestas

La primera vez crea `etiquetas_manuales.csv` con una fila por sesión. Las
columnas `auto_*` se reescriben en cada corrida (son la sugerencia); las demás
son tuyas y nunca se pisan. Lo que pongas ahí manda sobre lo automático.

Principio: en la base solo va lo OBSERVADO (mediciones, eventos, campos).
Las decisiones de análisis (apta / no apta, motivo, protocolo) van en ese CSV,
versionado junto al código.

Edición en la app (1.10): si una sesión se editó en el panel (recorte, tramos
rellenados, suavizado, eventos corregidos), se analiza la serie EDITADA, la
misma que ve la app, con sus eventos. El apta / no apta marcado en la app
manda sobre el `apta` de etiquetas_manuales.csv; las exclusiones automáticas
siguen aplicando igual. La tendencia de 60 s se calcula igual sobre la
editada aunque ya venga suavizada.
"""
import hashlib
import json
import math
import re

import numpy as np
import pandas as pd

import config as C

MANUALES = ["protocolo", "sitio", "apta", "motivo_manual", "fin_sesion",
            "t_basal_s", "notas_analisis"]
AUTOS = ["auto_protocolo", "auto_apta", "auto_motivos", "auto_fin_sesion"]


# ═══ utilidades de señal ════════════════════════════════════════════════

def tendencia_centrada(t, z, ventana_s):
    """Mediana móvil centrada por tiempo (no por cantidad de muestras).
    Ignora NaN, así sirve para recalcular sin los artefactos."""
    s = pd.Series(z, index=pd.to_timedelta(t, unit="s"))
    try:
        return s.rolling(f"{int(ventana_s)}s", center=True, min_periods=1).median().to_numpy()
    except (ValueError, NotImplementedError, TypeError):      # pandas < 1.3
        lo = np.searchsorted(t, t - ventana_s / 2, "left")
        hi = np.searchsorted(t, t + ventana_s / 2, "right")
        out = np.full(len(z), np.nan)
        for i in range(len(z)):
            w = z[lo[i]:hi[i]]
            w = w[np.isfinite(w)]
            if len(w):
                out[i] = np.median(w)
        return out


def sigma_robusta(x):
    x = np.asarray(x, float)
    x = x[np.isfinite(x)]
    if not len(x):
        return np.nan
    return 1.4826 * float(np.median(np.abs(x - np.median(x))))


def dilatar(t, mask, seg):
    if seg <= 0 or not mask.any():
        return mask
    ta = t[mask]
    idx = np.searchsorted(ta, t)
    izq = np.abs(t - ta[np.clip(idx - 1, 0, len(ta) - 1)])
    der = np.abs(ta[np.clip(idx, 0, len(ta) - 1)] - t)
    return np.minimum(izq, der) <= seg


def mediana_ventana(t, z, ok, a, b, fs, cobertura=0.5):
    """Mediana de z en [a, b) usando solo muestras ok. NaN si hay menos de
    `cobertura` de las muestras esperadas (hueco o todo artefacto)."""
    m = (t >= a) & (t < b) & ok & np.isfinite(z)
    if m.sum() < max(3, cobertura * (b - a) * fs):
        return np.nan
    return float(np.median(z[m]))


def theil_sen(x, y):
    m = np.isfinite(x) & np.isfinite(y)
    x, y = x[m], y[m]
    if len(x) < 6:
        return np.nan
    i, j = np.triu_indices(len(x), 1)
    dx = x[j] - x[i]
    k = dx != 0
    return float(np.median((y[j] - y[i])[k] / dx[k]))


def prueba_signos(k, n):
    """p bilateral exacta de que k de n sean positivos con p = 0,5."""
    if n == 0:
        return np.nan
    m = min(k, n - k)
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(m + 1)) / 2 ** n)


def vacio(v):
    return v is None or (isinstance(v, float) and math.isnan(v)) or (isinstance(v, str) and not v.strip())


# ═══ carga ══════════════════════════════════════════════════════════════

def cargar():
    if not (C.DATOS / "sesiones.json").exists():
        raise SystemExit("No hay caché. Corré primero: python extraer.py")
    filas = []
    for s in json.loads((C.DATOS / "sesiones.json").read_text(encoding="utf-8")):
        f = {k: v for k, v in s.items() if k not in ("datos_paciente", "datos_sesion")}
        for k, v in (s.get("datos_paciente") or {}).items():
            f[f"pac_{k}"] = v
        for k, v in (s.get("datos_sesion") or {}).items():
            f[f"ses_{k}"] = v
        filas.append(f)
    ses = pd.DataFrame(filas)
    ses["fecha"] = pd.to_datetime(ses["fecha"], utc=True, errors="coerce")
    ses["nro_sesion"] = pd.to_numeric(ses["nro_sesion"], errors="coerce").astype("Int64")

    leg = pd.read_csv(C.DATOS / "legacy.csv")
    leg = leg.rename(columns={"id": "session_id"}).drop(columns=["created_at"], errors="ignore")
    leg = leg.rename(columns={c: f"leg_{c}" for c in leg.columns if c != "session_id"})
    ses = ses.merge(leg, on="session_id", how="left")

    ev = pd.read_csv(C.DATOS / "eventos.csv") if (C.DATOS / "eventos.csv").stat().st_size > 2 \
        else pd.DataFrame(columns=["session_id", "elapsed_time", "kind", "amount_ml"])
    cal = pd.read_csv(C.DATOS / "calibraciones.csv").set_index("id")
    return ses, ev, cal


def cargar_app():
    """Ediciones y apta / no apta hechos en la app (los baja extraer.py).
    Sin esos archivos (caché vieja o base sin las tablas) devuelve vacío."""
    ediciones, revision = {}, {}
    p = C.DATOS / "ediciones.json"
    if p.exists():
        ediciones = {e["session_id"]: e for e in json.loads(p.read_text(encoding="utf-8"))}
    p = C.DATOS / "revision.csv"
    if p.exists() and p.stat().st_size > 2:
        for _, x in pd.read_csv(p, dtype=str, keep_default_na=False).iterrows():
            revision[x["session_id"]] = {"apta": x["apta"].strip().lower() in ("true", "t", "1", "si"),
                                         "nota": x.get("nota", "")}
    return ediciones, revision


def cargar_mediciones_editadas(sid, version):
    p = C.DATOS / "mediciones_editadas" / f"{sid}__{version}.csv.gz"
    if not p.exists():
        return None
    m = pd.read_csv(p)
    for c in ("elapsed_time", "impedance", "voltage_v"):
        if c in m:
            m[c] = pd.to_numeric(m[c], errors="coerce")
    m = m[np.isfinite(m["elapsed_time"]) & np.isfinite(m["impedance"])]
    return m.sort_values("elapsed_time", kind="mergesort").reset_index(drop=True)


def eventos_editados(sid, ed):
    """Eventos de la edición, en el tiempo de la serie editada. Los de fuera
    del recorte (agua y micción) quedan con tiempo negativo o pasado el fin:
    los filtros de ventana del análisis ya los tratan como antes / después."""
    filas = [{"session_id": sid, "event_number": e.get("event_number"),
              "elapsed_time": e.get("elapsed_time"), "kind": e.get("kind"),
              "amount_ml": e.get("amount_ml"),
              "impedance_change": e.get("gap_s") if e.get("kind") == "gap" else None}
             for e in (ed.get("eventos") or [])]
    return pd.DataFrame(filas, columns=["session_id", "event_number", "elapsed_time", "kind",
                                        "amount_ml", "impedance_change"])


def cargar_mediciones(sid):
    p = C.DATOS / "mediciones" / f"{sid}.csv.gz"
    if not p.exists():
        return None
    m = pd.read_csv(p)
    for c in ("elapsed_time", "impedance", "voltage_v"):
        if c in m:
            m[c] = pd.to_numeric(m[c], errors="coerce")
    m = m[np.isfinite(m["elapsed_time"]) & np.isfinite(m["impedance"])]
    return m.sort_values("elapsed_time", kind="mergesort").reset_index(drop=True)


def reescalar(med, row, cal):
    """Pasa las mediciones a la escala de la placa si quedaron en la del firmware.
    Pasa con las sesiones medidas con el firmware "1,1k" (cal 4) en la placa 5
    después de la última corrida de calibracion.sql (cal_mostrada vacía).
    Misma fórmula que el SQL: Z_b = Z_a·(K_a/K_b) + 2(Vd_b − Vd_a)/K_b."""
    actual = row.get("cal_mostrada")
    if vacio(actual):
        actual = row.get("cal_firmware")
    destino = row.get("cal_placa")
    if vacio(actual) or vacio(destino) or int(actual) == int(destino) or med is None:
        return med, ""
    a, b = int(actual), int(destino)
    if a not in cal.index or b not in cal.index:
        return med, ""
    ka, vda = float(cal.loc[a, "k_cal"]), float(cal.loc[a, "v_detector"])
    kb, vdb = float(cal.loc[b, "k_cal"]), float(cal.loc[b, "v_detector"])
    med = med.copy()
    med["impedance"] = med["impedance"] * (ka / kb) + 2 * (vdb - vda) / kb
    return med, f"{a}->{b}"


def sincronizar_manuales(ses):
    """Crea o actualiza etiquetas_manuales.csv sin pisar lo que cargaste."""
    base = ses[["session_id", "paciente", "nro_sesion", "fecha"]].copy()
    base["fecha"] = base["fecha"].dt.strftime("%Y-%m-%d")
    if C.ETIQUETAS_MANUALES.exists():
        man = pd.read_csv(C.ETIQUETAS_MANUALES, dtype=str, keep_default_na=False)
        man = man[["session_id"] + [c for c in MANUALES if c in man.columns]]
    else:
        man = pd.DataFrame(columns=["session_id"] + MANUALES)
    for c in MANUALES:
        if c not in man:
            man[c] = ""
    out = base.merge(man, on="session_id", how="left")
    for c in MANUALES:
        out[c] = out[c].fillna("").astype(str)
    return out


# ═══ una sesión ═════════════════════════════════════════════════════════

def procesar(row, med, ev_s, man, cal):
    r = {"session_id": row["session_id"]}
    motivos = []

    if med is None or len(med) < 2:
        r["motivos"] = ["sin_mediciones"]
        return r, None, [], []

    t = med["elapsed_time"].to_numpy(float)
    z = med["impedance"].to_numpy(float)
    fs = 1.0 / float(np.median(np.diff(t))) if len(t) > 2 else np.nan
    r["n_muestras_bajadas"] = len(t)
    r["fs_hz"] = fs
    r["_huella"] = hashlib.md5(np.round(t[:C.DUP_MUESTRAS], 3).tobytes()).hexdigest()
    r["_zhead"] = z[:C.DUP_MUESTRAS].copy()

    # 0 · cola: salto final al despegar electrodos o pararse
    t_end = float(t[-1])
    r["cola_recortada_s"] = 0.0
    a_, b_ = C.COLA_REF_S
    m_ref = (t >= t_end + a_) & (t < t_end + b_)
    if m_ref.sum() > 10:
        ref = float(np.median(z[m_ref]))
        z10 = tendencia_centrada(t, z, 10)
        cerca = np.where(np.abs(z10 - ref) <= C.COLA_UMBRAL_REL * abs(ref))[0]
        if len(cerca):
            perdido = t_end - float(t[cerca[-1]])
            if 5 < perdido <= C.COLA_MAX_S:
                corte = cerca[-1] + 1
                t, z, med = t[:corte], z[:corte], med.iloc[:corte]
                t_end = float(t[-1])
                r["cola_recortada_s"] = perdido
    r["duracion_min"] = (t_end - t[0]) / 60

    # 1 · tendencia, residuos y artefactos (dos pasadas: la segunda sin artefactos)
    tend0 = tendencia_centrada(t, z, C.VENTANA_TENDENCIA_S)
    res = z - tend0
    sig = sigma_robusta(res)
    piso = C.ARTEFACTO_MIN_REL * abs(float(np.nanmedian(tend0)))
    umbral = max(C.ARTEFACTO_K_SIGMA * sig, piso) if np.isfinite(sig) else piso
    art = dilatar(t, np.abs(res) > umbral, C.ARTEFACTO_DILATAR_S)
    ok = ~art
    tend = tendencia_centrada(t, np.where(ok, z, np.nan), C.VENTANA_TENDENCIA_S)
    if np.isnan(tend).any() and np.isfinite(tend).any():
        f = np.isfinite(tend)
        tend = np.interp(t, t[f], tend[f])
    # escalones: saltos de nivel de la tendencia que duran más que un artefacto
    lag = int(round(C.ESCALON_VENTANA_S * fs)) if np.isfinite(fs) else 0
    r["escalones"] = 0
    if lag >= 1 and len(tend) > lag:
        salto = np.abs(tend[lag:] - tend[:-lag]) > C.ESCALON_REL * abs(np.nanmedian(tend))
        idx = np.where(salto)[0]
        if len(idx):
            r["escalones"] = int(1 + np.sum(np.diff(t[idx]) > 2 * C.ESCALON_VENTANA_S))
    if r["escalones"] >= C.ESCALONES_AVISO:
        motivos.append("escalones")
    r["ruido_sigma_ohm"] = sigma_robusta(res[ok])
    r["umbral_artefacto_ohm"] = umbral
    r["fraccion_artefacto"] = float(art.mean())

    # 2 · basal
    tb = float(man["t_basal_s"]) if not vacio(man.get("t_basal_s")) else float(t[0]) + C.BASAL_INICIO_S
    r["t_basal_s"] = tb
    z0 = mediana_ventana(t, z, ok, tb, tb + C.BASAL_VENTANA_S, fs)
    if not np.isfinite(z0):
        z0 = mediana_ventana(t, z, np.ones_like(ok), tb, tb + C.BASAL_VENTANA_S, fs, cobertura=0.2)
        motivos.append("basal_con_artefactos")
    if not np.isfinite(z0):
        motivos.append("sin_basal")
    r["z0_ohm"] = z0
    # primer minuto: para medir el asentamiento y la caída "desde el inicio"
    z_ini = mediana_ventana(t, z, ok, t[0], t[0] + C.BASAL_VENTANA_S, fs, cobertura=0.2)
    r["z_inicio_ohm"] = z_ini
    r["asentamiento_pct"] = 100 * (z_ini - z0) / z_ini if np.isfinite(z_ini) else np.nan

    # 3 · eventos
    ev_s = ev_s.sort_values("elapsed_time", kind="mergesort")
    te = ev_s["elapsed_time"].to_numpy(float)
    kinds = ev_s["kind"].astype(str).to_numpy()
    ml = pd.to_numeric(ev_s["amount_ml"], errors="coerce").to_numpy(float)

    # 4 · punto final = ganas incómodas. Es el fin de la sesión; si se apretó M
    #     (micción) antes del final, esa marca es el momento de las ganas.
    es_void = (kinds == "void") & (te > tb + C.BASAL_VENTANA_S) & (te <= t_end)
    t_fin = float(te[es_void][0]) if es_void.any() else t_end
    r["fin_por"] = "marca_M" if es_void.any() else "fin_registro"
    a, b = C.PRE_FIN_VENTANA_S
    zf = mediana_ventana(t, z, ok, t_fin + a, t_fin + b, fs)
    if not np.isfinite(zf):
        zf = mediana_ventana(t, z, ok, t_fin - 180, t_fin + 1e-6, fs, cobertura=0.2)
        motivos.append("fin_con_artefactos")
    r["t_fin_s"] = t_fin
    r["duracion_llenado_min"] = (t_fin - tb) / 60
    r["zf_ohm"] = zf
    r["delta_z_ohm"] = zf - z0
    r["caida_pct"] = 100 * (z0 - zf) / z0 if z0 else np.nan
    r["caida_db"] = 20 * math.log10(z0 / zf) if (z0 and zf and z0 > 0 and zf > 0) else np.nan
    r["caida_pct_desde_inicio"] = 100 * (z_ini - zf) / z_ini if np.isfinite(z_ini) else np.nan
    if r["duracion_llenado_min"] < C.LLENADO_MINIMO_MIN:
        motivos.append("llenado_corto")

    # sensaciones intermedias, si se registraron (teclas propuestas)
    for kind in C.SENSACIONES:
        m_k = (kinds == kind) & (te > tb + C.BASAL_VENTANA_S) & (te <= t_fin)
        r[f"t_{kind}_min"] = r[f"caida_pct_{kind}"] = np.nan
        if m_k.any():
            tk = float(te[m_k][0])
            zk = mediana_ventana(t, z, ok, tk + a, tk + b, fs, cobertura=0.3)
            r[f"t_{kind}_min"] = (tk - tb) / 60
            r[f"caida_pct_{kind}"] = 100 * (z0 - zk) / z0 if np.isfinite(zk) else np.nan

    # 5 · pendiente robusta del llenado (sobre medianas de 30 s, sin artefactos)
    bordes = np.arange(tb, t_fin, C.BIN_PENDIENTE_S)
    xc, yz = [], []
    for a_ in bordes:
        mz = mediana_ventana(t, z, ok, a_, a_ + C.BIN_PENDIENTE_S, fs, cobertura=0.3)
        if np.isfinite(mz):
            xc.append((a_ + C.BIN_PENDIENTE_S / 2) / 3600)
            yz.append(mz)
    xc, yz = np.array(xc), np.array(yz)
    r["pendiente_ohm_h"] = theil_sen(xc, yz)
    r["pendiente_pct_h"] = theil_sen(xc, 100 * (yz / z0 - 1)) if z0 else np.nan

    # 6 · agua
    es_agua = kinds == "water"
    hasta_fin = te <= t_fin
    r["n_tomas"] = int((es_agua & hasta_fin).sum())
    r["agua_eventos_ml"] = float(np.nansum(ml[es_agua & hasta_fin])) if (es_agua & hasta_fin).any() else 0.0
    if not es_agua.any():                 # sin ninguna A: no se sabe si tomó, no es "0 ml"
        r["agua_eventos_ml"] = np.nan
        motivos.append("sin_tomas_registradas")
    r["t_primera_toma_min"] = (float(te[es_agua][0]) - tb) / 60 if es_agua.any() else np.nan
    dur_h = (t_fin - tb) / 3600
    r["agua_ml_h"] = r["agua_eventos_ml"] / dur_h if dur_h > 0 else np.nan
    r["n_marcas"] = int((kinds == "mark").sum())

    # 8 · escala, placa y recorte
    cp, cm = row.get("cal_placa"), row.get("cal_mostrada")
    k_m = vd_m = np.nan
    if not vacio(cp) and int(cp) in cal.index:
        r["k_cal_placa"] = float(cal.loc[int(cp), "k_cal"])
        r["v_det_placa"] = float(cal.loc[int(cp), "v_detector"])
    if not vacio(cm) and int(cm) in cal.index:
        k_m, vd_m = float(cal.loc[int(cm), "k_cal"]), float(cal.loc[int(cm), "v_detector"])
    vv = med["voltage_v"].to_numpy(float) if "voltage_v" in med else np.array([])
    # Solo cuenta fuera de los artefactos: un movimiento que toca el techo no
    # invalida la sesión; una tendencia pegada al techo, sí.
    if np.isfinite(vv).sum() > 0.5 * len(t):
        m_ = np.isfinite(vv) & ok
        frac_rec = float(np.mean(vv[m_] >= C.VADC_TECHO_V - 0.02)) if m_.any() else np.nan
        r["recorte_fuente"] = "voltage_v"
    elif np.isfinite(k_m):
        zmax, zmin = 2 * (C.VADC_TECHO_V + vd_m) / k_m, 2 * vd_m / k_m
        frac_rec = float(np.mean((z[ok] >= 0.98 * zmax) | (z[ok] <= 1.02 * zmin))) if ok.any() else np.nan
        r["recorte_fuente"] = "rango_calibracion"
    else:
        frac_rec = np.nan
        r["recorte_fuente"] = ""
    r["fraccion_recorte"] = frac_rec

    # 9 · respuesta a cada toma (cada ventana se corta en la toma siguiente y en el fin)
    tomas, curvas = [], []
    grilla = np.arange(C.TOMA_CURVA_S[0], C.TOMA_CURVA_S[1] + 1, 10)
    t_agua = te[es_agua]
    for n, (ta, mla) in enumerate(zip(t_agua, ml[es_agua]), 1):
        if ta < tb or ta >= t_fin:
            continue
        sig_toma = t_agua[t_agua > ta]
        t_corte = min(t_fin, float(sig_toma[0]) if len(sig_toma) else np.inf)
        ref = mediana_ventana(t, z, ok, ta + C.TOMA_REF_S[0], ta + C.TOMA_REF_S[1], fs)

        def d(win):
            a_, b_ = ta + win[0], ta + win[1]
            if b_ > t_corte or not np.isfinite(ref):
                return np.nan
            return 100 * (mediana_ventana(t, z, ok, a_, b_, fs) - ref) / z0
        d5, d12 = d(C.TOMA_5MIN_S), d(C.TOMA_12MIN_S)
        esp5 = r["pendiente_pct_h"] * (np.mean(C.TOMA_5MIN_S) / 3600)
        tomas.append({"session_id": row["session_id"], "toma_n": n, "t_toma_min": (ta - tb) / 60,
                      "ml": mla, "min_hasta_siguiente": (t_corte - ta) / 60,
                      "d5_pct": d5, "d12_pct": d12,
                      "d5_esperado_tendencia_pct": esp5, "d5_exceso_pct": d5 - esp5})
        if np.isfinite(ref):
            tt = ta + grilla
            vals = 100 * (np.interp(tt, t, tend) - ref) / z0
            vals[(tt < t[0]) | (tt > t_corte)] = np.nan
            curvas += [{"session_id": row["session_id"], "toma_n": n, "t_rel_s": int(g), "dz_pct": float(v_)}
                       for g, v_ in zip(grilla, vals)]

    serie = pd.DataFrame({"t_s": t, "z_ohm": z, "tendencia_ohm": tend, "artefacto": art.astype(int)})
    r["motivos"] = motivos
    r["frac_recorte_tmp"] = frac_rec
    return r, serie, tomas, curvas


# ═══ etiquetas de sesión ════════════════════════════════════════════════

def etiquetar(row, r):
    m = list(r.pop("motivos", []))
    if vacio(row.get("paciente")):
        m.append("sin_paciente")
    if isinstance(row.get("notas"), str) and re.search(C.REGEX_PRUEBA, row["notas"], re.I):
        m.append("posible_prueba")
    if bool(row.get("adc_lineal_asumido")) is True:
        m.append("adc_lineal")
    if r.get("reescalada"):
        m.append("reescalada_en_analisis")
    if row.get("cal_confirmada") is not True:
        m.append("cal_no_confirmada")
    if r.get("duracion_min", 0) < C.DURACION_MINIMA_MIN and "sin_mediciones" not in m:
        m.append("muy_corta")
    if r.get("n_muestras_bajadas", 0) < C.MUESTRAS_MINIMAS and "sin_mediciones" not in m:
        m.append("pocas_muestras")
    fr = r.pop("frac_recorte_tmp", np.nan)
    if np.isfinite(fr) and fr > C.FRACCION_RECORTE_MAX:
        m.append("posible_recorte")
    dur_s = 60 * r.get("duracion_min", 0)
    perdidos = float(row.get("segundos_perdidos") or 0)
    r["integridad"] = 1 - perdidos / dur_s if dur_s > 0 else np.nan
    if np.isfinite(r["integridad"]) and r["integridad"] < C.INTEGRIDAD_MINIMA:
        m.append("integridad_baja")
    if r.get("fraccion_artefacto", 0) > C.FRACCION_ARTEFACTO_MAX:
        m.append("artefactos_altos")

    r["auto_fin_sesion"] = "ganas"
    r["auto_protocolo"] = C.PROTOCOLO_POR_DEFECTO
    r["auto_motivos"] = ";".join(dict.fromkeys(m))
    r["auto_apta"] = "no" if set(m) & C.MOTIVOS_EXCLUYENTES else "si"
    return r


def covariables(row):
    c, legacy_usado = {}, []
    for nombre, (jkeys, legcol) in C.COVARIABLES.items():
        v = None
        for jkey in (jkeys if isinstance(jkeys, tuple) else (jkeys,)):
            v = row.get(jkey)
            if not vacio(v):
                break
        if vacio(v):
            v = row.get(f"leg_{legcol}")
            if not vacio(v):
                legacy_usado.append(nombre)
        c[nombre] = None if vacio(v) else v
    for k in ("altura_m", "peso_kg", "circ_iliaca_cm", "temp_amb_c", "humedad_pct", "agua_declarada_ml"):
        c[k] = pd.to_numeric(c[k], errors="coerce")
    if np.isfinite(c["altura_m"]) and c["altura_m"] > 3:      # cargada en cm
        c["altura_m"] /= 100
    by = pd.to_numeric(row.get("pac_birth_year"), errors="coerce")
    f = row.get("fecha")
    if np.isfinite(by) and pd.notna(f):
        c["edad"] = f.year - by
    else:
        c["edad"] = pd.to_numeric(row.get("leg_patient_age"), errors="coerce")
        if np.isfinite(c["edad"]):
            legacy_usado.append("edad")
    c["imc"] = c["peso_kg"] / c["altura_m"] ** 2 if np.isfinite(c["peso_kg"]) and np.isfinite(c["altura_m"]) and c["altura_m"] > 0 else np.nan
    c["covariables_de_legacy"] = ";".join(legacy_usado)
    return c


# ═══ resumen ════════════════════════════════════════════════════════════

T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179,
        2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064,
        2.060, 2.056, 2.052, 2.048, 2.045, 2.042]


def r_critico(n):
    if n < 3:
        return np.nan
    t = T975[n - 3] if n - 2 <= len(T975) else 2.0
    return t / math.sqrt(n - 2 + t * t)


def icc1(df, col):
    """ICC(1) por ANOVA de un factor (sujeto), con grupos desbalanceados.
    Devuelve (icc, DE dentro agrupada, DE entre medias de sujeto)."""
    g = [x[col].dropna().to_numpy(float) for _, x in df.groupby("paciente")]
    g = [x for x in g if len(x)]
    k, N = len(g), sum(len(x) for x in g)
    if k < 2 or N - k < 1:
        return np.nan, np.nan, np.nan
    gm = np.concatenate(g).mean()
    msb = sum(len(x) * (x.mean() - gm) ** 2 for x in g) / (k - 1)
    msw = sum(((x - x.mean()) ** 2).sum() for x in g) / (N - k)
    n0 = (N - sum(len(x) ** 2 for x in g) / N) / (k - 1)
    icc = (msb - msw) / (msb + (n0 - 1) * msw) if (msb + (n0 - 1) * msw) > 0 else np.nan
    return icc, math.sqrt(msw), float(np.std([x.mean() for x in g], ddof=1))


def coma(x, d=2):
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return "—"
    return f"{x:.{d}f}".replace(".", ",")


def resumen(df, tomas):
    L = []
    ex = json.loads((C.DATOS / "extraccion.json").read_text(encoding="utf-8")) \
        if (C.DATOS / "extraccion.json").exists() else {}
    ap = df[df["apta"] == "si"]
    L += ["# Chidori · EDA etapa III · inventario", "",
          f"Extracción: {ex.get('fecha', '—')} · {len(df)} sesiones · "
          f"{df['paciente'].nunique()} sujetos · {int(df['n_muestras_bajadas'].fillna(0).sum())} muestras", "",
          f"**Aptas para el EDA: {len(ap)} sesiones de {ap['paciente'].nunique()} sujetos** "
          f"(abdomen; los controles en otro sitio van aparte).", ""]

    L += ["## Motivos (una sesión puede tener varios)", "", "| motivo | excluye | sesiones |", "|---|---|---|"]
    cnt = {}
    for ms in df["motivos"].fillna(""):
        for m in [x for x in ms.split(";") if x]:
            cnt[m] = cnt.get(m, 0) + 1
    for m, n in sorted(cnt.items(), key=lambda kv: -kv[1]):
        excluye = m in C.MOTIVOS_EXCLUYENTES or m.startswith(("app:no_apta", "manual:")) or m == "fin_no_es_ganas"
        L.append(f"| {m} | {'sí' if excluye else 'aviso'} | {n} |")
    L += [""]

    dup = df[df["duplicada_de"].notna()] if "duplicada_de" in df else df.iloc[0:0]
    if len(dup):
        L += ["## Duplicados (copias de la misma medición; queda una)", "",
              "| copia | se queda | muestras |", "|---|---|---|"]
        for _, x in dup.sort_values(["duplicada_de"]).iterrows():
            et = f"{x['paciente']} s{x['nro_sesion']}" if isinstance(x["paciente"], str) else f"sin paciente {x['session_id'][:8]}"
            L.append(f"| {et} | {x['duplicada_de']} | {int(x['n_muestras_bajadas'])} |")
        L += ["", "Origen probable: `commitSession` sube sesión, mediciones y eventos en pasos separados y la "
              "cola reintenta todo si algo falla. Borrarlas de la base es opcional (irreversible): el análisis ya las saca.", ""]
    rees = df[df["reescalada"].fillna("").astype(str).str.len() > 0] if "reescalada" in df else df.iloc[0:0]
    if len(rees):
        L += [f"**{len(rees)} sesiones estaban en la escala del firmware \"1,1k\" (cal 4), no en la de la placa (cal 5)**: "
              "se reescalaron acá con la fórmula de `calibracion.sql`. Para dejarlo en la base, re-correr ese script. "
              "Que sigan apareciendo sesiones con cal 4 después del 09/10 indica que alguna placa no se re-flasheó con `R9_OHM 1200`.", ""]

    L += ["## Por sujeto", "", "| sujeto | sesiones | aptas |", "|---|---|---|"]
    for p, g in df.groupby("paciente", dropna=False):
        L.append(f"| {p if isinstance(p, str) else '— sin paciente'} | {len(g)} | {int((g['apta'] == 'si').sum())} |")
    L += [""]

    L += ["## Sesiones aptas", "",
          f"Caída = (Z0 − Zf) / Z0. Z0 = mediana del minuto que empieza a los {C.BASAL_INICIO_S // 60} min "
          "(después del asentamiento); Zf = mediana entre "
          f"{-C.PRE_FIN_VENTANA_S[0]} y {-C.PRE_FIN_VENTANA_S[1]} s antes del fin o de la M (las ganas). "
          "«asent.» = lo que cayó Z antes de la basal; «desde inicio» = la caída si la basal fuera el primer minuto.", "",
          "| sujeto | s | fecha | editada | fin por | basal→ganas (min) | agua (ml) | Z0 (Ω) | asent. % | caída % | desde inicio % | dB | %/h | artef. |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for _, x in ap.sort_values(["paciente", "nro_sesion"]).iterrows():
        L.append(f"| {x['paciente']} | {x['nro_sesion']} | {x['fecha']:%d/%m} | {x['editada'] if isinstance(x.get('editada'), str) else 'no'} | "
                 f"{x['fin_por']} | {coma(x['duracion_llenado_min'], 0)} | {coma(x['agua_eventos_ml'], 0)} | "
                 f"{coma(x['z0_ohm'], 1)} | {coma(x['asentamiento_pct'], 1)} | {coma(x['caida_pct'], 1)} | {coma(x['caida_pct_desde_inicio'], 1)} | "
                 f"{coma(x['caida_db'], 2)} | {coma(x['pendiente_pct_h'], 2)} | {coma(100 * x['fraccion_artefacto'], 0)} % |")
    L += [""]

    L += ["## Asentamiento de los primeros minutos", ""]
    a_ = ap[["asentamiento_pct", "caida_pct", "caida_pct_desde_inicio"]].dropna()
    if len(a_):
        frac = (a_["asentamiento_pct"] / a_["caida_pct_desde_inicio"]).where(a_["caida_pct_desde_inicio"] > 0)
        L += [f"- mediana del asentamiento (0 a {C.BASAL_INICIO_S // 60} min): {coma(a_['asentamiento_pct'].median(), 2)} % · "
              f"sesiones con más de 1 %: {int((a_['asentamiento_pct'] > 1).sum())} de {len(a_)}",
              f"- sesiones donde cayó más en los primeros {C.BASAL_INICIO_S // 60} min que en todo el resto: "
              f"{int((a_['asentamiento_pct'] > a_['caida_pct']).sum())} de {len(a_)}",
              f"- fracción de la caída «desde el inicio» que es asentamiento (mediana): {coma(100 * frac.median(), 0)} %",
              "", "Con la basal en el primer minuto, el asentamiento se cuenta como llenado. Para que no pase: "
              "esperar la estabilización antes de tocar Iniciar (o dejar que el análisis tome la basal más tarde, como acá).", ""]

    if "config_r9" in ap:
        g = ap.dropna(subset=["z0_ohm"]).groupby(["paciente", "config_r9"])["z0_ohm"].median().unstack()
        if {"R9_2k2", "R9_1k2"} <= set(g.columns):
            g = g.dropna()
            if len(g):
                L += [f"## Z basal antes y después del {C.FECHA_CAMBIO_R9[8:]}/{C.FECHA_CAMBIO_R9[5:7]} (cambio de R9 en la placa 1)", "",
                      "| sujeto | Z0 con R9 2,2k (Ω) | Z0 con R9 1,2k (Ω) | cociente |", "|---|---|---|---|"]
                for p_, x in g.iterrows():
                    L.append(f"| {p_} | {coma(x['R9_2k2'], 1)} | {coma(x['R9_1k2'], 1)} | {coma(x['R9_1k2'] / x['R9_2k2'], 2)} |")
                L += ["", "La rev 6 usa la misma K antes y después del cambio de R9. Si la ganancia se hubiera "
                      "tenido en cuenta, el cociente debería dar ~1. La caída % no se ve afectada (es un cociente "
                      "de amplitudes); el valor absoluto de Z, sí.", ""]

    L += ["## ¿Cae siempre? (prueba de signos)", ""]
    c = ap["caida_pct"].dropna()
    c = c[c != 0]
    k = int((c > 0).sum())
    L.append(f"- por sesión: cae en {k} de {len(c)} · p = {coma(prueba_signos(k, len(c)), 4)} "
             "(optimista: las sesiones de un mismo sujeto no son independientes)")
    med_suj = ap.groupby("paciente")["caida_pct"].median().dropna()
    med_suj = med_suj[med_suj != 0]
    k = int((med_suj > 0).sum())
    L += [f"- por sujeto (mediana de sus sesiones): cae en {k} de {len(med_suj)} · "
          f"p = {coma(prueba_signos(k, len(med_suj)), 4)} ← esta es la que se puede citar", ""]

    L += ["## ¿Umbral universal o personal?", "",
          "| sujeto | n | caída % media | DE | CV | caída dB mediana | hasta ganas (min) | %/h mediana |",
          "|---|---|---|---|---|---|---|---|"]
    for p, g in ap.groupby("paciente"):
        c = g["caida_pct"].dropna()
        cv = c.std(ddof=1) / abs(c.mean()) if len(c) > 1 and c.mean() else np.nan
        L.append(f"| {p} | {len(c)} | {coma(c.mean(), 1)} | {coma(c.std(ddof=1) if len(c) > 1 else np.nan, 1)} | "
                 f"{coma(cv, 2)} | {coma(g['caida_db'].median(), 2)} | {coma(g['duracion_llenado_min'].median(), 0)} | "
                 f"{coma(g['pendiente_pct_h'].median(), 2)} |")
    icc, sw, sb = icc1(ap, "caida_pct")
    L += ["", f"- DE dentro del sujeto (agrupada): {coma(sw, 2)} pp · DE entre sujetos (de las medias): {coma(sb, 2)} pp",
          f"- ICC(1) de la caída %: {coma(icc, 2)} (cerca de 1 = cada persona tiene su caída típica → "
          "umbral personal; cerca de 0 = la caída varía igual dentro que entre personas)",
          f"- Hipótesis de la app (ganas a {coma(C.HIPOTESIS_GANAS_DB, 1)} dB): mediana de los sujetos "
          f"{coma(ap.groupby('paciente')['caida_db'].median().median(), 2)} dB · "
          f"sesiones por encima de {coma(C.HIPOTESIS_GANAS_DB, 1)} dB: {int((ap['caida_db'] >= C.HIPOTESIS_GANAS_DB).sum())} de {int(ap['caida_db'].notna().sum())}", ""]

    L += ["## Respuesta a cada toma de agua", ""]
    tm = tomas[tomas["session_id"].isin(ap["session_id"])] if len(tomas) else tomas
    if len(tm) and tm["d5_pct"].notna().any():
        L += [f"- tomas analizables: {int(tm['d5_pct'].notna().sum())}",
              f"- ΔZ a 5 min de la toma (mediana): {coma(tm['d5_pct'].median(), 2)} % del basal",
              f"- lo que explicaría la tendencia de fondo: {coma(tm['d5_esperado_tendencia_pct'].median(), 2)} %",
              f"- exceso (mediana): {coma(tm['d5_exceso_pct'].median(), 2)} % · "
              f"tomas con caída mayor que la tendencia: {int((tm['d5_exceso_pct'] < 0).sum())} de {int(tm['d5_exceso_pct'].notna().sum())}",
              "", "Si el exceso es claramente negativo, parte de la caída aparece minutos después de "
              "tomar, antes de que haya diuresis: no es vejiga (intestino o redistribución).", ""]
    else:
        L += ["Sin tomas analizables en las sesiones aptas.", ""]

    L += ["## Antes de mirar correlaciones", "",
          f"- Variables del sujeto (sexo, edad, altura, IMC): n efectivo = {ap['paciente'].nunique()} sujetos. "
          f"Umbral aproximado de |ρ| para p < 0,05: {coma(r_critico(ap['paciente'].nunique()), 2)}.",
          f"- Variables de sesión: n = {len(ap)} sesiones, pero agrupadas por sujeto. "
          f"Umbral aproximado: {coma(r_critico(len(ap)), 2)} (optimista).",
          "- Con 10 covariables probadas, la chance de al menos un falso positivo es ~40 %.",
          "- La caída % no depende de K_CAL pero sí de V_det: caída = ΔVadc / (Vadc0 + V_det).", ""]
    (C.SALIDAS / "resumen.md").write_text("\n".join(L), encoding="utf-8")


# ═══ duplicados ═════════════════════════════════════════════════════════

def marcar_duplicados(filas):
    """Agrupa por las primeras marcas de tiempo, confirma con la correlación de Z
    y deja una sola copia por grupo: con paciente, más muestras, más eventos,
    más campos cargados y, a igualdad, la más vieja. Las demás: `duplicada`."""
    grupos = {}
    for r in filas:
        if r.get("_huella"):
            grupos.setdefault(r["_huella"], []).append(r)
    for g in grupos.values():
        if len(g) < 2:
            continue
        g.sort(key=lambda r: (not r["_tiene_paciente"], -r.get("n_muestras_bajadas", 0),
                              -r["_n_eventos"], -r["_n_campos"], r["_fecha"]))
        queda = g[0]
        for r in g[1:]:
            a, b = queda["_zhead"], r["_zhead"]
            n = min(len(a), len(b))
            igual = n > 10 and (np.allclose(a[:n], b[:n]) or np.corrcoef(a[:n], b[:n])[0, 1] >= C.DUP_CORR_MIN)
            if not igual:
                continue
            r["duplicada_de"] = queda["_etiqueta"]
            r["motivos"] = ";".join([m for m in r["motivos"].split(";") if m] + ["duplicada"])
            r["auto_motivos"] = ";".join([m for m in r["auto_motivos"].split(";") if m] + ["duplicada"])
            r["auto_apta"] = "no"
            r["apta"] = "no"                       # una copia no entra nunca, ni a mano


# ═══ main ═══════════════════════════════════════════════════════════════

def main():
    ses, ev, cal = cargar()
    ediciones, revision = cargar_app()
    C.SALIDAS.mkdir(exist_ok=True)
    (C.SALIDAS / "series").mkdir(exist_ok=True)
    man = sincronizar_manuales(ses).set_index("session_id")

    filas, todas_tomas, todas_curvas, eventos_usados = [], [], [], []
    for _, row in ses.iterrows():
        sid = row["session_id"]
        mrow = man.loc[sid] if sid in man.index else pd.Series({c: "" for c in MANUALES})
        med_orig = cargar_mediciones(sid)
        ev_s = ev[ev["session_id"] == sid]

        # Sesión editada en la app: se analiza la editada (con sus eventos)
        ed = ediciones.get(sid)
        editada = ""
        med_base = med_orig
        if ed is not None:
            med_ed = cargar_mediciones_editadas(sid, ed["version"])
            if med_ed is not None and len(med_ed) > 1:
                med_base, ev_s, editada = med_ed, eventos_editados(sid, ed), "si"
                row = row.copy()
                gaps = ev_s[(ev_s["kind"] == "gap") & (ev_s["elapsed_time"] >= 0)]
                row["segundos_perdidos"] = float(pd.to_numeric(gaps["impedance_change"], errors="coerce").fillna(0).sum())
            else:
                editada = "falta_serie"      # extraer.py no la bajó: se usa la original
        eventos_usados.append(ev_s)

        med, reesc = reescalar(med_base, row, cal)
        if reesc:
            row = row.copy()
            row["cal_mostrada"] = row["cal_placa"]
        r, serie, tomas, curvas = procesar(row, med, ev_s, mrow, cal)
        r["reescalada"] = reesc
        r["editada"] = editada
        if ed is not None:
            r["edicion_version"] = ed["version"]
            r["n_interpoladas"] = ed.get("n_interpoladas")
            r["basal_app_ohm"] = ed.get("initial_impedance")
            r["final_app_ohm"] = ed.get("final_impedance")
            # Los duplicados se buscan SIEMPRE con la original: una copia sin
            # editar de una sesión editada sigue siendo la misma medición.
            mo, _ = reescalar(med_orig, row, cal)
            if mo is not None and len(mo) > 1:
                to = mo["elapsed_time"].to_numpy(float)
                r["_huella"] = hashlib.md5(np.round(to[:C.DUP_MUESTRAS], 3).tobytes()).hexdigest()
                r["_zhead"] = mo["impedance"].to_numpy(float)[:C.DUP_MUESTRAS].copy()
        r["_n_eventos"] = int((ev["session_id"] == sid).sum())
        r["_n_campos"] = sum(not vacio(row.get(c)) for c in ses.columns if c.startswith("ses_"))
        r["_etiqueta"] = (f"{row['paciente']} s{row['nro_sesion']}" if not vacio(row.get("paciente"))
                          else f"sin paciente {str(sid)[:8]}")
        r["_tiene_paciente"] = not vacio(row.get("paciente"))
        r["_fecha"] = str(row.get("fecha"))
        r = etiquetar(row, r)
        r.update(covariables(row))

        # manual > automático
        r["protocolo"] = mrow.get("protocolo") or r["auto_protocolo"]
        sitio_db = row.get("ses_electrode_site")
        sitio_db = C.SITIOS.get(str(sitio_db).strip().lower(), "otro") if not vacio(sitio_db) else ""
        r["sitio"] = (mrow.get("sitio") or sitio_db or "abdomen").strip().lower()
        r["fin_sesion"] = mrow.get("fin_sesion") or r["auto_fin_sesion"]
        manual_apta = (mrow.get("apta") or "").strip().lower()
        motivos = [m for m in r["auto_motivos"].split(";") if m]
        apta = r["auto_apta"]
        if r["fin_sesion"] != "ganas":           # el objetivo supone que terminó en las ganas
            motivos.append("fin_no_es_ganas")
            apta = "no"
        rev = revision.get(sid)
        r["apta_app"] = "" if rev is None else ("si" if rev["apta"] else "no")
        r["nota_app"] = "" if rev is None else (rev.get("nota") or "")
        if rev is not None:
            # Marcada en la app: manda sobre el CSV. "Apta" no salva una
            # exclusión automática; "no apta" saca la sesión siempre.
            r["apta"] = apta if rev["apta"] else "no"
            if not rev["apta"]:
                motivos.append("app:no_apta")
        else:
            r["apta"] = manual_apta if manual_apta in ("si", "no") else apta
        if r["sitio"] != "abdomen":
            r["apta"] = "no"
        if mrow.get("motivo_manual"):
            motivos.append(f"manual:{mrow['motivo_manual']}")
        if r["sitio"] != "abdomen":
            motivos.append(f"control_{r['sitio']}")
        r["motivos"] = ";".join(motivos)
        r["etiqueta_manual"] = "si" if any(mrow.get(c) for c in MANUALES) else "no"

        if serie is not None:
            serie.to_csv(C.SALIDAS / "series" / f"{sid}.csv.gz", index=False)
        filas.append(r)
        todas_tomas += tomas
        todas_curvas += curvas

    ev_us = pd.concat(eventos_usados, ignore_index=True) if eventos_usados else pd.DataFrame()
    ev_us.to_csv(C.SALIDAS / "eventos_analizados.csv", index=False)   # graficos.py los dibuja

    marcar_duplicados(filas)
    for r in filas:
        for k in [k for k in r if k.startswith("_")]:
            r.pop(k)
    feat = pd.DataFrame(filas)
    base_cols = ["session_id", "paciente", "nro_sesion", "fecha", "placa", "cal_placa", "cal_mostrada",
                 "cal_confirmada", "adc_lineal_asumido", "notas", "microcortes", "segundos_perdidos",
                 "desconexiones", "z_inicial", "z_final"]
    extra = [c for c in ses.columns if c.startswith(("pac_", "ses_"))]
    df = ses[[c for c in base_cols if c in ses.columns] + extra].merge(feat, on="session_id", how="left")
    # Placa física: la cargada en la sesión (`board_id`) o la que vale para todas.
    placa_db = df["ses_board_id"] if "ses_board_id" in df else pd.Series(np.nan, index=df.index)
    df["placa_fisica"] = placa_db.where(placa_db.notna() & (placa_db.astype(str).str.strip() != ""),
                                        C.PLACA_FISICA_POR_DEFECTO)
    corte_r9 = pd.Timestamp(C.FECHA_CAMBIO_R9, tz="America/Argentina/Buenos_Aires")
    df["config_r9"] = np.where(df["fecha"] < corte_r9, "R9_2k2", "R9_1k2")
    df["z0_ohm_r9_1k2"] = df["z0_ohm"].where(df["config_r9"] == "R9_1k2")

    orden = (["session_id", "paciente", "nro_sesion", "fecha", "apta", "motivos", "editada", "apta_app",
              "nota_app", "protocolo", "sitio",
              "fin_sesion", "fin_por", "etiqueta_manual", "duplicada_de", "caida_pct", "caida_db",
              "caida_pct_desde_inicio", "asentamiento_pct", "z_inicio_ohm",
              "pendiente_pct_h", "pendiente_ohm_h", "z0_ohm", "zf_ohm", "delta_z_ohm",
              "duracion_llenado_min", "duracion_min", "t_fsf_min", "caida_pct_fsf", "t_fdv_min", "caida_pct_fdv",
              "n_tomas", "agua_eventos_ml", "agua_ml_h", "t_primera_toma_min", "n_marcas",
              "edad", "sexo", "altura_m", "peso_kg", "imc", "circ_iliaca_cm", "temp_amb_c", "humedad_pct",
              "agua_declarada_ml", "ingesta_24h_txt", "covariables_de_legacy",
              "placa", "placa_fisica", "config_r9", "z0_ohm_r9_1k2", "reescalada", "cal_placa", "cal_mostrada", "cal_confirmada", "k_cal_placa", "v_det_placa",
              "adc_lineal_asumido", "ruido_sigma_ohm", "umbral_artefacto_ohm", "fraccion_artefacto", "escalones",
              "fraccion_recorte", "recorte_fuente", "integridad", "microcortes", "segundos_perdidos",
              "desconexiones", "fs_hz", "n_muestras_bajadas", "t_basal_s", "t_fin_s", "cola_recortada_s",
              "z_inicial", "z_final", "basal_app_ohm", "final_app_ohm", "n_interpoladas",
              "edicion_version", "notas"] + AUTOS)
    orden = [c for c in dict.fromkeys(orden) if c in df.columns]
    df = df[orden + [c for c in df.columns if c not in orden]]
    df = df.sort_values(["paciente", "nro_sesion"], na_position="last")
    df.to_csv(C.SALIDAS / "sesiones_etiquetadas.csv", index=False, date_format="%Y-%m-%d %H:%M")

    tomas = pd.DataFrame(todas_tomas, columns=["session_id", "toma_n", "t_toma_min", "ml",
                                               "min_hasta_siguiente", "d5_pct", "d12_pct",
                                               "d5_esperado_tendencia_pct", "d5_exceso_pct"])
    tomas.to_csv(C.SALIDAS / "respuesta_tomas.csv", index=False)
    pd.DataFrame(todas_curvas, columns=["session_id", "toma_n", "t_rel_s", "dz_pct"]).to_csv(
        C.SALIDAS / "respuesta_tomas_curvas.csv", index=False)

    # etiquetas_manuales.csv: refresca las auto_*, conserva lo tuyo
    out = sincronizar_manuales(ses).merge(df[["session_id"] + AUTOS], on="session_id", how="left")
    out = out[["session_id", "paciente", "nro_sesion", "fecha"] + MANUALES + AUTOS]
    out.sort_values(["paciente", "nro_sesion"], na_position="last").to_csv(C.ETIQUETAS_MANUALES, index=False)

    resumen(df, tomas)
    ap = df[df["apta"] == "si"]
    print(f"{len(df)} sesiones · {len(ap)} aptas ({ap['paciente'].nunique()} sujetos). "
          f"Ver salidas/resumen.md y completar etiquetas_manuales.csv.")


if __name__ == "__main__":
    main()
