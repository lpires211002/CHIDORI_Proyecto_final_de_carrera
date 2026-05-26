/* =====================  PROYECTO CHIDORI ========================*/
/* ==================== ESP32-C3 OPTIMIZADO =======================*/
//
// Plataforma: ESP32-C3 Super Mini
//
// ╔══════════════════════════════════════════════════════════════╗
// ║  ⚠️  CONFIGURACIÓN OBLIGATORIA EN ARDUINO IDE  ⚠️             ║
// ║                                                              ║
// ║  Antes de cargar el sketch, en el menú Tools (Herramientas): ║
// ║                                                              ║
// ║     USB CDC On Boot:  ENABLED                                ║
// ║     Flash Size:       4MB (32Mb)                             ║
// ║     CPU Frequency:    160MHz (WiFi)                          ║
// ║     Partition Scheme: Default 4MB with spiffs                ║
// ║                                                              ║
// ║  Si "USB CDC On Boot" NO está en Enabled, los pines 20 y 21 ║
// ║  son tomados por el UART0 (Serial) y el BOTÓN (GPIO20)       ║
// ║  dejará de funcionar.                                        ║
// ╚══════════════════════════════════════════════════════════════╝
//
// Asignación de pines (verificada contra esquemático KiCAD):
//   GPIO 0  → ADC (Vout, salida del detector Schottky)
//   GPIO 4  → SPI SCK   (clk del AD9833)
//   GPIO 5  → BUZZER    (alarm)
//   GPIO 6  → SPI MOSI  (data del AD9833)
//   GPIO 7  → SPI FSYNC (fnc del AD9833)
//   GPIO 20 → BOTÓN     (SW2, pull-down 2.2k → activo en HIGH)
//
// ─────────────────────────────────────────────────────────────────
// Librerias
#include <WiFi.h>
#include <ESPmDNS.h>            // mDNS: chidori.local
#include <WebSocketsServer.h>
#include <SPI.h>
#include <stdint.h>
#include <math.h>

/* ================= ASIGNACIÓN DE PINES (ver esquemático) ================= */
#define BUZZER       5    // GPIO5  → buzzer (alarm)
#define BUTTON      20    // GPIO20 → botón SW2 (pull-down externo 2.2k)
#define ADC_PIN      0    // GPIO0  → entrada ADC (Vout del detector Schottky)
#define PIN_MOSI     6    // GPIO6  → SPI MOSI (data del AD9833)
#define PIN_SCK      4    // GPIO4  → SPI SCK  (clk del AD9833)
#define PIN_FSYNC    7    // GPIO7  → SPI FSYNC (fnc del AD9833, CS manual)

/* ================= CONSTANTES ELÉCTRICAS DEL CIRCUITO ================= */
// Generador AD9833 (verificado contra esquemático: Rfad/Riad = 4.8k/1k = 4.8)
#define VPP                 0.6      // Amplitud Vpp del AD9833 (≈ 600 mVpp)
#define R1                  10000    // Resistencia del Howland Pump (R1how1 = 10k)
#define GANANCIA_GENERADOR  4.8      // Rfad1/Riad1 = 4.8 (etapa pre-Howland)

// Cadena receptora: INA128 (G=5) → HP (G=10) → LP (G=4) ⇒ G_total = 200
#define GANANCIA_INA        5
#define GANANCIA_HIGH_PASS  10
#define GANANCIA_LOW_PASS   4
#define VShotcky            0.2      // Caída directa del Schottky BAT54S

// ADC del ESP32-C3: 12 bits, Vref ≈ 3.3 V con atenuación 11 dB (default)
#define VREF                3.3
#define RESOLUCION          4095
#define ADC(x)              ((x) * VREF / (RESOLUCION))

// El ADC mide el pico (no Vpp) gracias al detector Schottky.
// Para obtener Vpp (que es lo que se compara con I_pp del Howland) multiplicamos x2.
#define Amp2Vpp(x)          ((x) * 2.0)

/* ================= PARÁMETROS DE MUESTREO ================= */
#define FREQ                50000.0  // Frecuencia de inyección (50 kHz)
#define SAMPLE_INTERVAL_US  1428     // Muestreo ADC a ~700 Hz (1e6 / 700)
#define AVG_SAMPLES         256      // Promediador por bloque (256 muestras crudas → 1 Z)
#define TX_INTERVAL_MS      500      // ⚙️  Cadencia de envío al frontend (configurable)
// Warmup: no enviar al frontend hasta tener N muestras en el moving avg,
// para evitar transitorios inestables como referencia inicial.
#define WARMUP_MUESTRAS     5
#define CANT_MUESTRAS       10       // Tamaño del moving-average sobre Z

