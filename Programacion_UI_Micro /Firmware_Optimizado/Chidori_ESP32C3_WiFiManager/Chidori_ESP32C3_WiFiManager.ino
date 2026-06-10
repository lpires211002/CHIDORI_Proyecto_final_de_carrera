/* =====================  PROYECTO CHIDORI ========================*/
/* ===== ESP32-C3 SUPER MINI · WiFiManager · EDICIÓN ROBUSTA ======*/
//
// Reescritura orientada a confiabilidad de transmisión en tiempo real.
// Cambios clave respecto a la versión anterior:
//
//   1. AD9833 se inicializa ANTES del WiFi (alimentación limpia, igual
//      que el sketch de prueba "soloAD" que siempre anda) y se
//      RE-inicializa en cada START → la senoidal nunca queda colgada.
//   2. Heartbeat WebSocket (ping/pong) → los clientes fantasma que
//      dejan los refresh del navegador se eliminan solos. Sin esto,
//      broadcastTXT se frena llamando a sockets muertos.
//   3. Reconexión WiFi EN RUNTIME, no bloqueante, con backoff. La
//      versión anterior solo conectaba en el boot: si el router se
//      caía después, el equipo quedaba offline para siempre.
//   4. TX power fijado en 8.5 dBm. El ESP32-C3 Super Mini tiene un
//      defecto conocido de matching de antena: a potencia default la
//      señal es errática y el AP "Chidori-Setup" cuesta encontrarlo.
//      8.5 dBm es el fix documentado por la comunidad y además evita
//      el brown-out por picos de corriente con cables USB marginales.
//   5. Scheduler de muestreo sin ráfagas: si el loop se atrasa (WiFi
//      reconectando, etc.) se re-sincroniza en vez de disparar N
//      muestras juntas.
//   6. Cero String en el camino crítico → sin fragmentación de heap
//      en sesiones largas.
//   7. Diagnóstico: línea de estado cada 10 s por serial (RSSI, heap,
//      clientes WS) y comando WS "STATUS".
//
// ╔══════════════════════════════════════════════════════════════╗
// ║  ⚠️  CONFIGURACIÓN OBLIGATORIA EN ARDUINO IDE  ⚠️             ║
// ║                                                              ║
// ║  Boards Manager:    esp32 by Espressif Systems ≥ 3.0.0       ║
// ║  Library Manager:   WiFiManager by tzapu      ≥ 2.0.17       ║
// ║                     WebSockets by Markus Sattler ≥ 2.4.0     ║
// ║                                                              ║
// ║  Board:                ESP32C3 Dev Module                    ║
// ║  USB CDC On Boot:      ENABLED                               ║
// ║  CPU Frequency:        160MHz (WiFi)                         ║
// ║  Flash Size:           4MB (32Mb)                            ║
// ║  Partition Scheme:     Default 4MB with spiffs               ║
// ╚══════════════════════════════════════════════════════════════╝
//
// FLUJO WiFi (primera vez):
//   1. Encender → conectarse desde el celular a "Chidori-Setup"
//      (password: chidori123).
//   2. Portal cautivo abre solo; si no, ir a http://192.168.4.1
//   3. Configure WiFi → elegir red → Save. El ESP guarda y conecta.
//
// FLUJO WiFi (booteos siguientes):
//   Conecta solo a la red guardada. Si la red se cae DESPUÉS de
//   conectar, reintenta solo (backoff 5→30 s) sin frenar la medición.
//   Si nunca logra conectar en el boot, levanta el portal de nuevo.
//
// FACTORY RESET WiFi: mantener el botón apretado 5 s al encender.
//
// Pines (verificados contra esquemático KiCAD):
//   GPIO 0  → ADC (Vout, detector Schottky)
//   GPIO 4  → SPI SCK   (clk AD9833)
//   GPIO 5  → BUZZER
//   GPIO 6  → SPI MOSI  (data AD9833)
//   GPIO 7  → SPI FSYNC (fnc AD9833)
//   GPIO 20 → BOTÓN     (SW2, pull-down externo 2.2k → activo HIGH)
// ─────────────────────────────────────────────────────────────────

