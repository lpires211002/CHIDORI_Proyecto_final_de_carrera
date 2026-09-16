#!/usr/bin/env bash
#
# Release de Chidori v1.8.0 · correr ESTE script en la terminal de la Mac.
#
#   cd ~/Desktop/TESIS/CHIDORI-Proyecto-final-de-carrera
#   bash release_v1.8.0.sh
#
# Hace, en orden:
#   1. chequeos previos (SQL corrido, firmware flasheado)
#   2. commit de lo que quede suelto
#   3. tag v1.8.0 y push  → GitHub Actions arranca solo y compila el .exe
#   4. build del .dmg en la Mac
#
# No se puede hacer desde la sesión de Claude: la carpeta montada no tiene
# salida a internet para el push, y el .dmg necesita macOS.

set -euo pipefail

VERSION="1.8.0"
TAG="v${VERSION}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="${REPO_DIR}/Programacion_UI_Micro/UI_REACT"

cd "$REPO_DIR"
echo "▸ Repo: $REPO_DIR"
echo "▸ Rama: $(git branch --show-current)"
echo

# ── 0. Chequeos que esta versión SÍ necesita ─────────────────────────────────
cat <<'AVISO'
⚠  Antes de seguir, confirmá estas dos cosas. Esta versión cambia la escala de
   todos los números del instrumento, y si alguna falta vas a guardar datos mal
   etiquetados.

   1. Corriste sql/calibracion.sql en Supabase (columnas de calibración y
      migración de las sesiones a la escala nueva).
   2. Flasheaste el firmware. Por el monitor serial tiene que decir:
        K_CAL = 0.16675 A  ·  V_DETECTOR = 0.169 V
        Z = 2*(Vadc + V_DETECTOR) / K_CAL   [banco 2026-09-15 rev3]

AVISO
read -r -p "¿Las dos hechas? [s/N] " ok
[[ "$ok" =~ ^[sS]$ ]] || { echo "Cortado. Hacelas y volvé."; exit 1; }
echo

# ── 1. Versión ───────────────────────────────────────────────────────────────
VER_PKG="$(node -p "require('${UI_DIR}/package.json').version")"
if [ "$VER_PKG" != "$VERSION" ]; then
  echo "❌ package.json dice $VER_PKG y este script es el de $VERSION."
  exit 1
fi
echo "▸ package.json en $VER_PKG ✓"
echo

# ── 2. Commit de lo que quede suelto ─────────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  echo "▸ Cambios sin commitear:"
  git status --short
  echo
  read -r -p "¿Commitear todo como 'v1.8.0'? [s/N] " c
  if [[ "$c" =~ ^[sS]$ ]]; then
    git add -A
    git commit -m "v${VERSION}: calibracion medida, trazabilidad de la escala y crudo de A0

Los ohms de esta version no son comparables con los de la 1.7.0: la escala
pasa de constantes de diseño a constantes medidas en banco. Conversion para
reportes viejos: Z_nueva = 0,3454*Z_vieja - 0,3718 (absolutos) y solo el
factor para diferencias.

El firmware reporta su K_CAL en el STATUS y la app etiqueta cada sesion con
la calibracion que realmente la midio. El PDF ahora dice con que se midio.
Se guarda la continua cruda de A0.

Ver Programacion_UI_Micro/UI_REACT/RELEASE_v1.8.0.md"
    echo "✅ Commit hecho"
  else
    echo "❌ Cortado: no se taggea con el árbol sucio."
    exit 1
  fi
fi
echo

# ── 3. Tag y push · dispara el build de Windows en GitHub Actions ────────────
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "▸ El tag $TAG ya existe, no lo vuelvo a crear."
else
  git tag -a "$TAG" -m "Chidori $TAG"
fi
git push origin "$(git branch --show-current)"
git push origin "$TAG"

echo
echo "✅ Tag $TAG publicado · GitHub Actions está compilando el .exe (~10 min)"
echo "   https://github.com/lpires211002/CHIDORI_Proyecto_final_de_carrera/actions"
echo "   Cuando termine: entrar al run → Artifacts → Chidori-Windows"
echo

# ── 4. DMG de macOS ──────────────────────────────────────────────────────────
cd "$UI_DIR"

if [ ! -f ".env.local" ]; then
  echo "❌ Falta ${UI_DIR}/.env.local con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY."
  echo "   El build aborta sin eso. Copialo de .env.example y volvé a correr."
  exit 1
fi

echo "▸ Compilando el .dmg (tarda unos minutos)…"
npm run dist:mac

DMG="${UI_DIR}/release/Chidori-${VERSION}-universal.dmg"
echo
echo "✅ Listo"
echo "   DMG: $DMG"
echo "   EXE: bajarlo de Actions cuando termine el run"
echo
cat <<'MAC'
▸ Para instalarlo en OTRA Mac (la firma es ad-hoc, no notarizada):

    xattr -cr /Applications/Chidori.app
    codesign --force --deep --sign - /Applications/Chidori.app

  Desde macOS Sequoia el clic derecho → Abrir ya no alcanza. La alternativa
  sin terminal es Ajustes del Sistema → Privacidad y seguridad → Abrir de
  todas formas, después de intentar abrirla una vez.
MAC
