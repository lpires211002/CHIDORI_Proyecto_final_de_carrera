"""
Chidori · Etapa III · paso 1: bajar la base a una caché local.

    python extraer.py                 # pide usuario y clave
    python extraer.py --usuario sa    # usuario sin dominio → sa@chidori.local
    python extraer.py --refrescar     # vuelve a bajar también las mediciones
    python extraer.py --sin-vista     # arma el dataset desde las tablas, sin v_dataset_modelo

Usa la URL y la anon key de la app (Programacion_UI_Micro/UI_REACT/.env.local)
y tu login de Chidori: con una cuenta superadmin RLS deja ver todas las
sesiones; con una de clínico, solo las propias. La clave no se guarda.

Primero intenta `v_dataset_modelo`. Si la base la corta por tiempo (57014,
statement timeout: la vista cuenta las ~300 000 muestras con RLS), arma las
mismas columnas desde `sessions`, `patients` y `session_events`. El resultado
es el mismo; solo cambia de dónde sale.

Qué baja (a datos/):
    sesiones.json      una fila por sesión, con las columnas de v_dataset_modelo
    legacy.csv         columnas viejas de `sessions` que la vista no trae
                       (temperatura, humedad, peso… de las sesiones previas
                       al catálogo de campos). Nunca nombre ni apellido.
    eventos.csv        session_events
    calibraciones.csv  catálogo de calibraciones
    campos.json        field_definitions (para el diccionario de datos)
    mediciones/<session_id>.csv.gz   una por sesión
    extraccion.json    cuándo se bajó, de dónde y controles de conteo

Y lo que se hace desde el panel de la app (sql/edicion_sesiones.sql, app 1.10):
    ediciones.json     la edición de cada sesión editada: parámetros, eventos
                       corregidos, basal/final y versión
    mediciones_editadas/<session_id>__<version>.csv.gz   la serie editada
                       (la misma que ve la app). etiquetar.py usa esta en vez
                       de la original cuando existe.
    revision.csv       apta / no apta marcado en la app (manda sobre
                       etiquetas_manuales.csv)
    comentarios.csv    comentarios anclados a la curva (tiempo ORIGINAL)
Si la base todavía no tiene esas tablas, se sigue sin ellas.
"""
import argparse
import datetime as dt
import getpass
import json
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd
import requests

import config as C

PAGINA = 1000          # PostgREST corta en 1000 filas e ignora un limit mayor
TIMEOUT = 60


def leer_env(path):
    env = {}
    if not path.exists():
        sys.exit(f"No encuentro {path}. Pasá la ruta con --env.")
    for linea in path.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        k, v = linea.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class ErrorBase(RuntimeError):
    pass


class Supabase:
    def __init__(self, url, anon):
        self.url = url.rstrip("/")
        self.anon = anon
        self.token = None
        self.http = requests.Session()

    def login(self, email, clave):
        r = self.http.post(
            f"{self.url}/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": self.anon, "Content-Type": "application/json"},
            json={"email": email, "password": clave},
            timeout=TIMEOUT,
        )
        if r.status_code != 200:
            sys.exit(f"Login rechazado ({r.status_code}): {r.text[:200]}")
        self.token = r.json()["access_token"]

    def _h(self, extra=None):
        h = {"apikey": self.anon, "Authorization": f"Bearer {self.token}", "Accept": "application/json"}
        h.update(extra or {})
        return h

    def get(self, tabla, params, extra=None):
        r = self.http.get(f"{self.url}/rest/v1/{tabla}", params=params, headers=self._h(extra), timeout=TIMEOUT)
        if r.status_code >= 300:
            raise ErrorBase(f"{tabla}: {r.status_code} {r.text[:300]}")
        return r

    def todo(self, tabla, params):
        """GET paginado por offset. Solo para tablas chicas (sesiones, eventos)."""
        filas, offset = [], 0
        while True:
            lote = self.get(tabla, dict(params, offset=offset, limit=PAGINA)).json()
            filas.extend(lote)
            if len(lote) < PAGINA:
                return filas
            offset += PAGINA

    def contar(self, tabla, params):
        """count=exact de PostgREST. None si la base no lo devuelve."""
        try:
            r = self.get(tabla, dict(params, select="session_id", limit=1), extra={"Prefer": "count=exact"})
        except ErrorBase:
            return None
        total = r.headers.get("Content-Range", "").split("/")[-1]
        return int(total) if total.isdigit() else None

    def mediciones(self, sid):
        """Paginado por clave (elapsed_time, id), no por offset: cada página
        lee solo sus 1000 filas por el índice (session_id, elapsed_time) en vez
        de recorrer y descartar todas las anteriores."""
        filas, ultimo = [], None
        while True:
            p = {"select": "id,elapsed_time,impedance,impedance_raw,voltage_v",
                 "session_id": f"eq.{sid}", "order": "elapsed_time.asc,id.asc", "limit": PAGINA}
            if ultimo is not None:
                t, i = ultimo
                p["or"] = f"(elapsed_time.gt.{t!r},and(elapsed_time.eq.{t!r},id.gt.{i}))"
            lote = self.get("measurements", p).json()
            filas.extend(lote)
            if len(lote) < PAGINA:
                return filas
            ultimo = (float(lote[-1]["elapsed_time"]), lote[-1]["id"])

    def mediciones_editadas(self, sid, version):
        """Serie editada activa, paginada por idx."""
        filas, ultimo = [], -1
        while True:
            lote = self.get("measurements_edited", {
                "select": "idx,elapsed_time,impedance,impedance_raw,voltage_v,interpolated",
                "session_id": f"eq.{sid}", "version": f"eq.{version}", "idx": f"gt.{ultimo}",
                "order": "idx.asc", "limit": PAGINA}).json()
            filas.extend(lote)
            if len(lote) < PAGINA:
                return filas
            ultimo = lote[-1]["idx"]


