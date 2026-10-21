"""
Chidori · Etapa III · paso 3: figuras del EDA.

    python graficos.py            # todas
    python graficos.py --sin-sesiones   # salta el panel de cada sesión

Lee salidas/ (de `etiquetar.py`) y escribe en salidas/figuras/:

    sesiones/sesion_<P>_sNN.png  cada sesión: crudo, tendencia, artefactos,
                                 ventanas de Z0 y Zf, eventos y agua acumulada
    curvas_por_sujeto.png        las curvas aptas de cada sujeto superpuestas,
                                 en % del basal hasta las ganas
    caida_por_sujeto.png         caída %, pendiente y tiempo hasta las ganas:
                                 variabilidad dentro vs entre sujetos
    caida_vs_covariables.png     caída % contra cada covariable con datos
    respuesta_tomas.png          Z alrededor de cada toma de agua

Todas en tema claro, para la tesis impresa. Decimales con coma.
"""
import argparse
import json
import math

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.ticker import FuncFormatter  # noqa: E402

import config as C  # noqa: E402

COL = {
    "texto": "#0b0b0b", "texto2": "#52514e", "tenue": "#8a8984", "grilla": "#e6e5e0",
    "banda": "#f0efec", "crudo": "#c9c7c0", "s1": "#2a78d6", "s2": "#eb6834",
}
plt.rcParams.update({
    "font.size": 8.5, "axes.titlesize": 9.5, "axes.titleweight": "bold",
    "axes.titlelocation": "left", "axes.edgecolor": COL["tenue"], "axes.linewidth": 0.6,
    "axes.labelcolor": COL["texto2"], "xtick.color": COL["texto2"], "ytick.color": COL["texto2"],
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True,
    "grid.color": COL["grilla"], "grid.linewidth": 0.5, "legend.frameon": False,
    "figure.facecolor": "white", "axes.facecolor": "white", "savefig.dpi": 160,
    "savefig.bbox": "tight",
})
COMA = FuncFormatter(lambda v, _: f"{v:g}".replace(".", ","))


def coma(x, d=1):
    return "—" if x is None or not np.isfinite(x) else f"{x:.{d}f}".replace(".", ",")


def ejes_coma(ax):
    ax.xaxis.set_major_formatter(COMA)
    ax.yaxis.set_major_formatter(COMA)


def num_sujeto(cod):
    return cod.replace("P-", "").lstrip("0") if isinstance(cod, str) else "?"


def cargar():
    df = pd.read_csv(C.SALIDAS / "sesiones_etiquetadas.csv", parse_dates=["fecha"])
    df["nro_sesion"] = pd.to_numeric(df["nro_sesion"], errors="coerce").astype("Int64")
    # Los eventos que usó etiquetar.py: en las sesiones editadas en la app son
    # los corregidos, en el tiempo de la serie editada.
    p_ev = C.SALIDAS / "eventos_analizados.csv"
    ev = pd.read_csv(p_ev if p_ev.exists() and p_ev.stat().st_size > 2 else C.DATOS / "eventos.csv")
    cur_p = C.SALIDAS / "respuesta_tomas_curvas.csv"
    cur = pd.read_csv(cur_p) if cur_p.exists() else pd.DataFrame()
    return df, ev, cur


def serie(sid):
    p = C.SALIDAS / "series" / f"{sid}.csv.gz"
    return pd.read_csv(p) if p.exists() else None


# ── 1 · cada sesión ─────────────────────────────────────────────────────

