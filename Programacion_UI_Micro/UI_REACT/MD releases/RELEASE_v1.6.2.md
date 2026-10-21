# Chidori v1.6.2 · Reiniciar sin rehacer el setup + diagnóstico de firmware

---

## 🔁 Reiniciar ya no te devuelve al principio

Antes, **Reiniciar** descartaba la sesión y volvía a la pantalla de preparación:
había que volver a elegir el paciente y rehacer la calibración, aunque fueras a
medir a la misma persona en el mismo momento. En la práctica el caso más común
es "algo salió mal, arranco de nuevo" — y rehacer todo el enlace para eso no
tenía sentido.

Ahora:

| Acción | Qué hace |
|---|---|
| **Reiniciar** | Descarta muestras y eventos. Cronómetro a 00:00 en pausa, listo para dar play. **Conserva paciente, basal y enlace**, y se queda en el panel de medición. |
| **Chidori** (marca del header) | Suelta todo y vuelve a la pantalla de preparación. |

El cartel de confirmación dice exactamente qué se descarta y qué se conserva,
con los valores concretos ("Se conservan el paciente P-002 y el basal 29,00 Ω"),
y aclara si ya se había guardado algo en la nube.

> **El basal se conserva a propósito**, porque es parte del setup que se busca
> no rehacer. Pero se midió con vejiga vacía al inicio: si reiniciás mucho
> después, conviene registrarlo de nuevo desde el asistente de calibración, que
> ofrece las dos opciones. El valor está siempre a la vista en el readout.

---

## 📡 Firmware · diagnóstico

Agregados para poder investigar problemas que solo aparecen en sesiones largas:

- **Motivo del último reinicio** al arrancar (`esp_reset_reason`). Detecta
  brown-outs, que de otra forma se ven como "se cortó y volvió" sin explicación.
- **RSSI real de la estación asociada**, vía `esp_wifi_ap_get_sta_list`. Antes
  se reportaba `WiFi.RSSI()`, que en modo access point no significa nada.
- **Uptime** en la línea de estado.
- **Log con marca de tiempo** de asociación y caída de la computadora al AP.

## 🧹 Firmware · limpieza

Se eliminó todo el código muerto de la etapa STA/WiFiManager: el manejador de
eventos de estación que nunca llegaba a registrarse, el watchdog que ya era una
función vacía, y las globales de backoff sin uso (`wifiUp`, `wifiRetryDelayMs`,
`wifiNextRetryMs`, `wifiDownSinceMs`).

**Sin cambio funcional.** Se verificó que no quedaran referencias colgadas a los
símbolos eliminados.

---

## Recordatorios que siguen vigentes

**Después de flashear, registrá el basal de nuevo.** Desde la 1.6.0 el firmware
usa la calibración de fábrica del ADC, así que los valores de impedancia no son
directamente comparables con los de versiones anteriores.

**Medí a batería.** Con el microcontrolador conectado por USB a una notebook
enchufada a la red se arma un lazo de masa que altera la impedancia medida (se
observó ~68 Ω conectado contra ~28,85 Ω desconectado).

---

## Instalación

**macOS** — descargar el `.dmg`, arrastrar a Aplicaciones. La primera vez:
click derecho → Abrir.

**Windows** — descargar el `.exe`. SmartScreen puede advertir:
Más información → Ejecutar de todas formas.

**Firmware** — abrir el sketch en Arduino IDE y flashear el ESP32-C3.
