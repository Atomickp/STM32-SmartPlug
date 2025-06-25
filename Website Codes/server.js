const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const { createObjectCsvWriter } = require('csv-writer');

// Constants
const PORT = 3000;
const NODES_FILE = path.join(__dirname, 'nodes.json');
const RELAY_FILE = path.join(__dirname, 'relay_command.json');
const SCHEDULE_FILE = path.join(__dirname, 'schedules.json');
const TIMER_FILE = path.join(__dirname, 'timers.json');
const POWER_THRESHOLD = 100; // Watts
const ALERT_COOLDOWN_MS = 300000; // 5 minutes in milliseconds
const ALERT_COOLDOWN = 60000; // 1 minute cooldown in milliseconds

// Create logs directory if it doesn't exist
const LOGS_DIR = path.join(__dirname, 'logs');
try {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR);
    console.log('Logs directory created successfully');
  }
} catch (error) {
  console.error('Error creating logs directory:', error);
}

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Create HTTP server
const server = require('http').createServer(app);

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

// Initialize Telegram bot with hardcoded values
const TELEGRAM_TOKEN = "<TOKEN>";
const TELEGRAM_CHAT_ID = "<ID>";
const bot = new TelegramBot(TELEGRAM_TOKEN);

// CSV writers cache
const csvWriters = new Map();

// Active timers
const activeTimers = new Map();

// Timer management
const timers = new Map();

// Store active logging intervals
const loggingIntervals = new Map();

// Alert cooldowns
const alertCooldowns = new Map();

// Helper function to get CSV writer
function getCsvWriter(nodeId) {
  if (!csvWriters.has(nodeId)) {
    const csvWriter = createObjectCsvWriter({
      path: path.join(LOGS_DIR, `node_${nodeId}_data.csv`),
      header: [
        { id: 'timestamp', title: 'Timestamp' },
        { id: 'voltage', title: 'Voltage (V)' },
        { id: 'current', title: 'Current (A)' },
        { id: 'power', title: 'Power (W)' }
      ],
      append: true
    });
    csvWriters.set(nodeId, csvWriter);
  }
  return csvWriters.get(nodeId);
}

// Helper function to read JSON file
function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return {};
  }
}

// Helper function to write JSON file
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
    return false;
  }
}

// Initialize files with default values if they don't exist
function initializeFiles() {
  try {
    // Initialize nodes.json
    if (!fs.existsSync(NODES_FILE)) {
      writeJsonFile(NODES_FILE, { nodes: {} });
    }

    // Initialize relay_command.json
    if (!fs.existsSync(RELAY_FILE)) {
      writeJsonFile(RELAY_FILE, {
        nodes: {}
      });
    }

    // Initialize schedules.json
    if (!fs.existsSync(SCHEDULE_FILE)) {
      writeJsonFile(SCHEDULE_FILE, {
        nodes: {}
      });
    }

    // Initialize timers.json
    if (!fs.existsSync(TIMER_FILE)) {
      writeJsonFile(TIMER_FILE, {
        nodes: {}
      });
    }
  } catch (error) {
    console.error('Error initializing files:', error);
  }
}

// Initialize files on startup
initializeFiles();

// WebSocket broadcast function
function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Send Telegram alert
// Add logging to sendTelegramAlert to confirm its execution
async function sendTelegramAlert(nodeId, message) {
  if (!bot || !TELEGRAM_CHAT_ID) {
    console.log('Telegram alert (not sent - bot not configured):', message);
    return;
  }

  console.log(`Sending Telegram alert for node ${nodeId}: ${message}`);
  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message);
    console.log(`Telegram alert sent successfully for node ${nodeId}`);
  } catch (error) {
    console.error('Failed to send Telegram alert:', error);
  }
}

