/* =====================  PROYECTO CHIDORI ========================*/
/* ==================== ESP8266 OPTIMIZADO ========================*/

// Plataforma: ESP8266 

// Librerias
#include <ESP8266WiFi.h> // Libreria WIFI
#include <ESP8266mDNS.h> // Libreria mDNS para chidori.local
#include <WebSocketsServer.h> // Libreria WebSocket
#include <TickTwo.h> // Libreria de interrupciones por software
#include <SPI.h> // Libreria de protocolos SPI
#include <stdint.h>
#include <math.h>

/* ===== Definiciones y Macros ===== */

// Pines alarma y boton
#define BUZZER 5 // D1 = GPIO5
#define BUTTON 15 // D7 = GPIO15

// Constantes del circuito
#define VPP 0.6 // Amplitud del generador de ondas Vpp
#define R1 10000 // Resistencia del Howland
#define VREF 3.3 // Tension de referencia del ADC del NodeMcu ESP8266
#define RESOLUCION 1024 // Resolucion del adc interno
#define ADC(X) (X*VREF/(RESOLUCION-1)) // Macro para el calculo adc

// Ganancias del circuito
#define GANANCIA_GENERADOR 4.8
#define GANANCIA_HIGH_PASS 10
#define GANANCIA_LOW_PASS 4
#define GANANCIA_INA 5
#define VShotcky 0.2 // Caida Diodica del Schotcky

// Definiciones respecto al muestreo de alta velocidad
#define FREQ 50e3 // frecuencia de trabajo (50 kHz)
#define SAMPLE_INTERVAL_US 1428 // Intervalo para 700 Hz (1000000 us / 700 ≈ 1428 us)
#define AVG_SAMPLES 256 // Promediador de 256 muestras antes de transmitir
#define UMBRAL -1.5 // Nivel de umbral de alerta en decibeles
#define MUESTRAS_ALARMA 5 // Cantidad de muestras que permito debajo del nivel de alarma
#define CANT_MUESTRAS 10 // Cantidad de muestras que promedio

// Conversion de unidades
#define s2ms(x) (x*1000) // pasar de segundos a milisegundos
#define ms2s(x) (x*0.001) // pasar de milis a segundos

// Pasaje vpp a amplitud
#define Amp2Vpp(x) (x*2) // Paso de amplitud a vpp
#define Vpp2Amp(x) (x/2) // Paso de Vpp a Amp

// Calculo de Decibeles
#define dB(Z,Zref) (20*log10(Z/Zref)) 

// === CONFIGURACIÓN DE PINES SPI ===
constexpr uint8_t PIN_FSYNC = 4;  // D2 = GPIO4 (FSYNC)
constexpr uint32_t SPI_CLK_HZ = 1000000; // 1 MHz: seguro y validado

// === COMANDOS AD9833 ===
constexpr uint16_t CMD_RESET            = 0x2100;
constexpr uint16_t CMD_EXIT_RESET_SINE  = 0x2000;
constexpr uint16_t CMD_B28              = 0x2000;
constexpr uint16_t REG_FREQ0            = 0x4000;
constexpr uint16_t REG_PHASE0           = 0xC000;

constexpr double MCLK = 25e6; // 25 MHz frecuencia del CLK del AD9833


/* ==== Variables Globales ====== */

float muestras[CANT_MUESTRAS] = {0}; // defino un vector con mis muestras de impedancia
int size = 0; // ire moviendo el indice para hacer un moving average
float average_Z = 0; // defino el promedio de muestras

// Acumuladores para el promediador de 256 muestras a 700 Hz
uint32_t adc_sum = 0;
uint16_t adc_count = 0;
unsigned long last_sample_us = 0;

// Definicion maquina de estados
typedef enum {
  INACTIVO, 
  MIDIENDO,
  ALARMA
} state_t;

// Concentro toda la actividad de chidori en una estructura que contenga su estado y el valor medido
typedef struct {
  state_t estado;
  float Z;
  float Ref;
} sensor_t;

// Creo mi variable Chidori
sensor_t Chidori;

// ==== Configuración WIFI =====
const char* ssid = "Alejandra 2.4"; // Introducir Red WiFi
const char* password = "ALE67680208";  // Introducir contraseña de la red

// Configuración del WebSocket en el puerto 81
WebSocketsServer webSocket(81);

bool measuring = false; // Bandera para indicar si se está midiendo

// Corrientes y ganancias
float CORRIENTE_INYECTADA = VPP*GANANCIA_GENERADOR/R1; // Corriente inyectada del howland
float GANANCIA_RECEPTOR = GANANCIA_HIGH_PASS * GANANCIA_LOW_PASS * GANANCIA_INA; // Ganancia total del receptor

// Variables utilizadas para el debounce system
const int DEBOUNCE_CUENTAS = 5;    // 5 * 10 ms = 50 ms
int  countHigh             = 0;
bool botonConfirmado       = false;

