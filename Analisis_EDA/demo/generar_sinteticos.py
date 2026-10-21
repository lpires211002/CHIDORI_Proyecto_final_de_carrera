"""
Genera una caché FALSA con la misma forma que la que baja `extraer.py`, para
probar el pipeline sin tocar la base:

    python demo/generar_sinteticos.py
    CHIDORI_DEMO=1 python etiquetar.py
    CHIDORI_DEMO=1 python graficos.py

Todo queda en demo/ (datos, salidas y etiquetas): la caché real no se toca.

Los números no son mediciones: son un modelo de juguete (diuresis con retardo
después de cada toma, efecto rápido chico tras tomar, ruido, movimientos,
microcortes) con casos borde a propósito: notas de prueba, ADC lineal, escala
pendiente, sesión corta, recorte, datos en columnas legacy, sin paciente.
"""
import json
import sys
import uuid
from pathlib import Path

import numpy as np
import pandas as pd

import os  # noqa: E402
os.environ["CHIDORI_DEMO"] = "1"          # escribe en demo/datos, nunca en datos/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config as C  # noqa: E402

rng = np.random.default_rng(7)
FS = 700 / 192            # ~3,65 Hz como el firmware

CAL = pd.DataFrame([
    (1, "diseño (incorrecta)", 0.05760, 0.200, None, False),
    (2, "banco 2026-09-04", 0.28406, 0.277, None, False),
    (3, "banco 2026-09-15 (rev 3)", 0.16675, 0.169, None, True),
    (4, 'firmware "R9 1,1k" (rev 4)', 0.33350, 0.169, 5, False),
    (5, "R9 1,2k (rev 5, medida 2026-10-09)", 0.34200, 0.230, None, False),
], columns=["id", "label", "k_cal", "v_detector", "hw_id", "is_reference"])

SUJETOS = {   # código: (sexo, año, altura, peso, circ, Z0 típica, sensibilidad, capacidad ml)
    "P-001": ("Femenino", 2002, 1.62, 55, 78, 8.5, 0.020, 380),
    "P-002": ("Masculino", 2001, 1.80, 82, 92, 6.2, 0.012, 520),
    "P-003": ("Femenino", 1999, 1.68, 70, 88, 9.8, 0.016, 420),
    "P-004": ("Masculino", 2002, 1.76, 74, 85, 6.9, 0.015, 470),
    "P-005": ("Masculino", 1998, 1.72, 90, 101, 7.4, 0.009, 500),
    "P-006": ("Femenino", 2003, 1.58, 60, 82, 10.4, 0.018, 350),
}