def figura_sesion(x, s, ev_s, destino):
    tb, tf = x["t_basal_s"], x["t_fin_s"]
    t_min = s["t_s"] / 60
    fig, (ax, axa) = plt.subplots(2, 1, figsize=(10, 4.6), sharex=True,
                                  gridspec_kw={"height_ratios": [3.2, 1], "hspace": 0.08})

    # huecos de datos (> 1,5 s sin muestras)
    dt = np.diff(s["t_s"].to_numpy())
    for i in np.where(dt > 1.5)[0]:
        ax.axvspan(s["t_s"].iat[i] / 60, s["t_s"].iat[i + 1] / 60, color=COL["banda"], lw=0, zorder=0)

    # tramo de asentamiento (antes de la basal): queda fuera del objetivo
    if tb > s["t_s"].iat[0] + 30:
        ax.axvspan(s["t_s"].iat[0] / 60, tb / 60, color=COL["banda"], lw=0, zorder=0)
        ax.text((s["t_s"].iat[0] + tb) / 120, 0.90, "asentamiento\n(fuera del objetivo)", transform=ax.get_xaxis_transform(),
                ha="center", va="top", color=COL["texto2"], fontsize=7)

    # ventanas que definen el objetivo
    a, b = C.PRE_FIN_VENTANA_S
    for (u, v), et in (((tb, tb + C.BASAL_VENTANA_S), "Z₀"), ((tf + a, tf + b), "Zf")):
        ax.axvspan(u / 60, v / 60, color=COL["s1"], alpha=0.10, lw=0, zorder=0)
        ax.text((u + v) / 120, 1.0, et, transform=ax.get_xaxis_transform(), ha="center", va="bottom",
                color=COL["texto2"], fontsize=8)

    ax.plot(t_min, s["z_ohm"], color=COL["crudo"], lw=0.5, zorder=1, label="crudo")
    art = s["artefacto"] == 1
    if art.any():
        ax.scatter(t_min[art], s["z_ohm"][art], s=2, color=COL["s2"], lw=0, zorder=2,
                   label="artefacto (excluido)")
    ax.plot(t_min, s["tendencia_ohm"], color=COL["s1"], lw=2, zorder=3, label="tendencia 60 s")
    if np.isfinite(x["z0_ohm"]):
        ax.axhline(x["z0_ohm"], color=COL["texto2"], lw=0.7, zorder=2)
        ax.text(t_min.iat[-1], x["z0_ohm"], "  basal", va="center", ha="left", color=COL["texto2"], fontsize=7.5)

    tend = s["tendencia_ohm"].to_numpy()
    lo, hi = np.nanpercentile(tend, 0.5), np.nanpercentile(tend, 99.5)
    pad = max(0.25 * (hi - lo), 0.05)
    ax.set_ylim(lo - pad, hi + pad)
    fuera = ((s["z_ohm"] < lo - pad) | (s["z_ohm"] > hi + pad)).mean()

    etq = {"water": "A", "void": "M", "mark": "E", "fsf": "1ª sens.", "fdv": "1er deseo", "disconnect": "!"}
    for _, e in ev_s.iterrows():
        k = str(e["kind"])
        if k not in etq:
            continue
        te = e["elapsed_time"] / 60
        ax.axvline(te, color=COL["tenue"], lw=0.7, zorder=1)
        ax.text(te, 0.985, etq[k], transform=ax.get_xaxis_transform(), ha="center", va="top",
                color=COL["texto"], fontsize=7.5, bbox={"fc": "white", "ec": "none", "pad": 0.6})

    ax.set_ylabel("Z (Ω)")
    ax.legend(loc="lower right", fontsize=7.5, ncol=3, handlelength=1.6)
    estado = "APTA" if x["apta"] == "si" else "NO APTA"
    motivos = str(x["motivos"]) if isinstance(x["motivos"], str) else ""
    dup = x.get("duplicada_de")
    sub = (f"{estado}" + (f" · copia de {dup}" if isinstance(dup, str) else "")
           + (f" · {motivos.replace(';', ', ')}" if motivos else "") + f" · {x.get('placa', '')}")
    ax.text(0, 1.16, f"{x['paciente'] if isinstance(x['paciente'], str) else 'sin paciente'} · sesión "
            f"{x['nro_sesion'] if pd.notna(x['nro_sesion']) else '—'} · {x['fecha']:%d/%m/%Y}",
            transform=ax.transAxes, fontsize=9.5, fontweight="bold", color=COL["texto"])
    ax.text(0, 1.085, sub, transform=ax.transAxes, color=COL["texto2"], fontsize=7.5)
    ax.text(1, 1.16, f"caída {coma(x['caida_pct'])} % ({coma(x['caida_db'], 2)} dB) · "
            f"{coma(x['pendiente_pct_h'], 2)} %/h · {coma(x['duracion_llenado_min'], 0)} min hasta las ganas"
            + (f" · asentamiento previo {coma(x['asentamiento_pct'])} %" if np.isfinite(x.get("asentamiento_pct", np.nan)) else "")
            + (f" · crudo fuera de escala: {coma(100 * fuera, 1)} %" if fuera > 0.001 else ""),
            transform=ax.transAxes, ha="right", color=COL["texto"], fontsize=7.5)

    # agua acumulada
    ag = ev_s[ev_s["kind"] == "water"].sort_values("elapsed_time")
    tt = np.concatenate([[0], ag["elapsed_time"].to_numpy() / 60, [t_min.iat[-1]]])
    vv = np.concatenate([[0], np.cumsum(pd.to_numeric(ag["amount_ml"], errors="coerce").fillna(0)), [np.nan]])
    vv[-1] = vv[-2]
    axa.step(tt, vv, where="post", color=COL["texto2"], lw=1.2)
    axa.fill_between(tt, vv, step="post", color=COL["banda"], lw=0)
    axa.set_ylabel("agua (ml)")
    axa.set_xlabel("tiempo (min)")
    axa.set_ylim(0, max(250, np.nanmax(vv) * 1.15))
    ejes_coma(ax)
    ejes_coma(axa)
    fig.savefig(destino)
    plt.close(fig)


