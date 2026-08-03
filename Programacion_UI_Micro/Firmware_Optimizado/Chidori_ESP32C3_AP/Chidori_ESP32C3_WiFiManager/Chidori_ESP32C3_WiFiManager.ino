/* =====================  PROYECTO CHIDORI ========================*/
/* =====  ESP32-C3 SUPER MINI · ACCESS POINT · EDICIÓN ROBUSTA  ====*/
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
//   3. MODO ACCESS POINT: el ESP crea su PROPIA red WiFi ("Chidori"),
//      no depende de ningún router ni hotspot. La Mac se conecta directo.
//      (La versión anterior usaba WiFiManager + portal STA, frágil en el C3.)
//   4. TX power fijado en 8.5 dBm. El ESP32-C3 Super Mini tiene un
//      defecto conocido de matching de antena: a potencia default la
//      señal es errática y el AP "Chidori" cuesta encontrarlo.
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
// ║  Library Manager:   WebSockets by Markus Sattler ≥ 2.4.0     ║
// ║                                                              ║
// ║  Board:                ESP32C3 Dev Module                    ║
// ║  USB CDC On Boot:      ENABLED                               ║
// ║  CPU Frequency:        160MHz (WiFi)                         ║
// ║  Flash Size:           4MB (32Mb)                            ║
// ║  Partition Scheme:     Default 4MB with spiffs               ║
// ╚══════════════════════════════════════════════════════════════╝
//
// USO (siempre igual, sin configurar nada):
//   1. Encender el ESP → crea su propia red WiFi "Chidori"
//      (password: chidori123).
//   2. Desde la Mac, conectarse a esa red WiFi "Chidori".
//   3. Abrir la app apuntando a la IP 192.168.4.1, puerto 81.
//
//   No hay portal, ni red que elegir, ni credenciales que guardar: el ESP
//   ES su propio Access Point y arranca SIEMPRE en 192.168.4.1.
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
#define AVG_SAMPLES         192       // 192 @ 700 Hz ≈ 274 ms por Z cruda
#define TX_INTERVAL_MS      250       // ~4 Hz hacia el frontend

/* Cadena de filtrado sobre Z · MEDIANA y despues MEDIA.
 *
 * La media sola NO rechaza impulsos: un unico spike de +5 ohm se reparte y
 * contamina las CANT_MUESTRAS salidas siguientes con +0.5 ohm. Sobre un rango
 * util de ~4.6 ohm (la caida de 1.5 dB) eso es un 11 % de error arrastrado.
 * La mediana lo descarta entero, y recien despues se promedia para bajar el
 * ruido gaussiano. El orden importa: promediar primero ya habria mezclado el
 * spike con sus vecinos.
 *
 * Costo: MEDIANA_N * AVG_SAMPLES / 700 Hz de latencia extra (~1.4 s). El
 * llenado vesical es de escala de minutos, asi que sobra. */
#define MEDIANA_N           5         // ventana de la mediana (impar)
#define CANT_MUESTRAS       12        // media movil posterior
#define WARMUP_MUESTRAS     5         // no transmitir hasta estabilizar
// Si el scheduler se atrasa más de esto, re-sincroniza (evita ráfagas)
#define MAX_LAG_INTERVALS   4

/* ================= AD9833 ================= */
constexpr uint16_t CMD_RESET           = 0x2100;
constexpr uint16_t CMD_EXIT_RESET_SINE = 0x2000;
constexpr uint16_t REG_FREQ0           = 0x4000;
constexpr uint16_t REG_PHASE0          = 0xC000;
constexpr double   MCLK                = 25e6;

/* ================= WiFi / ACCESS POINT ================= */
const char*    MDNS_HOSTNAME          = "chidori";

// ── MODO AP (Access Point) ───────────────────────────────────────────
// El ESP crea su PROPIA red WiFi; la Mac se conecta directo. Sin router,
// sin hotspot, sin portal, sin credenciales, sin IP que dependa de la red.
const char*    AP_SSID                = "Chidori";        // red que crea el ESP
const char*    AP_PASSWORD            = "chidori123";     // WPA2, min 8 chars

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

/* Ventana de la mediana · previa a la media movil */
float med_buf[MEDIANA_N];
int   med_n = 0;

