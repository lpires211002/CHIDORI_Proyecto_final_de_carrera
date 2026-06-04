/* =====================  PROYECTO CHIDORI ========================*/
/* ===== ESP32-C3 SUPER MINI · CON PORTAL DE CONFIGURACIÓN WiFi ====*/
//
// Variante del firmware optimizado que añade auto-configuración WiFi
// mediante WiFiManager (portal cautivo). Las credenciales NO viven más
// en el código fuente: se ingresan una vez desde el navegador del
// celular y quedan persistidas en el flash del ESP32-C3.
//
// ╔══════════════════════════════════════════════════════════════╗
// ║  ⚠️  CONFIGURACIÓN OBLIGATORIA EN ARDUINO IDE  ⚠️             ║
// ║                                                              ║
// ║  Boards Manager:    esp32 by Espressif Systems ≥ 3.0.0       ║
// ║  Library Manager:   WiFiManager by tzapu      ≥ 2.0.17       ║
// ║                                                              ║
// ║  Board:                ESP32C3 Dev Module                    ║
// ║  USB CDC On Boot:      ENABLED                               ║
// ║  CPU Frequency:        160MHz (WiFi)                         ║
// ║  Flash Size:           4MB (32Mb)                            ║
// ║  Partition Scheme:     Default 4MB with spiffs               ║
// ╚══════════════════════════════════════════════════════════════╝
//
// FLUJO DE WiFi (primera vez):
//   1. Encender el dispositivo.
//   2. Desde el celular, conectarse a la red WiFi llamada
//      "Chidori-Setup" (sin contraseña por defecto).
//   3. Esperar a que se abra automáticamente el portal cautivo.
//      Si no abre, visitar manualmente http://192.168.4.1
//   4. Click "Configure WiFi" → seleccionar la red de la casa o
//      del consultorio, tipear la contraseña, Save.
//   5. El ESP guarda las credenciales en flash y se reinicia.
//   6. A partir de ahora arranca conectado a esa red.
//
// FLUJO DE WiFi (siguientes booteos):
//   1. Encender. Conecta solo a la última red configurada en ~3s.
//   2. Si falla 3 veces seguidas (red caída, contraseña cambiada,
//      etc.) levanta otra vez el portal "Chidori-Setup".
//
// RESET MANUAL DE CREDENCIALES (factory reset):
//   - Mantener apretado el botón mientras se enciende el dispositivo,
//     por 5 segundos. El firmware borra el flash WiFi y reinicia
//     en modo portal.
//
// Asignación de pines (verificada contra esquemático KiCAD):
//   GPIO 0  → ADC (Vout, salida del detector Schottky)
//   GPIO 4  → SPI SCK   (clk del AD9833)
//   GPIO 5  → BUZZER    (alarm)
//   GPIO 6  → SPI MOSI  (data del AD9833)
//   GPIO 7  → SPI FSYNC (fnc del AD9833)
//   GPIO 20 → BOTÓN     (SW2, pull-down externo 2.2k → activo en HIGH)
// ─────────────────────────────────────────────────────────────────

#include <WiFi.h>
#include <WiFiManager.h>          // ★ NUEVO · portal de configuración
#include <ESPmDNS.h>
#include <WebSocketsServer.h>
#include <SPI.h>
#include <stdint.h>
#include <math.h>

/* ================= ASIGNACIÓN DE PINES (esquemático) ================= */
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
#define FREQ                50000.0
#define SAMPLE_INTERVAL_US  1428
// AVG_SAMPLES 128 @ 700 Hz = ~183 ms por valor de Z. Con la señal tan estable
// que vimos (±0.05 Ω con 256), bajar a 128 mantiene calidad de sobra y duplica
// la velocidad. Si querés aún más fluido bajalo a 64; si querés menos ruido
// (paciente con movimiento) subilo a 256.
#define AVG_SAMPLES         128
#define TX_INTERVAL_MS      250     // ★ Cadencia de envío al frontend · ~4 Hz
#define CANT_MUESTRAS       10
// No enviar datos al frontend hasta que el moving average tenga al menos
// N muestras, para evitar que el primer valor (transitorio inestable)
// quede como referencia inicial del paciente.
#define WARMUP_MUESTRAS     5

