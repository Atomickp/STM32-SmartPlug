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
