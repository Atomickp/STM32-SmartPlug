#include <WiFi.h>
#include <HTTPClient.h>

// WiFi credentials
const char* ssid = "<SSID>";
const char* password = "<PASSWORD>";

// Node identification
const char* NODE_ID = "<ID>"; // Must match exactly what you set on the website
const char* NODE_NAME = "<Name>"; // Optional name for the node (will be set on first connection)

// Server configuration - IMPORTANT: Update this to match your actual server IP address
const char* SERVER_IP = "<IP>"; // Change this to your server's actual IP address
const int SERVER_PORT = 3000;            // Default port for your Node.js server

// Complete URL paths for API endpoints
String baseUrl;               // Base URL for the server
String sensorDataUrl;         // URL to send sensor data
String relayStatusUrl;        // URL to check relay status
String relayControlUrl;       // URL to control relay
String nodeRegistrationUrl;   // URL to register this node
String nodeSettingsUrl;       // URL to get/set threshold and auto-cutoff settings

// Relay pin
const int RELAY_PIN = 2; // GPIO2 - change this to match your hardware

// Use UART1 for sensor communication (PZEM or other power sensor)
HardwareSerial SensorSerial(1);
#define RXD2 16
#define TXD2 17  // Not used for RX-only

// Timing variables
unsigned long lastSensorRead = 0;
unsigned long lastRelayCheck = 0;
unsigned long lastWiFiCheck = 0;
const unsigned long SENSOR_INTERVAL = 1000;      // Send data every 1 second
const unsigned long RELAY_CHECK_INTERVAL = 1000; // Check relay state every 1 second
const unsigned long WIFI_CHECK_INTERVAL = 30000; // Check WiFi every 30 seconds

// Relay state tracking
bool relayState = false;
String lastRelayCommand = "";

// Reconnect to WiFi if disconnected
void ensureWiFiConnection() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.print("Reconnecting to WiFi...");
    WiFi.begin(ssid, password);
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      delay(500);
      Serial.print(".");
      attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\nReconnected to WiFi!");
      Serial.println("IP Address: " + WiFi.localIP().toString());
    } else {
      Serial.println("\nFailed to reconnect to WiFi");
    }
  }
}

// Register node with server
void registerNode() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(nodeRegistrationUrl);
  http.addHeader("Content-Type", "application/json");

  // Create JSON string manually for node registration including name
  String jsonData = "{\"nodeId\": \"" + String(NODE_ID) + 
                    "\", \"name\": \"" + String(NODE_NAME) + "\"}";

  int httpResponseCode = http.POST(jsonData);
  if (httpResponseCode > 0) {
    if (httpResponseCode == 201) {
      Serial.println("Node registered successfully");
    } else if (httpResponseCode == 409) {
      Serial.println("Node already exists (this is normal)");
    } else {
      Serial.println("Node registration returned: " + String(httpResponseCode));
    }
  } else {
    Serial.println("Node registration failed with error: " + http.errorToString(httpResponseCode));
  }
  http.end();
}

void setup() {
  // Initialize serial communications
  Serial.begin(115200);  
  SensorSerial.begin(115200, SERIAL_8N1, RXD2, TXD2);
  
  // Allow serial port to stabilize
  delay(1000);

  // Initialize relay pin
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // Start with relay OFF
  relayState = false;

  Serial.println("\n\nESP32 Power Monitor with Relay Control");
  Serial.println("--------------------------------------");
  Serial.println("Node ID: " + String(NODE_ID));
  Serial.println("Relay Pin: " + String(RELAY_PIN));

  // Connect to WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi...");
  int wifiAttempt = 0;
  while (WiFi.status() != WL_CONNECTED && wifiAttempt < 20) {
    delay(500);
    Serial.print(".");
    wifiAttempt++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected!");
    Serial.println("IP Address: " + WiFi.localIP().toString());
    
    // Set up server URLs based on your actual API structure
    baseUrl = "http://" + String(SERVER_IP) + ":" + String(SERVER_PORT);
    sensorDataUrl = baseUrl + "/api/sensor/" + String(NODE_ID);
    relayStatusUrl = baseUrl + "/api/relay/" + String(NODE_ID);  // Get relay status
    relayControlUrl = baseUrl + "/api/relay/" + String(NODE_ID); // Set relay state (same endpoint)
    nodeRegistrationUrl = baseUrl + "/api/nodes";
    nodeSettingsUrl = baseUrl + "/api/nodes/" + String(NODE_ID) + "/settings";
    
    // Register node with server
    registerNode();
  } else {
    Serial.println("\nWiFi connection failed! Will retry later.");
  }
}