/* ================= ALARMA ================= */
#define UMBRAL             -1.5
#define MUESTRAS_ALARMA     5
#define dB(Z, Zref)         (20.0 * log10((Z) / (Zref)))

/* ================= AD9833 ================= */
constexpr uint16_t CMD_RESET           = 0x2100;
constexpr uint16_t CMD_EXIT_RESET_SINE = 0x2000;
constexpr uint16_t CMD_B28             = 0x2000;
constexpr uint16_t REG_FREQ0           = 0x4000;
constexpr uint16_t REG_PHASE0          = 0xC000;
constexpr double   MCLK                = 25e6;

/* ================= WiFi / PORTAL ================= */
// Nombre del Access Point que aparece cuando el ESP necesita configuración
const char* PORTAL_SSID     = "Chidori-Setup";
// macOS rechaza redes abiertas por seguridad; con password (WPA2) conecta sin
// problemas. La password se le da al clínico/admin junto con instrucciones.
const char* PORTAL_PASSWORD = "chidori123";        // min 8 chars · WPA2
// Hostname mDNS publicado en la red local. Resoluble como chidori.local
const char* MDNS_HOSTNAME   = "chidori";
// Tiempo máximo (segundos) que el portal espera al usuario antes de
// reiniciar e intentar conectar de nuevo
const uint16_t PORTAL_TIMEOUT_S = 180;
// Tiempo máximo (segundos) que tarda en cada intento de conexión a la
// red guardada antes de levantar el portal de nuevo
const uint16_t CONNECT_TIMEOUT_S = 15;
// Cuántos segundos hay que mantener apretado el botón al boot para
// disparar el factory reset de las credenciales WiFi
const uint16_t FACTORY_RESET_HOLD_MS = 5000;

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

uint32_t adc_sum   = 0;
uint16_t adc_count = 0;

bool botonConfirmado = false;
int  debounceCount   = 0;
const int DEBOUNCE_CUENTAS = 5;

bool First_Measure = true;
uint8_t Alarm_counter = MUESTRAS_ALARMA;

/* ================= MÁQUINA DE ESTADOS =================
 * NOTA · La alarma se evalúa ÚNICAMENTE en el frontend, donde el clínico
 * configura el threshold y el tipo (abs / % / Δ). El firmware actúa como
 * sensor "dumb": solo mide y transmite. El estado ALARMA queda como
 * compatibilidad pero NO se entra por umbral interno — solo si el frontend
 * envía un comando explícito (futuro: BUZZER_ON).
 */
typedef enum { INACTIVO, MIDIENDO, ALARMA } state_t;

typedef struct {
  state_t estado;
  float   Z;
  float   Ref;
} sensor_t;

sensor_t Chidori;

/* ================= PROTOTIPOS ================= */
void Inicializar_WiFiManager();
void checkFactoryResetButton();
void Inicializar_AD9833();
void ad9833Write(uint16_t data);
void ad9833SetFrequency(double freqHz);
void ad9833Begin(double freqHz);
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length);
void adquirir_y_promediar();
void Calcular_promedio(float Z);
void checkButton();
void resetMedicion();