// Ultima tension pico-pico del detector (la que alimenta el calculo de Z).
// Se transmite junto con Z como dato de referencia/diagnostico. Es solo una
// asignacion por ciclo: no altera el muestreo ni el calculo.
float last_Vpp  = 0.0f;

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
const int DEBOUNCE_START_CUENTAS = 8;    // 80 ms para ARRANCAR
const int DEBOUNCE_STOP_CUENTAS  = 150;  // 1.5 s de hold para PARAR (anti-corte espurio en mediciones largas)

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
void Inicializar_AP();
void onWiFiEvent(WiFiEvent_t event);
void wifiWatchdog();
void startNetworkServices();
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length);
void adquirir_y_promediar();
float Calcular_mediana(float Z);
void Calcular_promedio(float Z);
void checkButton();
void resetMedicion();
void startMeasurement(const char* origen);
void stopMeasurement(const char* origen);
void statusTick();

/* ================= SETUP ================= */
void setup() {
  Serial.begin(115200);
  delay(3000);
  Serial.println("\n=== ESP32-C3 CHIDORI · ACCESS POINT ===");

  pinMode(BUZZER, OUTPUT);
  pinMode(BUTTON, INPUT);            // pull-down externo 2.2k en PCB
  digitalWrite(BUZZER, LOW);

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

  // Levantar el Access Point (red propia del ESP)
  Inicializar_AP();
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
  // Confirmacion audible del hold de 1.5 s: el usuario mantiene apretado
  // hasta el beep y recien ahi suelta. (No suena en STOP por la app.)
  if (strncmp(origen, "boton", 5) == 0) {
    digitalWrite(BUZZER, HIGH); delay(60); digitalWrite(BUZZER, LOW);
  }
  Serial.print(">> INACTIVO (por "); Serial.print(origen); Serial.println(")");
}

/* ─────────────────────────────────────────────────────────────────────
 *  WiFi: modo Access Point (el ESP crea su propia red "Chidori")
 * ───────────────────────────────────────────────────────────────────── */
void Inicializar_AP() {
  // ── MODO ACCESS POINT ──────────────────────────────────────────────
  // El ESP crea su PROPIA red WiFi. La Mac se conecta directo a 'Chidori'
  // y abre la UI apuntando a 192.168.4.1:81. No depende de ningun router,
  // hotspot ni credenciales: funciona igual en cualquier lugar.
  WiFi.mode(WIFI_AP);

  // IP fija del AP: SIEMPRE 192.168.4.1 (lo que va en la UI).
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1),
                    IPAddress(192, 168, 4, 1),
                    IPAddress(255, 255, 255, 0));

  bool ok = WiFi.softAP(AP_SSID, AP_PASSWORD);

  // Power save OFF: con el modem dormido entre beacons, los paquetes salen en
  // rafagas y el frontend ve huecos de cientos de ms. Es la causa clasica de
  // los microcortes de este tipo. En AP consume mas, pero el equipo mide
  // enchufado a bateria durante sesiones de horas: la continuidad importa mas.
  WiFi.setSleep(false);

  // TX power 8.5 dBm: fix de antena del C3 Super Mini + evita brown-out USB.
  WiFi.setTxPower(WIFI_POWER_8_5dBm);

  if (!ok) {
    Serial.println("No se pudo iniciar el Access Point. Reiniciando...");
    delay(2000);
    ESP.restart();
  }

  Serial.println("Access Point activo");
  Serial.print("   Red WiFi: ");  Serial.println(AP_SSID);
  Serial.print("   Clave:    ");  Serial.println(AP_PASSWORD);
  Serial.print("   IP:       ");  Serial.println(WiFi.softAPIP());
  Serial.println("   En la Mac: conectate a la red 'Chidori' y abri la UI con IP 192.168.4.1 puerto 81");

  wifiUp = true;
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
  // En modo AP no hay reconexion que vigilar: el Access Point esta siempre
  // activo mientras el ESP tenga alimentacion. (no-op para no tocar el loop)
}

