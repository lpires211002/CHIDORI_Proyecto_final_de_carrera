# Chidori · Firmware ESP32-C3 con configuración WiFi auto-asistida

Variante del firmware optimizado que reemplaza las credenciales hardcodeadas por un
**portal cautivo de configuración** (WiFiManager). El clínico/paciente configura la red
una vez desde el navegador del celular y el ESP32-C3 la recuerda en su flash interno.

> Si comparás con `Chidori_ESP32C3_Optimizado/`: idéntica lógica de adquisición, alarma,
> SPI y WebSocket. Solo cambia el manejo del WiFi. Pesa ~25 KB más por la librería.

---

## ⚠️ Configuración obligatoria del Arduino IDE

### Boards Manager

`Tools → Board → Boards Manager…` → instalar **esp32 by Espressif Systems** versión `≥ 3.0.0`.

### Library Manager

`Sketch → Include Library → Manage Libraries…` → instalar **WiFiManager** by `tzapu` versión `≥ 2.0.17`.

### Settings del board

| Opción | Valor |
|---|---|
| Board | ESP32C3 Dev Module |
| **USB CDC On Boot** | **Enabled** ← imprescindible |
| CPU Frequency | 160 MHz (WiFi) |
| Flash Frequency | 80 MHz |
| Flash Mode | QIO |
| Flash Size | 4MB (32Mb) |
| Partition Scheme | Default 4MB with spiffs |
| Upload Speed | 921600 |

---

## 🚀 Primera vez · cómo configurar la red WiFi

1. Conectá el cable USB y abrí el **Serial Monitor** (115200 baud) para seguir los logs.
2. Al arrancar, el ESP intenta conectarse a la última red configurada. Si nunca se
   configuró, levanta un **Access Point propio** llamado `Chidori-Setup` (sin contraseña).
3. Desde el celular (o cualquier dispositivo con WiFi), conectate a esa red `Chidori-Setup`.
4. Tu sistema operativo va a abrir automáticamente el portal cautivo. Si no,
   visitá manualmente `http://192.168.4.1` desde el navegador.
5. Click en **Configure WiFi** → seleccioná la red de la casa / consultorio →
   ingresá la contraseña → **Save**.
6. El ESP guarda las credenciales en flash y se reinicia. En el Serial Monitor verás:
   ```
   ✅ WiFi conectado
      SSID: <tu_red>
      IP:   192.168.x.x
      RSSI: -52 dBm
   ✅ mDNS iniciado → ws://chidori.local:81
   ✅ AD9833 inicializado a 50 kHz (seno)
   ```
7. Listo. La app web ya puede conectarse al WebSocket usando `chidori.local:81` o la IP.

---

## 🔁 Cambiar de red WiFi después · factory reset

Si necesitás migrar el dispositivo a otra red (cambio de router, mudanza, viaje a
otro consultorio):

1. Desconectá el cable USB.
2. **Mantené apretado el botón físico (SW2)** mientras volvés a enchufar.
3. Después de 5 segundos sostenidos sentirás 3 beeps cortos del buzzer.
4. El ESP borra las credenciales y reinicia en modo portal `Chidori-Setup`.
5. Repetí el procedimiento de configuración como la primera vez.

> Si soltás el botón antes de los 5 segundos, no pasa nada: arranca normal.

---

## 🛟 Qué pasa si la red no se puede conectar

- Si el ESP no logra conectarse a la red guardada en 15 segundos (red apagada,
  contraseña cambiada, fuera de rango), levanta el portal automáticamente.
- Si nadie configura el portal dentro de 3 minutos, el ESP **se reinicia**
  y vuelve a intentar. Útil ante cortes momentáneos de luz / WiFi.

---

## 📡 Hostname mDNS

El firmware publica el servicio como `chidori.local` en el puerto `81`. Esto significa
que la app web puede conectarse simplemente a:

```
ws://chidori.local:81
```

sin necesidad de saber la IP que le asignó el router. Funciona en cualquier sistema con
Bonjour/avahi instalado (Mac y la mayoría de Linux nativo; en Windows hay que tener
"Bonjour Print Services" o usar la IP directa).

---

## ⚙️ Constantes ajustables (en el `.ino`)

| Define | Default | Descripción |
|---|---|---|
| `PORTAL_SSID` | `"Chidori-Setup"` | Nombre del AP de respaldo |
| `PORTAL_PASSWORD` | `""` (abierto) | Cambialo si querés que el portal requiera password |
| `MDNS_HOSTNAME` | `"chidori"` | Publica `chidori.local` |
| `PORTAL_TIMEOUT_S` | `180` | Segundos antes de reiniciar si nadie configura el portal |
| `CONNECT_TIMEOUT_S` | `15` | Segundos por intento de conexión a la red guardada |
| `FACTORY_RESET_HOLD_MS` | `5000` | Cuánto hay que mantener el botón al boot para reset |
| `TX_INTERVAL_MS` | `1000` | Cadencia de envío al frontend |
| `UMBRAL` | `-1.5` | Umbral de alarma en dB (log10) |
| `MUESTRAS_ALARMA` | `5` | Muestras consecutivas bajo umbral para disparar |

---

## 🆚 Comparación con `Chidori_ESP32C3_Optimizado/`

| Aspecto | Optimizado (hardcoded) | WiFiManager (este) |
|---|---|---|
| Credenciales WiFi | En el código `.ino` | En flash, configurables sin reflashear |
| Cambiar de red | Editar + recompilar + flashear | Apretar botón 5s al boot |
| Repo público con password | ❌ vulnerable | ✅ seguro (nada de credenciales en el código) |
| Tamaño binario | ~750 KB | ~775 KB (+25 KB por WiFiManager) |
| RAM en runtime | ~50 KB libres | ~45 KB libres |
| Resto del firmware | Idéntico | Idéntico |

---

## 🆘 Troubleshooting

| Síntoma | Causa más probable |
|---|---|
| No aparece la red `Chidori-Setup` | ¿Está USB CDC On Boot en Enabled? ¿Flashe en el board correcto? Mirá el Serial Monitor para ver si el AP arrancó. |
| `Chidori-Setup` aparece pero no abre el portal | Visitá `http://192.168.4.1` manualmente. Algunos Android no autodetectan el cautivo. |
| Conecta a la red pero la app web no lo encuentra | Probá con la IP directa (`ws://192.168.x.x:81`). Si funciona así, tu sistema no resuelve mDNS — instalá Bonjour en Windows. |
| El factory reset no funciona | ¿Activaste USB CDC On Boot? Sin eso, GPIO20 está tomado por el UART y `digitalRead(BUTTON)` no funciona. |
| Alarma nunca dispara | Recalibrar el UMBRAL (probar -0.65 si venís del firmware viejo con `log()` natural). |
| No suena el buzzer | Verificar GPIO5 conectado y polaridad correcta. |