/* ================= SETUP ================= */
void setup() {
  Serial.begin(115200);
  delay(150);
  Serial.println("\n=== ESP32-C3 CHIDORI · WiFiManager edition ===");

  pinMode(BUZZER, OUTPUT);
  pinMode(BUTTON, INPUT);            // pull-down externo de 2.2k en PCB
  digitalWrite(BUZZER, LOW);

  // Si el botón está apretado al boot, ofrecer factory reset
  checkFactoryResetButton();

  // Cálculos derivados
  CORRIENTE_INYECTADA = VPP * GANANCIA_GENERADOR / R1;
  GANANCIA_RECEPTOR   = GANANCIA_HIGH_PASS * GANANCIA_LOW_PASS * GANANCIA_INA;
  Serial.print("I_inyectada (pp) = "); Serial.print(CORRIENTE_INYECTADA * 1000, 4); Serial.println(" mA");
  Serial.print("Ganancia receptor total = ");          Serial.println(GANANCIA_RECEPTOR);

  Chidori.estado = INACTIVO;
  Chidori.Z      = 0.0f;
  Chidori.Ref    = 0.0f;

  // ★ NUEVO · WiFi con portal de configuración
  Inicializar_WiFiManager();
  Inicializar_AD9833();
}

/* ================= LOOP PRINCIPAL ================= */
void loop() {
  webSocket.loop();

  // Antirrebote del botón cada 10 ms
  if (millis() - t_debounce >= 10) {
    t_debounce = millis();
    checkButton();
  }

  // Muestreo ADC a 700 Hz solo si estamos midiendo
  if (Chidori.estado == MIDIENDO) {
    if (micros() - last_sample_us >= SAMPLE_INTERVAL_US) {
      last_sample_us += SAMPLE_INTERVAL_US;
      adquirir_y_promediar();
    }
  }

  switch (Chidori.estado) {
    case INACTIVO:
      digitalWrite(BUZZER, LOW);
      if (botonConfirmado) {
        botonConfirmado = false;
        Serial.println(">> MIDIENDO (Por boton)");
        resetMedicion();
        Chidori.estado = MIDIENDO;
        last_sample_us = micros();
      }
      break;

    case MIDIENDO:
      // Sin evaluación de alarma local · el frontend decide si dispara
      // alerta según el threshold que el clínico haya configurado.
      digitalWrite(BUZZER, LOW);
      if (botonConfirmado) {
        botonConfirmado = false;
        Serial.println(">> INACTIVO (Por boton)");
        Chidori.estado = INACTIVO;
        First_Measure  = true;
      }
      break;

    case ALARMA:
      // Estado mantenido por compatibilidad. Hoy NO se entra
      // automáticamente — solo si se agrega un comando WS futuro
      // tipo "BUZZER_ON". Por ahora, el buzzer queda apagado.
      digitalWrite(BUZZER, LOW);
      if (botonConfirmado) {
        botonConfirmado = false;
        digitalWrite(BUZZER, LOW);
        Serial.println(">> INACTIVO (Por boton)");
        Chidori.estado = INACTIVO;
        First_Measure  = true;
      }
      break;
  }
}

/* ─────────────────────────────────────────────────────────────────────
 *  WiFi via portal cautivo (WiFiManager)
 *
 *  - autoConnect() intenta conectar a las credenciales guardadas en flash.
 *  - Si nunca se configuró o falla la conexión, levanta el AP del portal
 *    y bloquea hasta que el usuario configure (con un timeout de 3 min).
 *  - Si pasados los 3 min nadie configura, reinicia el dispositivo para
 *    reintentar (útil ante cortes momentáneos sin que quede atascado).
 * ───────────────────────────────────────────────────────────────────── */