/* Línea de diagnóstico cada 10 s */
void statusTick() {
  if (millis() - last_status_ms < 10000) return;
  last_status_ms = millis();

  Serial.print("[status] estado=");
  Serial.print(Chidori.estado == MIDIENDO ? "MIDIENDO" : "INACTIVO");
  Serial.print(" · modo=AP ip="); Serial.print(WiFi.softAPIP());
  Serial.print(" · stations="); Serial.print(WiFi.softAPgetStationNum());
  Serial.print(" · clientesWS="); Serial.print(webSocket.connectedClients());
  Serial.print(" · heap="); Serial.print(ESP.getFreeHeap());
  Serial.print(" · Z="); Serial.println(Chidori.Z, 3);
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
    char buf[112];
    snprintf(buf, sizeof(buf),
             "STATUS estado=%s rssi=%d heap=%u Z=%.3f v=%.4f",
             Chidori.estado == MIDIENDO ? "MIDIENDO" : "INACTIVO",
             wifiUp ? (int)WiFi.RSSI() : 0,
             (unsigned)ESP.getFreeHeap(), Chidori.Z, last_Vpp);
    webSocket.sendTXT(num, buf);
  }
}

/* ================= ADQUISICIÓN ================= */
void adquirir_y_promediar() {
  // analogReadMilliVolts aplica la curva de calibracion de fabrica (eFuse).
  // analogRead() * 3.3 / 4095 asumia un ADC lineal, y el del ESP32-C3 no lo es:
  // el error dependia del punto de trabajo y se propagaba a Vpp y a Z.
  adc_sum += analogReadMilliVolts(ADC_PIN);
  adc_count++;

  if (adc_count < AVG_SAMPLES) return;

  float avg_mv = (float)adc_sum / AVG_SAMPLES;   // ya en milivolts calibrados
  adc_sum   = 0;
  adc_count = 0;

  float voltage = avg_mv / 1000.0f;
  float Vpp     = Amp2Vpp(voltage + VShotcky);
  float Z       = Vpp / (CORRIENTE_INYECTADA * GANANCIA_RECEPTOR);
  last_Vpp      = Vpp;                     // para el TX (dato de referencia)

  // MEDIANA primero (mata impulsos), MEDIA despues (baja ruido gaussiano)
  Z = Calcular_mediana(Z);
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
    // Formato: "<Z> <Vpp>"  (ej: "22.30942 1.5234")
    // La UI toma el 1er valor como impedancia y el 2do como tension de lectura.
    // Sigue siendo un unico snprintf sin String: costo identico al anterior.
    char msg[32];
    snprintf(msg, sizeof(msg), "%.5f %.4f", Chidori.Z, last_Vpp);
    if (wifiUp && webSocket.connectedClients() > 0) {
      webSocket.broadcastTXT(msg);
    }
    Serial.print("Z = "); Serial.println(msg);
  }
}

/* Mediana movil de MEDIANA_N · rechazo de impulsos.
 *
 * Mientras la ventana no esta llena devuelve el valor tal cual: al arrancar es
 * preferible responder que filtrar, y el WARMUP ya descarta esos primeros
 * valores. Ordena una copia (N es chico, la insercion directa es mas barata
 * que cualquier algoritmo "listo"). */
float Calcular_mediana(float Z) {
  if (med_n < MEDIANA_N) {
    med_buf[med_n++] = Z;
    if (med_n < MEDIANA_N) return Z;
  } else {
    for (int i = 0; i < MEDIANA_N - 1; i++) med_buf[i] = med_buf[i + 1];
    med_buf[MEDIANA_N - 1] = Z;
  }

  float tmp[MEDIANA_N];
  for (int i = 0; i < MEDIANA_N; i++) tmp[i] = med_buf[i];
  for (int i = 1; i < MEDIANA_N; i++) {
    float v = tmp[i];
    int j = i - 1;
    while (j >= 0 && tmp[j] > v) { tmp[j + 1] = tmp[j]; j--; }
    tmp[j + 1] = v;
  }
  return tmp[MEDIANA_N / 2];
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
  // Umbral asimetrico anti-corte: ARRANCAR es rapido (80 ms), pero PARAR
  // una medicion en curso exige un hold deliberado de 1.5 s. Asi un roce,
  // vibracion o glitch electrico NO puede frenar una sesion de horas.
  const int umbral = (Chidori.estado == INACTIVO) ? DEBOUNCE_START_CUENTAS
                                                  : DEBOUNCE_STOP_CUENTAS;
  if (digitalRead(BUTTON) == HIGH) {
    if (debounceCount < umbral) {
      debounceCount++;
      if (debounceCount >= umbral) {
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
  med_n         = 0;     // sin esto, la sesion nueva arranca con Z de la anterior
  adc_sum       = 0;
  adc_count     = 0;
  First_Measure = true;
  last_tx_ms    = millis();
}