def una_sesion(cod, nro, fecha, placa=3, casos=()):
    sexo, anio, alt, peso, circ, z0, sens, cap = SUJETOS[cod] if cod else SUJETOS["P-002"]
    sid = str(uuid.UUID(int=int(rng.integers(0, 2**63))))
    z0 = z0 * rng.normal(1, 0.04)
    sens = sens * rng.normal(1, 0.15)
    cap = cap * rng.normal(1, 0.12)
    t_max = 150 * 60
    t = np.arange(0, t_max, 1 / FS)
    t = np.sort(np.abs(t + rng.normal(0, 0.01, len(t))))

    # tomas libres: 3 a 6, entre 200 y 500 ml
    n_tomas = int(rng.integers(3, 7))
    t_tomas = np.sort(rng.uniform(2 * 60, 70 * 60, n_tomas))
    ml_tomas = rng.choice([200, 250, 300, 350, 500], n_tomas)
    # diuresis: basal 1 ml/min + cada toma con un núcleo gamma (pico ~40 min)
    tau = 40 * 60
    def nucleo(dt):
        dt = np.clip(dt, 0, None)
        return (dt / tau) ** 2 * np.exp(-2 * dt / tau)
    trap = getattr(np, "trapezoid", None) or np.trapz
    norm = trap(nucleo(np.arange(0, 6 * 3600, 10)), dx=10)
    tasa = 1 / 60 + sum(m * 0.8 * nucleo(t - ta) / norm for ta, m in zip(t_tomas, ml_tomas))
    vol = np.concatenate([[0], np.cumsum(tasa[1:] * np.diff(t))])
    # fin: cuando el volumen llega a la capacidad (ganas incómodas)
    idx_fin = int(np.searchsorted(vol, cap))
    if "corta" in casos:
        idx_fin = int(10 * 60 * FS)
    idx_fin = min(idx_fin, len(t) - 1)
    t, vol = t[: idx_fin + 1], vol[: idx_fin + 1]
    keep = t_tomas < t[-1] - 60
    t_tomas, ml_tomas = t_tomas[keep], ml_tomas[keep]

    rapido = sum(-0.004 * (m / 250) * np.exp(-np.clip(t - ta, 0, None) / 300) * (t >= ta)
                 for ta, m in zip(t_tomas, ml_tomas))
    asent = -0.01 * np.exp(-t / 600)            # asentamiento del gel
    z = z0 * (1 - sens * vol / 100 + rapido + asent) + rng.normal(0, 0.010, len(t))
    for _ in range(int(rng.integers(2, 6))):    # movimientos de 5 a 25 s
        a = rng.uniform(60, t[-1] - 30)
        m = (t >= a) & (t < a + rng.uniform(5, 25))
        z[m] += rng.choice([-1, 1]) * rng.uniform(0.3, 2.0)
    if "recorte" in casos:
        k, vd = CAL.set_index("id").loc[placa, ["k_cal", "v_detector"]]
        z = np.minimum(z * 2.2, 2 * (2.0 + vd) / k)
    # microcortes
    drop = np.zeros(len(t), bool)
    for _ in range(int(rng.integers(0, 4))):
        a = rng.uniform(60, t[-1] - 30)
        drop |= (t >= a) & (t < a + rng.uniform(2, 20))
    t, z = t[~drop], z[~drop]
    k, vd = CAL.set_index("id").loc[placa, ["k_cal", "v_detector"]]
    vadc = z * k / 2 - vd

    med = pd.DataFrame({"elapsed_time": np.round(t, 3), "impedance": np.round(z, 4),
                        "impedance_raw": np.round(z, 4),
                        "voltage_v": np.round(vadc, 4) if fecha >= "2026-09-01" else np.nan})

    ev = [{"session_id": sid, "elapsed_time": float(ta), "impedance": float(np.interp(ta, t, z)),
           "impedance_change": None, "kind": "water", "amount_ml": float(m)} for ta, m in zip(t_tomas, ml_tomas)]
    if rng.random() < 0.5:
        ev.append({"session_id": sid, "elapsed_time": float(t[-1] - 20), "impedance": float(z[-1]),
                   "impedance_change": None, "kind": "void", "amount_ml": None})
    if rng.random() < 0.4:
        ev.append({"session_id": sid, "elapsed_time": float(rng.uniform(300, t[-1])), "impedance": 0,
                   "impedance_change": None, "kind": "mark", "amount_ml": None})
    ev = sorted(ev, key=lambda e: e["elapsed_time"])
    for i, e in enumerate(ev, 1):
        e["event_number"] = i

    legacy = "legacy" in casos
    datos_ses = {} if legacy else {"weight_kg": peso + rng.normal(0, 0.8), "iliac_circ_cm": circ,
                                   "temperature_c": round(rng.uniform(18, 27), 1),
                                   "humidity_pct": round(rng.uniform(35, 75)),
                                   "water_ml": int(ml_tomas.sum()), "food_24h": "café a la mañana"}
    cal_mostrada = placa
    if "escala_pendiente" in casos:
        cal_mostrada = 4
    fila = {
        "session_id": sid, "paciente": cod, "nro_sesion": nro, "fecha": f"{fecha}T15:00:00+00:00",
        "datos_paciente": {"sex": sexo, "birth_year": anio, "height_m": alt} if cod else {},
        "datos_sesion": datos_ses,
        "z_inicial": float(np.median(z[:220])), "z_final": float(np.median(z[-220:])),
        "delta_z": None, "z_inicial_raw": None, "z_final_raw": None,
        "cal_firmware": 4 if "escala_pendiente" in casos else placa, "cal_placa": placa,
        "placa": CAL.set_index("id").loc[placa, "label"], "cal_mostrada": cal_mostrada,
        "cal_confirmada": fecha >= "2026-09-20", "k_cal_firmware": float(k),
        "adc_lineal_asumido": "adc_lineal" in casos,
        "duracion": None, "n_muestras": len(med), "t_ultima_muestra_s": float(t[-1]),
        "notas": "prueba de banco con resistencias" if "prueba" in casos else "",
        "marcas": sum(e["kind"] == "mark" for e in ev), "tomas_agua": len(t_tomas),
        "agua_ml": float(ml_tomas.sum()), "micciones": sum(e["kind"] == "void" for e in ev),
        "miccion_ml": 0, "microcortes": 0, "segundos_perdidos": float(drop.sum() / FS),
        "desconexiones": 0,
    }
    leg = {"id": sid, "created_at": fila["fecha"],
           "temperature_c": round(rng.uniform(18, 27), 1) if legacy else None,
           "humidity_pct": round(rng.uniform(35, 75)) if legacy else None,
           "food_24h": None, "water_total_ml": None,
           "patient_weight": peso if legacy else None, "patient_height": alt * 100 if legacy else None,
           "patient_iliac_circ": circ if legacy else None, "patient_gender": sexo if legacy else None,
           "patient_age": None, "v_detector_firmware": vd}
    return fila, leg, med, ev