#include <WiFi.h>
#include <WiFiManager.h>
#include <ESPmDNS.h>
#include <WebSocketsServer.h>
#include <SPI.h>
#include <stdint.h>
#include <math.h>

/* ================= PINES ================= */
#define BUZZER       5
#define BUTTON      20
#define ADC_PIN      0
#define PIN_MOSI     6
#define PIN_SCK      4
#define PIN_FSYNC    7

/* ================= CONSTANTES ELÉCTRICAS ================= */
#define VPP                 0.6
#define R1                  10000
#define GANANCIA_GENERADOR  4.8

#define GANANCIA_INA        5
#define GANANCIA_HIGH_PASS  10
#define GANANCIA_LOW_PASS   4
#define VShotcky            0.2

#define VREF                3.3
#define RESOLUCION          4095
#define ADC(x)              ((x) * VREF / (RESOLUCION))
#define Amp2Vpp(x)          ((x) * 2.0)

/* ================= MUESTREO ================= */
#define FREQ                50000.0   // frecuencia de inyección AD9833
#define SAMPLE_INTERVAL_US  1428      // ~700 Hz
#define AVG_SAMPLES         128       // 128 @ 700 Hz ≈ 183 ms por Z
#define TX_INTERVAL_MS      250       // ~4 Hz hacia el frontend
#define CANT_MUESTRAS       10        // moving average sobre Z
#define WARMUP_MUESTRAS     5         // no transmitir hasta estabilizar
// Si el scheduler se atrasa más de esto, re-sincroniza (evita ráfagas)
#define MAX_LAG_INTERVALS   4

/* ================= AD9833 ================= */
constexpr uint16_t CMD_RESET           = 0x2100;
constexpr uint16_t CMD_EXIT_RESET_SINE = 0x2000;
constexpr uint16_t REG_FREQ0           = 0x4000;
constexpr uint16_t REG_PHASE0          = 0xC000;
constexpr double   MCLK                = 25e6;

/* ================= WiFi / PORTAL ================= */
const char*    PORTAL_SSID            = "Chidori-Setup";
const char*    PORTAL_PASSWORD        = "chidori123";   // WPA2, min 8 chars
const char*    MDNS_HOSTNAME          = "chidori";
const uint16_t PORTAL_TIMEOUT_S       = 180;
const uint16_t CONNECT_TIMEOUT_S      = 15;
const uint16_t FACTORY_RESET_HOLD_MS  = 5000;

// Reconexión runtime: backoff entre reintentos
const uint32_t WIFI_RETRY_MIN_MS      = 5000;
const uint32_t WIFI_RETRY_MAX_MS      = 30000;
// Si está INACTIVO y lleva más de esto sin WiFi → reboot preventivo
// (nunca se reinicia en medio de una medición)
const uint32_t WIFI_DEAD_REBOOT_MS    = 180000;

// Heartbeat WS: ping cada 15 s, espera pong 3 s, 2 fallos = desconectar.
// ESTO es lo que elimina los clientes fantasma de los page-refresh.
const uint32_t WS_PING_INTERVAL_MS    = 15000;
const uint32_t WS_PONG_TIMEOUT_MS     = 3000;
const uint8_t  WS_PONG_RETRIES        = 2;

WebSocketsServer webSocket(81);

/* ================= VARIABLES GLOBALES ================= */
float muestras[CANT_MUESTRAS];
int   size_m    = 0;
float average_Z = 0;

float CORRIENTE_INYECTADA;
float GANANCIA_RECEPTOR;

unsigned long t_debounce     = 0;
unsigned long last_sample_us = 0;
unsigned long last_tx_ms     = 0;
unsigned long last_status_ms = 0;

uint32_t adc_sum   = 0;
uint16_t adc_count = 0;

bool botonConfirmado = false;
int  debounceCount   = 0;
const int DEBOUNCE_CUENTAS = 5;

bool First_Measure = true;

/* ── Estado WiFi runtime (manejado por eventos + loop) ── */
volatile bool wifiUp            = false;  // seteado por eventos WiFi
volatile bool wifiNeedsServices = false;  // re-arrancar mDNS tras reconectar
uint32_t      wifiRetryDelayMs  = WIFI_RETRY_MIN_MS;
unsigned long wifiNextRetryMs   = 0;
unsigned long wifiDownSinceMs   = 0;