/* ================= PARÁMETROS DE ALARMA ================= */
// dB matemáticamente correctos (log10). Recalibrá empíricamente si hace falta.
#define UMBRAL             -1.5      // Umbral de atenuación en dB respecto a Z_ref
#define MUESTRAS_ALARMA     5        // N° de muestras consecutivas bajo umbral

// Macro dB correcta (log base 10)
#define dB(Z, Zref)         (20.0 * log10((Z) / (Zref)))

/* ================= COMANDOS AD9833 ================= */
constexpr uint16_t CMD_RESET           = 0x2100;
constexpr uint16_t CMD_EXIT_RESET_SINE = 0x2000;
constexpr uint16_t CMD_B28             = 0x2000;
constexpr uint16_t REG_FREQ0           = 0x4000;
constexpr uint16_t REG_PHASE0          = 0xC000;
constexpr double   MCLK                = 25e6;   // 25 MHz xtal del módulo

/* ================= WIFI ================= */
const char* ssid     = "Alejandra 2.4";
const char* password = "ALE67680208";

WebSocketsServer webSocket(81);

/* ================= VARIABLES GLOBALES ================= */
// Moving average de impedancia
float muestras[CANT_MUESTRAS];
int   size_m    = 0;
float average_Z = 0;

// Constantes derivadas (calculadas en setup)
float CORRIENTE_INYECTADA;   // I_pp inyectada por el Howland
float GANANCIA_RECEPTOR;     // Ganancia total de la cadena receptora

// Temporizadores no bloqueantes
unsigned long t_debounce     = 0;
unsigned long last_sample_us = 0;
unsigned long last_tx_ms     = 0;

// Acumuladores del promediador rápido (700 Hz × 256)
uint32_t adc_sum   = 0;
uint16_t adc_count = 0;

// Antirrebote del botón
bool botonConfirmado = false;
int  debounceCount   = 0;
const int DEBOUNCE_CUENTAS = 5;   // 5 × 10 ms = 50 ms

// Estado de la medición
bool First_Measure = true;
uint8_t Alarm_counter = MUESTRAS_ALARMA;

/* ================= MÁQUINA DE ESTADOS ================= */
typedef enum { INACTIVO, MIDIENDO, ALARMA } state_t;

typedef struct {
  state_t estado;
  float   Z;     // Impedancia actual (promediada)
  float   Ref;   // Impedancia de referencia (captura al iniciar)
} sensor_t;

sensor_t Chidori;

/* ================= PROTOTIPOS ================= */
void Inicializar_WIFI();
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
  // No bloqueamos esperando a Serial: con USB CDC On Boot el host puede no
  // estar conectado y el dispositivo debe arrancar igual.

  delay(100);
  Serial.println("\n=== ESP32-C3 CHIDORI OPTIMIZADO INICIADO ===");

  pinMode(BUZZER, OUTPUT);
  pinMode(BUTTON, INPUT);           // pull-down externo de 2.2k en PCB
  digitalWrite(BUZZER, LOW);

  // Cálculo de constantes derivadas
  CORRIENTE_INYECTADA = VPP * GANANCIA_GENERADOR / R1;                      // ≈ 0.288 mA pp
  GANANCIA_RECEPTOR   = GANANCIA_HIGH_PASS * GANANCIA_LOW_PASS * GANANCIA_INA; // 200

  Serial.print("I_inyectada (pp) = "); Serial.print(CORRIENTE_INYECTADA * 1000, 4); Serial.println(" mA");
  Serial.print("Ganancia receptor total = ");          Serial.println(GANANCIA_RECEPTOR);

  Chidori.estado = INACTIVO;
  Chidori.Z      = 0.0f;
  Chidori.Ref    = 0.0f;

  Inicializar_WIFI();
  Inicializar_AD9833();
}