// Variable de Referencia 
bool First_Measure =  true;
uint8_t Alarm_counter = MUESTRAS_ALARMA; // cantidad de muestras que tomo debajo del umbral antes de la alarma

// Prototipos de funciones
void Hw_Init(void); // Seteo de todo el hardware
void Inicializar_Buzzer(void); // Seteo del Buzzer
void Inicializar_Boton(void);  // Seteo del Boton
void Inicializar_WIFI(void); // Seteo del Wifi
void Inicializar_AD9833(void); // Seteo del Modulo AD9833
void ad9833Begin(double freqHz); // Inicia al AD9833 mediante SPI
void ad9833Write(uint16_t data); // Envia un comando al modulo AD9833
void ad9833SetFrequency(double freqHz); // Setea la frecuencia
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length); // Configuracion WIFI
void adquirir_y_promediar(); // adquiere muestras a 700Hz y las promedia en 256
void Calcular_promedio(float *vec, float Z); // Calcula el promedio
void checkButton(); // Filtro para el boton

// Timers
TickTwo timer_debounce(checkButton, 10); // Interrupcion para debounce del boton

void setup() {
  Chidori.estado = INACTIVO; // Inicializo Chidori en el estado base
  Hw_Init();
}

void loop() {
  webSocket.loop();
  timer_debounce.update();
  MDNS.update(); // Actualiza el mDNS resolver

  // --- MUESTREO DE ALTA VELOCIDAD (700 Hz) EN SEGUNDO PLANO ---
  if (Chidori.estado == MIDIENDO) {
    if (micros() - last_sample_us >= SAMPLE_INTERVAL_US) {
      last_sample_us = micros();
      adquirir_y_promediar();
    }
  }

  switch (Chidori.estado) {
    case INACTIVO:
      digitalWrite(BUZZER, LOW);
      if (botonConfirmado) {
        botonConfirmado = false;
        Serial.println(">> MIDIENDO (Por boton)");
        measuring = true;
        Chidori.estado  = MIDIENDO;
        last_sample_us = micros(); // Sincroniza marca de tiempo
      }
      break;

    case MIDIENDO:
      // Evaluamos la atenuación en decibeles respecto al baseline
      if (!First_Measure && dB(Chidori.Z, Chidori.Ref) < UMBRAL) {
        Alarm_counter--;
        Serial.print("⚠️ Caida detectada! Muestras restantes para Alarma: ");
        Serial.println(Alarm_counter);
      } else {
        Alarm_counter = MUESTRAS_ALARMA; // Resetea si se recupera
      }

      if (Alarm_counter == 0) {
        First_Measure = true; // Levanto el flag para la proxima medicion
        Chidori.estado = ALARMA;
      }

      // Volver a INACTIVO si vuelve a pulsar el boton físico
      if (botonConfirmado) {
        botonConfirmado = false;
        Serial.println(">> INACTIVO (Por boton)");
        measuring = false;
        First_Measure = true;
        Chidori.estado  = INACTIVO;
      }
      break;

    case ALARMA:
      Alarm_counter = MUESTRAS_ALARMA;
      digitalWrite(BUZZER, HIGH);
      if (botonConfirmado) {
        Serial.println(">> INACTIVO (Alarma silenciada por boton)");
        botonConfirmado = false;
        measuring = false;
        Chidori.estado  = INACTIVO;
      }
      break;
  }
}

// === FUNCIONES ===

void Hw_Init() {
  Serial.begin(115200);
  Inicializar_Buzzer();
  Inicializar_Boton();
  Inicializar_WIFI();
  Inicializar_AD9833();
  return;
}

void Inicializar_Buzzer() {
  pinMode(BUZZER, OUTPUT);  
  digitalWrite(BUZZER, LOW); // apagar al inicio
  return;
}

void Inicializar_Boton() {
  pinMode(BUTTON, INPUT); // Configuro el boton
  timer_debounce.start(); // Inicializo Timer
  return;
}

void Inicializar_WIFI() {
  WiFi.begin(ssid, password);
  
  Serial.println("Conectando a WiFi...");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\nConectado a WiFi.");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  
  // --- INICIALIZACIÓN DE MDNS (chidori.local) ---
  if (MDNS.begin("chidori")) {
    Serial.println("✅ Servidor mDNS iniciado (http://chidori.local)");
    MDNS.addService("ws", "tcp", 81); // Publica el WebSocket de Chidori en mDNS
  } else {
    Serial.println("❌ Error al iniciar mDNS");
  }

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  return;
}

void Inicializar_AD9833() {
  // Inicializar pin FSYNC
  pinMode(PIN_FSYNC, OUTPUT);
  digitalWrite(PIN_FSYNC, HIGH);

  // Iniciar SPI (HSPI en NodeMCU)
  SPI.begin();  // GPIO13 = MOSI, GPIO14 = SCLK
  SPI.beginTransaction(SPISettings(SPI_CLK_HZ, MSBFIRST, SPI_MODE2));  // CPOL=1, CPHA=0

  // Iniciar AD9833 con seno a 50 kHz
  ad9833Begin(FREQ); // 50 kHz
  return;
}