/* ================= MÁQUINA DE ESTADOS =================
 * La alarma se evalúa ÚNICAMENTE en el frontend. El firmware es un
 * sensor "dumb": mide y transmite. ALARMA queda por compatibilidad. */
typedef enum { INACTIVO, MIDIENDO, ALARMA } state_t;

typedef struct {
  state_t estado;
  float   Z;
  float   Ref;
} sensor_t;

sensor_t Chidori;

/* ================= PROTOTIPOS ================= */
void Inicializar_AD9833();
void ad9833Write(uint16_t data);
void ad9833SetFrequency(double freqHz);
void ad9833Begin(double freqHz);
void Inicializar_WiFiManager();
void onWiFiEvent(WiFiEvent_t event);
void wifiWatchdog();
void startNetworkServices();
void checkFactoryResetButton();
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length);
void adquirir_y_promediar();
void Calcular_promedio(float Z);
void checkButton();
void resetMedicion();
void startMeasurement(const char* origen);
void stopMeasurement(const char* origen);
void statusTick();

/* ================= SETUP ================= */
void setup() {
  Serial.begin(115200);
  delay(150);
  Serial.println("\n=== ESP32-C3 CHIDORI · WiFiManager ROBUSTO ===");

  pinMode(BUZZER, OUTPUT);
  pinMode(BUTTON, INPUT);            // pull-down externo 2.2k en PCB
  digitalWrite(BUZZER, LOW);

  checkFactoryResetButton();

  // Constantes derivadas
  CORRIENTE_INYECTADA = VPP * GANANCIA_GENERADOR / R1;
  GANANCIA_RECEPTOR   = GANANCIA_HIGH_PASS * GANANCIA_LOW_PASS * GANANCIA_INA;
  Serial.print("I_inyectada (pp) = "); Serial.print(CORRIENTE_INYECTADA * 1000, 4); Serial.println(" mA");
  Serial.print("Ganancia receptor = ");  Serial.println(GANANCIA_RECEPTOR);

  Chidori.estado = INACTIVO;
  Chidori.Z      = 0.0f;
  Chidori.Ref    = 0.0f;

  // ADC: atenuación 11 dB explícita (rango completo 0–3.3 V aprox.)
  analogSetPinAttenuation(ADC_PIN, ADC_11db);

  // ★ AD9833 PRIMERO, con el WiFi todavía apagado.
  // Reproduce el entorno del sketch "soloAD" (alimentación sin los picos
  // de corriente de la radio) → init SPI confiable siempre.
  Inicializar_AD9833();

  // Recién ahora la radio
  Inicializar_WiFiManager();
}

/* ================= LOOP PRINCIPAL ================= */
void loop() {
  webSocket.loop();
  wifiWatchdog();
  statusTick();

  // Antirrebote del botón cada 10 ms
  if (millis() - t_debounce >= 10) {
    t_debounce = millis();
    checkButton();
  }

  // Muestreo ADC a ~700 Hz solo midiendo
  if (Chidori.estado == MIDIENDO) {
    unsigned long now_us = micros();
    if (now_us - last_sample_us >= SAMPLE_INTERVAL_US) {
      // Si nos atrasamos mucho (reconexión WiFi, etc.) re-sincronizamos
      // en vez de disparar una ráfaga de muestras para "ponernos al día".
      if (now_us - last_sample_us > (unsigned long)SAMPLE_INTERVAL_US * MAX_LAG_INTERVALS) {
        last_sample_us = now_us;
      } else {
        last_sample_us += SAMPLE_INTERVAL_US;
      }
      adquirir_y_promediar();
    }
  }

  switch (Chidori.estado) {
    case INACTIVO:
      if (botonConfirmado) {
        botonConfirmado = false;
        startMeasurement("boton");
      }
      break;

    case MIDIENDO:
      if (botonConfirmado) {
        botonConfirmado = false;
        stopMeasurement("boton");
      }
      break;

    case ALARMA:   // compatibilidad · hoy no se entra automáticamente
      if (botonConfirmado) {
        botonConfirmado = false;
        stopMeasurement("boton");
      }
      break;
  }
}

