# Cómo medir con Chidori — guía rápida

> **TL;DR:** ESP cerca del router → enchufar → `npm run dev` → abrir `localhost:5173` → Reconectar.
> Si el serial dice **`clientesWS=1`**, estás conectado y midiendo.

---

## 1. La regla de oro: la señal WiFi

El **90% de los problemas de conexión son señal floja**. El ESP32-C3 Super Mini tiene una antena mala de fábrica.

| RSSI (lo ves en el serial) | Estado |
|---|---|
| **-30 a -55 dBm** | Excelente, estable |
| **-55 a -65 dBm** | Aceptable |
| **peor que -70 dBm** | Inestable, se cae (esto fue lo que te costó 2 días) |

👉 **Tené el ESP en el mismo ambiente que el router, a menos de 2-3 m.** Si tenés que medir lejos del router, usá un **alargue USB** para acercar el ESP al router (no al revés).

---

## 2. Los dos caminos de datos (entender esto evita casi toda la confusión)

- **Serial** (cable USB → Arduino IDE): el ESP imprime `Z = ...` **siempre** que mide, lo dispares con el botón físico o con la app. **No depende del WiFi.** Que el serial muestre números **NO** significa que la app esté conectada.
- **App web** (WiFi → WebSocket): la app recibe los datos por WiFi. Para esto la IP tiene que estar bien y la señal tiene que aguantar.
- **El indicador que manda** para saber si la app está realmente conectada es **`clientesWS`** en el serial:
  - `clientesWS=1` → la app está enganchada ✅
  - `clientesWS=0` → la app NO está recibiendo nada ❌

---

## 3. Setup (ya está hecho — una sola vez)

- Firmware con **IP fija `192.168.0.200`** → no cambia más entre reinicios.
- App configurada a `192.168.0.200 : 81`.
- No tenés que volver a tocar esto salvo que cambies de router/red.

---

## 4. Procedimiento para medir (cada vez)

1. **Enchufá el ESP** por USB. Esperá ~15-20 s a que arranque.
2. *(Recomendado)* Abrí el **Serial Monitor** (Arduino IDE, **115200 baud**) y confirmá:
   - `wifi=OK` con RSSI mejor que **-65 dBm**
   - `ip=192.168.0.200`
3. Confirmá que tu **Mac esté en la misma red WiFi** (la de tu casa, `192.168.0.x`) — no en la del celular ni en otra.
4. Levantá la app **en local** (NO la de Vercel — HTTPS bloquea `ws://`):
   ```bash
   cd "Programacion_UI_Micro /UI_REACT"
   npm run dev
   ```
   Abrí **http://localhost:5173**
5. Si la app dice **DESCONECTADO**, abrí Configuración → **Reconectar**.
6. Confirmá la conexión: el serial pasa a **`clientesWS=1`**.
7. Calibrá (vejiga vacía) e **Iniciá adquisición**.

---

## 5. Si no conecta — checklist de 30 segundos

Hacé estos chequeos **en orden**:

1. **Señal** → ¿el serial muestra RSSI peor que -70 o `wifi=CAIDO`? Acercá el ESP al router.
2. **IP** → ¿qué dice `ip=` en el serial? Tiene que ser **igual** a la DIRECCIÓN de la app (`192.168.0.200`).
3. **Misma red** → `ipconfig getifaddr en0` tiene que dar `192.168.0.x`.
4. **Puerto alcanzable** → `nc -vz 192.168.0.200 81` tiene que decir `succeeded!`.
5. **Navegador trabado** → hard reload con `Cmd + Shift + R` y Reconectar.

---

## 6. Comandos útiles (Terminal de la Mac)

```bash
# ¿En qué red está la Mac?
ipconfig getifaddr en0

# Encontrar la IP real del ESP (por si dudás de la .200)
arp -a | grep -i 38:1a:52

# ¿El WebSocket está abierto y alcanzable?
nc -vz 192.168.0.200 81

# Levantar la app
cd "Programacion_UI_Micro /UI_REACT" && npm run dev
```

---

## 7. Plan B: modo AP (si algún día no hay router confiable)

Si tenés que demostrar en un lado donde el WiFi es malo o desconocido (ej: un aula de la facu), lo más robusto es pasar el ESP a **modo AP**: crea su **propia** red WiFi, la Mac se conecta directo a él y la IP es siempre `192.168.4.1`. Inmune a la señal del router y a las IPs que cambian. Es una modificación de firmware — pedímela y te la armo.

---

## 8. Sesiones largas (4 h continuas) — checklist

Para que una medición de horas **no se corte**:

**El equipo (ya resuelto en firmware):**
- El botón físico ahora exige **mantenerlo apretado 1.5 s** para frenar (suena un *beep* de confirmación). Un roce, vibración o glitch eléctrico ya **no** puede cortar la sesión. Arrancar sigue siendo un toque corto.
- La medición **sigue corriendo aunque el WiFi parpadee**; el watchdog reconecta solo. El reinicio preventivo NUNCA ocurre mientras estás midiendo.

**La Mac (el riesgo más grande en sesiones largas):**
- **Que la Mac NO se duerma.** Abrí una Terminal y dejá corriendo toda la sesión:
  ```bash
  caffeinate -dimsu
  ```
  Si la Mac duerme, perdés el stream en vivo.
- Mac **enchufada a la corriente**.
- Dejá **abierta** la terminal del `npm run dev` y la **pestaña del navegador** (el front respalda la sesión a `localStorage` cada 30 s → un F5 accidental se recupera).
- Mantené la pestaña **visible** (Chrome ralentiza las pestañas en segundo plano).

**Alimentación del ESP:**
- Alimentalo desde una fuente estable (mejor cargador de pared o hub con alimentación, no un cable dudoso). Un brown-out lo reinicia.

**Respaldo recomendado:**
- Dejá el **Serial Monitor abierto**: el firmware imprime cada `Z` por el cable pase lo que pase, así tenés un registro de respaldo aunque la app hipe.

---

## Resumen de lo que aprendiste (a la mala)

- **Señal manda.** ESP cerca del router. Es lo primero que tenés que mirar.
- **Serial ≠ App.** El cable siempre mide; la app necesita WiFi. Mirá `clientesWS`.
- **IP fija `.200`** ya no cambia. Si no conecta, confirmá en el serial que siga en `.200`.
- **App en localhost**, no en Vercel.