// Control the relay and update state
void controlRelay(bool state) {
  digitalWrite(RELAY_PIN, state ? HIGH : LOW);
  relayState = state;
  Serial.println("Relay turned " + String(state ? "ON" : "OFF"));
}

// Check for relay commands from server
void checkRelayCommands() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(relayStatusUrl);
  
  int httpResponseCode = http.GET();
  
  if (httpResponseCode == 200) {
    String response = http.getString();
    
    // Parse JSON response manually using string operations
    int stateIndex = response.indexOf("\"state\":");
    if (stateIndex != -1) {
      int startQuote = response.indexOf("\"", stateIndex + 8);
      int endQuote = response.indexOf("\"", startQuote + 1);
      
      if (startQuote != -1 && endQuote != -1) {
        String relayCommand = response.substring(startQuote + 1, endQuote);
        
        if (relayCommand != lastRelayCommand) {
          lastRelayCommand = relayCommand;
          Serial.println("Received relay command: " + relayCommand);
          
          if (relayCommand == "on" && !relayState) {
            controlRelay(true);
          } else if (relayCommand == "off" && relayState) {
            controlRelay(false);
          }
        }
      }
    }
  } else if (httpResponseCode > 0) {
    Serial.println("Relay check error: " + String(httpResponseCode));
  } else {
    Serial.println("Relay check connection error: " + http.errorToString(httpResponseCode));
  }
  
  http.end();
}

// Send sensor data to server
void sendSensorData(float voltage, float current, float power) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(sensorDataUrl);
  http.addHeader("Content-Type", "application/json");

  // Create JSON string manually for sensor data
  String jsonData = "{\"voltage\": " + String(voltage, 2) +
                    ", \"current\": " + String(current, 2) +
                    ", \"power\": " + String(power, 2) + "}";

  int httpResponseCode = http.POST(jsonData);
  if (httpResponseCode > 0) {
    if (httpResponseCode == 200) {
      Serial.println("Data sent successfully");
    } else {
      Serial.println("Data sent with response code: " + String(httpResponseCode));
    }
  } else {
    Serial.println("Data sending error: " + http.errorToString(httpResponseCode));
  }
  http.end();
}

void loop() {
  unsigned long currentTime = millis();
  
  // Check WiFi connection periodically
  if (currentTime - lastWiFiCheck >= WIFI_CHECK_INTERVAL) {
    ensureWiFiConnection();
    lastWiFiCheck = currentTime;
  }
  
  // Only perform operations if connected to WiFi
  if (WiFi.status() == WL_CONNECTED) {
    // Check for relay commands periodically
    if (currentTime - lastRelayCheck >= RELAY_CHECK_INTERVAL) {
      checkRelayCommands();
      lastRelayCheck = currentTime;
    }
  }
  
  // Read sensor data
  if (SensorSerial.available()) {
    String data = SensorSerial.readStringUntil('\n');
    data.trim();

    // Parse comma-separated values (voltage,current,power)
    int v1 = data.indexOf(',');
    int v2 = data.indexOf(',', v1 + 1);

    if (v1 > 0 && v2 > v1) {
      float voltage = data.substring(0, v1).toFloat();
      float current = data.substring(v1 + 1, v2).toFloat();
      float power   = data.substring(v2 + 1).toFloat();

      // Print sensor values and relay state
      Serial.printf("Sensor → V: %.2fV, I: %.2fA, P: %.2fW | Relay: %s\n", 
                    voltage, current, power, relayState ? "ON" : "OFF");

      // Send data to server based on interval
      if (currentTime - lastSensorRead >= SENSOR_INTERVAL && WiFi.status() == WL_CONNECTED) {
        sendSensorData(voltage, current, power);
        lastSensorRead = currentTime;
      }
    } else {
      Serial.println("Invalid sensor data format: " + data);
    }
  }

  // Small delay to prevent overwhelming the CPU
  delay(50);
}