/* ─────────────────────────────────────────────────────────────────────
 *  START / STOP centralizados
 *  START re-inicializa el AD9833: si por cualquier glitch dejó de
 *  generar, cada medición arranca con la senoidal garantizada.
 *  Costo: 6 escrituras SPI (~µs), imperceptible.
 * ───────────────────────────────────────────────────────────────────── */
void startMeasurement(const char* origen) {
  ad9833Begin(FREQ);                  // ★ re-init defensivo del generador
  resetMedicion();
  Chidori.estado = MIDIENDO;
  last_sample_us = micros();
  Serial.print(">> MIDIENDO (por "); Serial.print(origen); Serial.println(")");
}

void stopMeasurement(const char* origen) {
  Chidori.estado = INACTIVO;
  digitalWrite(BUZZER, LOW);
  First_Measure  = true;
  Serial.print(">> INACTIVO (por "); Serial.print(origen); Serial.println(")");
}

/* ─────────────────────────────────────────────────────────────────────
 *  WiFi: boot con WiFiManager + reconexión runtime por eventos
 * ───────────────────────────────────────────────────────────────────── */
void Inicializar_WiFiManager() {
  WiFi.mode(WIFI_STA);

  // Eventos: detectan caída/recuperación del WiFi en runtime
  WiFi.onEvent(onWiFiEvent);

  WiFiManager wm;
  wm.setConfigPortalTimeout(PORTAL_TIMEOUT_S);
  wm.setConnectTimeout(CONNECT_TIMEOUT_S);
  wm.setConnectRetries(3);
  wm.setCleanConnect(true);          // desconecta antes de conectar (más confiable)
  wm.setHostname(MDNS_HOSTNAME);

  wm.setTitle("Chidori · Configuración WiFi");
  wm.setShowInfoErase(true);
  wm.setBreakAfterConfig(true);
  wm.setDarkMode(true);

  const char* CUSTOM_HTML =
    "<p style='font-family:system-ui;font-size:13px;color:#666;line-height:1.5;margin:14px 0;'>"
    "Seleccioná la red WiFi a la que querés que se conecte el dispositivo Chidori. "
    "Las credenciales se guardan en el dispositivo, no se transmiten a ningún servidor."
    "</p>";
  wm.setCustomHeadElement(CUSTOM_HTML);

  // ★ Cuando levanta el AP del portal, bajar TX power a 8.5 dBm.
  // El C3 Super Mini tiene mal matching de antena: a potencia default
  // el AP "Chidori-Setup" se ve intermitente o directamente no aparece.
  wm.setAPCallback([](WiFiManager* w) {
    WiFi.setTxPower(WIFI_POWER_8_5dBm);
    Serial.println("⚙ Portal activo · TX power 8.5 dBm (fix antena C3)");
    Serial.print  ("  Conectarse a \""); Serial.print(PORTAL_SSID);
    Serial.println("\" y abrir http://192.168.4.1");
  });

  Serial.println("Conectando WiFi…");
  Serial.print("  AP de respaldo: "); Serial.println(PORTAL_SSID);

  bool connected = (strlen(PORTAL_PASSWORD) > 0)
                     ? wm.autoConnect(PORTAL_SSID, PORTAL_PASSWORD)
                     : wm.autoConnect(PORTAL_SSID);

  if (!connected) {
    Serial.println("❌ Sin conexión ni configuración dentro del timeout. Reiniciando…");
    delay(2000);
    ESP.restart();
  }

  // ★ TX power 8.5 dBm también en modo estación:
  //   - estabiliza el link (defecto de antena del C3 Super Mini)
  //   - evita picos >200 mA que disparan brown-out del USB CDC
  WiFi.setTxPower(WIFI_POWER_8_5dBm);

  // ★ Power save OFF: sin esto el modem acumula paquetes y los manda en
  // ráfagas según el DTIM del router → el lag que veíamos en el dashboard.
  WiFi.setSleep(false);

  // Auto-reconexión del driver + nuestro watchdog con backoff
  WiFi.setAutoReconnect(true);
  WiFi.persistent(true);

  Serial.println("✅ WiFi conectado");
  Serial.print("   SSID: ");  Serial.println(WiFi.SSID());
  Serial.print("   IP:   ");  Serial.println(WiFi.localIP());
  Serial.print("   RSSI: ");  Serial.print(WiFi.RSSI()); Serial.println(" dBm");
  Serial.println("   TX power 8.5 dBm · power save OFF");

  wifiUp            = true;
  wifiNeedsServices = false;   // el GOT_IP del boot ya quedó atendido acá
  startNetworkServices();
}