def opcional(sb, tabla, params):
    """Tablas de la edición en la app. Si la base no las tiene todavía
    (falta correr sql/edicion_sesiones.sql), None: el EDA usa la original."""
    try:
        return sb.todo(tabla, params)
    except ErrorBase as e:
        txt = str(e)
        if any(x in txt for x in ("PGRST205", "42P01", "does not exist", "Could not find")):
            return None
        raise


def dataset_desde_tablas(sb, eventos, cal):
    """Las mismas columnas que v_dataset_modelo, armadas acá en vez de en la base.
    n_muestras y t_ultima_muestra_s se completan después de bajar las mediciones."""
    cols = ("id,created_at,patient_id,session_number,session_data,initial_impedance,final_impedance,"
            "initial_impedance_raw,final_impedance_raw,calibration_id,calibration_hw_id,"
            "calibration_shown,calibration_matched,k_cal_firmware,adc_lineal_asumido,"
            "elapsed_time_str,notes")
    ses = sb.todo("sessions", {"select": cols, "order": "created_at.asc,id.asc"})
    pac = {p["id"]: p for p in sb.todo("patients", {"select": "id,code,data", "order": "code.asc"})}
    etiqueta_cal = {c["id"]: c["label"] for c in cal}

    ag = defaultdict(lambda: defaultdict(float))
    for e in eventos:
        a, k, ml = ag[e["session_id"]], e.get("kind"), e.get("amount_ml")
        ml = float(ml) if ml is not None else 0.0
        if k == "mark":
            a["marcas"] += 1
        elif k == "water":
            a["tomas_agua"] += 1
            a["agua_ml"] += ml
        elif k == "void":
            a["micciones"] += 1
            a["miccion_ml"] += ml
        elif k == "gap":
            a["microcortes"] += 1
            a["segundos_perdidos"] += float(e.get("impedance_change") or 0)
        elif k == "disconnect":
            a["desconexiones"] += 1

    filas = []
    for s in ses:
        p = pac.get(s.get("patient_id")) or {}
        a = ag[s["id"]]
        zi, zf = s.get("initial_impedance"), s.get("final_impedance")
        filas.append({
            "session_id": s["id"], "paciente": p.get("code"), "nro_sesion": s.get("session_number"),
            "fecha": s.get("created_at"),
            "datos_paciente": p.get("data") or {}, "datos_sesion": s.get("session_data") or {},
            "z_inicial": zi, "z_final": zf,
            "delta_z": round(zf - zi, 4) if zi is not None and zf is not None else None,
            "z_inicial_raw": s.get("initial_impedance_raw"), "z_final_raw": s.get("final_impedance_raw"),
            "cal_firmware": s.get("calibration_id"), "cal_placa": s.get("calibration_hw_id"),
            "placa": etiqueta_cal.get(s.get("calibration_hw_id")),
            "cal_mostrada": s.get("calibration_shown"), "cal_confirmada": s.get("calibration_matched"),
            "k_cal_firmware": s.get("k_cal_firmware"), "adc_lineal_asumido": s.get("adc_lineal_asumido"),
            "duracion": s.get("elapsed_time_str"), "n_muestras": None, "t_ultima_muestra_s": None,
            "notas": s.get("notes"),
            **{k: (int(a[k]) if k not in ("agua_ml", "miccion_ml", "segundos_perdidos") else a[k])
               for k in ("marcas", "tomas_agua", "agua_ml", "micciones", "miccion_ml",
                         "microcortes", "segundos_perdidos", "desconexiones")},
        })
    return filas


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--usuario")
    ap.add_argument("--env", default=str(C.ENV_APP))
    ap.add_argument("--refrescar", action="store_true",
                    help="volver a bajar las mediciones aunque estén en caché")
    ap.add_argument("--sin-vista", action="store_true",
                    help="no usar v_dataset_modelo: armar el dataset desde las tablas")
    a = ap.parse_args()

    env = leer_env(Path(a.env))
    url, anon = env.get("VITE_SUPABASE_URL"), env.get("VITE_SUPABASE_ANON_KEY")
    if not url or not anon:
        sys.exit("Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en el .env")
    dominio = env.get("VITE_AUTH_LOCAL_DOMAIN") or "chidori.local"

    usuario = a.usuario or input("Usuario de Chidori: ").strip()
    email = usuario if "@" in usuario else f"{usuario}@{dominio}"
    sb = Supabase(url, anon)
    sb.login(email, getpass.getpass(f"Clave de {email}: "))
    print("Sesión iniciada.")

    C.DATOS.mkdir(parents=True, exist_ok=True)
    (C.DATOS / "mediciones").mkdir(exist_ok=True)

    # tablas chicas primero: las necesita también el armado sin vista
    eventos = sb.todo("session_events", {
        "select": "session_id,event_number,elapsed_time,impedance,impedance_change,kind,amount_ml",
        "order": "session_id.asc,event_number.asc,id.asc"})
    pd.DataFrame(eventos, columns=["session_id", "event_number", "elapsed_time", "impedance",
                                   "impedance_change", "kind", "amount_ml"]).to_csv(
        C.DATOS / "eventos.csv", index=False)
    print(f"  session_events: {len(eventos)}")
    cal = sb.todo("calibrations", {"select": "id,label,k_cal,v_detector,hw_id,is_reference", "order": "id.asc"})
    pd.DataFrame(cal).to_csv(C.DATOS / "calibraciones.csv", index=False)

    fuente = "v_dataset_modelo"
    sesiones = None
    if not a.sin_vista:
        try:
            sesiones = sb.todo("v_dataset_modelo", {"select": "*", "order": "fecha.asc,session_id.asc"})
        except ErrorBase as e:
            if "57014" not in str(e) and "timeout" not in str(e).lower():
                raise
            print("  v_dataset_modelo cortó por tiempo (57014): armo lo mismo desde las tablas.")
    if sesiones is None:
        sesiones = dataset_desde_tablas(sb, eventos, cal)
        fuente = "tablas"
    if not sesiones:
        sys.exit("No vino ninguna sesión: ¿la cuenta está aprobada y es superadmin?")
    print(f"  sesiones ({fuente}): {len(sesiones)}")

    legacy_cols = ("id,created_at,temperature_c,humidity_pct,food_24h,water_total_ml,"
                   "patient_weight,patient_height,patient_iliac_circ,patient_gender,"
                   "patient_age,v_detector_firmware")
    legacy = sb.todo("sessions", {"select": legacy_cols, "order": "created_at.asc,id.asc"})
    pd.DataFrame(legacy).to_csv(C.DATOS / "legacy.csv", index=False)

    campos = sb.todo("field_definitions", {"select": "*", "order": "scope.asc,sort_order.asc"})
    (C.DATOS / "campos.json").write_text(
        json.dumps(campos, ensure_ascii=False, indent=1, default=str), encoding="utf-8")

    # ── lo que se hizo en la app: ediciones, apta / no apta, comentarios ──
    ediciones = opcional(sb, "session_edits", {
        "select": ("session_id,version,params,eventos,stats,initial_impedance,final_impedance,"
                   "initial_impedance_raw,final_impedance_raw,elapsed_time_str,total_events,"
                   "n_muestras,n_interpoladas,t_cero,escala,algo_version,app_version,edited_at"),
        "order": "session_id.asc"})
    revision = opcional(sb, "session_review", {
        "select": "session_id,apta,nota,updated_at", "order": "session_id.asc"})
    comentarios = opcional(sb, "session_comments", {
        "select": "id,session_id,t_from,t_to,body,created_at", "order": "session_id.asc,t_from.asc"})
    hay_app = ediciones is not None
    (C.DATOS / "ediciones.json").write_text(
        json.dumps(ediciones or [], ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    pd.DataFrame(revision or [], columns=["session_id", "apta", "nota", "updated_at"]).to_csv(
        C.DATOS / "revision.csv", index=False)
    pd.DataFrame(comentarios or [], columns=["id", "session_id", "t_from", "t_to", "body", "created_at"]).to_csv(
        C.DATOS / "comentarios.csv", index=False)
    if hay_app:
        print(f"  app: {len(ediciones)} sesión(es) editada(s), {len(revision or [])} marcada(s) "
              f"apta/no apta, {len(comentarios or [])} comentario(s)")
    else:
        print("  app: la base no tiene las tablas de edición (sql/edicion_sesiones.sql): se usa la original")

    dir_ed = C.DATOS / "mediciones_editadas"
    dir_ed.mkdir(exist_ok=True)
    vigentes = {f"{e['session_id']}__{e['version']}.csv.gz" for e in (ediciones or [])}
    for viejo in dir_ed.glob("*.csv.gz"):       # versiones reemplazadas o vueltas al original
        if viejo.name not in vigentes:
            viejo.unlink()
    controles_ed = []
    for e in ediciones or []:
        destino = dir_ed / f"{e['session_id']}__{e['version']}.csv.gz"
        if destino.exists() and not a.refrescar:
            n = len(pd.read_csv(destino))
        else:
            med = pd.DataFrame(sb.mediciones_editadas(e["session_id"], e["version"]),
                               columns=["idx", "elapsed_time", "impedance", "impedance_raw",
                                        "voltage_v", "interpolated"])
            med.to_csv(destino, index=False)
            n = len(med)
        estado = "OK" if n == int(e["n_muestras"]) else f"DIFERENTE (la base dice {e['n_muestras']})"
        controles_ed.append({"session_id": e["session_id"], "version": e["version"], "muestras": n, "estado": estado})
        if estado != "OK":
            print(f"  editada {e['session_id'][:8]}: {n} muestras {estado}")

    controles = []
    for i, s in enumerate(sesiones, 1):
        sid = s["session_id"]
        destino = C.DATOS / "mediciones" / f"{sid}.csv.gz"
        if destino.exists() and not a.refrescar:
            med = pd.read_csv(destino)
        else:
            med = pd.DataFrame(sb.mediciones(sid), columns=["id", "elapsed_time", "impedance",
                                                            "impedance_raw", "voltage_v"])
            med.drop(columns=["id"]).to_csv(destino, index=False)
        n = len(med)
        esperado = s.get("n_muestras")
        if esperado is None:                      # armado sin vista: contar en la base
            esperado = sb.contar("measurements", {"session_id": f"eq.{sid}"})
            s["n_muestras"] = n
            s["t_ultima_muestra_s"] = float(med["elapsed_time"].max()) if n else None
        estado = ("sin control" if esperado is None
                  else "OK" if n == int(esperado) else f"DIFERENTE (la base dice {esperado})")
        controles.append({"session_id": sid, "paciente": s.get("paciente"),
                          "nro_sesion": s.get("nro_sesion"), "muestras": n, "estado": estado})
        print(f"  [{i:>2}/{len(sesiones)}] {s.get('paciente') or '—':>6} "
              f"s{s.get('nro_sesion') or '?'}: {n} muestras {'' if estado == 'OK' else estado}")

    (C.DATOS / "sesiones.json").write_text(
        json.dumps(sesiones, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    (C.DATOS / "extraccion.json").write_text(json.dumps({
        "fecha": dt.datetime.now().isoformat(timespec="seconds"),
        "cuenta": email,
        "fuente_sesiones": fuente,
        "sesiones": len(sesiones),
        "eventos": len(eventos),
        "muestras": sum(c["muestras"] for c in controles),
        "controles": controles,
        "app_ediciones": "disponible" if hay_app else "sin tablas en la base",
        "ediciones": len(ediciones or []),
        "controles_editadas": controles_ed,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    malas = [c for c in controles if c["estado"] not in ("OK",)]
    print(f"Listo. {len(malas)} sesión(es) sin conteo OK." if malas else "Listo. Conteos OK.")


if __name__ == "__main__":
    main()