def main():
    d = C.DATOS
    (d / "mediciones").mkdir(parents=True, exist_ok=True)
    plan = [
        ("P-001", 1, "2026-08-12", 3, ("legacy",)), ("P-001", 2, "2026-09-02", 3, ()),
        ("P-002", 1, "2026-08-14", 3, ("adc_lineal",)), ("P-002", 2, "2026-09-10", 3, ()),
        ("P-003", 1, "2026-09-11", 3, ()), ("P-003", 2, "2026-09-18", 3, ()),
        ("P-004", 1, "2026-08-18", 3, ("legacy",)), ("P-004", 2, "2026-08-20", 3, ()),
        ("P-004", 3, "2026-09-05", 3, ()), ("P-004", 4, "2026-09-16", 3, ()),
        ("P-004", 5, "2026-09-22", 3, ("prueba",)), ("P-004", 6, "2026-09-29", 5, ("escala_pendiente",)),
        ("P-004", 7, "2026-10-12", 5, ()), ("P-005", 1, "2026-09-20", 5, ("recorte",)),
        ("P-005", 2, "2026-10-03", 3, ()), ("P-006", 1, "2026-10-07", 5, ("corta",)),
        ("P-006", 2, "2026-10-14", 5, ()), (None, None, "2026-09-01", 3, ()),
    ]
    filas, legs, evs = [], [], []
    for cod, nro, fecha, placa, casos in plan:
        f, leg, med, ev = una_sesion(cod, nro, fecha, placa, casos)
        filas.append(f)
        legs.append(leg)
        evs += ev
        med.to_csv(d / "mediciones" / f"{f['session_id']}.csv.gz", index=False)
    (d / "sesiones.json").write_text(json.dumps(filas, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    pd.DataFrame(legs).to_csv(d / "legacy.csv", index=False)
    pd.DataFrame(evs).to_csv(d / "eventos.csv", index=False)
    CAL.to_csv(d / "calibraciones.csv", index=False)
    (d / "campos.json").write_text("[]", encoding="utf-8")
    (d / "extraccion.json").write_text(json.dumps({"fecha": "SINTÉTICO", "sesiones": len(filas)}), encoding="utf-8")
    print(f"Caché sintética: {len(filas)} sesiones en {d}")


if __name__ == "__main__":
    main()
