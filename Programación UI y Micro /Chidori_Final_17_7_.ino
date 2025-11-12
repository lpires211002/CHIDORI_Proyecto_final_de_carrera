/* =====================  PROYECTO CHIDORI ========================*/

// Plataforma: ESP8266 

// Librerias
#include <ESP8266WiFi.h> // Libreria WIFI
#include <WebSocketsServer.h> // Libreria WIFI
#include <TickTwo.h> // Libreria de interrupciones por software
#include <SPI.h> // Libreria de protocolos SPI
#include <stdint.h>


/* ===== Definiciones y Macros ===== */

//pines alarma y boton
#define BUZZER 5 //D1 = GPIO5
#define BUTTON 15 // D7 = GPIO15

//constantes del circuito
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

// definiciones respecto al muestreo
#define FREQ 50e3 //frecuencia de trabajo
#define T_MUESTREO 1 //Periodo de muestreo en segundos
#define T_ENVIO_DATOS 10 // Periodo de envio de datos
#define UMBRAL 50 // Nivel de umbral de alerta en Ohm
#define CANT_MUESTRAS 10 // Cantidad de muestras que promedio

// Conversion de unidades
#define s2ms(x) (x*1000) //pasar de segundos a milisegundos
#define ms2s(x) (x*0.001) // pasar de milis a segundos

// pasaje vpp a ampitud
#define Amp2Vpp(x) (x*2) //Paso de amplitud a vpp
#define Vpp2Amp(x) (x/2) //Paso de Vpp a Amp

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
int Counter = T_ENVIO_DATOS;

//definicion maquina de estados

typedef enum {
  INACTIVO, 
  MIDIENDO,
  ALARMA
}state_t;

// Concentro toda la actividad de chidori en una estructura que contenga su estado y el valor medido

typedef struct{
  state_t estado;
  float Z;
}sensor_t;

// Creo mi variable Chidori
sensor_t Chidori;

// ==== Configuración WIFI =====
const char* ssid = "Rafaela 2.4"; // Introducir Red WiFi
const char* password = "0143330122";  // Introducir contraseña de la red

// Configuración del WebSocket en el puerto 81
WebSocketsServer webSocket(81);

bool measuring = false; // Bandera para indicar si se está midiendo

// Corrientes y ganancias

float CORRIENTE_INYECTADA = VPP*GANANCIA_GENERADOR/R1; // Corriente inyectada del howland
float GANANCIA_RECEPTOR = GANANCIA_HIGH_PASS * GANANCIA_LOW_PASS * GANANCIA_INA; //Ganancia total del circuito receptor

// Variables utilizadas para el debounce system
const int DEBOUNCE_CUENTAS = 5;    // 5 * 10 ms = 50 ms
int  countHigh             = 0;
bool botonConfirmado       = false;

// Prototipos de funciones
void Hw_Init(void); // Seteo de todo el hardware
void Inicializar_Buzzer(void); // Seteo del Buzzer
void Inicializar_Boton(void);  // Seteo del Boton
void Inicializar_WIFI(void); // Seteo del Wifi
void Inicializar_AD9833(void); // Seteo del Modulo AD9833
void ad9833Begin(double freqHz); // Inicia al AD9833 mediante SPI
void ad9833Write(uint16_t data); // Envia un comando al modulo AD9833
void ad9833SetFrequency(double freqHz); // Setea la frecuencia de la onda generada por el AD9833
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length); // Configuracion WIFI
void Medir_Impedancia(); // mide y calcula la impedancia
void Enviar_Impedancia(); // transmite el valor medido a la pagina web
void Calcular_promedio(float *vec, float Z); //Calcula el promedio de las muestras 
void checkButton(); // Filtro para el boton, evita rebotes mecanicos

// Timers 
TickTwo timer_muestreo(Medir_Impedancia,s2ms(T_MUESTREO)); //Seteo una interrupcion para medir la impedancia
//TickTwo timer_wifi(Enviar_Impedancia,s2ms(T_ENVIO_DATOS)); //Seteo una interrupcion para enviar el valor calculado
TickTwo timer_debounce(checkButton, 10); // Seteo una interrupcion para evitar el rebote del boton

