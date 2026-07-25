# Generar el ejecutable de Chidori (Mac / Windows)

Empaqueta la UI como una **app de escritorio con ícono**. El usuario final hace
doble click y se abre la interfaz — **sin instalar Node, sin terminal, sin `npm`**.
Funciona offline (modo AP) y el `ws://` al ESP no se bloquea (a diferencia de Vercel).

> Esto ya está todo configurado en el proyecto (Electron + electron-builder).
> Solo tenés que correr **un comando** en cada sistema operativo.

---

## Los 3 problemas del `git pull` → por qué el ejecutable NO los tiene

Tu amigo **no clona el repo nunca**. Le pasás **un solo archivo** (el `.dmg` en Mac
o el `.exe` en Windows) por AirDrop, mail, USB o Drive, y lo abre.

| Problema al pullear | Con el ejecutable |
|---|---|
| No sabía usar la terminal | No hay terminal: doble click y listo. |
| No tenía Node.js | El ejecutable trae su propio runtime adentro. No instala nada. |
| El `.env` no se descargó | Las variables se **hornean dentro del ejecutable** cuando VOS lo generás. El usuario final no necesita ningún `.env`. |

**En una frase:** el repo es para vos (desarrollo); el ejecutable es para ellos (uso).

---

## Importante: cada binario se compila en SU sistema operativo

- La **app de Mac** (`.dmg`) se genera **en una Mac**.
- La **app de Windows** (`.exe`) se genera **en una PC con Windows**.

No se puede compilar el `.exe` desde la Mac ni al revés (de forma simple/confiable).
Si solo tenés Mac, podés generar Windows con una VM o pidiéndole a alguien con Windows
que corra el comando en el repo.

---

## Una sola vez (en cada máquina de build)

1. Instalá **Node.js LTS** (https://nodejs.org) si no lo tenés.
2. En la carpeta `UI_REACT/`:
   ```bash
   npm install
   ```
   (esto agrega `electron` y `electron-builder`, ya declarados en package.json)
3. Confirmá que exista **`.env.local`** con las variables de Supabase
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). Se **hornean** dentro del
   ejecutable en el build. **Si faltan, el build ahora se corta con un mensaje
   claro** (no genera un binario roto). Copiá `.env.example` a `.env.local`.
   Ojo: si compilás la versión de Windows en OTRA máquina, esa máquina también
   necesita su propio `.env.local` (copiá el archivo o creálo de nuevo ahí).

---

## Generar la app

**En Mac:**
```bash
npm run dist:mac
```
→ Sale en `release/`:
- `Chidori-0.0.0.dmg` — lo que compartís. El usuario lo abre y **arrastra Chidori a Aplicaciones**.
- `release/mac/Chidori.app` — la app suelta.

**Para Windows — SIN tener una PC con Windows (recomendado):**

GitHub compila el `.exe` por vos en una máquina Windows en la nube (gratis).

*Una sola vez* — cargar los secrets:
1. En tu repo: **Settings → Secrets and variables → Actions → New repository secret**
2. Creá dos secrets con los mismos valores de tu `.env.local`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

*Cada vez que quieras el `.exe`*:
1. Repo → pestaña **Actions** → **"Build Windows (.exe)"** (columna izquierda)
2. Botón **"Run workflow"** → **"Run workflow"** (verde)
3. Esperá ~10 min (aparece un ✓ verde)
4. Entrá al run terminado → abajo de todo, sección **Artifacts** → descargá **`Chidori-Windows`**
   (baja un `.zip`; adentro está el `.exe`)

*(Si preferís hacerlo en una PC con Windows: instalá Node.js, cloná el repo, poné el
`.env.local` en `UI_REACT/` y corré `npm run dist:win`.)*

---

## Qué hace el usuario final

- **Mac:** abre el `.dmg`, arrastra **Chidori** a Aplicaciones, y la abre desde el Launchpad.
- **Windows:** ejecuta el `.exe`, siguiente-siguiente, y queda un acceso directo en el escritorio.

Después es lo de siempre: se conecta a la red WiFi **`Chidori`** del ESP y la app ya
apunta a `192.168.4.1`. Cero terminal.

---

## Cómo se lo pasás a los usuarios (GitHub Releases)

El `.dmg` pesa ~184 MB, así que **no va al repo** (GitHub rechaza archivos >100 MB, y
además inflaría el historial para siempre). Por eso `release/` está en `.gitignore`.
La forma correcta es **Releases**:

1. Repo → columna derecha → **Releases** → **"Create a new release"**
2. **Choose a tag** → escribí `v1.0.0` → **"+ Create new tag: v1.0.0 on publish"**
3. **Release title**: `Chidori v1.0.0`
4. Arrastrá los archivos: el **`.dmg`** (Mac) y el **`.exe`** (Windows)
5. **Publish release**

Les pasás **el link del release**. Cada uno baja el archivo de su sistema:
- Mac → `.dmg`
- Windows → `.exe`

💡 Si publicás el tag `v1.0.0`, GitHub Actions **compila el `.exe` solo** y lo adjunta
al release automáticamente.

---

## Aviso de "app sin firmar" (esperado)

Como la app **no está firmada** con un certificado de pago, la primera vez:

### Mac

El build aplica una **firma ad-hoc** automática (`electron/afterPack.cjs`), que evita
que macOS trate la app como malware. Aun así, al ser un "desarrollador no identificado":

