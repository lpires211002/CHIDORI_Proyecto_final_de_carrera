# Chidori · Product Context

> Bioimpedancia vesical en tiempo real. Diseñado como **instrumento clínico**,
> no como tablero SaaS.

## Register

`product` · La interfaz **sirve al uso médico**. El diseño nunca es el producto.

## Users

### Clínico
Médico, enfermera o investigador que registra una sesión con un paciente. Trabaja bajo
presión de tiempo, lee de lejos, atiende otras tareas en paralelo. Necesita confianza
en lo que el instrumento dice y certeza de que la sesión queda registrada.

### Paciente operador (uso domiciliario)
Persona con disfunción vesical que se mide a sí misma en su casa. Tiene baja
tolerancia al ruido visual y a la ansiedad. Necesita instrucciones claras, un solo
camino correcto, y un alarma que no se le escape.

### Cuidador
Familiar o asistente que acompaña al paciente. Lee la pantalla a 1.5 m de distancia.
No es operador del software, es testigo del estado.

## Product Purpose

Detectar el llenado vesical mediante caídas de impedancia (medidas por electrodos a
50 kHz vía un microcontrolador ESP32-C3) y alertar antes de que sea molesto u
ofensivo para el paciente, con datos exportables para análisis clínico.

El producto **no diagnostica**. Asiste al monitoreo. Toda decisión clínica final es
humana.

## Tone

**Editorial · científico · premium clinical.**

- Como un instrumento de medición serio en formato digital
- Tipografía editorial (Fraunces serif + IBM Plex Sans/Mono)
- Color como estado, jamás como decoración
- Sin entusiasmo de SaaS, sin emoji-shouting, sin gradient text
- Calmo bajo presión: la alarma es persistente y clara, pero no histérica

## Anti-references

Cosas que el producto **NO** debe parecer:

- Tablero de observabilidad oscuro azul (Datadog, Grafana)
- Healthcare app con teal + white (Headspace, Calm, generic health AI)
- Cripto / fintech con neón sobre negro
- Marketing de startup con gradientes orange→cyan, ripples, glassmorphism
- Apps tipo Apple Health (demasiado consumer)
- Dashboards "smart" con caricaturas animadas (la vejiga caricaturizada compite con el dato real)

## Strategic principles

1. **El chart es el instrumento.** Todo lo demás es soporte. La curva de impedancia
   es la lectura primaria; la visualización de vejiga es secundaria y deterministic.
2. **El alarma es un momento, no un toast.** El evento más importante (umbral
   alcanzado) recibe banner persistente, tono repetitivo, flash de título, y exige
   reconocimiento explícito.
3. **Sincronización a la nube es visible.** Nada se "guarda en silencio". Cada
   escritura a Supabase tiene un badge de estado en el header con tiempo desde
   último éxito y retry visible si falla.
4. **Color encoda estado, nunca categoría.** Hay UN signal color (indigo) y UN
   alarm color (rust). El resto son neutrales tintados.
5. **Tipografía carga el significado.** Fraunces (serif) en números prominentes
   genera autoridad editorial; IBM Plex Mono en datos tabulares genera lectura
   instrumental.
6. **El paciente no necesita ver la configuración técnica.** WebSocket y Supabase
   credentials viven en un drawer escondido.
7. **Calma bajo presión.** Motion mínimo, sin bounces, sin ripples, sin pulse en
   cifras vitales. Solo el alarma se mueve, porque es la única cosa que debe
   capturar la atención.

## Constraints

- Funciona offline si no hay Supabase configurado (no requiere cuenta)
- Funciona offline si no hay WebSocket (simulador integrado para entrenamiento)
- Soporta light y dark mode (paciente domiciliario puede usar light de día,
  clínico en quirófano oscuro usa dark)
- Soporta accesibilidad básica: contraste AA, focus visible, aria-labels en
  pills y badges, no depende exclusivamente de color
- No depende de fuentes propietarias ($$$); usa Fraunces + IBM Plex (Google Fonts)
- No usa servicios de tracking ni analytics. Es un instrumento médico.

## Brand

- Nombre: **Chidori** (千鳥)
- Marca tipográfica: nombre en Fraunces 500, con un punto signal indigo a su izquierda
- Sin logo emoji, sin lightning bolt, sin gradient
- Voz: tercera persona, formal pero accesible. "Solicite al paciente que…",
  "La alarma dispara cuando…"
