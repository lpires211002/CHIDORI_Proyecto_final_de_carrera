# Chidori v1.9.0 · Interfaz nueva y calibración por placa

---

## Lo primero: hay dos placas con dos ganancias

El 27/09 se cambió **R9 de 2,2k a 1,1k** en una placa. La etapa U4D pasa de ×4,5
a ×9,1 y **toda la cadena gana el doble**. Si una placa se flashea con la
calibración de la otra, la impedancia sale al doble o a la mitad **sin ningún
aviso**.

El firmware ahora trae una línea para elegir la placa **antes de flashear**:

```c
#define R9_OHM  1100      // <-- 2200 o 1100, SEGÚN LA PLACA
```

| `R9_OHM` | Calibración | `K_CAL` | Rango |
|---|---|---|---|
| `2200` | rev 3 · medida en banco el 15/09 | 0,16675 | 2,03 a ~26 Ω |
| `1100` | rev 4 · rev 3 × 2, **derivada, no medida** | 0,33350 | 1,01 a ~13 Ω |

Cualquier otro valor no compila. El equipo reporta su `K_CAL` en cada STATUS,
así que la base etiqueta sola cada sesión con la calibración que corresponde.

Con 1,1k el techo baja a ~13 Ω: una lectura pegada ahí es **recorte**.

La rev 4 supone que R9 es lo único que cambió. Para confirmarlo en esa placa:
osciloscopio en **U4 pin 8 y pin 14**, la relación tiene que dar ~9 (con 2,2k
da ~4,4).

### La sesión que quedó en el medio

P-004 sesión 9 (27/09) se midió con R9 ya en 1,1k y el firmware todavía en 2,2k:
quedó **al doble** (basal 14,75 Ω que en realidad son 7,38 Ω).
`sql/calibracion.sql` la corrige. El resto de las sesiones no cambia.

El script ahora separa dos cosas que hasta ahora eran la misma:

- `calibration_id` · con qué constantes calculó el **firmware**;
- `calibration_hw_id` · con qué **placa** se midió.

Cada sesión queda en ohms de su placa. Si alguna vez se mide con una placa
modificada antes de reflashearla, esa sesión se agrega a la **LISTA** de la
sección 3b del script y se vuelve a correr.

### El PDF dice la verdad sobre la escala

El reporte del panel admin informa la constante de la escala en que **están**
los ohms, no la que usó el firmware, y avisa cuando difieren.

---

## Interfaz nueva

- **La placa en 3D** en la pantalla de inicio, exportada de KiCad. Gira despacio
  y se ilumina cuando el equipo está enlazado.
- **La luz de fondo acompaña toda la app.** Midiendo se atenúa y baja a 24 fps,
  pensado para sesiones de horas. En tema claro se dibuja como tinta.
- **Entrada al dashboard animada:** las tarjetas de la pantalla de inicio vuelan
  a su lugar.
- **Lecturas más limpias:** tres celdas del mismo ancho, sin sparklines. Las
  explicaciones pasan al tooltip del rótulo. El número grande sigue siendo la
  tendencia (mediana de 60 s); el crudo va en la línea de detalle.
- **Volumen estimado y Alarma** son celdas plegables: al tocarlas abren un panel
  al costado del gráfico, que se angosta para hacerle lugar.
- **Configuración y Eventos** pasan de pestañas a secciones plegables con un
  resumen de una línea, para que la preparación no compita con la señal.
- **La alarma suena.** Antes el navegador bloqueaba el audio porque se creaba
  sin un gesto del usuario; ahora se habilita al tocar Iniciar. Durante los 30 s
  de confirmación muestra la cuenta regresiva.
- **Tipografías embebidas** (Space Grotesk y JetBrains Mono, más Ω, ≈ y flechas):
  se ven igual en todas las máquinas y no necesitan internet.

---

## Antes de usar esta versión

1. **Correr `sql/calibracion.sql`** en Supabase → SQL Editor, entero. Tiene que
   decir `Placa modificada: 1 sesion(es) reasignadas`.
2. **Flashear la placa de 1,1k** con `R9_OHM 1100`. Hacerlo **después** del SQL:
   si no, la base no reconoce la calibración nueva y etiqueta mal la sesión.
3. Verificar por el monitor serie:
   ```
   K_CAL = 0.33350 A  ·  V_DETECTOR = 0.169 V
   Placa: R9 = 1100 ohm
   ```
4. Las placas con 2,2k **no hace falta tocarlas**. Si se reflashean con este
   código, antes cambiar la línea a `R9_OHM 2200`.

---

## Instalación en Mac

La app está firmada **ad-hoc**, no notarizada. En cualquier Mac que no sea la que
compiló, macOS la bloquea. Arrastrala a Aplicaciones y corré una sola vez:

```bash
xattr -cr /Applications/Chidori.app
codesign --force --deep --sign - /Applications/Chidori.app
```

O bien: intentar abrirla, y después **Ajustes del Sistema → Privacidad y
seguridad → Abrir de todas formas**.

---

## Exactitud

Sin cambios respecto de la 1.8.0: **±13 %** mientras la escala se derive de la
cadena de ganancias. La rev 4 hereda ese 13 % y suma sus supuestos. Lo que la
cierra de verdad es calibrar cada placa contra resistencias patrón.