# ── 2 · curvas por sujeto ───────────────────────────────────────────────

def curvas_por_sujeto(ap):
    sujetos = sorted(ap["paciente"].dropna().unique())
    if not sujetos:
        return
    nc = min(3, len(sujetos))
    nf = math.ceil(len(sujetos) / nc)
    fig, axs = plt.subplots(nf, nc, figsize=(3.4 * nc, 2.5 * nf), sharex=True, sharey=True, squeeze=False)
    for ax, p in zip(axs.flat, sujetos):
        g = ap[ap["paciente"] == p].sort_values("nro_sesion")
        for _, x in g.iterrows():
            s = serie(x["session_id"])
            if s is None or not np.isfinite(x["z0_ohm"]):
                continue
            m = (s["t_s"] >= x["t_basal_s"]) & (s["t_s"] <= x["t_fin_s"])
            s = s[m].iloc[::20]                      # ~5 s, la tendencia ya es suave
            tm = (s["t_s"] - x["t_basal_s"]) / 60
            y = 100 * (s["tendencia_ohm"] / x["z0_ohm"] - 1)
            ax.plot(tm, y, color=COL["s1"], lw=1.2, alpha=0.85)
            ax.plot(tm.iat[-1], -x["caida_pct"], "o", ms=4, color=COL["s1"], mec="white", mew=1)
            ax.text(tm.iat[-1], -x["caida_pct"], f" s{x['nro_sesion']}", fontsize=7, color=COL["texto2"], va="center")
        ax.axhline(0, color=COL["texto2"], lw=0.7)
        ax.set_title(f"{p} · {len(g)} {'sesión' if len(g) == 1 else 'sesiones'}")
        ejes_coma(ax)
    for ax in axs.flat[len(sujetos):]:
        ax.set_visible(False)
    for ax in axs[-1]:
        ax.set_xlabel("min desde la basal")
    for ax in axs[:, 0]:
        ax.set_ylabel("ΔZ (% del basal)")
    fig.suptitle("Tendencia de cada sesión apta hasta las ganas (punto = fin)", x=0.01, ha="left",
                 fontsize=10, fontweight="bold")
    fig.tight_layout()
    fig.savefig(C.SALIDAS / "figuras" / "curvas_por_sujeto.png")
    plt.close(fig)


# ── 3 · dentro vs entre sujetos ─────────────────────────────────────────

