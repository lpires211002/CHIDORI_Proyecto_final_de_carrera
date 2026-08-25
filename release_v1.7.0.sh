#!/usr/bin/env bash
#
# Release de Chidori v1.7.0 · correr ESTE script en la terminal de la Mac.
#
#   cd ~/Documents/CHIDORI-Proyecto-final-de-carrera
#   bash release_v1.7.0.sh
#
# Hace, en orden:
#   1. commit de los cambios de la 1.7.0
#   2. tag v1.7.0 y push  → GitHub Actions arranca solo y compila el .exe
#   3. build del .dmg en la Mac
#
# No se puede hacer desde la sesión de Claude: la carpeta montada no permite
# las operaciones de escritura de git ni tiene salida a internet, y el .dmg
# necesita macOS.

set -euo pipefail

VERSION="1.7.0"
TAG="v${VERSION}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="${REPO_DIR}/Programacion_UI_Micro/UI_REACT"

cd "$REPO_DIR"

echo "▸ Repo: $REPO_DIR"
echo "▸ Rama: $(git branch --show-current)"
echo

# ── 0. Basura de la sesión de Claude ─────────────────────────────────────────
if [ -d "_to_delete" ]; then
  echo "⚠  Hay una carpeta _to_delete/ con archivos temporales de la sesión."
  echo "   No se incluye en el commit. Podés borrarla cuando quieras:"
  echo "     rm -rf '${REPO_DIR}/_to_delete'"
  echo
fi

# ── 1. Commit ────────────────────────────────────────────────────────────────
echo "▸ Archivos de la 1.7.0"
git add \
  Programacion_UI_Micro/UI_REACT/package.json \
  Programacion_UI_Micro/UI_REACT/RELEASE_v1.7.0.md \
  Programacion_UI_Micro/UI_REACT/src/lib/signal.js \
  Programacion_UI_Micro/UI_REACT/src/Dashboard.jsx \
  Programacion_UI_Micro/UI_REACT/src/components/StatsGrid.jsx \
  Programacion_UI_Micro/UI_REACT/src/components/Timeline.jsx \
  "Programacion_UI_Micro/Firmware_Optimizado/Chidori_ESP32C3_AP/Chidori_ESP32C3_WiFiManager/Chidori_ESP32C3_WiFiManager.ino"

git status --short
echo

git commit -m "v1.7.0: estimadores robustos de Z y reloj del equipo en el protocolo

Basal, Z final y tasa pasan a calcularse por mediana sobre ventanas de
tiempo en vez de sobre muestras sueltas, y la alarma se evalua sobre la
tendencia con persistencia de 30 s. Sobre la sesion del 20-ago la tasa
pasa de un rango de -576..+5808 ohm/min de puro ruido a -0,30..+0,40, y
la alarma deja de dispararse 18 minutos antes de tiempo por un
movimiento del paciente.

El firmware agrega su millis() y un numero de secuencia al mensaje
(<Z> <Vpp> <Vadc> <t_ms> <seq>): cada muestra queda ubicada en el
instante en que se midio y no en el que llego, las muestras perdidas se
cuentan exacto por salto de secuencia (288 microcortes -> 7) y la
duracion de la sesion pasa a ser tiempo de datos (508:58 -> 84 min).

Compatible en ambos sentidos con las versiones anteriores de firmware y
de app. El dato crudo no se toca."

echo "✅ Commit hecho"
echo

# ── 2. Tag y push · dispara el build de Windows en GitHub Actions ────────────
git tag -a "$TAG" -m "Chidori $TAG"
git push origin "$(git branch --show-current)"
git push origin "$TAG"

echo
echo "✅ Tag $TAG publicado · GitHub Actions esta compilando el .exe (~10 min)"
echo "   https://github.com/lpires211002/CHIDORI_Proyecto_final_de_carrera/actions"
echo "   Cuando termine: entrar al run → Artifacts → Chidori-Windows"
echo

# ── 3. DMG de macOS ──────────────────────────────────────────────────────────
cd "$UI_DIR"

if [ ! -f ".env.local" ]; then
  echo "❌ Falta ${UI_DIR}/.env.local con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY."
  echo "   El build aborta sin eso. Copialo de .env.example y volvé a correr."
  exit 1
fi

echo "▸ Compilando el .dmg (tarda unos minutos)…"
npm run dist:mac

echo
echo "✅ Listo"
echo "   DMG: ${UI_DIR}/release/Chidori-${VERSION}-universal.dmg"
echo "   EXE: bajarlo de Actions cuando termine el run"
