# Chidori v1.7.0 · Los números dejan de moverse con el paciente

---

## El problema, medido

Sobre la sesión real del 20 de agosto (P-004, 17.304 muestras, 84 minutos) se
midieron las tres escalas que conviven en la señal:

| | Magnitud |
|---|---|
| Ruido de fondo, con el paciente quieto | **0,010 Ω** |
| Señal fisiológica de llenado | **1,28 Ω/hora** (0,021 Ω/min) |
| Artefactos de movimiento | hasta **4,33 Ω**, de 5 a 25 segundos |

El instrumento es limpio: la señal está unas 170 veces por encima del piso de
ruido. Lo que ensuciaba la lectura eran los **artefactos de movimiento** — un
solo movimiento del paciente produce una excursión de hasta 2,4 veces toda la
señal de la sesión. Eso no es un defecto del circuito: le pasa a toda la
bioimpedancia, y es la razón por la que los protocolos exigen quietud.

Pero los artefactos duran **segundos** y la señal evoluciona en **decenas de
minutos**. Son separables por escala temporal, y de eso se trata esta versión.

---

## 📊 La lectura principal ahora es una tendencia

El número grande del readout pasó a ser la **mediana móvil de 60 segundos**.
Rechaza cualquier excursión de menos de 30 segundos y distorsiona la señal real
en 0,02 Ω — lo que el llenado cambia en un minuto.

La lectura cruda no se esconde: va abajo, en chico, junto con un chip
**movimiento** que se enciende cuando el desvío respecto de la tendencia no lo
explica el ruido. Así se entiende por qué el número grande no salta cuando el
paciente se acomoda.

La vejiga en pantalla también se alimenta de la tendencia.

---

## 🎯 Basal, Z final y tasa

Las tres magnitudes que la app reporta y guarda se calculaban sobre muestras
sueltas, a merced de que el paciente se hubiera movido justo en ese instante.

| | Antes | Ahora |
|---|---|---|
| **Basal** | mediana de las 5 primeras muestras (1,4 s) | mediana del **primer minuto** |
| **Z final** | la última muestra individual | mediana del **último minuto** |
| **Tasa** | pendiente sobre los últimos 10 puntos (2,7 s) | dos medianas de 30 s separadas **5 minutos** |

El caso de la tasa era el más grave. Con un ruido de 0,010 Ω, medir una
pendiente sobre 2,7 segundos daba ruido amplificado, no una tasa: sobre la
sesión del 20 de agosto los valores iban de **−576 a +5808 Ω/min**. Con la
ventana nueva quedan entre −0,30 y +0,40, con mediana −0,023 Ω/min contra el
valor real de −0,021.

Mientras la sesión es demasiado corta para una pendiente honesta (los primeros
~3 minutos) la tasa muestra **—** en vez de inventar un número. Y pasó a
mostrarse con 3 decimales: con 2 se leía siempre 0,00 y no se distinguía nada.

**Fijar el basal a mano** también usa ahora la ventana de 60 segundos, y cierra
la calibración automática para que el basal progresivo del primer minuto no
pise el valor recién elegido.

---

## 🔔 La alarma dejó de dispararse por un movimiento

Se evaluaba contra la muestra instantánea. Ahora se evalúa contra la
**tendencia** y exige que el umbral **se sostenga 30 segundos**.

Sobre la sesión del 20 de agosto, con el umbral en −5 % del basal: la versión
anterior habría disparado a los **138 segundos**, por el primer movimiento del
paciente — 18 minutos antes de que la señal se acercara de verdad al umbral. La
nueva dispara a los 1210 segundos, cuando la tendencia cruza.

El margen que se muestra en pantalla sale del mismo valor que evalúa la alarma,
así que lo que se lee es lo que decide.

---

## ⏱️ El tiempo lo pone el equipo, no el navegador

El firmware ahora manda, con cada muestra, **su propio reloj** y un **número de
secuencia**. El mensaje pasó a ser `<Z> <Vpp> <Vadc> <t_ms> <seq>`.

Hasta acá la app le ponía a cada muestra la hora en que **llegaba**. Con el WiFi
tartamudeando, los datos se acumulan y llegan en ráfaga, y la curva quedaba
dibujada con huecos y apelotonamientos que nunca existieron en la medición.

Lo que cambia:

- **Cada punto queda en el instante en que se midió.** El jitter entre muestras
  del eje de tiempo pasa de 0,225 s a 0.
