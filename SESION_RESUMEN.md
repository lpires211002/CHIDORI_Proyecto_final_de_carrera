# Chidori — Resumen de sesión (junio 2026)

## Objetivo
Reescribir el firmware ESP32-C3 + WiFiManager para resolver problemas de transmisión de datos, conectividad WiFi y compatibilidad con el dashboard React de la tesis de impedancia bioeléctrica.

---

## 1. Firmware reescrito

**Archivo:** `Programacion_UI_Micro /Firmware_Optimizado/Chidori_ESP32C3_WiFiManager/Chidori_ESP32C3_WiFiManager.ino`

### Problemas del firmware original
| Problema | Causa | Fix aplicado |
|---|---|---|
| Datos en ráfagas, delays irregulares | WiFi power save activo | `WiFi.setSleep(false)` |
| Señal WiFi débil / portal difícil de encontrar | TX power al máximo (defecto antena C3 Super Mini) | `WiFi.setTxPower(WIFI_POWER_8_5dBm)` en portal y station mode |
| AD9833 a veces no genera señal | Init después del WiFi, picos de corriente de la radio | `Inicializar_AD9833()` ANTES de `Inicializar_WiFiManager()` + re-init en cada START |
| Clientes WebSocket fantasma (browser refresh) | Sin heartbeat | `webSocket.enableHeartbeat(15000, 3000, 2)` |
| Datos en burst al volver de reconexión | Scheduler acumulaba ticks | Anti-burst: resync de `last_sample_us` si el lag supera `MAX_LAG_INTERVALS` |
| `String` fragmentation heap | Uso de `String` en hot path | `snprintf` en todo el firmware |
| Sin diagnóstico de runtime | — | Comando `STATUS` → responde `STATUS estado=X rssi=Y heap=Z Z=W` |
| Sin reconexión WiFi en runtime | — | `wifiWatchdog()` no bloqueante con backoff 5→30 s |
| IP cambia en cada boot (DHCP) | — | IP estática `192.168.0.200` vía `WiFi.config()` antes de WiFiManager |

### Protocolo WebSocket (puerto 81)
- **TX firmware→UI:** `"%.5f"` (valor Z en Ω), `"PONG"`, `"STATUS estado=X rssi=Y heap=Z Z=W"`
- **RX UI→firmware:** `START`, `STOP`, `RESET`, `PING`, `STATUS`
- **Frecuencia de muestreo:** ~4 Hz
- **Formato numérico:** `snprintf(msg, 16, "%.5f", Z)` — sin `String`

### Configuración Arduino IDE requerida
```
Board:              ESP32C3 Dev Module
USB CDC On Boot:    Enabled          ← crítico, sin esto no aparece el puerto serial
CPU Frequency:      160MHz (WiFi)
Flash Size:         4MB
Partition Scheme:   Default 4MB with spiffs
Upload Speed:       921600
```

---

## 2. UI React — auditoría y fixes

**Directorio:** `Programacion_UI_Micro /UI_REACT/`

### Fixes de compatibilidad con el protocolo
| Fix | Detalle |
|---|---|
| Router de mensajes WS | `handleSocketMessage` clasifica numérico vs `STATUS` vs `PONG` — ignora texto desconocido |
| Filtro de spikes | `sanitizeZ`: límites 1–100000 Ω + histéresis 30%/15 Ω, máx 3 rechazos consecutivos |
| Polling de STATUS | `setInterval(STATUS, 5000 ms)` — reconcilia estado con botón físico GPIO20 |
| `sendCommand` seguro | Guard de `readyState === WebSocket.OPEN` antes de enviar |
| Parser STATUS | `applyDeviceStatus` extrae `estado`, `rssi`, `heap` y los muestra en pill/SettingsPanel |

