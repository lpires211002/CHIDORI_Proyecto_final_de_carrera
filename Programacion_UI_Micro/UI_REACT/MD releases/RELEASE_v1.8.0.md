# Chidori v1.8.0 · Los ohms ahora significan algo

---

## Lo primero, porque cambia todo lo demás

**Los números de esta versión NO son comparables con los de la 1.7.0.** Un reporte
viejo y uno nuevo del mismo paciente van a mostrar impedancias muy distintas sin
que haya cambiado nada en el paciente.

El firmware calculaba `Z = Vpp / (I · G)` con una corriente y una ganancia que
**nunca fueron medidas**: salían de multiplicar ganancias de diseño. Los valores
reales, medidos en banco, son otros.

| | 1.7.0 (diseño) | 1.8.0 (medido) |
|---|---|---|
| Corriente inyectada | 288 µA pp | **322 µA pp** |
| Ganancia del receptor | 200 | **517,9** |
| Déficit del detector | 0,200 V | **0,169 V** |
| `K_CAL = I · G` | 0,05760 | **0,16675** |

**Para convertir cualquier reporte de la 1.7.0 o anterior:**

```
Z_nueva = 0,3454 · Z_vieja − 0,3718        (valores absolutos)
ΔZ_nueva = 0,3454 · ΔZ_vieja                (diferencias: sin el offset)
```

El offset se cancela en cualquier resta. Aplicárselo a un delta mete un sesgo
de −0,37 Ω.

Las sesiones guardadas en la nube **ya fueron convertidas** (ver
`sql/calibracion.sql`). Lo que queda en la escala vieja son los PDF que hayas
exportado antes de esta versión.

---

## Qué estaba mal, en concreto

`GANANCIA_RECEPTOR = 10 × 4 × 5 = 200` contaba tres etapas de una cadena que
tiene seis. Faltaban U4A, U4C y U4D por completo. Y el `4` de U4B era la
relación resistiva 2k/500, válida en continua: a 50 kHz la reactancia del
capacitor de acoplamiento domina y esa etapa no gana 4.

El único término que estaba bien era el ×5 del INA122, que con Rg abierto lo da
por fórmula.

La corriente, además, se calculaba en vez de medirse.

---

## El equipo ahora dice con qué midió

Hasta la 1.7.0, la app no tenía forma de saber qué constantes usó el ESP. Si se
flasheaba un firmware viejo por error, la sesión quedaba guardada con la escala
equivocada y **nadie se enteraba**.

Ahora el mensaje `STATUS` del firmware lleva `kcal` y `vdet`. La app los recibe,
los muestra en el panel de diagnóstico y los guarda con la sesión. La base
compara ese `K_CAL` contra el catálogo de calibraciones y etiqueta la sesión por
**lo que realmente la midió**, no por un valor por defecto.

Si el firmware es viejo y no los reporta, la sesión queda marcada
`calibration_matched = false`: la etiqueta es una suposición y se ve que lo es.

---

## El reporte PDF dice la calibración

Nuevo bloque **Calibración** con `K_CAL`, `V_det`, la fórmula y la exactitud
estimada. Sin esto, dos reportes con escalas distintas se ven idénticos.

---

## Se guarda la tensión cruda

`measurements.voltage_v` guarda la continua medida en A0, que es el dato físico.
Hasta ahora se guardaba solo la impedancia, que es un valor **derivado** de
constantes que ya cambiaron dos veces.

Con el crudo, la próxima recalibración es una re-derivación exacta en vez de una
migración con pérdida.

---

## Exactitud: ±13 %

La etapa U5B son dos resistencias sin capacitores: su ganancia **es 10 por
construcción**. Medida da 11,29, o sea +12,9 %. Ese es el error real de leer
14 mVpp con el osciloscopio, y se propaga entero a `K_CAL`.

**Una medición de 8,7 Ω es 8,7 ± 1,1 Ω.** Así hay que reportarla.

Baja a ~1 % cuando se calibre contra resistencias patrón, que además da el
residuo del ajuste — la cifra de exactitud que el instrumento todavía no tiene.

---

## Antes de usar esta versión

1. **Correr `sql/calibracion.sql`** en Supabase. Sin eso, las columnas nuevas no
   existen y la app guarda las sesiones sin la calibración (funciona, pero
   pierde la trazabilidad).
2. **Flashear el firmware.** Si medís con el firmware viejo y la app nueva, la
   sesión entra con la escala vieja. Queda marcada, pero es más fácil no pisarlo.
3. Verificar por el monitor serial que arranque diciendo:
   ```
   K_CAL = 0.16675 A  ·  V_DETECTOR = 0.169 V
   Z = 2*(Vadc + V_DETECTOR) / K_CAL   [banco 2026-09-15 rev3]
   ```

---

## Instalación en Mac

La app está firmada **ad-hoc**, no notarizada. En cualquier Mac que no sea la que
compiló, macOS la bloquea. Desde Sequoia el clic derecho → Abrir ya no alcanza.

Arrastrala a Aplicaciones y corré una sola vez:

```bash
xattr -cr /Applications/Chidori.app
codesign --force --deep --sign - /Applications/Chidori.app
```

O bien: intentar abrirla, y después **Ajustes del Sistema → Privacidad y
seguridad → Abrir de todas formas**.

Si la pasás por pendrive en vez de descargarla, no se le pone la marca de
cuarentena y abre sin trámite.

---

## Rango del instrumento

| | |
|---|---|
| Z mínima (`Vadc = 0`) | **2,03 Ω** |
| Z máxima antes de que recorte el TL084 | **~26 Ω** |
| Resolución (1 LSB) | 9,6 mΩ |

Una lectura pegada al techo es **recorte**, no tejido de alta impedancia. Una
pegada al piso es señal nula: electrodos sueltos, jumper J5 o inyección apagada.

---

## Además

El ajuste de filtros de esta revisión **centró la banda de paso**. El pico pasó
de 85 kHz a 40 kHz y el −3 dB va de 22 a 74 kHz, así que los 50 kHz caen en zona
plana: ante ±10 % de frecuencia la ganancia se mueve 8,2 % contra 13,2 % antes.
El instrumento quedó más robusto ante tolerancias y deriva térmica.
