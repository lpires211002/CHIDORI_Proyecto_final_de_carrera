# Chidori v1.9.1 · Pacientes sin cambiar de WiFi

---

## Lo nuevo: se elige el paciente estando en la red del Chidori

Hasta la 1.9.0, para asociar la sesión a un paciente había que estar en el
WiFi de siempre: elegir el paciente, recién ahí pasarse a la red **Chidori**
y enlazar el equipo. Si te olvidabas, había que rehacer el camino.

Ahora:

- **La lista de pacientes se descarga sola** al abrir la app con internet, y
  se refresca cada 10 minutos, al volver a la ventana y al volver internet.
  Queda guardada en la computadora junto con cuántas sesiones lleva cada uno.
- **En la red del Chidori el selector abre al instante** con lo guardado. La
  pantalla de inicio dice cuántos pacientes hay guardados y de cuándo es la
  lista.
- **El número de sesión** sale de lo guardado más las sesiones medidas sin
  internet que todavía esperan en la cola: dos sesiones seguidas offline ya no
  salen con el mismo número.
- **Nada se cuelga sin internet.** Toda consulta a la nube desde la pantalla
  corta a los 5 segundos y cae a lo guardado. Antes podía quedar en
  "Cargando…" mucho rato.
- **Crear un paciente sin internet** sigue funcionando: queda guardado en la
  computadora y sube solo al volver internet. Si el código ya existía en la
  nube, se usa ese paciente en vez de duplicarlo.

El aviso de "volvé a tu WiFi habitual" ahora aparece solo si esa computadora
nunca descargó la lista. **Hay que abrir la app con internet al menos una vez
en cada computadora.**

### No toca la medición ni el guardado

La descarga corre **solo en la pantalla de preparación**: desde que se toca
Iniciar hasta que se reinicia, la app no hace ninguna consulta nueva. El
guardado de la sesión (mediciones, eventos, calibración y la cola sin
internet) es el mismo de la 1.9.0.

---

## Calibración de la placa modificada (rev 5)

La placa a la que se le cambió R9 el 27/09 tiene **R9 = 1,2k**, no 1,1k
(código SMD `1201`). El 09/10 se midió completa:

| | |
|---|---|
| Corriente inyectada | **328 µA pp** (confirma los 322 µA; los "400 µA" eran una lectura en circuito) |
| K_CAL | **0,342** |
| Déficit del detector | **0,230 V** |

- **Firmware**: `#define R9_OHM 1200` (rev 5) o `2200` (rev 3, placas
  originales). Se quitó la opción `1100`: esa placa nunca existió.
- **Base** (`sql/calibracion.sql`, rev 5): las sesiones medidas con el firmware
  "1,1k" pasan solas a la calibración de la placa de 1,2k. P-004 sesión 9 queda
  con basal **7,55 Ω**.

---

## Antes de usar esta versión

1. Si todavía no lo corriste: **`sql/calibracion.sql`** (rev 5) en Supabase →
   SQL Editor, entero.
2. **Flashear la placa de R9 = 1,2k** con `R9_OHM 1200`, después del SQL. Por
   el monitor serie:
   ```
   K_CAL = 0.34200 A  ·  V_DETECTOR = 0.230 V
   Placa: R9 = 1200 ohm
   ```
   Las placas de 2,2k no se tocan.
3. En cada computadora, **abrir la app una vez con internet** para que baje la
   lista de pacientes.

---

## Instalación en Mac

La app está firmada **ad-hoc**, no notarizada. Arrastrala a Aplicaciones y
corré una sola vez:

```bash
xattr -cr /Applications/Chidori.app
codesign --force --deep --sign - /Applications/Chidori.app
```

Al abrirla por primera vez, macOS pregunta si Chidori puede **encontrar
dispositivos en la red local**: hay que darle **Permitir**, o la app no llega
al equipo. Si se negó, se activa en Ajustes del Sistema → Privacidad y
seguridad → Red local → Chidori, y después Cmd+Q y volver a abrir.
