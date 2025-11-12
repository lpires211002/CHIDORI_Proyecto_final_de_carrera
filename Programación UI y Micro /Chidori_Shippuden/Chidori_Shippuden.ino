

// Plataforma: ESP8266 


// Librerias
#include <ESP8266WiFi.h>
#include <WebSocketsServer.h>
#include <TickTwo.h>
#include <SPI.h>

// Definiciones y Macros
#define VPP 0.6 //Amplitud del generador de ondas Vpp
#define R1 10000 // Resistencia del Howland
#define VREF 3.3 //Tension de referencia del ADC del NodeMcu ESP8266
#define RESOLUCION 1024 //Resolucion del adc interno
#define ADC(X) (X*VREF/(RESOLUCION-1)) // Macro para el calculo adc
// Ganancias del circuito
#define GANANCIA_GENERADOR 4.8
#define GANANCIA_HIGH_PASS 10
#define GANANCIA_LOW_PASS 4
#define GANANCIA_INA 5
#define VShotcky 0.2 // Caida Diodica del Schotcky
#define FREQ 50e3 //frecuencia de trabajo
#define T_MUESTREO 1 //Periodo de muestreo en segundos
// Conversion de unidades
#define s2ms(x) (x*1000) //pasar de segundos a milisegundos
#define ms2s(x) (x*0.001) // pasar de milis a segundos
// === CONFIGURACIÓN DE PINES ===
constexpr uint8_t PIN_FSYNC = 4;  // D2 = GPIO4 (FSYNC)
constexpr uint32_t SPI_CLK_HZ = 1000000; // 1 MHz: seguro y validado

// === COMANDOS AD9833 ===
constexpr uint16_t CMD_RESET            = 0x2100;
constexpr uint16_t CMD_EXIT_RESET_SINE  = 0x2000;
constexpr uint16_t CMD_B28              = 0x2000;
constexpr uint16_t REG_FREQ0            = 0x4000;
constexpr uint16_t REG_PHASE0           = 0xC000;

constexpr double MCLK = 25e6; // 25 MHz (típico en módulos AD9833)


/* Variables Globales */

// Configuración WIFI
const char* ssid = "iPhone de Luca (5)";
const char* password = "lfplfplfp";
// Configuración del WebSocket en el puerto 81
WebSocketsServer webSocket(81);

bool measuring = false; // Bandera para indicar si se está midiendo

// Corrientes y ganancias
float CORRIENTE_INYECTADA = VPP*GANANCIA_GENERADOR/R1; // Corriente inyectada del howland
float GANANCIA_RECEPTOR = GANANCIA_HIGH_PASS * GANANCIA_LOW_PASS * GANANCIA_INA; //Ganancia total del circuito receptor

//Prototipos de funciones
void ad9833Begin(double freqHz);
void ad9833Write(uint16_t data);
void ad9833SetFrequency(double freqHz);
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length); // Configuracion WIFI
float Medir_Impedancia(); //Funcion que mide y calcula la impedancia
void Enviar_Impedancia(); //Funcion que transmite el valor medido a la pagina web


// Timers 
TickTwo timer_wifi(Enviar_Impedancia,s2ms(T_MUESTREO)); //Seteo una interrupcion cada 30 segundos para enviar la data

void setup() {
  Serial.begin(115200);
  // Inicializar pin FSYNC
  pinMode(PIN_FSYNC, OUTPUT);
  digitalWrite(PIN_FSYNC, HIGH);

  // Iniciar SPI (HSPI en NodeMCU)
  SPI.begin();  // GPIO13 = MOSI, GPIO14 = SCLK
  SPI.beginTransaction(SPISettings(SPI_CLK_HZ, MSBFIRST, SPI_MODE2));  // CPOL=1, CPHA=0

  // Iniciar AD9833 con seno a 50 kHz
  ad9833Begin(FREQ); // 50 kHz
  WiFi.begin(ssid, password);
  
  Serial.println("Conectando a WiFi...");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print("no conectado \n");
  }
  
  Serial.println("\nConectado a WiFi.");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);

  timer_wifi.start(); //Inicio el timer del wifi
}

void loop() {
  timer_wifi.update();     // Actualiza el timer para enviar impedancia cada 30s
  webSocket.loop();        // Gestiona las conexiones WebSocket
}

// === FUNCIONES ===
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

void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_TEXT) {
    String command = String((char*)payload);
    if (command == "START") {
      measuring = true;
      Serial.println("Mediciones iniciadas.");
    } else if (command == "STOP") {
      measuring = false;
      Serial.println("Mediciones detenidas.");
    } else if (command == "RESET") {
      measuring = false;
      Serial.println("Mediciones reseteadas.");
    }
  }
}
float Medir_Impedancia(){ // Mide la señal recibida y calcula la impedancia
  int sensorValue = analogRead(A0);
  float voltage = ADC(sensorValue);  // Convertir a voltaje (0-1V)
  float resistance = (voltage + VShotcky )/(CORRIENTE_INYECTADA*GANANCIA_RECEPTOR);  // Ley de Ohm (I = 500µA -> 0.0005A)
  return resistance;
}

void Enviar_Impedancia() {
  if (!measuring) return; // Solo enviar si está midiendo

  float Z = Medir_Impedancia(); //Leo la señal
  String message = String(Z, 5); // Valor de resistencia con 5 decimales
  Serial.println(message);
  webSocket.broadcastTXT(message);
}

