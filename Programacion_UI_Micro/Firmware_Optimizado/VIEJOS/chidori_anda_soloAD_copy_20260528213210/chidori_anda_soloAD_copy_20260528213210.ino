#include <SPI.h>

/* ===== Pines ESP32-C3 Super Mini · matchean la PCB ===== */
#define PIN_MOSI  6     // SPI MOSI · "data" del AD9833
#define PIN_SCK   4     // SPI SCK  · "clk" del AD9833
#define PIN_FSYNC 7     // SPI CS   · "fnc" del AD9833
// No usamos MISO · el AD9833 no envía nada de vuelta

/* ===== AD9833 ===== */
#define FREQ 50000.0    // 50 kHz
#define MCLK 25000000.0 // 25 MHz (verificá en el cristal SMD del módulo)

/* ===== Escritura SPI · MSB primero garantizado ===== */
void ad9833Write(uint16_t data)
{
  digitalWrite(PIN_FSYNC, LOW);
  delayMicroseconds(1);                  // tCSS
  SPI.transfer((uint8_t)(data >> 8));    // MSB · D15-D8
  SPI.transfer((uint8_t)(data & 0xFF));  // LSB · D7-D0
  digitalWrite(PIN_FSYNC, HIGH);
  delayMicroseconds(2);                  // tCSH
}

/* ===== Secuencia oficial AD9833 ===== */
void ad9833Begin(double freq)
{
  uint32_t freqWord = (uint32_t)((freq * (1UL << 28)) / MCLK);

  ad9833Write(0x2100);                                // RESET=1, B28=1
  delayMicroseconds(5);

  ad9833Write(0x4000 | (uint16_t)(freqWord & 0x3FFF));        // FREQ0 LSB
  ad9833Write(0x4000 | (uint16_t)((freqWord >> 14) & 0x3FFF));// FREQ0 MSB

  ad9833Write(0xC000);                                // PHASE0 = 0

  delayMicroseconds(5);
  ad9833Write(0x2000);                                // RESET=0 · sale seno
}

/* ===== SETUP ===== */
void setup()
{
  Serial.begin(115200);
  delay(200);
  Serial.println("=== AD9833 TEST ===");

  pinMode(PIN_FSYNC, OUTPUT);
  digitalWrite(PIN_FSYNC, HIGH);

  // CS manual, sin MISO (es write-only)
  SPI.begin(PIN_SCK, -1, PIN_MOSI, -1);
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE2));

  delay(100);

  ad9833Begin(FREQ);
  Serial.print("AD9833 inicializado a "); Serial.print(FREQ);
  Serial.println(" Hz");
  Serial.println("Sonda el osciloscopio en VOUT del AD9833");
}

/* ===== LOOP ===== */
void loop()
{
  // El AD9833 sigue generando solo · no hace falta refrescar
}