def caida_por_sujeto(ap):
    sujetos = sorted(ap["paciente"].dropna().unique())
    if not sujetos:
        return
    hip = 100 * (1 - 10 ** (-C.HIPOTESIS_GANAS_DB / 20))
    vars_ = [("caida_pct", "Caída al momento de las ganas (%)"),
             ("pendiente_pct_h", "Pendiente del llenado (%/h)"),
             ("duracion_llenado_min", "Tiempo hasta las ganas (min)")]
    fig, axs = plt.subplots(1, 3, figsize=(11, 3.4))
    rng = np.random.default_rng(0)
    for ax, (col, tit) in zip(axs, vars_):
        for i, p in enumerate(sujetos):
            v = ap.loc[ap["paciente"] == p, col].dropna().to_numpy()
            ax.scatter(i + rng.uniform(-0.12, 0.12, len(v)), v, s=22, color=COL["s1"], ec="white", lw=1, zorder=3)
            if len(v):
                ax.plot([i - 0.25, i + 0.25], [np.median(v)] * 2, color=COL["texto"], lw=1.6, zorder=4)
        ax.set_xticks(range(len(sujetos)))
        ax.set_xticklabels([f"{p}\nn={int(ap['paciente'].eq(p).sum())}" for p in sujetos], fontsize=7.5)
        ax.grid(axis="x", visible=False)
        ax.set_title(tit)
        ax.yaxis.set_major_formatter(COMA)
        if col == "caida_pct":
            ax.axhline(hip, color=COL["texto2"], lw=0.8)
            ax.text(len(sujetos) - 0.5, hip, f"hipótesis de la app: {coma(C.HIPOTESIS_GANAS_DB, 1)} dB ({coma(hip, 1)} %)",
                    ha="right", va="bottom", fontsize=7, color=COL["texto2"])
            ax.set_ylim(bottom=min(0, np.nanmin(ap[col]) - 1))
    fig.suptitle("Cada punto es una sesión apta; la raya es la mediana del sujeto", x=0.01, ha="left",
                 fontsize=10, fontweight="bold")
    fig.tight_layout()
    fig.savefig(C.SALIDAS / "figuras" / "caida_por_sujeto.png")
    plt.close(fig)


# ── 4 · caída vs covariables ────────────────────────────────────────────

def es_del_sujeto(ap, col):
    g = ap.dropna(subset=[col]).groupby("paciente")[col].nunique()
    return len(g) > 0 and (g <= 1).all()


def caida_vs_covariables(ap):
    pan = [(c, et) for c, et in C.COVARIABLES_GRAFICO
           if c in ap.columns and pd.to_numeric(ap[c], errors="coerce").notna().sum() >= 3]
    if not pan:
        return
    nc = 3
    nf = math.ceil(len(pan) / nc)
    fig, axs = plt.subplots(nf, nc, figsize=(10.5, 2.9 * nf), sharey=True, squeeze=False)
    for ax, (c, et) in zip(axs.flat, pan):
        d = ap[["paciente", "caida_pct"]].assign(x=pd.to_numeric(ap[c], errors="coerce")).dropna()
        ax.scatter(d["x"], d["caida_pct"], s=24, color=COL["s1"], ec="white", lw=1, zorder=3)
        for _, r in d.iterrows():
            ax.annotate(num_sujeto(r["paciente"]), (r["x"], r["caida_pct"]), xytext=(4, 3),
                        textcoords="offset points", fontsize=6.5, color=COL["texto2"])
        rho = d[["x", "caida_pct"]].rank().corr().iloc[0, 1] if d["x"].nunique() > 1 else np.nan
        suj = es_del_sujeto(ap, c)
        nsu = d["paciente"].nunique()
        ax.set_title(et, fontsize=8.5)
        ax.set_xlabel(f"ρ = {coma(rho, 2)} · {len(d)} ses. / {nsu} suj."
                      + (f" · del sujeto: n efectivo = {nsu}" if suj else ""), fontsize=7)
        ejes_coma(ax)
    for ax in axs.flat[len(pan):]:
        ax.set_visible(False)
    for ax in axs[:, 0]:
        ax.set_ylabel("caída a las ganas (%)")
    fig.suptitle("Caída % contra covariables · descriptivo (el número junto a cada punto es el sujeto)",
                 x=0.01, ha="left", fontsize=10, fontweight="bold")
    fig.tight_layout()
    fig.savefig(C.SALIDAS / "figuras" / "caida_vs_covariables.png")
    plt.close(fig)


