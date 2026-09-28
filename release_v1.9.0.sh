#!/usr/bin/env bash
#
# Release de Chidori v1.9.0 · correr ESTE script en la terminal de la Mac.
#
#   cd ~/Desktop/TESIS/CHIDORI-Proyecto-final-de-carrera
#   bash release_v1.9.0.sh
#
# Hace, en orden:
#   1. chequeos previos (SQL corrido, placa de 1,1k flasheada)
#   2. versión 1.9.0, árbol limpio y .env.local con valores reales
#   3. tag v1.9.0 y push  → GitHub Actions compila el .exe y lo adjunta al
#      release solo (~10 min)
#   4. build del .dmg en la Mac
#   5. si está `gh`, crea/actualiza el release y sube el .dmg
#
# No se puede hacer desde la sesión de Claude: no tiene credenciales de
# GitHub para el push, y el .dmg necesita macOS.

set -euo pipefail

VERSION="1.9.0"
TAG="v${VERSION}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="${REPO_DIR}/Programacion_UI_Micro/UI_REACT"
NOTES="${UI_DIR}/RELEASE_v${VERSION}.md"

cd "$REPO_DIR"
echo "▸ Repo: $REPO_DIR"
echo "▸ Rama: $(git branch --show-current)"
echo

# ── 0. Chequeos de datos ─────────────────────────────────────────────────────
cat <<'AVISO'
⚠  Antes de seguir, confirmá estas dos cosas:

   1. Corriste sql/calibracion.sql en Supabase (rev 4). El editor tiene que
      haber dicho "Placa modificada: 1 sesion(es) reasignadas".
   2. Flasheaste la placa de R9 = 1,1k con R9_OHM 1100 (DESPUÉS del SQL).
      Por el monitor serie tiene que decir:
        K_CAL = 0.33350 A  ·  V_DETECTOR = 0.169 V
        Placa: R9 = 1100 ohm
      Las placas de 2,2k no se tocan.

AVISO
read -r -p "¿Las dos hechas? [s/N] " ok
[[ "$ok" =~ ^[sS]$ ]] || { echo "Cortado. Hacelas y volvé."; exit 1; }
echo

# ── 1. Versión y árbol limpio ────────────────────────────────────────────────
VER_PKG="$(node -p "require('${UI_DIR}/package.json').version")"
if [ "$VER_PKG" != "$VERSION" ]; then
  echo "❌ package.json dice $VER_PKG y este script es el de $VERSION."
  exit 1
fi
echo "▸ package.json en $VER_PKG ✓"

if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Hay cambios sin commitear. No se publica un release con el árbol sucio:"
  git status --short
  echo "   Commitealos (o descartalos) y volvé a correr."
  exit 1
fi
echo "▸ Árbol limpio ✓"

# ── 2. .env.local con valores reales ─────────────────────────────────────────
# Vite hornea estas variables en el build: si quedan las de ejemplo, la app
# compila igual pero el login da "Failed to fetch". Ya pasó una vez.
ENV_FILE="${UI_DIR}/.env.local"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Falta ${ENV_FILE} con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY."
  exit 1
fi
URL="$(sed -n 's/^VITE_SUPABASE_URL=//p' "$ENV_FILE" | tr -d "\"' \r")"
KEY="$(sed -n 's/^VITE_SUPABASE_ANON_KEY=//p' "$ENV_FILE" | tr -d "\"' \r")"
if ! [[ "$URL" =~ ^https://[a-z0-9]+\.supabase\.co/?$ ]] || [[ "$URL" == *YOUR* ]] || [ "${#KEY}" -lt 30 ]; then
  echo "❌ .env.local tiene valores de ejemplo o incompletos."
  echo "   VITE_SUPABASE_URL tiene que ser https://<proyecto>.supabase.co y la"
  echo "   anon key, la real (Supabase → Project Settings → API)."
  exit 1
fi
echo "▸ .env.local con URL y clave reales ✓"
echo

# ── 3. Tag y push · dispara el build de Windows en GitHub Actions ────────────
HEAD_SHA="$(git rev-parse HEAD)"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  TAG_SHA="$(git rev-parse "$TAG^{commit}")"
  if [ "$TAG_SHA" != "$HEAD_SHA" ]; then
    echo "❌ El tag $TAG apunta a ${TAG_SHA:0:7} y HEAD es ${HEAD_SHA:0:7}."
    echo "   Si hubo commits después del tag y van en esta versión:"
    echo "     git tag -d $TAG && git tag -a $TAG -m 'Chidori $TAG'"
    exit 1
  fi
  echo "▸ Tag $TAG ya creado en HEAD ✓"
else
  git tag -a "$TAG" -m "Chidori $TAG"
  echo "▸ Tag $TAG creado"
fi
git push origin "$(git branch --show-current)"
git push origin "$TAG"

echo
echo "✅ Tag $TAG publicado · GitHub Actions compila el .exe (~10 min) y lo"
echo "   adjunta al release solo:"
echo "   https://github.com/lpires211002/CHIDORI-Proyecto-final-de-carrera/actions"
echo

# ── 4. DMG de macOS ──────────────────────────────────────────────────────────
cd "$UI_DIR"
echo "▸ Compilando el .dmg (tarda unos minutos)…"
npm run dist:mac

DMG="$(ls -t release/*"${VERSION}"*.dmg 2>/dev/null | head -1 || true)"
if [ -z "$DMG" ]; then
  echo "❌ No encontré el .dmg de ${VERSION} en release/:"
  ls release
  exit 1
fi
DMG="${UI_DIR}/${DMG}"
echo "✅ DMG: $DMG"
echo

# ── 5. Release en GitHub ─────────────────────────────────────────────────────
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  # Si Actions ya lo creó (al adjuntar el .exe), se reusa; si no, se crea acá
  # y Actions le suma el .exe cuando termine.
  gh release view "$TAG" >/dev/null 2>&1 \
    || gh release create "$TAG" --title "Chidori $TAG" --notes-file "$NOTES" \
    || true
  gh release edit "$TAG" --title "Chidori $TAG" --notes-file "$NOTES"
  gh release upload "$TAG" "$DMG" --clobber
  echo "✅ Release $TAG con notas y .dmg:"
  echo "   https://github.com/lpires211002/CHIDORI-Proyecto-final-de-carrera/releases/tag/$TAG"
else
  echo "▸ No está 'gh' (o no hay sesión). Subí el .dmg a mano:"
  echo "   GitHub → Releases → $TAG → Edit → arrastrar el .dmg"
  echo "   Y pegá como descripción: $NOTES"
fi
echo

cat <<'MAC'
▸ Para instalarlo en OTRA Mac (la firma es ad-hoc, no notarizada):

    xattr -cr /Applications/Chidori.app
    codesign --force --deep --sign - /Applications/Chidori.app

  Desde macOS Sequoia el clic derecho → Abrir ya no alcanza. La alternativa
  sin terminal es Ajustes del Sistema → Privacidad y seguridad → Abrir de
  todas formas, después de intentar abrirla una vez.
MAC
