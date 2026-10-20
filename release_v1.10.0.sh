#!/usr/bin/env bash
#
# Release de Chidori v1.10.0 · correr ESTE script en la terminal de la Mac.
#
#   cd ~/Desktop/TESIS/CHIDORI-Proyecto-final-de-carrera
#   bash release_v1.10.0.sh
#
# Hace, en orden:
#   1. chequeo previo (sql/edicion_sesiones.sql corrido)
#   2. versión 1.10.0, código de la app sin cambios sueltos y .env.local real
#   3. tag v1.10.0 y push  → GitHub Actions compila el .exe y lo adjunta al
#      release solo (~10 min)
#   4. build del .dmg en la Mac
#   5. si está `gh`, crea/actualiza el release y sube el .dmg
#
# No se puede hacer desde la sesión de Claude: no tiene credenciales de
# GitHub para el push, y el .dmg necesita macOS.

set -euo pipefail

VERSION="1.10.0"
TAG="v${VERSION}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="${REPO_DIR}/Programacion_UI_Micro/UI_REACT"
NOTES="${UI_DIR}/MD releases/RELEASE_v${VERSION}.md"

cd "$REPO_DIR"
echo "▸ Repo: $REPO_DIR"
echo "▸ Rama: $(git branch --show-current)"
echo

# ── 0. Chequeos de datos ─────────────────────────────────────────────────────
cat <<'AVISO'
⚠  Antes de seguir, confirmá:

   1. Corriste sql/edicion_sesiones.sql en Supabase. Al final muestra una
      tabla con session_edits, measurements_edited, session_review y
      session_comments, todas con rls = t y 1 política.

AVISO
read -r -p "¿Corriste sql/edicion_sesiones.sql? [s/N] " ok
[[ "$ok" =~ ^[sS]$ ]] || { echo "Cortado. Corrélo y volvé."; exit 1; }
if [ ! -f "$NOTES" ]; then
  echo "❌ No encuentro las notas del release: $NOTES"
  exit 1
fi
echo

# ── 1. Versión y árbol limpio ────────────────────────────────────────────────
VER_PKG="$(node -p "require('${UI_DIR}/package.json').version")"
if [ "$VER_PKG" != "$VERSION" ]; then
  echo "❌ package.json dice $VER_PKG y este script es el de $VERSION."
  exit 1
fi
echo "▸ package.json en $VER_PKG ✓"

# Solo importa lo que entra al build. Cambios sueltos en la tesis, el KiCad o
# sql/ no frenan el release: no forman parte de la app.
APP_PATHS=("$UI_DIR/src" "$UI_DIR/electron" "$UI_DIR/public" "$UI_DIR/build"
           "$UI_DIR/index.html" "$UI_DIR/package.json" "$UI_DIR/package-lock.json"
           "$UI_DIR/vite.config.js")
SUCIO="$(git status --porcelain -- "${APP_PATHS[@]}")"
if [ -n "$SUCIO" ]; then
  echo "❌ Hay cambios sin commitear en el código de la app. No se publica así:"
  echo "$SUCIO"
  echo "   Commitealos (o descartalos) y volvé a correr."
  exit 1
fi
echo "▸ Código de la app sin cambios sueltos ✓"

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
