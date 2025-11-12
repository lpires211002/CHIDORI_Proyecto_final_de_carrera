
// Plataforma: ESP8266 


// Librerias
#include <ESP8266WiFi.h>
#include <WebSocketsServer.h>
#include <TickTwo.h>

// Definiciones y Macros
#define VPP 0.62 //Amplitud del generador de ondas Vpp
#define R1 10000 // Resistencia del Howland
// Ganancias del circuito
#define GANANCIA_GENERADOR 4.8
#define GANANCIA_HIGH_PASS 10
#define GANANCIA_LOW_PASS 4
#define GANANCIA_INA 5
#define VShotcky 0.2 // Caida Diodica del Schotcky

// ────── Pines (usar GPIOs seguros) ──────

//Pines controladores de AD9833
#define FSYNC_PIN   4   // D2
#define SCLK_PIN    14  // D7 (manual SPI Clock)
#define MOSI_PIN    13  // D5 (manual SPI MOSI)

// ────── Parámetros de frecuencia del AD9833 ──────
#define MCLK        25000000UL     // Frecuencia del oscilador del AD9833
#define POW28       268435456ULL   // 2^28
#define FREQ_HZ     50000UL        // Frecuencia deseada: 50 kHz

// ────── Códigos de control para el AD9833 ──────
#define CTRL_RESET      0x0100    // Reset activo
#define CTRL_B28_RST    0x2100    // B28=1, RESET=1, usar FREQ0
#define CTRL_PHASE0     0xC000    // Fase = 0
#define WAVE_SINE       0x2000    // Senoidal
#define WAVE_TRIANGLE   0x2002    // Triangular
#define WAVE_SQUARE     0x2028    // Cuadrada


// Prototipos de funciones
void ad9833Write(uint16_t data); //Envia un comando usando el protocolo SPI
void ad9833SetFrequency(uint32_t freq); // Setea la frecuencia del generador de Ondas
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length); // Configuracion WIFI
float Medir_Impedancia(); //Funcion que mide y calcula la impedancia
void Enviar_Impedancia(); //Funcion que transmite el valor medido a la pagina web


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

// Timers 
TickTwo timer_wifi(Enviar_Impedancia,30000); //Seteo una interrupcion cada 30 segundos para enviar la data

void setup() {
  Serial.begin(115200);
  delay(50);

  // Configurar pines como salida
  pinMode(FSYNC_PIN, OUTPUT);
  pinMode(SCLK_PIN, OUTPUT);
  pinMode(MOSI_PIN, OUTPUT);

  // Estados iniciales
  digitalWrite(FSYNC_PIN, HIGH);
  digitalWrite(SCLK_PIN, LOW);
  digitalWrite(MOSI_PIN, LOW);

  // Inicialización del AD9833
  ad9833Write(CTRL_RESET);         // Entrar en reset
  ad9833SetFrequency(FREQ_HZ);     // Establecer frecuencia deseada
  ad9833Write(CTRL_PHASE0);        // Fase 0
  ad9833Write(WAVE_SINE);          // Salida senoidal, RESET=0

  // Configuracion WIFI
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

// ──────────────────────────────
// Función: enviar un comando SPI de 16 bits al AD9833
void ad9833Write(uint16_t data) {
  digitalWrite(FSYNC_PIN, LOW);


  for (int8_t i = 15; i >= 0; i--) {
    digitalWrite(SCLK_PIN, LOW);
    digitalWrite(MOSI_PIN, (data >> i) & 1);
    digitalWrite(SCLK_PIN, HIGH);  // Captura en flanco de subida (modo SPI 2)
  }

  digitalWrite(FSYNC_PIN, HIGH);
}

// ──────────────────────────────
// Función: calcular y cargar frecuencia en FREQ0
void ad9833SetFrequency(uint32_t freq) {
  uint64_t ftw = ((uint64_t)freq * POW28) / MCLK;

  uint16_t lsb = 0x4000 | (ftw & 0x3FFF);
  uint16_t msb = 0x4000 | ((ftw >> 14) & 0x3FFF);

  ad9833Write(CTRL_B28_RST);  // B28=1, RESET=1
  ad9833Write(lsb);           // Enviar LSB primero
  ad9833Write(msb);           // Luego MSB
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
  float voltage = sensorValue * (1.0 / 1024.0);  // Convertir a voltaje (0-1V)
  float resistance = (voltage + VShotcky )/(CORRIENTE_INYECTADA*GANANCIA_RECEPTOR);  // Ley de Ohm (I = 500µA -> 0.0005A)
  return resistance;
}

void Enviar_Impedancia(){
  float Z = Medir_Impedancia(); //Leo la señal
  String message = String(Z, 2); // Valor de resistencia con 2 decimales
  Serial.println(message);
  webSocket.broadcastTXT(message);
}

