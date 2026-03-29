const express = require('express');
const cors = require('cors');
const axios = require('axios');
const DigestFetch = require('digest-fetch');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

const CONFIG = {
  host: process.env.DAHUA_HOST || '192.168.38.200',
  port: process.env.DAHUA_PORT || 80,
  user: process.env.DAHUA_USER || 'admin',
  password: process.env.DAHUA_PASSWORD || 'admin',
  port: process.env.PORT || 3001
};

const client = new DigestFetch(CONFIG.user, CONFIG.password);

const BASE_URL = `http://${CONFIG.host}:${CONFIG.port}`;

function generateAuthHeader() {
  return {
    Authorization: 'Digest ' + Buffer.from(`${CONFIG.user}:${CONFIG.password}`).toString('base64')
  };
}

async function makeRequest(method, url, data = null) {
  try {
    const options = {
      method,
      url: `${BASE_URL}${url}`,
      headers: {
        'Content-Type': 'application/json',
        ...generateAuthHeader()
      },
      timeout: 30000,
      responseType: 'stream'
    };
    if (data) options.data = data;
    return await axios(options);
  } catch (error) {
    console.error(`Error en petition ${method} ${url}:`, error.message);
    throw error;
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', camera: CONFIG.host });
});

app.get('/api/snapshot', async (req, res) => {
  try {
    const response = await makeRequest('GET', '/cgi-bin/snapshot.cgi?chn=1');
    res.setHeader('Content-Type', 'image/jpeg');
    response.data.pipe(res);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener snapshot' });
  }
});

app.get('/api/stream', (req, res) => {
  const streamUrl = `rtsp://${CONFIG.user}:${CONFIG.password}@${CONFIG.host}:554/cam/realmonitor?channel=1&subtype=0`;
  res.json({ streamUrl, rtsp: streamUrl });
});

app.post('/api/capture', async (req, res) => {
  try {
    const timestamp = Date.now();
    const tempFile = path.join(__dirname, 'uploads', `capture_${timestamp}.jpg`);
    
    if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
      fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
    }

    const response = await makeRequest('GET', '/cgi-bin/snapManager.cgi?action=attachFileProc&Flags[0]=Event&Events[0]=TrafficManualSnap&heartbeat=2');
    
    res.json({ 
      success: true, 
      message: 'Captura iniciada',
      timestamp 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/records', async (req, res) => {
  try {
    const { startTime, endTime, channel = 1 } = req.query;
    
    const start = startTime || Math.floor(Date.now() / 1000) - 86400;
    const end = endTime || Math.floor(Date.now() / 1000);

    const url = `/cgi-bin/playback.cgi?action=getTrunk&channel=${channel}&startTime=${start}&endTime=${end}`;
    
    const response = await makeRequest('GET', url);
    let data = '';
    
    response.data.on('data', (chunk) => data += chunk);
    response.data.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        res.json(parsed);
      } catch {
        res.json({ records: [], raw: data });
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message, records: [] });
  }
});

app.get('/api/events', async (req, res) => {
  res.json({
    message: 'Usa /api/event-stream para conexión persistente',
    endpoint: '/api/event-stream'
  });
});

app.get('/api/event-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const eventSource = axios.CancelToken.source();
  
  try {
    const url = `${BASE_URL}/cgi-bin/eventManager.cgi?action=attach&channel=0&event=TrafgTraficCarPlate&heartbeat=10`;
    
    const response = await axios({
      method: 'GET',
      url,
      headers: generateAuthHeader(),
      timeout: 60000,
      responseType: 'stream'
    });

    response.data.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('PlateNumber')) {
        const eventData = parseDahuaEvent(text);
        if (eventData) {
          res.write(`data: ${JSON.stringify(eventData)}\n\n`);
        }
      }
    });

    response.data.on('error', (err) => {
      console.error('Stream error:', err.message);
      res.write(`data: ${JSON.stringify({ error: 'Connection lost', reconnecting: true })}\n\n`);
    });

    req.on('close', () => {
      eventSource.cancel('Client disconnected');
      response.data.destroy();
    });
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
  }
});

function parseDahuaEvent(text) {
  try {
    const plateMatch = text.match(/PlateNumber["']?\s*[:=]\s*["']?([^"'&\s]+)/);
    const colorMatch = text.match(/PlateColor["']?\s*[:=]\s*["']?([^"'&\s]+)/);
    const laneMatch = text.match(/PhysicalLane["']?\s*[:=]\s*["']?(\d+)/);
    const timeMatch = text.match(/UTC["']?\s*[:=]\s*["']?(\d+)/);
    
    if (plateMatch) {
      return {
        id: uuidv4(),
        plateNumber: plateMatch[1],
        plateColor: colorMatch ? colorMatch[1] : 'Unknown',
        lane: laneMatch ? parseInt(laneMatch[1]) : 0,
        timestamp: timeMatch ? new Date(parseInt(timeMatch[1]) * 1000).toISOString() : new Date().toISOString(),
        raw: text
      };
    }
  } catch (e) {
    console.error('Parse error:', e);
  }
  return null;
}

app.get('/api/config', async (req, res) => {
  try {
    const url = '/cgi-bin/configManager.cgi?action=getConfig&name=Traffic';
    const response = await makeRequest('GET', url);
    let data = '';
    response.data.on('data', (chunk) => data += chunk);
    response.data.on('end', () => res.json({ config: data }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ptz', async (req, res) => {
  const { action, speed = 1 } = req.body;
  const actions = {
    up: 'Up',
    down: 'Down', 
    left: 'Left',
    right: 'Right',
    zoomIn: 'ZoomIn',
    zoomOut: 'ZoomOut',
    focusNear: 'FocusNear',
    focusFar: 'FocusFar',
    irisOpen: 'IrisOpen',
    irisClose: 'IrisClose'
  };
  
  if (!actions[action]) {
    return res.status(400).json({ error: 'Acción inválida' });
  }

  try {
    const url = `/cgi-bin/ptz.cgi?action=start&channel=1&code=${actions[action]}&arg1=0&arg2=${speed}&arg3=0`;
    await makeRequest('GET', url);
    res.json({ success: true, action });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ptz/stop', async (req, res) => {
  const { action } = req.body;
  const actions = {
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    zoomIn: 'ZoomIn',
    zoomOut: 'ZoomOut'
  };
  
  try {
    const url = `/cgi-bin/ptz.cgi?action=stop&channel=1&code=${actions[action] || 'Up'}`;
    await makeRequest('GET', url);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = CONFIG.port;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend API corriendo en puerto ${PORT}`);
  console.log(`Conectando a cámara: ${CONFIG.host}`);
});