/* mDNS + WebSocket server. Se llama al boot y tras cada reconexión. */
void startNetworkServices() {
  MDNS.end();
  if (MDNS.begin(MDNS_HOSTNAME)) {
    MDNS.addService("ws", "tcp", 81);
    Serial.print("✅ mDNS → ws://"); Serial.print(MDNS_HOSTNAME); Serial.println(".local:81");
    Serial.print("   (si .local falla, usar la IP directa: ");
    Serial.print(WiFi.localIP()); Serial.println(":81)");
  } else {
    Serial.println("⚠ mDNS no inició · usar la IP directa");
  }

  static bool wsStarted = false;
  if (!wsStarted) {
    webSocket.begin();
    webSocket.onEvent(webSocketEvent);
    // ★ Heartbeat: elimina clientes fantasma (refresh del navegador,
    // celular que se fue de rango). Sin esto broadcastTXT se degrada.
    webSocket.enableHeartbeat(WS_PING_INTERVAL_MS, WS_PONG_TIMEOUT_MS, WS_PONG_RETRIES);
    wsStarted = true;
  }
}

/* Eventos del driver WiFi (corren en otra task → solo flags) */
void onWiFiEvent(WiFiEvent_t event) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      if (wifiUp) {
        wifiUp          = false;
        wifiDownSinceMs = millis();
        wifiNextRetryMs = millis() + WIFI_RETRY_MIN_MS;
        wifiRetryDelayMs = WIFI_RETRY_MIN_MS;
      }
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      if (!wifiUp) {
        wifiUp            = true;
        wifiNeedsServices = true;   // mDNS se re-arranca desde el loop
      }
      break;
    default:
      break;
  }
}

/* Reconexión no bloqueante con backoff. La medición NUNCA se frena:
 * el ADC y el AD9833 siguen, solo se pausa la transmisión. */
void wifiWatchdog() {
  if (wifiUp) {
    if (wifiNeedsServices) {
      wifiNeedsServices = false;
      WiFi.setTxPower(WIFI_POWER_8_5dBm);
      WiFi.setSleep(false);
      Serial.print("✅ WiFi reconectado · IP "); Serial.println(WiFi.localIP());
      startNetworkServices();
    }
    return;
  }

  unsigned long now = millis();

  // Reboot preventivo solo si está INACTIVO (jamás durante una medición)
  if (Chidori.estado == INACTIVO && now - wifiDownSinceMs >= WIFI_DEAD_REBOOT_MS) {
    Serial.println("❌ WiFi muerto hace 3 min y sin medición en curso. Reiniciando…");
    delay(200);
    ESP.restart();
  }

  if (now >= wifiNextRetryMs) {
    Serial.print("↻ Reintentando WiFi (backoff ");
    Serial.print(wifiRetryDelayMs / 1000); Serial.println(" s)…");
    WiFi.reconnect();
    wifiRetryDelayMs = min(wifiRetryDelayMs * 2, WIFI_RETRY_MAX_MS);
    wifiNextRetryMs  = now + wifiRetryDelayMs;
  }
}

/* Línea de diagnóstico cada 10 s */
void statusTick() {
  if (millis() - last_status_ms < 10000) return;
  last_status_ms = millis();

  Serial.print("[status] estado=");
  Serial.print(Chidori.estado == MIDIENDO ? "MIDIENDO" : "INACTIVO");
  Serial.print(" · wifi="); Serial.print(wifiUp ? "OK" : "CAIDO");
  if (wifiUp) { Serial.print(" ("); Serial.print(WiFi.RSSI()); Serial.print(" dBm)"); }
  Serial.print(" · clientesWS="); Serial.print(webSocket.connectedClients());
  Serial.print(" · heap="); Serial.print(ESP.getFreeHeap());
  Serial.print(" · Z="); Serial.println(Chidori.Z, 3);
}

