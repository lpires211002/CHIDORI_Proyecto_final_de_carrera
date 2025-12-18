/* =====================  PROYECTO CHIDORI ========================*/
/* ========= ADAPTADO A ESP32-C3 SUPER MINI ======================*/

#include <WiFi.h>
#include <WebSocketsServer.h>
#include <SPI.h>
#include <math.h>

/* ================= DEFINES ================= */

// Pines (AJUSTAR SEGÚN TU PLACA)
#define BUZZER     21
#define BUTTON     20
#define ADC_PIN     3
#define PIN_MOSI    6
#define PIN_SCK     4
#define PIN_FSYNC   7

// Constantes eléctricas
#define VPP 0.6
#define R1 10000
#define VREF 3.3
#define RESOLUCION 4095   // ADC ESP32
#define ADC(x) ((x)*VREF/(RESOLUCION))

// Ganancias
#define GANANCIA_GENERADOR 4.8
#define GANANCIA_HIGH_PASS 10
#define GANANCIA_LOW_PASS  4
#define GANANCIA_INA       5
#define VShotcky           0.2

// Medición
#define FREQ           50000
#define T_MUESTREO_MS  1000
#define T_ENVIO_DATOS  10
#define UMBRAL        -1.5
#define MUESTRAS_ALARMA 5
#define CANT_MUESTRAS 10

#define dB(Z,Zref) (20*log10((Z)/(Zref)))

// AD9833
constexpr uint16_t CMD_RESET           = 0x2100;
constexpr uint16_t CMD_EXIT_RESET_SINE = 0x2000;
constexpr uint16_t CMD_B28             = 0x2000;
constexpr uint16_t REG_FREQ0           = 0x4000;
constexpr uint16_t REG_PHASE0          = 0xC000;
constexpr double   MCLK                = 25e6;

/* ================= WIFI ================= */

const char* ssid     = "Alejandra 2.4";
const char* password = "ALE67680208";

WebSocketsServer webSocket(81);

/* ================= VARIABLES ================= */

float muestras[CANT_MUESTRAS];
int   size_m = 0;
float average_Z = 0;

float CORRIENTE_INYECTADA;
float GANANCIA_RECEPTOR;

unsigned long t_medir = 0;
int Counter = T_ENVIO_DATOS;

bool botonConfirmado = false;
int  debounceCount   = 0;
const int DEBOUNCE_CUENTAS = 5;

bool First_Measure = true;
float Zref;
uint8_t Alarm_counter = MUESTRAS_ALARMA;

/* ================= ESTADOS ================= */

typedef enum { INACTIVO, MIDIENDO, ALARMA } state_t;

typedef struct {
  state_t estado;
  float Z;
  float Ref;
} sensor_t;

sensor_t Chidori;

/* ================= PROTOTIPOS ================= */

void Inicializar_WIFI();
void Inicializar_AD9833();
void ad9833Write(uint16_t data);
void ad9833SetFrequency(double freqHz);
void ad9833Begin(double freqHz);
void webSocketEvent(uint8_t, WStype_t, uint8_t*, size_t);
void Medir_Impedancia();
void Calcular_promedio(float Z);
void checkButton();

/* ================= SETUP ================= */

void setup() {

  Serial.begin(115200);
  while (!Serial) delay(10);

  Serial.println("\n=== ESP32-C3 CHIDORI INICIADO ===");

  pinMode(BUZZER, OUTPUT);
  pinMode(BUTTON, INPUT);
  digitalWrite(BUZZER, LOW);

  CORRIENTE_INYECTADA = VPP * GANANCIA_GENERADOR / R1;
  GANANCIA_RECEPTOR   = GANANCIA_HIGH_PASS * GANANCIA_LOW_PASS * GANANCIA_INA;

  Chidori.estado = INACTIVO;

  Inicializar_WIFI();
  Inicializar_AD9833();
}

/* ================= LOOP ================= */

void loop() {

  webSocket.loop();
  checkButton();

  if (millis() - t_medir >= T_MUESTREO_MS) {
    t_medir = millis();
    Medir_Impedancia();
  }

  switch (Chidori.estado) {

    case INACTIVO:
      digitalWrite(BUZZER, LOW);
      if (botonConfirmado) {
        botonConfirmado = false;
        Serial.println(">> MIDIENDO");
        Chidori.estado = MIDIENDO;
      }
      break;

    case MIDIENDO:
      if (!First_Measure && dB(Chidori.Z, Chidori.Ref) < UMBRAL) {
        if (--Alarm_counter == 0) {
          Chidori.estado = ALARMA;
        }
      }
      if (botonConfirmado) {
        botonConfirmado = false;
        Chidori.estado = INACTIVO;
      }
      break;

    case ALARMA:
      digitalWrite(BUZZER, HIGH);
      if (botonConfirmado) {
        botonConfirmado = false;
        digitalWrite(BUZZER, LOW);
        Chidori.estado = INACTIVO;
      }
      break;
  }
}

/* ================= FUNCIONES ================= */

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
    Serial.println("\n❌ WiFi no conectado");
    return;
  }

  Serial.println("\n✅ WiFi conectado");
  Serial.println(WiFi.localIP());

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
}

void Inicializar_AD9833() {

  pinMode(PIN_FSYNC, OUTPUT);
  digitalWrite(PIN_FSYNC, HIGH);

  SPI.begin(PIN_SCK, -1, PIN_MOSI, PIN_FSYNC);
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE2));

  ad9833Begin(FREQ);
}

void ad9833Write(uint16_t data) {
  digitalWrite(PIN_FSYNC, LOW);
  SPI.transfer16(data);
  digitalWrite(PIN_FSYNC, HIGH);
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

void Medir_Impedancia() {

  int adc = analogRead(ADC_PIN);
  float voltage = ADC(adc);

  float Z = (voltage + VShotcky) /
            (CORRIENTE_INYECTADA * GANANCIA_RECEPTOR);

  Calcular_promedio(Z);
  Chidori.Z = average_Z;

  if (--Counter <= 0) {

    if (First_Measure) {
      Chidori.Ref = Chidori.Z;
      First_Measure = false;
    }

    String msg = String(Chidori.Z, 5);
    webSocket.broadcastTXT(msg);

    Serial.print("Z = ");
    Serial.println(msg);

    Counter = T_ENVIO_DATOS;
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

void checkButton() {
  if (digitalRead(BUTTON)) {
    if (++debounceCount >= DEBOUNCE_CUENTAS) {
      botonConfirmado = true;
      debounceCount = DEBOUNCE_CUENTAS;
    }
  } else debounceCount = 0;
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_TEXT) {
    Serial.print("WS: ");
    Serial.println((char*)payload);
  }
}
