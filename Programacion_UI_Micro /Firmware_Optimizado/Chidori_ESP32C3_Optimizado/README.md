# Chidori — Firmware ESP32-C3 Optimizado

Firmware para la placa CHIDORI sobre **ESP32-C3 Super Mini**. Sustituye al firmware viejo `Chidori_Alarma` (ESP8266) preservando su comportamiento eléctrico y mejorando filtrado, robustez y comunicación.

---

## ⚠️ Configuración OBLIGATORIA del Arduino IDE

Antes de compilar y cargar, en el menú **Tools (Herramientas)** seleccioná:

| Opción | Valor |
|--------|-------|
| **Board** | ESP32C3 Dev Module |
| **USB CDC On Boot** | **Enabled** ← imprescindible |
| **CPU Frequency** | 160 MHz (WiFi) |
| **Flash Frequency** | 80 MHz |
| **Flash Mode** | QIO |
| **Flash Size** | 4MB (32Mb) |
| **Partition Scheme** | Default 4MB with spiffs |
| **Upload Speed** | 921600 |

### ¿Por qué USB CDC On Boot debe estar en Enabled?

El **botón está en GPIO20**, que también es el pin **RX del UART0** del ESP32-C3. Si USB CDC está deshabilitado, `Serial` toma control de los pines 20/21 y el botón queda inutilizable. Con CDC habilitado, `Serial` va por el puerto USB nativo y los pines GPIO quedan libres.

---

## Asignación de pines (esquemático KiCAD)

| GPIO | Función | Señal en esquemático |
|------|---------|----------------------|
| 0 | ADC | Vout (salida del detector Schottky) |
| 4 | SPI SCK | clk del AD9833 |
| 5 | Buzzer | alarm |
| 6 | SPI MOSI | data del AD9833 |
| 7 | SPI FSYNC (CS manual) | fnc del AD9833 |
| 20 | Botón SW2 | pull-down externo 2.2k, activo en HIGH |

---

## Parámetros configurables (en el `.ino`)

| Define | Default | Descripción |
|--------|---------|-------------|
| `FREQ` | 50000 | Frecuencia de inyección del AD9833 (Hz) |
| `SAMPLE_INTERVAL_US` | 1428 | Período de muestreo del ADC (≈700 Hz) |
| `AVG_SAMPLES` | 256 | Muestras crudas que se promedian para producir 1 Z |
| `TX_INTERVAL_MS` | 1000 | Cadencia de envío al frontend |
| `CANT_MUESTRAS` | 10 | Tamaño del moving-average sobre Z |
| `UMBRAL` | -1.5 | Umbral de alarma en dB (log10) respecto a Z_ref |
| `MUESTRAS_ALARMA` | 5 | Muestras CONSECUTIVAS bajo umbral para disparar |

### Cambiar la cadencia de envío
- Para frontend más fluido: bajar `TX_INTERVAL_MS` (p.ej. 500 → 2 Hz)
- Para datos más limpios: subir `TX_INTERVAL_MS` (p.ej. 5000 → cada 5 s)
- El muestreo y promediado interno siguen igual; cambia solo cuántas Z se transmiten.

### Recalibrar el umbral de alarma
El umbral está expresado en **dB reales (log base 10)**. En el firmware viejo (`Chidori_Alarma`) estaba mal calculado con `log()` natural, por lo que el mismo valor numérico de `-1.5` activaba la alarma con caídas mucho menores. Si tu calibración empírica del firmware viejo era buena con -1.5, el equivalente correcto sería **≈ -0.65 dB**. Pero si querés el valor matemático estándar (-1.5 dB reales), dejá el default.

---

## Comunicación con el frontend

| Canal | Protocolo | Detalle |
|-------|-----------|---------|
| Local | WebSocket TCP | `ws://chidori.local:81` (vía mDNS) o `ws://<ip>:81` |
| Datos | broadcast TXT | string con Z en Ω, 5 decimales |
| Comandos | TXT recibidos | `START` / `STOP` / `RESET` |

A diferencia del firmware viejo, los comandos por WebSocket **sí** controlan el estado: podés iniciar y parar la medición desde la UI sin pulsar el botón físico.

---

## Estados (FSM)

```
INACTIVO ──(botón o START WS)──► MIDIENDO ──(5 muestras < UMBRAL)──► ALARMA
   ▲                                │                                   │
   └─────────(botón o STOP)─────────┘                                   │
   ▲                                                                    │
   └─────────────────────────(botón silencia)───────────────────────────┘
```

---

## Cálculo de impedancia

```
V_ADC   = ADC(avg) × VREF / 4095               # voltaje medido (pico - V_Schottky)
V_pico  = V_ADC + V_Schottky                   # recupero pico recortado por el diodo
V_pp    = 2 × V_pico                           # detector de pico → multiplico ×2
Z       = V_pp / (I_pp_inyectada × G_total)
        = V_pp / (0.288 mA × 200)
```

El factor **×2** es físicamente necesario porque hay un rectificador Schottky (BAT54S + cap 10 nF) entre la cadena de amplificación y el ADC. Sin ese factor, Z saldría a la mitad de su valor real.

---

## Diferencias clave vs `Chidori_Alarma` (firmware viejo)

| Aspecto | Viejo (ESP8266) | Nuevo (ESP32-C3) |
|---------|-----------------|------------------|
| Muestreo ADC | 1 Hz | 700 Hz + promedio 256 |
| Cálculo dB | `log()` natural (incorrecto) | `log10()` (correcto) |
| Envío al frontend | Cada 10 s | Cada 1 s (configurable) |
| Comandos WS START/STOP | Decorativos | Funcionales |
| Reconexión WiFi | Bloqueante (cuelga si no hay red) | Timeout 15 s + sigue offline |
| mDNS | No | Sí (`chidori.local`) |
| Alarm counter | Acumulativo | Consecutivo + reset |

---

## Troubleshooting

| Síntoma | Posible causa |
|---------|---------------|
| Buzzer no suena | Verificar GPIO5 conectado, polaridad correcta |
| Botón no responde | ¿USB CDC On Boot en Enabled? ¿Pull-down 2.2k en su lugar? |
| Z = 0 o NaN | Cable de electrodos abierto / AD9833 sin SPI / Schottky inverso |
| Alarma nunca dispara | Recalibrar `UMBRAL` (probar -0.65 si venís del firmware viejo) |
| Alarma dispara con ruido | Subir `MUESTRAS_ALARMA` o `CANT_MUESTRAS` |
| No aparece `chidori.local` | Tu sistema requiere Bonjour/avahi; alternativamente usar IP directa |