- **Los microcortes se cuentan por salto de secuencia**, que es la cuenta
  exacta de muestras que el equipo midió y la computadora no recibió. Antes se
  estimaban multiplicando la duración del hueco por una frecuencia supuesta de
  4 Hz, lo que contaba como perdido todo lo que solo venía demorado. Sobre la
  sesión del 20 de agosto: de 288 eventos a 7.
- **La duración es tiempo de datos.** Esa sesión informaba 508:58 con 84
  minutos de datos: el cronómetro siguió corriendo siete horas después de la
  última muestra, y ese número era el que quedaba guardado como duración de la
  medición. Ahora, si el equipo deja de mandar, el cronómetro se queda quieto
  —que es la verdad— y el aviso de señal congelada explica por qué.
- **Integridad del enlace**, en la pestaña Eventos: qué porcentaje de las
  muestras que el equipo midió llegaron efectivamente. Cada microcorte de la
  línea de tiempo dice cuántas muestras se perdieron.

---

## 🧹 Firmware · limpieza y diagnóstico

Se eliminó el resto del código muerto de la etapa STA/WiFiManager. Sin cambio
funcional.

El diagnóstico agregado en la 1.6.2 (motivo del último reinicio, RSSI real de la
estación, uptime, log de asociación y caída al AP) ya dio su primer resultado:
las desconexiones de las mediciones largas **no eran del equipo**. La curva de
impedancia es continua a través de todos los huecos, sin reinicios. El patrón
—corte de 1 a 2 segundos cada ~6 segundos, parejo durante toda la sesión— es de
la computadora que recibe.

---

## 🔌 Compatibilidad

Firmware y app se pueden actualizar **en cualquier orden**:

- Firmware nuevo con app vieja: la app ignora los campos que no conoce.
- Firmware viejo con app nueva: la app vuelve sola al reloj del navegador y a la
  estimación del hueco.

---

## Lo que no cambia

**El dato crudo queda intacto.** La curva que se grafica, el CSV que se exporta
y lo que se guarda en la base siguen siendo las muestras tal como las manda el
equipo, una por una. Todo lo de esta versión es capa de lectura y de reporte.

---

## ⚠️ Comparabilidad entre versiones

Las sesiones medidas con 1.6.2 o anterior tienen el basal, la Z final y la tasa
calculados con el criterio viejo. **No son directamente comparables** con las que
se midan desde ahora. Los datos crudos sí lo son: son los mismos.

---

## Recordatorios que siguen vigentes

**Después de flashear, registrá el basal de nuevo.** Desde la 1.6.0 el firmware
usa la calibración de fábrica del ADC, así que los valores de impedancia no son
directamente comparables con los de versiones anteriores.

**Medí a batería.** Con el microcontrolador conectado por USB a una notebook
enchufada a la red se arma un lazo de masa que altera la impedancia medida (se
observó ~68 Ω conectado contra ~28,85 Ω desconectado).

---

## 📶 Nuevo · preparar la computadora antes de medir

El tartamudeo del enlace es de la máquina que recibe, no del equipo. En la
laptop con Windows, antes de una sesión:

1. En una consola **como administrador**:
   `netsh wlan set autoconfig enabled=no interface="Wi-Fi"`
   Esto frena el escaneo periódico de redes, que es la causa principal.
   **Al terminar la sesión, revertir** con `enabled=yes`, si no la máquina no se
   vuelve a conectar sola a ninguna red.
2. Administrador de dispositivos → adaptador Wi-Fi → Administración de energía →
   destildar "permitir que el equipo apague este dispositivo".
3. Opciones de energía → Configuración del adaptador inalámbrico → **Máximo
   rendimiento**.
4. Laptop enchufada, y "conectar automáticamente" apagado en las otras redes
   guardadas.

Se puede verificar en dos minutos, sin medir a nadie: conectarse a la red
Chidori y dejar corriendo `ping -t 192.168.4.1`. Si los picos cada ~6 segundos
desaparecen después del paso 1, está resuelto.

---

## Instalación

**macOS** — descargar el `.dmg`, arrastrar a Aplicaciones. La primera vez:
click derecho → Abrir.

**Windows** — descargar el `.exe`. SmartScreen puede advertir:
Más información → Ejecutar de todas formas.

**Firmware** — abrir el sketch en Arduino IDE y flashear el ESP32-C3.