void ad9833Write(uint16_t data) {
  digitalWrite(PIN_FSYNC, LOW);
  SPI.transfer16(data);
  digitalWrite(PIN_FSYNC, HIGH);
  delayMicroseconds(1);  // Requerido por datasheet
}

void ad9833SetFrequency(double freqHz) {
  uint32_t freqWord = static_cast<uint32_t>((freqHz * (1UL << 28)) / MCLK);

  uint16_t lsb = (uint16_t)((freqWord & 0x3FFF) | REG_FREQ0);
  uint16_t msb = (uint16_t)(((freqWord >> 14) & 0x3FFF) | REG_FREQ0);

  ad9833Write(CMD_B28);     // Habilita escritura de 28 bits
  ad9833Write(lsb);         // Enviar LSB
  ad9833Write(msb);         // Enviar MSB
}

void ad9833Begin(double freqHz) {
  ad9833Write(CMD_RESET);                // Entrar en reset
  ad9833SetFrequency(freqHz);            // Cargar frecuencia
  ad9833Write(REG_PHASE0 | 0x0000);      // Fase = 0°
  ad9833Write(CMD_EXIT_RESET_SINE);      // Salir de reset y activar seno
}

// --- WebSocket Event Handler ---
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_TEXT) {
    String command = String((char*)payload);
    Serial.print("Comando WebSocket recibido: ");
    Serial.println(command);

    if (command == "START") {
      if (Chidori.estado == INACTIVO) {
        measuring = true;
        Chidori.estado = MIDIENDO;
        adc_sum = 0;
        adc_count = 0;
        last_sample_us = micros();
        Serial.println(">> MIDIENDO (Por comando WS)");
      }
    } 
    else if (command == "STOP") {
      measuring = false;
      Chidori.estado = INACTIVO;
      digitalWrite(BUZZER, LOW);
      First_Measure = true;
      Serial.println(">> INACTIVO (Pausado por comando WS)");
    } 
    else if (command == "RESET") {
      measuring = false;
      Chidori.estado = INACTIVO;
      digitalWrite(BUZZER, LOW);
      First_Measure = true;
      Alarm_counter = MUESTRAS_ALARMA;
      // Vaciamos el promedio
      size = 0;
      average_Z = 0;
      adc_sum = 0;
      adc_count = 0;
      Serial.println(">> INACTIVO (Reseteado por comando WS)");
    }
  }
}

// --- Adquisición Fisiológica a 700 Hz con Filtro de Promedio de 256 Muestras ---
void adquirir_y_promediar() {
  adc_sum += analogRead(A0);
  adc_count++;

  if (adc_count >= AVG_SAMPLES) {
    float avg_adc = (float)adc_sum / AVG_SAMPLES;
    adc_sum = 0;
    adc_count = 0;

    float voltage = ADC(avg_adc);  // Convertir a voltaje
    float resistance = (Amp2Vpp(voltage + VShotcky)) / (CORRIENTE_INYECTADA * GANANCIA_RECEPTOR);  // Ley de Ohm

    // Promedio móvil adicional de 10 muestras para suavizado total
    Calcular_promedio(muestras, resistance);
    Chidori.Z = average_Z;

    if (First_Measure) { // La primera muestra promediada se establece como baseline Zref
      Chidori.Ref = Chidori.Z;
      First_Measure = false;
      Serial.print("⭐ Impedancia de Referencia Calibrada: ");
      Serial.print(Chidori.Ref);
      Serial.println(" Ohm");
    }

    String message = String(Chidori.Z, 5);
    Serial.print("Enviando Z Promediado (256 muestras a 700Hz): ");
    Serial.print(message);
    Serial.print(" Ohm (Atenuacion: ");
    Serial.print(dB(Chidori.Z, Chidori.Ref));
    Serial.println(" dB)");

    int clients = webSocket.connectedClients();
    if (clients > 0) {
      webSocket.broadcastTXT(message);
    }
  }
}

void Calcular_promedio(float vec[CANT_MUESTRAS], float Z) {
  if (size < CANT_MUESTRAS) {
    vec[size] = Z;
    size++;
  } else {
    for (int i = 0; i < CANT_MUESTRAS - 1; i++) {
      vec[i] = vec[i + 1];
    }
    vec[CANT_MUESTRAS - 1] = Z;
  }

  average_Z = 0;
  for (int i = 0; i < size; i++) {
    average_Z += vec[i];
  }
  average_Z /= size;
}

// === Debounce ===
void checkButton() {
  if (digitalRead(BUTTON) == HIGH) {
    if (countHigh < DEBOUNCE_CUENTAS) {
      countHigh++;
      if (countHigh >= DEBOUNCE_CUENTAS) {
        botonConfirmado = true;
      }
    }
  } else {
    countHigh = 0;
  }
}