# ── 5 · respuesta a las tomas ───────────────────────────────────────────

def respuesta_tomas(ap, cur):
    if cur.empty:
        return
    cur = cur[cur["session_id"].isin(ap["session_id"])]
    if cur.empty:
        return
    fig, ax = plt.subplots(figsize=(7.5, 3.8))
    for (_, _), g in cur.groupby(["session_id", "toma_n"]):
        ax.plot(g["t_rel_s"] / 60, g["dz_pct"], color=COL["crudo"], lw=0.7, zorder=1)
    med = cur.groupby("t_rel_s")["dz_pct"].agg(["median", "count"])
    n_tomas = cur.groupby(["session_id", "toma_n"]).ngroups
    med = med[med["count"] >= max(3, 0.3 * n_tomas)]     # sin la cola con pocas tomas
    ax.plot(med.index / 60, med["median"], color=COL["s1"], lw=2, zorder=3)
    pend = ap.loc[ap["session_id"].isin(cur["session_id"]), "pendiente_pct_h"].median()
    tt = np.array([0, C.TOMA_CURVA_S[1]])
    ax.plot(tt / 60, pend * tt / 3600, color=COL["s2"], lw=2, zorder=2)
    if len(med):
        ax.text(med.index[-1] / 60, med["median"].iat[-1], "  mediana de las tomas", color=COL["texto"],
                fontsize=7.5, va="center")
    ax.text(tt[-1] / 60, pend * tt[-1] / 3600, "  tendencia de fondo\n  (pendiente mediana)", color=COL["texto"],
            fontsize=7.5, va="center")
    for (u, v) in (C.TOMA_5MIN_S, C.TOMA_12MIN_S):
        ax.axvspan(u / 60, v / 60, color=COL["banda"], lw=0, zorder=0)
    ax.axvline(0, color=COL["texto2"], lw=0.8)
    ax.axhline(0, color=COL["texto2"], lw=0.6)
    ax.text(0, 1.0, " toma", transform=ax.get_xaxis_transform(), va="bottom", fontsize=7.5, color=COL["texto2"])
    n = cur.groupby(["session_id", "toma_n"]).ngroups
    ax.set_title(f"Z alrededor de cada toma de agua · {n} tomas, cada curva cortada en la toma siguiente", pad=14)
    ax.set_xlabel("min desde la toma")
    ax.set_ylabel("ΔZ (% del basal) vs. 2 min previos")
    ax.set_xlim(C.TOMA_CURVA_S[0] / 60, C.TOMA_CURVA_S[1] / 60 + 4)
    ejes_coma(ax)
    fig.text(0.01, -0.04, "Si la curva azul cae más rápido que la naranja en los primeros minutos, esa parte no "
             "es vejiga: la diuresis tarda decenas de minutos en arrancar.", fontsize=7, color=COL["texto2"])
    fig.savefig(C.SALIDAS / "figuras" / "respuesta_tomas.png")
    plt.close(fig)


def main():
    ap_ = argparse.ArgumentParser()
    ap_.add_argument("--sin-sesiones", action="store_true")
    a = ap_.parse_args()
    df, ev, cur = cargar()
    (C.SALIDAS / "figuras" / "sesiones").mkdir(parents=True, exist_ok=True)
    ap = df[df["apta"] == "si"]
    if not a.sin_sesiones:
        for _, x in df.iterrows():
            s = serie(x["session_id"])
            if s is None:
                continue
            nombre = (f"sesion_{x['paciente']}_s{int(x['nro_sesion']):02d}.png"
                      if isinstance(x["paciente"], str) and pd.notna(x["nro_sesion"])
                      else f"sesion_sinpaciente_{x['session_id'][:8]}.png")
            figura_sesion(x, s, ev[ev["session_id"] == x["session_id"]], C.SALIDAS / "figuras" / "sesiones" / nombre)
    curvas_por_sujeto(ap)
    caida_por_sujeto(ap)
    caida_vs_covariables(ap)
    respuesta_tomas(ap, cur)
    print(f"Figuras en {C.SALIDAS / 'figuras'}")


if __name__ == "__main__":
    main()