/* ─────────────────────────────────────────────────────────────────────
 *  Factory reset · botón apretado 5 s al boot borra credenciales WiFi
 * ───────────────────────────────────────────────────────────────────── */
void checkFactoryResetButton() {
  if (digitalRead(BUTTON) != HIGH) return;

  Serial.println("⚠ Botón apretado al boot.");
  Serial.print  ("  Mantener "); Serial.print(FACTORY_RESET_HOLD_MS / 1000);
  Serial.println(" s para borrar credenciales WiFi…");

  unsigned long t0 = millis();
  while (digitalRead(BUTTON) == HIGH) {
    if (millis() - t0 >= FACTORY_RESET_HOLD_MS) {
      Serial.println("✅ FACTORY RESET · borrando credenciales WiFi");
      WiFiManager wm;
      wm.resetSettings();
      for (int i = 0; i < 3; i++) {
        digitalWrite(BUZZER, HIGH); delay(120);
        digitalWrite(BUZZER, LOW);  delay(120);
      }
      Serial.println("Reiniciando en modo portal…");
      delay(800);
      ESP.restart();
    }
    delay(50);
  }
  Serial.println("→ Botón soltado antes del umbral. Continuando.");
}

/* ================= AD9833 ================= */
void Inicializar_AD9833() {
  pinMode(PIN_FSYNC, OUTPUT);
  digitalWrite(PIN_FSYNC, HIGH);
  SPI.begin(PIN_SCK, -1, PIN_MOSI, -1);   // CS manual, sin MISO
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE2));
  delay(100);                              // settle (igual que sketch soloAD)
  ad9833Begin(FREQ);
  Serial.println("✅ AD9833 inicializado a 50 kHz (seno) · antes del WiFi");
}

/* Palabra de 16 bits en dos transfers de 8 → MSB-first garantizado
 * independiente del endianness (C3 es RISC-V little-endian). */
void ad9833Write(uint16_t data) {
  digitalWrite(PIN_FSYNC, LOW);
  delayMicroseconds(1);                  // tCSS
  SPI.transfer((uint8_t)(data >> 8));
  SPI.transfer((uint8_t)(data & 0xFF));
  digitalWrite(PIN_FSYNC, HIGH);
  delayMicroseconds(2);                  // tCSH
}

/* Solo escribe FREQ0 (LSB+MSB). No toca el control register. */
void ad9833SetFrequency(double freqHz) {
  uint32_t freqWord = (uint32_t)((freqHz * (1UL << 28)) / MCLK);
  ad9833Write(REG_FREQ0 | (uint16_t)(freqWord        & 0x3FFF));
  ad9833Write(REG_FREQ0 | (uint16_t)((freqWord >> 14) & 0x3FFF));
}

/* Secuencia oficial (datasheet AD9833 / AN-1070):
 *   RESET=1 → FREQ0 LSB → FREQ0 MSB → PHASE0 → RESET=0 (seno) */
void ad9833Begin(double freqHz) {
  ad9833Write(CMD_RESET);
  delayMicroseconds(5);
  ad9833SetFrequency(freqHz);
  ad9833Write(REG_PHASE0 | 0x0000);
  delayMicroseconds(5);
  ad9833Write(CMD_EXIT_RESET_SINE);
}