1. Arrastrá Chidori a **Aplicaciones**.
2. **Click derecho** sobre la app → **Abrir** → botón **Abrir**.
3. Si macOS lo bloquea igual: **Ajustes del Sistema → Privacidad y seguridad** →
   al final dice *"Chidori fue bloqueado…"* → **"Abrir de todas formas"**.

**Si aparece "Malware bloqueado y transferido al basurero":**
es un falso positivo de macOS por falta de firma de Apple. Recuperá la app del
basurero y ejecutá una sola vez en la Terminal:

```bash
xattr -cr /Applications/Chidori.app
codesign --force --deep --sign - /Applications/Chidori.app
```

Después abrila normalmente. (El primer comando saca la marca de "descargado de
internet"; el segundo aplica la firma ad-hoc.)

> Para que ese cartel no aparezca nunca en ninguna Mac hay que **notarizar** la app
> con una cuenta Apple Developer (US$99/año). Es la única solución definitiva.
### Windows

- En el aviso de SmartScreen → **Más información** → **Ejecutar de todas formas**.
- Chrome puede avisar "descarga no habitual" → **Conservar**.

Para eliminar estos avisos hay que **firmar** la app (Apple Developer ~US$99/año;
certificado code-signing en Windows). Para uso de tesis / interno, el workaround de
arriba alcanza perfecto.

---

## Personalizar el ícono

Reemplazá **`build/icon.png`** por tu logo (PNG cuadrado, mínimo 512×512, ideal 1024×1024).
electron-builder genera solo el `.icns` (Mac) y el `.ico` (Windows) a partir de ese archivo.
(Hay un ícono base ya puesto.)

---

## Actualizaciones · cómo mantener al día a los usuarios

La app **avisa sola** cuando hay una versión nueva. Al abrirse consulta el último
Release de GitHub y, si detecta una versión mayor a la instalada, muestra:

> **Hay una versión nueva de Chidori (v1.1.0)** · [Descargar] [Más tarde]

"Descargar" les abre la página del Release para bajar el archivo de su sistema.
Instalan encima de la versión vieja (en Mac: reemplazar en Aplicaciones) y listo.
**Las sesiones guardadas no se pierden.**

Si no hay internet (modo AP), el repo es privado o no hay releases, **no muestra nada**
y no molesta a nadie.

### Para publicar una actualización · paso a paso

**Paso 1 · Cambiar el número de versión** (en `package.json`)

Abrí `UI_REACT/package.json` con cualquier editor de texto (doble click desde el
Finder, o TextEdit). En la línea 4 dice:

```json
"version": "1.0.0",
```

Cambiala al número nuevo, por ejemplo:

```json
"version": "1.1.0",
```

Guardá (`Cmd + S`). *(Regla simple: arreglos chicos → `1.0.1`; funciones nuevas → `1.1.0`.)*

⚠️ **Sin este paso nadie recibe el aviso de actualización.**

---

**Paso 2 · Subir los cambios a GitHub**

Abrí la Terminal y pegá (una línea por vez):

```bash
cd ~/Documents/CHIDORI-Proyecto-final-de-carrera/Programacion_UI_Micro/UI_REACT
```

```bash
git add -A && git commit -m "Version 1.1.0" && git push
```

⚠️ **Hacelo ANTES del Paso 4**: GitHub compila el `.exe` a partir de lo que está subido.

---

**Paso 3 · Generar el ejecutable de Mac**

En la misma Terminal:

```bash
npm run dist:mac
```

Esperá 3–8 min. Después:

```bash
open release
```

Se abre el Finder con **`Chidori-1.1.0-universal.dmg`** (con el número nuevo).

---

**Paso 4 · Generar el ejecutable de Windows**

1. Entrá a `github.com/lpires211002/CHIDORI_Proyecto_final_de_carrera`
2. Pestaña **Actions**
3. Izquierda: **"Build Windows (.exe)"**
4. Botón **"Run workflow"** → **"Run workflow"** (verde)
5. Esperá el ✓ verde (~2–10 min)
6. Entrá al run terminado → abajo de todo, **Artifacts** → descargá **`Chidori-Windows`**
7. Descomprimí el `.zip` → adentro está el **`.exe`**

---

**Paso 5 · Publicar el Release**

1. En el repo → columna derecha → **Releases** → **"Draft a new release"**
2. **Choose a tag** → escribí **`v1.1.0`** → **"+ Create new tag: v1.1.0 on publish"**
   ⚠️ El tag lleva **`v`** adelante y debe coincidir con la versión del Paso 1.
3. **Release title**: `Chidori v1.1.0`
4. *(Opcional)* En la descripción, qué cambió.
5. Arrastrá los **dos archivos** a la zona de "Attach binaries":
   - `Chidori-1.1.0-universal.dmg` (de `release/`)
   - el `.exe` descomprimido (del Paso 4)
6. Esperá que suban (barra al 100%) → **"Publish release"**

---

**Paso 6 · Verificar**

Abrí tu app Chidori vieja (la 1.0.0). A los ~3 segundos tiene que aparecer:

> **Hay una versión nueva de Chidori (v1.1.0)** · [Descargar] [Más tarde]

Si aparece, ya lo están viendo todos. ✅

*(Si no aparece: revisá que el tag sea `v1.1.0` exacto, que el `package.json` diga
`1.1.0`, y que el repo sea público.)*

> **Importante:** el tag del Release y el `"version"` de `package.json` tienen que
> coincidir (`v1.1.0` ↔ `1.1.0`), y el **repo debe ser público** para que la app
> pueda consultar los releases.

---

## Versión

El nombre del archivo usa la versión de `package.json` (`"version"`), hoy en `1.0.0`.