void setup() {
  Chidori.estado = INACTIVO; // Inicializo Chidori en el estado base
  Hw_Init();
}
void loop() {
  webSocket.loop();
  timer_debounce.update();
  //timer_wifi.update();
  timer_muestreo.update();
  switch (Chidori.estado) {
    case INACTIVO:
      digitalWrite(BUZZER, LOW);
      if (botonConfirmado) {
        Serial.println("MIDIENDO");
        botonConfirmado = false;
        Chidori.estado  = MIDIENDO;
      }
      break;

    case MIDIENDO:
      if (Chidori.Z > UMBRAL) {
        Chidori.estado = ALARMA;
      }
      // Volver a INACTIVO si vuelve a pulsar
      if (botonConfirmado) {
        botonConfirmado = false;
        Serial.println("INACTIVO");
        Chidori.estado  = INACTIVO;
      }
      break;

    case ALARMA:
      digitalWrite(BUZZER, HIGH);
      if (botonConfirmado) {
        Serial.println("INACTIVO");
        botonConfirmado = false;
        Chidori.estado  = INACTIVO;
      }
      break;
  }
}
// === FUNCIONES ===


void Hw_Init(){
  Serial.begin(115200);
  Inicializar_Buzzer();
  Inicializar_Boton();
  Inicializar_WIFI();
  Inicializar_AD9833();
  return;
}


void Inicializar_Buzzer(){
  pinMode(BUZZER, OUTPUT);  
  digitalWrite(BUZZER, LOW); // apagar al inicio
  return;
}

void Inicializar_Boton(){
  pinMode(BUTTON, INPUT); // Configuro el boton
  timer_debounce.start(); // Inicializo Timer
  return;
}

void Inicializar_WIFI(){
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
  timer_muestreo.start();
  //timer_wifi.start(); //Inicio el timer del wifi
  return;
}

void Inicializar_AD9833(){
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
void Medir_Impedancia() { // Mide la señal recibida y calcula la impedancia
  int sensorValue = analogRead(A0);
  float voltage = ADC(sensorValue);  // Convertir a voltaje 
  float resistance = (Amp2Vpp(voltage + VShotcky))/(CORRIENTE_INYECTADA*GANANCIA_RECEPTOR);  // Ley de Ohm 
  Calcular_promedio(muestras,resistance);
  Chidori.Z = average_Z;
  if(Counter > 0) Counter --;
  else{
      String message = String(Chidori.Z, 5);
      Serial.print("Enviando por WebSocket: ");
      Serial.println(message);

      int clients = webSocket.connectedClients();
      Serial.print("Clientes conectados: ");
      Serial.println(clients);

      if (clients > 0) {
        webSocket.broadcastTXT(message);
      } else {
      Serial.println("⚠️ No hay clientes conectados.");
      }
      Serial.println(Chidori.Z); // Corrección del print mal formateado
      Counter = T_ENVIO_DATOS;
  }
}
/*
void Enviar_Impedancia() {
  if (!measuring) return;

  float Z = Medir_Impedancia(); 
  Chidori.Z = Z; 

  String message = String(Z, 5);
  Serial.print("Enviando por WebSocket: ");
  Serial.println(message);

  int clients = webSocket.connectedClients();
  Serial.print("Clientes conectados: ");
  Serial.println(clients);

  if (clients > 0) {
    webSocket.broadcastTXT(message);
  } else {
    Serial.println("⚠️ No hay clientes conectados.");
  }
  
  Serial.println(Chidori.Z); // Corrección del print mal formateado
}
*/
void Calcular_promedio(float vec[CANT_MUESTRAS], float Z) {
  if(size < CANT_MUESTRAS){
    vec[size] = Z;
    size++;
  } else {
    for(int i = 0; i < CANT_MUESTRAS - 1; i++) {
      vec[i] = vec[i + 1];
    }
    vec[CANT_MUESTRAS - 1] = Z;
  }

  average_Z = 0;
  for(int i = 0; i < size; i++) {
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








