# ESP Power Monitor

A web-based monitoring system for multiple ESP devices that tracks voltage, current, and power consumption with relay control capabilities.

## Features

- Real-time monitoring of multiple ESP nodes
- Individual graphs for voltage, current, and power
- Relay control for each node
- Telegram alerts for high power consumption
- Dynamic node addition/removal
- Clean and responsive UI

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
Create a `.env` file with your Telegram credentials (optional):
```
TELEGRAM_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

3. Start the server:
```bash
npm start
```

4. Access the web interface at `http://localhost:3000`

## ESP Device Setup

Upload the following code to your ESP device(s):

```cpp
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>

const char* ssid = "your_wifi_ssid";
const char* password = "your_wifi_password";
const char* serverUrl = "http://your_server:3000";
const char* nodeId = "esp1"; // Unique ID for each ESP

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("Connected to WiFi");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    WiFiClient client;
    HTTPClient http;
    
    // Read sensor values (replace with your actual sensor code)
    float voltage = 220.0; // Example value
    float current = 0.5;   // Example value
    float power = voltage * current; // Calculate power
    
    // Send data to server
    String url = String(serverUrl) + "/api/sensor/" + nodeId;
    http.begin(client, url);
    http.addHeader("Content-Type", "application/json");
    
    String payload = "{\"voltage\":" + String(voltage) + 
                    ",\"current\":" + String(current) + 
                    ",\"power\":" + String(power) + "}";
    
    int httpCode = http.POST(payload);
    
    if (httpCode > 0) {
      String response = http.getString();
      Serial.println(response);
    }
    
    http.end();
    
    // Check relay state
    url = String(serverUrl) + "/api/relay/" + nodeId;
    http.begin(client, url);
    
    httpCode = http.GET();
    
    if (httpCode > 0) {
      String response = http.getString();
      // Update relay state based on response
      // Your relay control code here
    }
    
    http.end();
  }
  
  delay(1000);
}

## API Endpoints

### Sensor Data
- POST /api/sensor/:nodeId - Send sensor data (voltage, current, power)
- GET /api/sensor/:nodeId - Get latest sensor data

### Relay Control
- POST /api/relay/:nodeId - Control relay state (on/off)
- GET /api/relay/:nodeId - Get current relay state

### Schedules
- GET /api/schedules/:nodeId - Get all schedules
- POST /api/schedules/:nodeId - Add new schedule
- DELETE /api/schedules/:nodeId/:scheduleId - Delete schedule
- PATCH /api/schedules/:nodeId/:scheduleId - Toggle schedule

### Timers
- POST /api/timer/:nodeId - Start timer
- GET /api/timer/:nodeId - Get timer status

### Logs
- GET /api/logs/:nodeId - Download sensor data logs

### Alerts
- POST /api/alert - Send power threshold alert

## File Structure
- `server.js` - Main server file
- `data.json` - Stores sensor data
- `relay_command.json` - Stores relay state
- `index.html` - Frontend interface
- `nodes.json` - Stores node configuration
- `schedules.json` - Stores scheduling data
- `timers.json` - Stores timer data
- `logs/` - Directory containing CSV log files for each node 