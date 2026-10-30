# Chidori v1.6.1 · Tensión medida en vez de reconstruida

Cambio chico y puntual, orientado a diagnóstico de hardware.

---

## La tensión de lectura ahora es un valor medido

Hasta acá, el panel **Tensión de lectura** mostraba la tensión pico a pico
*reconstruida* a la salida de la cadena receptora:

```
Vpp = (continua en A0 + 0,2 V) × 2
```

Ese número **no corresponde a ningún nodo del circuito**: es el resultado de
compensar la caída del Schottky y multiplicar por dos para volver de amplitud a
pico a pico. No se puede contrastar con el tester en ningún punto, y cuando la
cadena satura da valores imposibles para la placa (se llegaron a ver 8,25 V en
un circuito de 3,3 V).

Ahora se muestra la **continua medida en A0**, tal como la lee el conversor:
promediada y con la calibración de fábrica aplicada, pero sin reconstruir nada.
Ese valor sí se puede medir con el tester en el pin.

- El panel lo rotula **"continua medida en A0"**.
- El gráfico en modo Tensión grafica lo mismo.
- Con firmware anterior sigue mostrando la Vpp y lo aclara en el rótulo
  ("Vpp reconstruida"), así no se confunden dos magnitudes distintas.

**Protocolo del firmware.** Pasa de `"<Z> <Vpp>"` a `"<Z> <Vpp> <Vadc>"`. La
interfaz acepta las tres versiones (1, 2 o 3 campos), así que se puede
actualizar la app antes que el firmware sin romper nada.

> Para que el valor nuevo aparezca hay que **flashear el firmware**. Con el
> anterior la app sigue funcionando, mostrando la magnitud vieja.

---

## Cómo usarlo para diagnosticar

El ADC del ESP32-C3 con atenuación de 11 dB llega hasta ~3,1 V.

- Si `Vadc` queda **pegado cerca de 2,1 V sin moverse**, la cadena está saturada
  contra el riel y el valor de impedancia no representa nada.
- Si se mueve libremente, la cadena está en zona lineal.

Sirve además como referencia al recorrer la cadena con el osciloscopio: `Vadc`
es el final del recorrido. Si en `INAout` no hay señal de 50 kHz pero en `Vadc`
sí, el acople entra entre esos dos puntos.

---

## Otros

- `.gitignore`: se agregaron los archivos de bloqueo y respaldo de KiCad
  (`*.lck`, `*.kicad_prl`, `*-backups/`), que se generan al abrir el proyecto y
  no son parte del diseño.

---

## Instalación

**macOS** — descargar el `.dmg`, arrastrar a Aplicaciones. La primera vez:
click derecho → Abrir.

**Windows** — descargar el `.exe`. SmartScreen puede advertir:
Más información → Ejecutar de todas formas.

**Firmware** — abrir el sketch en Arduino IDE y flashear. Recordá que el
firmware de la 1.6.0 en adelante cambia la calibración del ADC: después de
flashear hay que **registrar el basal de nuevo**.
