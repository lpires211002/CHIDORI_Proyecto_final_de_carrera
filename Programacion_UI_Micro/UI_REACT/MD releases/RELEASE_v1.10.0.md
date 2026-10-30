# Chidori v1.10.0 · Edición de sesiones guardadas

---

## Lo nuevo: editar la curva de una sesión ya guardada

En el panel de administración, en el detalle de cada sesión, hay un botón
**Editar curva**. La edición **no toca la medición original**: se guarda
aparte, pasa a ser la versión principal de la sesión y se puede deshacer con
**Volver al original**.

Mientras se edita, la curva original queda en gris detrás y la editada encima.
Todo se marca arrastrando sobre el gráfico (un click solo toma ±15 s) o
escribiendo los tiempos en mm:ss:

- **Recortar inicio y fin.** Si se corta el inicio, el tiempo 0 pasa al nuevo
  comienzo.
- **Sacar tramos del medio.** El hueco se rellena con una curva suave y
  monótona (PCHIP) sobre Z y Vadc, apoyada en la mediana de 5 s de cada lado.
  Los puntos rellenados cuentan en los cálculos y quedan marcados como
  interpolados. Avisa si un tramo pasa de 5 min.
- **Suavizar.** Media o mediana móvil centrada de n muestras (muestra a
  cuántos segundos equivale), sobre Z y Vadc.
- **Basal y final a mano.** Si no se marcan, valen las reglas de siempre sobre
  la curva editada (mediana del primer y del último minuto).
- **Eventos.** Agregar, mover, borrar y corregir ml. Fuera del recorte se
  conservan las ingestas y micciones; las marcas y los cortes se descartan.
- **Comentarios** anclados a un instante o a un tramo (C1, C2… en el gráfico).
  El comentario general sigue siendo "Notas de la sesión".

## Apta / no apta

Cada sesión se puede marcar **no apta** para el análisis, con un texto libre
opcional. Por defecto todas son aptas. No depende de la edición: vale también
para sesiones sin editar y se mantiene si se vuelve al original.

## Descargas

Si la sesión tiene edición, PDF, CSV y TXT preguntan qué versión bajar. La
editada dice qué se le hizo, marca los puntos interpolados (columna
`interpolado`) y trae los comentarios.

## Análisis (Analisis_EDA)

`extraer.py` baja las ediciones y `etiquetar.py` analiza la versión editada.
El apta / no apta de la app manda sobre `etiquetas_manuales.csv`; las
exclusiones automáticas siguen aplicando.

---

## Antes de usar esta versión

1. **`sql/edicion_sesiones.sql`** en Supabase → SQL Editor, una sola vez por
   base. Sin eso, el botón "Editar curva" queda deshabilitado con el aviso.
2. Por ahora el editor está solo en el **panel de administración**.

`sql/calibracion.sql` tiene un paso nuevo (4.d) que reescala las ediciones
cuando cambia una calibración. No hace falta volver a correrlo ahora.

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
