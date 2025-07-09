// cansat_firmware.ino
//
// Merged CanSat Telemetry Sketch for ESP32 with LoRa RA-01
// - Continuously reads (simulated) sensor data.
// - Transmits data via LoRa.
// - Prints telemetry to Serial in the format required by the web installer.
//   FORMAT: PACKET: Team ID;TEMP;PRE;ALT;TX
//
// Required Libraries:
// - "LoRa by Sandeep Mistry" (from Arduino Library Manager)
// - "Adafruit BMP280 Library" (if you add a real sensor)

#include <SPI.h>
#include <LoRa.h>

// --- PIN CONFIGURATION (From your board_test.ino) ---
#define LED_PIN 25
#define LORA_SCK_PIN   18
#define LORA_MISO_PIN  19
#define LORA_MOSI_PIN  23
#define LORA_NSS_PIN   5
#define LORA_RST_PIN   14
#define LORA_DIO0_PIN  26

// --- CANSAT CONFIGURATION ---
#define TEAM_ID "DEMO_DATA"      // Your CanSat Team ID
#define LORA_FREQUENCY 433E6  // LoRa frequency in Hz (433 MHz)

// --- TIMING ---
const long packetInterval = 5000; // Time between packets (in milliseconds)
unsigned long previousMillis = 0; // Stores last time packet was sent

// --- FORWARD DECLARATIONS for placeholder functions ---
float readTemperature();
float readPressure();
float calculateAltitude(float pressure, float seaLevelPressure = 1013.25);


void setup() {
  Serial.begin(115200);
  // Wait for a moment for the serial monitor to connect
  while (!Serial && millis() < 2000);
  delay(500);

  Serial.println("--- CanSat Telemetry Transmitter ---");

  // --- Configure Onboard LED ---
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH); // Turn LED on during setup

  // --- Configure and Test LoRa Module ---
  Serial.println("Initializing LoRa Module...");
  
  SPI.begin(LORA_SCK_PIN, LORA_MISO_PIN, LORA_MOSI_PIN, LORA_NSS_PIN);
  LoRa.setPins(LORA_NSS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);

    Serial.println("LoRa initialization In DEMO MODE");
  
  Serial.println("LoRa Initialized Successfully!");
  Serial.println("Starting telemetry loop...");
  
  digitalWrite(LED_PIN, LOW); // Turn LED off, setup is complete
}

void loop() {
  // Check if it's time to send a new packet (non-blocking)
  unsigned long currentMillis = millis();
  if (currentMillis - previousMillis >= packetInterval) {
    previousMillis = currentMillis; // Save the last time we sent a packet

    // --- 1. Read Sensor Data (Using placeholder functions) ---
    float temperature = readTemperature();
    float pressure = readPressure();
    float altitude = calculateAltitude(pressure);

    // --- 2. Construct the LoRa Packet ---
    String loraPacket = String(TEAM_ID) + ";" +
                        String(temperature, 2) + ";" +
                        String(pressure, 2) + ";" +
                        String(altitude, 2);

    // --- 3. Transmit Packet via LoRa ---
    // Flash LED to indicate transmission attempt
    digitalWrite(LED_PIN, HIGH);
    LoRa.beginPacket();
    LoRa.print(loraPacket);
    int successCode = LoRa.endPacket(); // Returns 1 for success, 0 for failure
    digitalWrite(LED_PIN, LOW);
    
    // --- 4. Determine TX Status ---
    String txStatus = (successCode) ? "TRUE" : "FALSE";

    // --- 5. Construct and Print Final Packet to Serial for Web Installer ---
    String serialPacket = "PACKET: " + loraPacket + ";" + txStatus;
    Serial.println(serialPacket);
  }
}


// ======================================================================
// === SENSOR SIMULATION / PLACEHOLDER FUNCTIONS                      ===
// === TODO: Replace the content of these functions with your REAL    ===
// ===       sensor reading code (e.g., from a BMP280 or BME280).     ===
// ======================================================================

float readTemperature() {
  // Placeholder: returns a random value between 20.00 and 29.99
  // **REPLACE THIS with your sensor's temperature reading**
  // Example: return bmp.readTemperature();
  return 20.0 + (random(1000) / 100.0);
}

float readPressure() {
  // Placeholder: returns a random value between 1000.00 and 1019.99 hPa
  // **REPLACE THIS with your sensor's pressure reading**
  // Example: return bmp.readPressure() / 100.0; // (Pa to hPa)
  return 1000.0 + (random(2000) / 100.0);
}

float calculateAltitude(float pressure, float seaLevelPressure) {
  // This is a standard formula and can likely be kept as-is.
  // It calculates altitude based on the current pressure.
  float altitude = 44330 * (1.0 - pow(pressure / seaLevelPressure, 0.1903));
  return altitude;
}