// Function to control relay - updates relay state for ESP to poll
// Add logging to controlRelay to confirm relay state updates
async function controlRelay(nodeId, state) {
  try {
    const relayState = (state === true || state === 'on') ? 'on' : 'off';

    console.log(`Setting relay state for node ${nodeId}: ${relayState.toUpperCase()}`);
    
    // Update relay state in file - ESP will poll this
    const relayData = readJsonFile(RELAY_FILE);
    if (!relayData.nodes) relayData.nodes = {};

    relayData.nodes[nodeId] = {
      state: relayState,
      timestamp: Date.now()
    };

    if (!writeJsonFile(RELAY_FILE, relayData)) {
      throw new Error('Failed to write relay state to file');
    }

    console.log(`Relay state updated for node ${nodeId}: ${relayState.toUpperCase()}`);
    return true;
  } catch (error) {
    console.error(`Error updating relay state for node ${nodeId}:`, error);
    return false;
  }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('WebSocket message received:', data);
      // Only handle custom WebSocket messages here
      // Threshold checks are now handled in the sensor data endpoint
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// API Routes

// Get all nodes
app.get('/api/nodes', (req, res) => {
  try {
    const data = readJsonFile(NODES_FILE);
    res.json(data.nodes || {});
  } catch (error) {
    res.status(500).json({ error: 'Failed to get nodes' });
  }
});

// Add new node
app.post('/api/nodes', (req, res) => {
  try {
    const { nodeId, name } = req.body;
    if (!nodeId) {
      return res.status(400).json({ message: 'Node ID is required' });
    }

    const data = readJsonFile(NODES_FILE);
    if (!data.nodes) data.nodes = {};
    
    if(data.nodes[nodeId]){
      return res.status(409).json({ message: 'Node with this ID already exists' });
    }

    // Initialize node data with name
    data.nodes[nodeId] = {
      name: name || nodeId, // Use provided name or nodeId as default
      voltage: 0,
      current: 0,
      power: 0,
      timestamp: Date.now(),
      threshold: null,
      autoCutoff: false
    };

    if (writeJsonFile(NODES_FILE, data)) {
      // Initialize relay state for the node
      const relayData = readJsonFile(RELAY_FILE);
      if (!relayData.nodes) relayData.nodes = {};
      relayData.nodes[nodeId] = { state: 'off', timestamp: Date.now() };
      writeJsonFile(RELAY_FILE, relayData);

      // Initialize other configs
      const scheduleData = readJsonFile(SCHEDULE_FILE);
      if (!scheduleData.nodes) scheduleData.nodes = {};
      scheduleData.nodes[nodeId] = [];
      writeJsonFile(SCHEDULE_FILE, scheduleData);

      const timerData = readJsonFile(TIMER_FILE);
      if (!timerData.nodes) timerData.nodes = {};
      timerData.nodes[nodeId] = {};
      writeJsonFile(TIMER_FILE, timerData);

      res.status(201).json({ message: 'Node added successfully', nodeId });
    } else {
      res.status(500).json({ error: 'Failed to write node data' });
    }
  } catch (error) {
    console.error('Error adding node:', error);
    res.status(500).json({ error: 'Failed to add node' });
  }
});

// Update node settings (threshold and auto-cutoff)
app.post('/api/nodes/:nodeId/settings', (req, res) => {
  try {
    const { nodeId } = req.params;
    const { threshold, autoCutoff } = req.body;

    const nodesData = readJsonFile(NODES_FILE);
    if (!nodesData.nodes || !nodesData.nodes[nodeId]) {
      return res.status(404).json({ error: 'Node not found' });
    }

    if (threshold !== undefined) {
      const parsedThreshold = parseFloat(threshold);
      nodesData.nodes[nodeId].threshold = isNaN(parsedThreshold) ? null : parsedThreshold;
    }
    if (autoCutoff !== undefined) {
      nodesData.nodes[nodeId].autoCutoff = Boolean(autoCutoff);
    }

    if (writeJsonFile(NODES_FILE, nodesData)) {
      res.json({ success: true, message: 'Settings updated' });
    } else {
      res.status(500).json({ error: 'Failed to update settings' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Delete node
app.delete('/api/nodes/:nodeId', (req, res) => {
  try {
    const { nodeId } = req.params;
    const nodesData = readJsonFile(NODES_FILE);

    if (nodesData.nodes && nodesData.nodes[nodeId]) {
      delete nodesData.nodes[nodeId];
      writeJsonFile(NODES_FILE, nodesData);
      
      // Also remove from other files
      const relayData = readJsonFile(RELAY_FILE);
      if (relayData.nodes && relayData.nodes[nodeId]) {
        delete relayData.nodes[nodeId];
        writeJsonFile(RELAY_FILE, relayData);
      }
      
      const scheduleData = readJsonFile(SCHEDULE_FILE);
      if (scheduleData.nodes && scheduleData.nodes[nodeId]) {
        delete scheduleData.nodes[nodeId];
        writeJsonFile(SCHEDULE_FILE, scheduleData);
      }
      
      const timerData = readJsonFile(TIMER_FILE);
      if (timerData.nodes && timerData.nodes[nodeId]) {
        delete timerData.nodes[nodeId];
        writeJsonFile(TIMER_FILE, timerData);
      }

      res.status(200).json({ message: 'Node removed successfully' });
    } else {
      res.status(404).json({ error: 'Node not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove node' });
  }
});

// Get single sensor data
app.get('/api/sensor/:nodeId', (req, res) => {
  try {
    const { nodeId } = req.params;
    const nodesData = readJsonFile(NODES_FILE);
    
    if (nodesData.nodes && nodesData.nodes[nodeId]) {
      res.json(nodesData.nodes[nodeId]);
    } else {
      res.status(404).json({ error: 'Node data not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to get sensor data' });
  }
});

// Update sensor data - simple threshold check
app.post('/api/sensor/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { voltage, current, power } = req.body;
    
    // Basic validation
    if (!voltage || !current || !power) {
      return res.status(400).json({ error: 'Missing sensor data' });
    }

    // Parse values to ensure they're numbers
    const parsedPower = parseFloat(power);
    
    // Read current node data
    const nodesData = readJsonFile(NODES_FILE);
    if (!nodesData.nodes) {
      nodesData.nodes = {};
    }
    
    // Get node or initialize
    const node = nodesData.nodes[nodeId] || {};
    
    // Update with new readings
    node.voltage = parseFloat(voltage);
    node.current = parseFloat(current);
    node.power = parsedPower;
    node.timestamp = Date.now();
    
    // Save back to nodes.json
    nodesData.nodes[nodeId] = node;
    writeJsonFile(NODES_FILE, nodesData);
    
    // SIMPLE THRESHOLD CHECK
    console.log(`Node ${nodeId}: Power=${parsedPower}W, Threshold=${node.threshold}W, AutoCutoff=${node.autoCutoff}`);
    
    if (node.threshold && parsedPower > node.threshold) {
      console.log(`THRESHOLD EXCEEDED: Node ${nodeId} - ${parsedPower}W > ${node.threshold}W`);
      
      // 1. Send WebSocket alert
      broadcast({
        type: 'threshold_alert',
        nodeId,
        power: parsedPower,
        threshold: node.threshold
      });
      
      // 2. Send Telegram alert (direct API call for reliability)
      const alertMessage = `⚠️ ALERT: Node ${nodeId}\nPower threshold exceeded!\nPower: ${parsedPower}W > Threshold: ${node.threshold}W`;
      
      fetch('https://api.telegram.org/bot7816437987:AAHgvClRcNCXGNU96g2aKvgTgRytN0aJHoE/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: "1602500087",
          text: alertMessage
        })
      })
      .then(response => console.log(`Telegram alert sent: ${response.ok ? 'Success' : 'Failed'}`))
      .catch(error => console.error('Telegram error:', error));
      
      // 3. If auto-cutoff enabled, turn off relay
      if (node.autoCutoff) {
        console.log(`AUTO-CUTOFF: Turning off relay for Node ${nodeId}`);
        
        // Update relay command file
        const relayData = readJsonFile(RELAY_FILE);
        if (!relayData.nodes) relayData.nodes = {};
        
        relayData.nodes[nodeId] = {
          state: 'off',
          timestamp: Date.now()
        };
        
        writeJsonFile(RELAY_FILE, relayData);
      }
    }
    
    // Broadcast updated sensor data
    broadcast({
      type: 'sensor_data',
      nodeId,
      voltage: parseFloat(voltage),
      current: parseFloat(current),
      power: parsedPower
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving sensor data:', error);
    res.status(500).json({ error: 'Failed to save sensor data' });
  }
});

// Get relay status
app.get('/api/relay/:nodeId', (req, res) => {
  try {
    const { nodeId } = req.params;
    const data = readJsonFile(RELAY_FILE);
    const nodeState = data.nodes?.[nodeId] || { state: 'off', timestamp: Date.now() };
    res.json(nodeState);
  } catch (error) {
    res.json({ state: 'off', timestamp: Date.now() });
  }
});

// Update relay state
app.post('/api/relay/:nodeId', (req, res) => {
  try {
    const { nodeId } = req.params;
    const { state } = req.body;
    
    if (!state || (state !== 'on' && state !== 'off')) {
      return res.status(400).json({
        error: 'Invalid relay state. Use "on" or "off"'
      });
    }

    const relayData = readJsonFile(RELAY_FILE);
    if (!relayData.nodes) relayData.nodes = {};

    relayData.nodes[nodeId] = {
      state,
      timestamp: Date.now()
    };

    if (writeJsonFile(RELAY_FILE, relayData)) {
      res.json({
        success: true,
        message: `Relay ${state} for node ${nodeId}`
      });
    } else {
      throw new Error('Failed to write relay state');
    }
  } catch (error) {
    console.error('Relay control error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Download logs endpoint
app.get('/api/logs/:nodeId', (req, res) => {
  try {
    const { nodeId } = req.params;
    const logFile = path.join(LOGS_DIR, `node_${nodeId}_data.csv`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const downloadFile = path.join(LOGS_DIR, `node_${nodeId}_data_${timestamp}.csv`);

    console.log(`Attempting to download log file: ${logFile}`);

    if (!fs.existsSync(logFile)) {
      console.log(`Log file not found: ${logFile}`);
      return res.status(404).json({ error: 'No logs found for this node' });
    }

    // Create a copy of the current log file
    fs.copyFileSync(logFile, downloadFile);

    console.log(`Created backup file: ${downloadFile}`);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=node_${nodeId}_data_${timestamp}.csv`);
    
    // Stream the backup file
    const fileStream = fs.createReadStream(downloadFile);
    fileStream.on('error', (error) => {
      console.error('Error streaming log file:', error);
      res.status(500).json({ error: 'Failed to stream log file' });
    });
    fileStream.on('end', () => {
      // Keep the backup file for reference
      console.log(`Successfully sent backup file: ${downloadFile}`);
    });
    fileStream.pipe(res);
  } catch (error) {
    console.error('Error downloading logs:', error);
    console.error('Error details:', {
      nodeId,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: 'Failed to download logs' });
  }
});

// Schedule Management Routes
app.get('/api/schedules/:nodeId', (req, res) => {
  try {
    const { nodeId } = req.params;
    const data = readJsonFile(SCHEDULE_FILE);
    const schedules = data.nodes?.[nodeId] || [];
    res.json(schedules);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get schedules' });
  }
});

app.post('/api/schedules/:nodeId', (req, res) => {
  try {
    const { nodeId } = req.params;
    const { time, action } = req.body;

    if (!time || !action || (action !== 'on' && action !== 'off')) {
      return res.status(400).json({ error: 'Invalid schedule data' });
    }

    const data = readJsonFile(SCHEDULE_FILE);
    if (!data.nodes) data.nodes = {};
    if (!data.nodes[nodeId]) data.nodes[nodeId] = [];

    const schedule = {
      id: Date.now().toString(),
      time,
      action,
      enabled: true
    };

    data.nodes[nodeId].push(schedule);
    
    if (writeJsonFile(SCHEDULE_FILE, data)) {
      res.json({ success: true, schedule });
    } else {
      throw new Error('Failed to save schedule');
    }
  } catch (error) {
    console.error('Error adding schedule:', error);
    res.status(500).json({ error: 'Failed to add schedule' });
  }
});

app.delete('/api/schedules/:nodeId/:scheduleId', (req, res) => {
  try {
    const { nodeId, scheduleId } = req.params;
    const data = readJsonFile(SCHEDULE_FILE);

    if (data.nodes?.[nodeId]) {
      data.nodes[nodeId] = data.nodes[nodeId].filter(s => s.id !== scheduleId);
      if (writeJsonFile(SCHEDULE_FILE, data)) {
        res.json({ success: true });
      } else {
        throw new Error('Failed to delete schedule');
      }
    } else {
      res.status(404).json({ error: 'Schedule not found' });
    }
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

// Toggle schedule
app.patch('/api/schedules/:nodeId/:scheduleId', (req, res) => {
  try {
    const { nodeId, scheduleId } = req.params;
    const { enabled } = req.body;

    const data = readJsonFile(SCHEDULE_FILE);
    if (!data.nodes?.[nodeId]) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const scheduleIndex = data.nodes[nodeId].findIndex(s => s.id === scheduleId);
    if (scheduleIndex === -1) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    data.nodes[nodeId][scheduleIndex].enabled = enabled;
    
    if (writeJsonFile(SCHEDULE_FILE, data)) {
      res.json({ 
        success: true, 
        schedule: data.nodes[nodeId][scheduleIndex]
      });
    } else {
      throw new Error('Failed to update schedule');
    }
  } catch (error) {
    console.error('Error updating schedule:', error);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

// Telegram Alert Route
app.post('/api/alert', async (req, res) => {
  try {
    const { nodeId, power } = req.body;
    const botToken = "7816437987:AAHgvClRcNCXGNU96g2aKvgTgRytN0aJHoE";
    const chatId = "1602500087";
    const message = `⚠️ ALERT: Node ${nodeId}\nPower threshold exceeded!\nCurrent power = ${power}W`;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to send Telegram message');
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to send Telegram alert:', error);
    res.status(500).json({ error: 'Failed to send alert' });
  }
});

// Timer management
function readTimerFile() {
  try {
    const data = readJsonFile(TIMER_FILE);
    return data.timers || {};
  } catch (error) {
    console.error('Error reading timer file:', error);
    return {};
  }
}

function writeTimerFile(timers) {
  try {
    const timerData = { nodes: {} };
    for (const [nodeId, timer] of timers.entries()) {
      timerData.nodes[nodeId] = {
        startTime: timer.startTime,
        duration: timer.duration,
        action: timer.action,
        endTime: timer.startTime + timer.duration,
      };
    }
    writeJsonFile(TIMER_FILE, timerData);
    return true;
  } catch (error) {
    console.error('Error writing timer file:', error);
    return false;
  }
}

function startTimer(nodeId, duration, action) {
  clearTimeout(timers.get(nodeId)?.timeout);
  
  const timer = {
    startTime: Date.now(),
    duration: duration * 1000, // Convert to milliseconds
    action,
    timeout: setTimeout(async () => {
      await controlRelay(nodeId, action === 'on');
      clearTimer(nodeId);
    }, duration * 1000)
  };
  
  timers.set(nodeId, timer);
  writeTimerFile(timers);
}

function clearTimer(nodeId) {
  const timer = timers.get(nodeId);
  if (timer) {
    clearTimeout(timer.timeout);
    timers.delete(nodeId);
    writeTimerFile(timers);
  }
}

function getTimerStatus(nodeId) {
  const timer = timers.get(nodeId);
  if (!timer) return { active: false, remainingTime: 0 };

  const elapsed = Date.now() - timer.startTime;
  const remaining = Math.max(0, Math.ceil((timer.duration - elapsed) / 1000));
  
  if (remaining <= 0) {
    clearTimer(nodeId);
    return { active: false, remainingTime: 0 };
  }
  
  return {
    active: true,
    remainingTime: remaining,
    action: timer.action
  };
}

// Timer endpoints
app.post('/api/timer/:nodeId', (req, res) => {
  try {
    const { nodeId } = req.params;
    const { duration, action } = req.body;

    if (!duration || duration < 1 || !['on', 'off'].includes(action)) {
      return res.status(400).json({ error: 'Invalid timer parameters' });
    }

    startTimer(nodeId, duration, action);
    res.json({ success: true });
  } catch (error) {
    console.error('Error starting timer:', error);
    res.status(500).json({ error: 'Failed to start timer' });
  }
});

app.get('/api/timer/:nodeId', (req, res) => {
  try {
    const { nodeId } = req.params;
    const status = getTimerStatus(nodeId);
    res.json(status);
  } catch (error) {
    console.error('Error getting timer status:', error);
    res.status(500).json({ error: 'Failed to get timer status' });
  }
});

app.delete('/api/timer/:nodeId', (req, res) => {
  try {
    const { nodeId } = req.params;
    clearTimer(nodeId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling timer:', error);
    res.status(500).json({ error: 'Failed to cancel timer' });
  }
});

// Function to start logging for a node
function startLogging(nodeId) {
  // Clear any existing interval
  if (loggingIntervals.has(nodeId)) {
    clearInterval(loggingIntervals.get(nodeId));
  }

  const interval = setInterval(() => {
    try {
      // Get current data
      const data = readJsonFile(NODES_FILE);
      const nodeData = data.nodes?.[nodeId];
      
      if (!nodeData) return;

      // Ensure logs directory exists
      if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR);
      }

      const logFile = path.join(LOGS_DIR, `node_${nodeId}_data.csv`);
      
      // Create file with headers if it doesn't exist
      if (!fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, 'Timestamp,Voltage (V),Current (A),Power (W)\n');
      }

      // Get current timestamp in ISO format
      const timestamp = new Date().toISOString();
      const logLine = `${timestamp},${nodeData.voltage},${nodeData.current},${nodeData.power}\n`;
      
      // Append the data
      fs.appendFileSync(logFile, logLine);
    } catch (error) {
      console.error(`Error logging data for node ${nodeId}:`, error);
    }
  }, 1000); // Log every second

  loggingIntervals.set(nodeId, interval);
}

// Function to stop logging for a node
function stopLogging(nodeId) {
  if (loggingIntervals.has(nodeId)) {
    clearInterval(loggingIntervals.get(nodeId));
    loggingIntervals.delete(nodeId);
  }
}

// Start logging for all existing nodes when server starts
try {
  const data = readJsonFile(NODES_FILE);
  if (data.nodes) {
    Object.keys(data.nodes).forEach(nodeId => {
      startLogging(nodeId);
    });
  }
} catch (error) {
  console.error('Error starting logging for existing nodes:', error);
}

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Check schedules every minute
  setInterval(async () => {
    try {
      const scheduleData = readJsonFile(SCHEDULE_FILE);
      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 5); // HH:mm format

      for (const [nodeId, schedules] of Object.entries(scheduleData.nodes || {})) {
        for (const schedule of schedules) {
          if (schedule.enabled && schedule.time === currentTime) {
            // Actually control the relay using the controlRelay function
            const success = await controlRelay(nodeId, schedule.action === 'on');
            if (success) {
              console.log(`Executed schedule for node ${nodeId}: ${schedule.action} at ${schedule.time}`);
            } else {
              console.error(`Failed to execute schedule for node ${nodeId}: ${schedule.action} at ${schedule.time}`);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error checking schedules:', error);
    }
  }, 60000); // Check every minute

  // Restore active timers on server restart
  try {
    const timerData = readJsonFile(TIMER_FILE);
    const now = Date.now();

    for (const [nodeId, timer] of Object.entries(timerData.nodes || {})) {
      const remainingTime = Math.ceil((timer.endTime - now) / 1000);
      if (remainingTime > 0) {
        startTimer(nodeId, remainingTime, timer.action);
        console.log(`Restored timer for node ${nodeId}: ${remainingTime}s remaining`);
      } else {
        // Remove expired timer
        delete timerData.nodes[nodeId];
        console.log(`Removed expired timer for node ${nodeId}`);
      }
    }
    writeJsonFile(TIMER_FILE, timerData);
  } catch (error) {
    console.error('Error restoring timers:', error);
  }
  
  // Continuous power threshold checker - runs every second
  setInterval(() => {
    try {
      // Read current node data
      const nodesData = readJsonFile(NODES_FILE);
      if (!nodesData.nodes) return;
      
      const currentTime = Date.now();
      
      // Check each node for threshold exceedance
      Object.entries(nodesData.nodes).forEach(async ([nodeId, node]) => {
        // Skip nodes without threshold or power data
        if (!node.threshold || node.power === undefined) return;
        
        // Check if power exceeds threshold
        console.log(`Checking threshold for ${nodeId}: ${node.power}W vs ${node.threshold}W threshold (AutoCutoff: ${node.autoCutoff})`);
        
        // Check if the threshold is exceeded
        if (node.power > node.threshold) {
          // Get last alert time for this node (or 0 if first alert)
          const lastAlertTime = alertCooldowns.get(nodeId) || 0;
          
          // Only send alert if cooldown period has passed
          if (currentTime - lastAlertTime > ALERT_COOLDOWN) {
            console.log(`THRESHOLD EXCEEDED: Node ${nodeId} - ${node.power}W > ${node.threshold}W (Sending alert)`);
            
            // Update the last alert time for this node
            alertCooldowns.set(nodeId, currentTime);
            
            // Send WebSocket alert
            broadcast({
              type: 'threshold_alert',
              nodeId,
              power: node.power,
              threshold: node.threshold
            });
            
            // Send Telegram alert
            const alertMessage = `⚠️ ALERT: Node ${nodeId}\nPower threshold exceeded!\nPower: ${node.power}W > Threshold: ${node.threshold}W`;
            
            fetch('https://api.telegram.org/bot7816437987:AAHgvClRcNCXGNU96g2aKvgTgRytN0aJHoE/sendMessage', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: "1602500087",
                text: alertMessage
              })
            })
            .then(response => console.log(`Telegram alert sent: ${response.ok ? 'Success' : 'Failed'}`))
            .catch(error => console.error('Telegram error:', error));
          } else {
            // Log that we're skipping the alert due to cooldown
            const timeRemaining = Math.ceil((ALERT_COOLDOWN - (currentTime - lastAlertTime)) / 1000);
            console.log(`THRESHOLD EXCEEDED: Node ${nodeId} - ${node.power}W > ${node.threshold}W (Alert cooldown: ${timeRemaining}s remaining)`);
          }
          
          // Turn off relay if auto-cutoff is enabled (always do this regardless of alert cooldown)
          if (node.autoCutoff) {
            // Get current relay state
            const relayData = readJsonFile(RELAY_FILE);
            if (!relayData.nodes) relayData.nodes = {};
            
            // Only update the relay if it's not already off
            if (!relayData.nodes[nodeId] || relayData.nodes[nodeId].state !== 'off') {
              console.log(`AUTO-CUTOFF: Turning off relay for Node ${nodeId}`);
              
              relayData.nodes[nodeId] = {
                state: 'off',
                timestamp: currentTime
              };
              
              writeJsonFile(RELAY_FILE, relayData);
              console.log(`Relay state for ${nodeId} set to OFF due to threshold exceedance`);
            }
          }
        }
      });
    } catch (error) {
      console.error('Error in power threshold checker:', error);
    }
  }, 1000); // Check every second
});

// Update node name
app.post('/api/nodes/:nodeId/name', (req, res) => {
  try {
    const { nodeId } = req.params;
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    const nodesData = readJsonFile(NODES_FILE);
    if (!nodesData.nodes || !nodesData.nodes[nodeId]) {
      return res.status(404).json({ error: 'Node not found' });
    }
    
    nodesData.nodes[nodeId].name = name;
    
    if (writeJsonFile(NODES_FILE, nodesData)) {
      res.json({ success: true, message: 'Node name updated successfully' });
    } else {
      res.status(500).json({ error: 'Failed to update node name' });
    }
  } catch (error) {
    console.error('Error updating node name:', error);
    res.status(500).json({ error: 'Failed to update node name' });
  }
});