void Inicializar_WiFiManager() {
  WiFiManager wm;

  // Comportamiento del portal
  wm.setConfigPortalTimeout(PORTAL_TIMEOUT_S);
  wm.setConnectTimeout(CONNECT_TIMEOUT_S);
  wm.setHostname(MDNS_HOSTNAME);

  // Limpieza visual del portal
  wm.setTitle("Chidori · Configuración WiFi");
  wm.setShowInfoErase(true);          // botón "Erase WiFi config"
  wm.setBreakAfterConfig(true);       // tras guardar, devolver control al sketch
  wm.setDarkMode(true);

  // Texto explicativo encima del scan de redes
  const char* CUSTOM_HTML =
    "<p style='font-family:system-ui;font-size:13px;color:#666;line-height:1.5;margin:14px 0;'>"
    "Seleccioná la red WiFi a la que querés que se conecte el dispositivo Chidori. "
    "Las credenciales se guardan en el dispositivo, no se transmiten a ningún servidor."
    "</p>";
  wm.setCustomHeadElement(CUSTOM_HTML);

  Serial.println("Conectando WiFi…");
  Serial.print("  AP de respaldo: "); Serial.println(PORTAL_SSID);

  bool connected;
  if (strlen(PORTAL_PASSWORD) > 0) {
    connected = wm.autoConnect(PORTAL_SSID, PORTAL_PASSWORD);
  } else {
    connected = wm.autoConnect(PORTAL_SSID);
  }

  if (!connected) {
    Serial.println("❌ No se pudo conectar ni configurar dentro del timeout.");
    Serial.println("   Reiniciando para reintentar…");
    delay(2000);
    ESP.restart();
  }

  Serial.println("✅ WiFi conectado");
  Serial.print("   SSID: ");  Serial.println(WiFi.SSID());
  Serial.print("   IP:   ");  Serial.println(WiFi.localIP());
  Serial.print("   RSSI: ");  Serial.print(WiFi.RSSI()); Serial.println(" dBm");

  // ★ CRÍTICO · desactivar WiFi Power Save
  // Por default ESP32 entra en WIFI_PS_MIN_MODEM que acumula paquetes y los
  // envía en ráfagas cada 100ms-10s (depende del DTIM del router). Para
  // streaming en tiempo real necesitamos modem siempre activo.
  // Trade-off: ~20mA más de consumo (irrelevante para uso con USB).
  WiFi.setSleep(false);
  Serial.println("✅ WiFi power save DESACTIVADO (latencia mínima)");

  // NOTA: NO seteamos TxPower al máximo · eso causa picos de corriente
  // (>200mA pico) que pueden disparar brown-out con cables USB marginales
  // y resetear el USB CDC ("not connected" cada vez que reconectás).
  // El default del core (~11-15 dBm) alcanza para RSSI hasta -75 dBm.

  if (MDNS.begin(MDNS_HOSTNAME)) {
    MDNS.addService("ws", "tcp", 81);
    Serial.print("✅ mDNS iniciado → ws://"); Serial.print(MDNS_HOSTNAME); Serial.println(".local:81");
  } else {
    Serial.println("❌ Error al iniciar mDNS (chidori.local no resoluble)");
  }

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
}

/* ─────────────────────────────────────────────────────────────────────
 *  Factory reset · si el botón está apretado al boot, esperamos 5s
 *  sostenidos para confirmar y entonces borramos credenciales WiFi.
 *  Esto le da al clínico una forma de cambiar de red sin reflashear.
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
      wm.resetSettings();              // wipes saved SSID + password
      // Beep de confirmación: 3 tonos cortos
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
  Serial.println("→ Botón soltado antes del umbral. Continuando normalmente.");
}

/* ================= INICIALIZACIÓN DEL AD9833 ================= */
void Inicializar_AD9833() {
  pinMode(PIN_FSYNC, OUTPUT);
  digitalWrite(PIN_FSYNC, HIGH);
  SPI.begin(PIN_SCK, -1, PIN_MOSI, -1);   // CS manejado manualmente
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE2));
  ad9833Begin(FREQ);
  Serial.println("✅ AD9833 inicializado a 50 kHz (seno)");
}

/* Envía una palabra de 16 bits al AD9833.
 * Usamos dos transfers de 8 bits para garantizar MSB-first independiente
 * del endianness del SoC (ESP32-C3 es RISC-V little-endian). */
void ad9833Write(uint16_t data) {
  digitalWrite(PIN_FSYNC, LOW);
  delayMicroseconds(1);                  // tCSS · setup time CS-to-SCK
  SPI.transfer((uint8_t)(data >> 8));    // MSB primero (D15-D8)
  SPI.transfer((uint8_t)(data & 0xFF));  // LSB después (D7-D0)
  digitalWrite(PIN_FSYNC, HIGH);
  delayMicroseconds(2);                  // tCSH · hold time + recovery
}