/* ================= LOOP PRINCIPAL ================= */
void loop() {
  webSocket.loop();

  // --- Antirrebote del botón cada 10 ms ---
  if (millis() - t_debounce >= 10) {
    t_debounce = millis();
    checkButton();
  }

  // --- Muestreo ADC a 700 Hz (solo si estamos midiendo) ---
  if (Chidori.estado == MIDIENDO) {
    if (micros() - last_sample_us >= SAMPLE_INTERVAL_US) {
      last_sample_us += SAMPLE_INTERVAL_US;   // mantiene cadencia precisa
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
      // Evaluamos atenuación contra el baseline (solo si ya tenemos referencia)
      if (!First_Measure && dB(Chidori.Z, Chidori.Ref) < UMBRAL) {
        if (--Alarm_counter == 0) {
          Serial.println(">> ALARMA disparada");
          Chidori.estado = ALARMA;
        }
      } else {
        Alarm_counter = MUESTRAS_ALARMA;   // requiere muestras CONSECUTIVAS
      }

      if (botonConfirmado) {
        botonConfirmado = false;
        Serial.println(">> INACTIVO (Por boton)");
        Chidori.estado = INACTIVO;
        First_Measure  = true;
      }
      break;

    case ALARMA:
      digitalWrite(BUZZER, HIGH);
      if (botonConfirmado) {
        botonConfirmado = false;
        digitalWrite(BUZZER, LOW);
        Serial.println(">> INACTIVO (Alarma silenciada por boton)");
        Chidori.estado = INACTIVO;
        First_Measure  = true;
      }
      break;
  }
}

/* ================= INICIALIZACIONES ================= */
void Inicializar_WIFI() {
  Serial.println("Conectando WiFi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\n❌ WiFi no conectado (sigue funcionando offline)");
    return;
  }

  Serial.println("\n✅ WiFi conectado");
  Serial.print("IP: "); Serial.println(WiFi.localIP());

  if (MDNS.begin("chidori")) {
    Serial.println("✅ mDNS iniciado → ws://chidori.local:81");
    MDNS.addService("ws", "tcp", 81);
  } else {
    Serial.println("❌ Error al iniciar mDNS");
  }

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
}

void Inicializar_AD9833() {
  pinMode(PIN_FSYNC, OUTPUT);
  digitalWrite(PIN_FSYNC, HIGH);

  // CS manejado manualmente → pasamos -1 como SS al driver SPI
  SPI.begin(PIN_SCK, -1, PIN_MOSI, -1);
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE2));

  ad9833Begin(FREQ);
  Serial.println("✅ AD9833 inicializado a 50 kHz (seno)");
}

/* ================= AD9833 ================= */
void ad9833Write(uint16_t data) {
  digitalWrite(PIN_FSYNC, LOW);
  SPI.transfer16(data);
  digitalWrite(PIN_FSYNC, HIGH);
  delayMicroseconds(1);    // requerido por datasheet
}

void ad9833SetFrequency(double freqHz) {
  uint32_t freqWord = (uint32_t)((freqHz * (1UL << 28)) / MCLK);
  ad9833Write(CMD_B28);
  ad9833Write(REG_FREQ0 | (freqWord & 0x3FFF));
  ad9833Write(REG_FREQ0 | ((freqWord >> 14) & 0x3FFF));
}

void ad9833Begin(double freqHz) {
  ad9833Write(CMD_RESET);
  ad9833SetFrequency(freqHz);
  ad9833Write(REG_PHASE0);
  ad9833Write(CMD_EXIT_RESET_SINE);
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
// Llamada a 700 Hz desde el loop. Acumula 256 muestras → calcula Z → moving average → TX.
void adquirir_y_promediar() {
  adc_sum += analogRead(ADC_PIN);
  adc_count++;

  if (adc_count < AVG_SAMPLES) return;

  // ---- Bloque completo: calcular impedancia ----
  float avg_adc = (float)adc_sum / AVG_SAMPLES;
  adc_sum   = 0;
  adc_count = 0;

  float voltage = ADC(avg_adc);                              // V medido por el ADC (pico - V_Schottky)
  float Vpp     = Amp2Vpp(voltage + VShotcky);               // recupero el Vpp real sobre Z
  float Z       = Vpp / (CORRIENTE_INYECTADA * GANANCIA_RECEPTOR);

  Calcular_promedio(Z);
  Chidori.Z = average_Z;

  // ---- WARMUP GATE: descartar transitorios iniciales ----
  if (size_m < WARMUP_MUESTRAS) {
    Serial.print("[warmup] muestra "); Serial.print(size_m);
    Serial.print("/"); Serial.print(WARMUP_MUESTRAS);
    Serial.print(" · Z parcial = "); Serial.println(Chidori.Z, 3);
    return;
  }

  // Primera medición tras el warmup → capturo baseline ESTABLE
  if (First_Measure) {
    Chidori.Ref   = Chidori.Z;
    First_Measure = false;
    Serial.print("⭐ Z_ref calibrada (post-warmup): "); Serial.print(Chidori.Ref, 3); Serial.println(" Ω");
  }

  // ---- Transmisión al frontend con cadencia configurable ----
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
// Lógica HIGH-activo: pull-down externo 2.2k → flanco a 3V3 al apretar
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
// Reinicia todos los buffers y contadores entre sesiones de medición
void resetMedicion() {
  size_m        = 0;
  average_Z     = 0;
  adc_sum       = 0;
  adc_count     = 0;
  Alarm_counter = MUESTRAS_ALARMA;
  First_Measure = true;
  last_tx_ms    = millis();
}