/* ================= WEBSOCKET ================= */
/* El frontend hace parseFloat(msg) e ignora lo no-numérico (NaN),
 * así que las respuestas de texto (STATUS/PONG) no lo rompen. */
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      IPAddress ip = webSocket.remoteIP(num);
      Serial.print("WS cliente #"); Serial.print(num);
      Serial.print(" conectado desde "); Serial.println(ip);
      return;
    }
    case WStype_DISCONNECTED:
      Serial.print("WS cliente #"); Serial.print(num); Serial.println(" desconectado");
      return;
    case WStype_TEXT:
      break;
    default:
      return;
  }

  const char* cmd = (const char*)payload;   // la lib null-termina los TEXT
  Serial.print("Comando WS: "); Serial.println(cmd);

  if (strcmp(cmd, "START") == 0 && Chidori.estado == INACTIVO) {
    startMeasurement("WS");
  }
  else if (strcmp(cmd, "STOP") == 0) {
    stopMeasurement("WS STOP");
  }
  else if (strcmp(cmd, "RESET") == 0) {
    stopMeasurement("WS RESET");
    resetMedicion();
  }
  else if (strcmp(cmd, "PING") == 0) {
    webSocket.sendTXT(num, "PONG");
  }
  else if (strcmp(cmd, "STATUS") == 0) {
    char buf[96];
    snprintf(buf, sizeof(buf),
             "STATUS estado=%s rssi=%d heap=%u Z=%.3f",
             Chidori.estado == MIDIENDO ? "MIDIENDO" : "INACTIVO",
             wifiUp ? (int)WiFi.RSSI() : 0,
             (unsigned)ESP.getFreeHeap(), Chidori.Z);
    webSocket.sendTXT(num, buf);
  }
}

/* ================= ADQUISICIÓN ================= */
void adquirir_y_promediar() {
  adc_sum += analogRead(ADC_PIN);
  adc_count++;

  if (adc_count < AVG_SAMPLES) return;

  float avg_adc = (float)adc_sum / AVG_SAMPLES;
  adc_sum   = 0;
  adc_count = 0;

  float voltage = ADC(avg_adc);
  float Vpp     = Amp2Vpp(voltage + VShotcky);
  float Z       = Vpp / (CORRIENTE_INYECTADA * GANANCIA_RECEPTOR);

  Calcular_promedio(Z);
  Chidori.Z = average_Z;

  // ── WARMUP: no transmitir ni calibrar Z_ref con transitorios ──
  if (size_m < WARMUP_MUESTRAS) {
    Serial.print("[warmup] "); Serial.print(size_m);
    Serial.print("/"); Serial.print(WARMUP_MUESTRAS);
    Serial.print(" · Z parcial = "); Serial.println(Chidori.Z, 3);
    return;
  }

  if (First_Measure) {
    Chidori.Ref   = Chidori.Z;
    First_Measure = false;
    Serial.print("⭐ Z_ref calibrada: "); Serial.print(Chidori.Ref, 3); Serial.println(" Ω");
  }

  // ── TX cada TX_INTERVAL_MS · sin String (cero fragmentación) ──
  if (millis() - last_tx_ms >= TX_INTERVAL_MS) {
    last_tx_ms = millis();
    char msg[16];
    snprintf(msg, sizeof(msg), "%.5f", Chidori.Z);
    if (wifiUp && webSocket.connectedClients() > 0) {
      webSocket.broadcastTXT(msg);
    }
    Serial.print("Z = "); Serial.println(msg);
  }
}

void Calcular_promedio(float Z) {
  if (size_m < CANT_MUESTRAS) {
    muestras[size_m++] = Z;
  } else {
    for (int i = 0; i < CANT_MUESTRAS - 1; i++)
      muestras[i] = muestras[i + 1];
    muestras[CANT_MUESTRAS - 1] = Z;
  }
  average_Z = 0;
  for (int i = 0; i < size_m; i++)
    average_Z += muestras[i];
  average_Z /= size_m;
}

/* ================= BOTÓN (antirrebote) ================= */
void checkButton() {
  if (digitalRead(BUTTON) == HIGH) {
    if (debounceCount < DEBOUNCE_CUENTAS) {
      debounceCount++;
      if (debounceCount >= DEBOUNCE_CUENTAS) {
        botonConfirmado = true;
      }
    }
  } else {
    debounceCount = 0;
  }
}

/* ================= UTILIDADES ================= */
void resetMedicion() {
  size_m        = 0;
  average_Z     = 0;
  adc_sum       = 0;
  adc_count     = 0;
  First_Measure = true;
  last_tx_ms    = millis();
}