### Bugs de ciclo de vida WebSocket corregidos
| Bug | Fix |
|---|---|
| **React StrictMode** en dev ejecuta effects dos veces → mount/cleanup/mount cierra el socket recién conectado | Eliminado `<StrictMode>` de `main.jsx` para desarrollo |
| **Callbacks encolados del reconnect interval** disparaban `connectWebSocket()` mientras el socket ya estaba `OPEN`, cerrándolo | Guard al inicio de `connectWebSocket`: `if (socketRef.current?.readyState === WebSocket.OPEN) return` |

### Rediseño UI v3 (sesión anterior)
- Header mínimo con `HeaderMenu.jsx` (⋯)
- Command bar con cronómetro + Marcar/Reiniciar/Exportar
- `StatsGrid` a 3 celdas (hero + basal + tasa)
- `RealTimeCharts` unificado con toggle Impedancia/dZdt
- Backup de sesión anti-F5 en `localStorage` cada 30 s
- Watchdog de staleness: >3 s sin datos → pill "Sin datos"

---

## 3. Troubleshooting de hardware/conexión

### Problema: puerto Arduino IDE no encontrado
- **Síntoma:** `/dev/cu.usbmodem101` not found con 3 cables distintos
- **Causa:** Arduino IDE tenía un número de puerto incorrecto
- **Fix:** puerto real era `/dev/cu.usbmodem1101` (diferente número)

### Problema: Mixed Content HTTPS → ws://
- **Síntoma:** App en `chidori-rosy.vercel.app` (HTTPS) no podía conectar a `ws://`
- **Fix:** usar la UI en local (`npm run dev` → `http://localhost:5173`)

### Problema: mDNS `chidori.local` no resuelve
- **Síntoma:** `ping chidori.local` → Unknown host
- **Fix:** usar IP directa. IP encontrada con `arp -a` (MAC Espressif OUI `38:1a:52`)

### Problema: IP cambia en cada reboot
- **Fix permanente:** `WiFi.config(192.168.0.200, ...)` en el firmware → siempre `192.168.0.200`

### Problema: WiFi drops intermitentes
- **RSSI:** -58 a -63 dBm (señal límite)
- **Síntoma en firmware:** `wifi=CAIDO`, `E (644496) wifi:sta is connecting, return error`
- **Causa:** `WiFi.reconnect()` falla si el state machine interno ya está en estado conectando
- **Mitigación:** backoff automático 5→30 s en `wifiWatchdog()`. Para estabilidad definitiva: acercar el ESP32 al router

---

## 4. Estado actual

| Componente | Estado |
|---|---|
| Firmware compilación | ✅ 88%, 1154507 bytes |
| AD9833 generando señal | ✅ |
| WiFi conecta | ✅ (IP fija 192.168.0.200 tras próximo flash) |
| WebSocket puerto 81 | ✅ (`nc -zv` succeeded) |
| Datos Z transmitidos | ✅ ~22 Ω medidos en prueba |
| UI conecta y muestra datos | ✅ (sesión activa confirmada, timer corriendo) |
| Estabilidad de conexión | ⚠️ Depende de señal WiFi (-60 dBm = límite) |
| IP estática | ⏳ Pendiente flashear con el nuevo firmware |

---

## 5. Pendientes

1. **Flashear** el firmware con la IP estática `192.168.0.200`
2. **Configurar la app** con `192.168.0.200` y guardar (una sola vez)
3. **Mejorar señal WiFi** — acercar ESP32 al router para sesiones de demo estables
4. **Pushear** cambios de UI a GitHub (main.jsx, Dashboard.jsx)

---

## 6. Comandos útiles de diagnóstico

```bash
# Ver IP del ESP32 en la red
arp -a | grep -v incomplete

# Verificar si el puerto WebSocket está abierto
nc -zv 192.168.0.200 81

# Correr UI localmente (evita Mixed Content de Vercel)
cd "Programacion_UI_Micro /UI_REACT"
npm run dev

# Build de producción (en Linux arm64 con vite8)
npm install @rolldown/binding-linux-arm64-gnu --no-save
npx vite build --outDir /tmp/chidori_build_$RANDOM --emptyOutDir
```
