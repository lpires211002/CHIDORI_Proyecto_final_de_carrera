# Chidori v1.5.0 · Protocolo experimental

Esta versión adapta la interfaz al protocolo acordado con el tutor: 4-6 sesiones
por persona, ficha de paciente, variables configurables desde el panel, e
hidratación libre registrada como eventos. Además corrige un problema de pérdida
de datos que afectaba a todas las sesiones largas.

---

## ⚠️ Antes de instalar

**1. Hay que correr el SQL.** Esta versión no funciona sin las tablas nuevas.
En el editor SQL de Supabase, ejecutar:

```
UI_REACT/sql/pacientes_y_campos.sql
```

Crea `patients` y `field_definitions`, agrega `patient_id`, `session_number` y
`session_data` a `sessions`, y `kind` / `amount_ml` a `session_events`.
Es idempotente: se puede correr más de una vez sin romper nada.

**2. Si compilás vos, corré `npm install` primero.** Se agregó la dependencia
`ogl`; sin instalarla el build falla.

---

## 🐛 Corrección importante · sesiones largas truncadas

**Las sesiones de más de 1000 muestras se veían y se exportaban incompletas.**

PostgREST corta en 1000 filas por request y `.limit()` no sube ese tope: es una
restricción del servidor, no del cliente. Una medición de 70 minutos a 4 Hz son
~17.000 muestras, así que se estaba leyendo el 6 % de la sesión.

Afectaba a la vista del panel de administración **y a los exports CSV y TXT**,
sin ningún aviso.

Ahora las lecturas se paginan de a 1000 hasta agotar la tabla, con orden total
(`elapsed_time` + `id`) para que paginar no repita ni saltee filas.

> **Si ya exportaste datos de sesiones largas, conviene rehacer esos archivos.**

---

## 🐛 Corrección · la app crasheaba al reabrirla (macOS)

`A JavaScript error occurred in the main process · TypeError: Object has been destroyed`

En macOS, cerrar la ventana con el botón rojo no cierra la aplicación: el proceso
sigue vivo. La referencia a la ventana quedaba apuntando a un objeto ya destruido
—el wrapper de JavaScript sigue existiendo, así que la comprobación de "existe"
daba verdadero— y cualquier llamada sobre él tiraba la excepción.

Se disparaba al volver a abrir la app con la ventana cerrada, o al abrirla dos
veces. Ahora todo acceso a la ventana verifica que siga viva, y si no queda
ninguna se abre una nueva.

Se corrigieron además dos casos de la misma familia que todavía no habían
aparecido: el aviso de actualización (que corre 3 s después del arranque y podía
encontrar la ventana ya cerrada) y el bloqueo de instancia única (el proceso que
perdía el bloqueo seguía ejecutándose y alcanzaba a abrir su propia ventana).

---

## 🧪 Protocolo experimental

**Ficha de paciente.** La sesión se asocia a un paciente *antes* de empezar a
medir. Cada paciente tiene código único (`P-001`), nombre y apellido, y las
sesiones se numeran solas: `P-001 · sesión 3`.

**Campos configurables.** Nueva pestaña **Campos que se miden** en el panel de
administración. Se definen las variables de la ficha (estables: sexo, altura) y
las de cada sesión (peso, temperatura, humedad, comidas de las últimas 24 h) sin
tocar código ni migrar la base. Los valores viajan en JSONB.

**Eventos tipados.** Además de las marcas manuales:

| Evento | Tecla | Registra |
|---|---|---|
| Marca | `E` | punto de interés |
| Ingesta de agua | `A` | volumen en ml |
| Micción | `M` | el volumen se puede cargar después |

El agua total se calcula sumando las ingestas marcadas; no se carga a mano.

**Datos de sesión al cerrar.** Temperatura, humedad y comidas se completan al
exportar, no al empezar: recién ahí se conocen.

---

## 📈 Volumen estimado · escala en dB

El llenado ahora se calcula desde la hipótesis de trabajo, no desde el umbral de
alarma configurado a mano:

```
caída_dB = −20 · log10(Z / Z_basal)
llenado  = caída_dB / 1,5
```

El 100 % es la caída de **1,5 dB** respecto del basal — el punto en que, según la
hipótesis, aparecen las ganas. El llenado es lineal en dB, no en ohmios.

Se usa `20·log10` porque la impedancia es una magnitud de amplitud: 1,5 dB son
15,9 % de caída. Con la convención de potencia (`10·log10`) serían 29,2 %; si el
criterio del ensayo fuera ese, se cambia la constante `DB_FACTOR`.

**Sin basal no hay estimación**: el panel lo dice, en vez de mostrar un 0 % que se
leería como vejiga vacía. El panel también muestra la caída en dB y la impedancia
del umbral, para poder contrastarlas con lo que refiere el paciente.

> Antes la escala salía del umbral de alarma: si ese umbral quedaba cerca del
> basal, la barra saltaba a 100 % apenas arrancaba la medición.

---

## 📊 Panel de administración

**Gráfico de sesiones archivadas.** Al abrir una medición vieja se plotea su
curva con los marcadores de eventos: `A` ingesta, `M` micción, `!` desconexión,
número para las marcas manuales, y banda roja translúcida para los microcortes
(el ancho es la duración real del corte).

Con menos de ~2.500 muestras dibuja cada punto. Con más, simplifica a ~1.500 con
LTTB —conserva picos y valles— y ofrece el botón **Dibujar todos los puntos**. La
tabla y los exports siempre usan las muestras completas.

**Tabla virtualizada.** Están todas las filas disponibles, pero solo se montan las
visibles. Con 57.600 muestras (4 h) el DOM se mantiene en ~35 nodos en vez de
congelar el navegador. Va plegada por defecto.

**Edición dinámica.** El formulario de edición sale del mismo catálogo de campos
que la toma de datos. Antes estaba hardcodeado con los campos viejos y no dejaba
ver ni corregir las notas ni los datos de sesión.

**Exports arreglados.** El PDF y el TXT del panel armaban el paciente con el
formato viejo: salía "Código: N/A" y sin campos.

---

## 📄 Reportes PDF

- **Se incrusta el gráfico de la sesión**, re-rendido en paleta clara sobre fondo
  blanco. El canvas de pantalla es transparente y de tema oscuro: pegado tal cual
  en una hoja quedaba ilegible.
- **La Ω ya no sale como ©.** jsPDF usa las 14 fuentes estándar, que codifican en
  WinAnsi y no tienen caracteres griegos. Se translitera a `ohm`.

---

## 🎨 Interfaz

**Pantalla de inicio nueva.** Los dos requisitos para medir —enlace con el
dispositivo y paciente— como filas de estado en vivo, con el arranque debajo.
Antes la conexión se anunciaba tres veces y el paciente no se mencionaba: te
enterabas de que faltaba recién al apretar Iniciar.

- Fondo con columna de luz (LightPillar), a sangre y fuera del eje de lectura.
- Botón de arranque con reflejo especular que responde al cursor.
- El logo **Chidori** vuelve al inicio; si hay una medición en curso, pregunta
  antes y avisa si todavía no se guardó nada en la nube.
- Menú **⋯** a pantalla completa sobre el margen derecho, con el fondo difuminado.
- Sin líneas divisorias en header y footer.

---

## Instalación

**macOS** — descargar el `.dmg`, arrastrar a Aplicaciones. La primera vez:
click derecho → Abrir (la app está firmada ad-hoc, no con certificado de Apple).

**Windows** — descargar el `.exe` y ejecutarlo. SmartScreen puede advertir:
Más información → Ejecutar de todas formas.

No hace falta Node.js ni terminal: el ejecutable trae todo.