/* Calcula el freqWord para la frecuencia pedida.
 * IMPORTANTE: NO reescribe el control register para no salir del modo
 * RESET durante el setup. Eso lo hace ad9833Begin() al final. */
void ad9833SetFrequency(double freqHz) {
  uint32_t freqWord = (uint32_t)((freqHz * (1UL << 28)) / MCLK);
  // Escribimos LSB primero, MSB después (orden requerido cuando B28=1)
  ad9833Write(REG_FREQ0 | (uint16_t)(freqWord        & 0x3FFF));
  ad9833Write(REG_FREQ0 | (uint16_t)((freqWord >> 14) & 0x3FFF));
}

/* Secuencia oficial de init según AD9833 datasheet / AN-1070:
 *   1. Control: B28=1, RESET=1  (mantiene salida en cero durante setup)
 *   2. FREQ0 LSB
 *   3. FREQ0 MSB
 *   4. PHASE0 (opcional)
 *   5. Control: B28=1, RESET=0  (recién aquí arranca la senoidal)
 */
void ad9833Begin(double freqHz) {
  // 1. Mantener RESET activo durante toda la configuración
  ad9833Write(CMD_RESET);                  // 0x2100 · B28=1, RESET=1
  delayMicroseconds(5);

  // 2-3. Cargar la frecuencia (2 escrituras consecutivas a FREQ0)
  ad9833SetFrequency(freqHz);

  // 4. Fase 0 (no estrictamente necesaria pero deja un estado conocido)
  ad9833Write(REG_PHASE0 | 0x0000);

  delayMicroseconds(5);

  // 5. Liberar RESET → empieza a generar la senoidal
  ad9833Write(CMD_EXIT_RESET_SINE);        // 0x2000 · B28=1, RESET=0, modo seno
}

/* ================= WEBSOCKET ================= */
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  if (type != WStype_TEXT) return;

  String command = String((char*)payload);
  Serial.print("Comando WS: "); Serial.println(command);

  if (command == "START" && Chidori.estado == INACTIVO) {
    resetMedicion();
    Chidori.estado = MIDIENDO;
    last_sample_us = micros();
    Serial.println(">> MIDIENDO (Por comando WS)");
  }
  else if (command == "STOP") {
    Chidori.estado = INACTIVO;
    digitalWrite(BUZZER, LOW);
    First_Measure  = true;
    Serial.println(">> INACTIVO (STOP por WS)");
  }
  else if (command == "RESET") {
    Chidori.estado = INACTIVO;
    digitalWrite(BUZZER, LOW);
    resetMedicion();
    Serial.println(">> INACTIVO (RESET por WS)");
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

  // ── WARMUP GATE ──────────────────────────────────────────────────
  // No transmitimos ni calibramos referencia hasta tener suficientes
  // muestras en el moving average. Las primeras lecturas son ruido
  // transitorio y no deben quedar como Z_ref del paciente.
  if (size_m < WARMUP_MUESTRAS) {
    Serial.print("[warmup] muestra "); Serial.print(size_m);
    Serial.print("/"); Serial.print(WARMUP_MUESTRAS);
    Serial.print(" · Z parcial = "); Serial.println(Chidori.Z, 3);
    return;
  }

  if (First_Measure) {
    Chidori.Ref   = Chidori.Z;
    First_Measure = false;
    Serial.print("⭐ Z_ref calibrada (post-warmup): "); Serial.print(Chidori.Ref, 3); Serial.println(" Ω");
  }

  if (millis() - last_tx_ms >= TX_INTERVAL_MS) {
    last_tx_ms = millis();
    String msg = String(Chidori.Z, 5);
    if (webSocket.connectedClients() > 0) {
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
  Alarm_counter = MUESTRAS_ALARMA;
  First_Measure = true;
  last_tx_ms    = millis();
}
