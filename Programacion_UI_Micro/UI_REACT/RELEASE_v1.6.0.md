# Chidori v1.6.0 · Trabajo sin internet + calidad de señal

Dos frentes: la interfaz deja de necesitar internet para armar la sesión, y el
firmware corrige el filtrado y la calibración del ADC.

---

## ⚠️ El firmware de esta versión NO está validado

Los cambios de firmware están escritos y revisados, pero **no se probaron con
hardware**. Antes de usarlos en mediciones que vayan a la tesis:

1. Flashear y verificar que arranca y transmite.
2. Comparar una medición contra una del firmware anterior, sobre la misma carga.
3. Confirmar que el valor de Z no se corrió (ver más abajo: el cambio de ADC
   puede desplazarlo, y sería un desplazamiento **correcto**).

La versión anterior queda en el historial de git si hay que volver atrás.

---

## 📶 Selección de paciente sin internet

**El problema.** El Chidori es un access point sin salida a internet. Mientras
estás enlazado al equipo no se puede leer Supabase, pero el protocolo exige
elegir el paciente antes de medir. El orden quedaba forzado —WiFi de casa,
elegir paciente, cambiar de red, medir— y si te olvidabas de un paso había que
rehacer el camino.

**Ahora** la última lista descargada queda en caché local. Se puede elegir
paciente estando ya enlazado al equipo, y también **crear uno nuevo**: se guarda
con un identificador temporal y sube solo cuando vuelve internet.

El selector avisa cuando está mostrando datos guardados y de qué momento son
("Lista guardada · hace 2 días"), y marca los pacientes que todavía no subieron.

Tres detalles que hacían falta para no romper el dataset:

- **La cola de sesiones corrige la referencia al paciente.** Una sesión medida
  offline puede apuntar a un paciente que todavía no existe en la base; primero
  se suben los pacientes y después se reemplaza la referencia. Si el paciente no
  pudo subir, la sesión espera en vez de guardarse sin atribuir.
- **Los códigos pendientes ocupan número.** Sin eso, dos altas offline seguidas
  reusaban el mismo código y chocaban al subir.
- **Una búsqueda filtrada no pisa el caché**, que si no guardaría un subconjunto
  y offline parecería que faltan pacientes.

La pantalla de inicio además explica el orden cuando detecta que estás enlazado
al equipo sin haber elegido paciente.

---

## 📡 Firmware · calidad de señal

**Mediana antes de la media.** El filtro era una media móvil de 10, que no
rechaza impulsos: un pico de +5 Ω se repartía y contaminaba las 10 salidas
siguientes con +0,5 Ω cada una. Sobre un rango útil de ~4,6 Ω (la caída de
1,5 dB) eso es un 11 % de error arrastrado durante casi dos segundos.

Ahora pasa por una mediana de 5 —que descarta el impulso entero— y recién
después por la media, ahora de 12, para el ruido gaussiano. El orden importa:
promediar primero ya habría mezclado el pico con sus vecinos.

**Calibración del ADC.** El firmware calculaba la tensión como
`analogRead() × 3,3 / 4095`, asumiendo un conversor lineal. El ADC del ESP32-C3
no lo es, y cada chip trae su curva de corrección de fábrica. Ahora se usa
`analogReadMilliVolts()`, que la aplica.

> Esto afecta a la tensión **y a la impedancia**. Es esperable que los valores
> de Z se corran respecto de los del firmware anterior: los nuevos son los
> correctos. Conviene volver a registrar el basal de referencia.

**Power save de WiFi desactivado.** No estaba en el firmware de access point.
Con el módem durmiendo entre beacons los paquetes salen en ráfagas, que es la
causa clásica de los microcortes que veníamos viendo.

**192 muestras por lectura** en vez de 128: √1,5 menos de ruido, a cambio de
~274 ms por lectura cruda. Para una señal de escala de minutos sobra.

---

## 🐛 Correcciones

**El gráfico rotulaba mal la tensión.** En el modo Tensión, el tooltip decía
`dZ/dt = 1.67 Ω/min` sobre un valor que estaba en volts. Había dos ramas —
impedancia y "todo lo demás"— y el modo tensión caía en la segunda.

---

## Sobre la tensión de lectura y el osciloscopio

Quedó documentado porque va a volver a aparecer: **el valor que reporta el
firmware no tiene por qué coincidir con el del osciloscopio o el tester.**

| Dónde se mide | Valor |
|---|---|
| Firmware (Vpp reconstruido) | 1,6613 V |
| Tester en AC (Vrms) | 0,587 V |
| Pin del ADC (continua real) | 0,631 V |
| En el cuerpo, antes de la ganancia ×200 | 8,31 mV |

Son tres efectos superpuestos: el nodo (salida de la cadena receptora, no el
electrodo), la convención (un tester lee valor eficaz, no pico a pico: factor
2,83) y que el ADC nunca ve una senoidal sino la continua del detector, a partir
de la cual se reconstruye el valor pico a pico.

---

## Advertencia de medición · lazo de masa

Con el microcontrolador conectado por USB a una notebook enchufada a la red, la
impedancia medida **no es la del tejido**: la masa del USB abre un camino
paralelo para la corriente de inyección. En una prueba se midió ~68 Ω conectado
contra ~28,85 Ω desconectado, un factor 2,4.

**Medir siempre a batería.** Si hace falta el puerto serie para depurar, al
menos con la notebook desenchufada del cargador.

---

## Instalación

**macOS** — descargar el `.dmg`, arrastrar a Aplicaciones. La primera vez:
click derecho → Abrir.

**Windows** — descargar el `.exe` y ejecutarlo. SmartScreen puede advertir:
Más información → Ejecutar de todas formas.

**Firmware** — abrir el sketch en Arduino IDE y flashear el ESP32-C3. Después de
flashear hay que **registrar el basal de nuevo**.
