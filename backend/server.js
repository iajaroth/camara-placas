const express = require('express');
const cors = require('cors');
const DigestFetch = require('digest-fetch');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== CONFIGURATION (fixed port collision) =====
const CAMERA = {
  host: process.env.DAHUA_HOST || '192.168.38.200',
  port: parseInt(process.env.DAHUA_PORT || '80'),
  user: process.env.DAHUA_USER || 'admin',
  password: process.env.DAHUA_PASSWORD || 'STStec2703',
};
const SERVER_PORT = parseInt(process.env.PORT || '3001');
const CAMERA_URL = `http://${CAMERA.host}:${CAMERA.port}`;

console.log(`[CONFIG] Camera: ${CAMERA_URL} (user: ${CAMERA.user})`);
console.log(`[CONFIG] Server port: ${SERVER_PORT}`);

// Digest auth client - handles 401 challenge-response automatically
const dahua = new DigestFetch(CAMERA.user, CAMERA.password);

// ===== IN-MEMORY EVENT STORE =====
let plateEvents = [];
const MAX_EVENTS = 1000;
let sseClients = [];

function addEvent(event) {
  plateEvents.unshift(event);
  if (plateEvents.length > MAX_EVENTS) plateEvents = plateEvents.slice(0, MAX_EVENTS);
  const msg = `data: ${JSON.stringify(event)}\n\n`;
  sseClients = sseClients.filter(c => { try { c.write(msg); return true; } catch { return false; } });
}

// ===== CAMERA REQUEST HELPER =====
async function cam(path, opts = {}) {
  const url = `${CAMERA_URL}${path}`;
  const t0 = Date.now();
  try {
    const resp = await dahua.fetch(url, { method: opts.method || 'GET', headers: opts.headers || {} });
    console.log(`[CAM] ${path.substring(0, 80)} => ${resp.status} (${Date.now() - t0}ms)`);
    return resp;
  } catch (err) {
    console.error(`[CAM] ${path.substring(0, 80)} => ERROR (${Date.now() - t0}ms): ${err.message}`);
    throw err;
  }
}

// ===== ENDPOINTS =====

// Health check - tests actual camera connectivity
app.get('/api/health', async (req, res) => {
  try {
    const resp = await cam('/cgi-bin/magicBox.cgi?action=getDeviceType');
    const text = await resp.text();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text}`);
    res.json({ status: 'online', camera: CAMERA.host, device: text.trim(), eventsStored: plateEvents.length, sseClients: sseClients.length });
  } catch (err) {
    res.json({ status: 'offline', camera: CAMERA.host, error: err.message, eventsStored: plateEvents.length });
  }
});

// Diagnostic - test multiple CGI endpoints to see what works
app.get('/api/diagnose', async (req, res) => {
  const tests = [
    ['/cgi-bin/magicBox.cgi?action=getDeviceType', 'Device Type'],
    ['/cgi-bin/magicBox.cgi?action=getSerialNo', 'Serial Number'],
    ['/cgi-bin/magicBox.cgi?action=getSoftwareVersion', 'Firmware'],
    ['/cgi-bin/snapshot.cgi?channel=1', 'Snapshot'],
    ['/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle', 'Channel Title'],
    ['/cgi-bin/configManager.cgi?action=getConfig&name=TrafficSnap', 'Traffic Snap Config'],
    ['/cgi-bin/configManager.cgi?action=getConfig&name=Record', 'Record Config'],
  ];
  const results = [];
  for (const [path, name] of tests) {
    try {
      const resp = await cam(path);
      const ct = resp.headers.get('content-type') || '';
      let preview;
      if (ct.includes('image')) { preview = `[image ${ct}]`; await resp.arrayBuffer(); }
      else { preview = (await resp.text()).substring(0, 500); }
      results.push({ name, path, status: resp.status, ok: resp.ok, contentType: ct, preview });
    } catch (err) {
      results.push({ name, path, status: 0, ok: false, error: err.message });
    }
  }
  res.json({ camera: CAMERA.host, user: CAMERA.user, results });
});

// Snapshot proxy - uses proper digest auth
app.get('/api/snapshot', async (req, res) => {
  try {
    const ch = req.query.channel || 1;
    const resp = await cam(`/cgi-bin/snapshot.cgi?channel=${ch}`);
    if (!resp.ok) throw new Error(`Camera HTTP ${resp.status}`);
    res.setHeader('Content-Type', resp.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    resp.body.pipe(res);
  } catch (err) {
    res.status(502).json({ error: 'Snapshot failed', detail: err.message });
  }
});

// RTSP stream info
app.get('/api/stream', (req, res) => {
  res.json({
    main: `rtsp://${CAMERA.user}:${CAMERA.password}@${CAMERA.host}:554/cam/realmonitor?channel=1&subtype=0`,
    sub: `rtsp://${CAMERA.user}:${CAMERA.password}@${CAMERA.host}:554/cam/realmonitor?channel=1&subtype=1`,
  });
});

// Get stored plate events
app.get('/api/events', (req, res) => {
  const { limit = 100, search = '' } = req.query;
  let filtered = plateEvents;
  if (search) {
    const q = search.toLowerCase();
    filtered = plateEvents.filter(e => e.plateNumber?.toLowerCase().includes(q));
  }
  res.json({ total: plateEvents.length, events: filtered.slice(0, parseInt(limit)) });
});

// SSE stream for real-time events
app.get('/api/event-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  // Send recent events
  plateEvents.slice(0, 10).forEach(evt => res.write(`data: ${JSON.stringify(evt)}\n\n`));
  sseClients.push(res);
  console.log(`[SSE] Client connected (${sseClients.length} total)`);
  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
    console.log(`[SSE] Client disconnected (${sseClients.length} total)`);
  });
});

// Push endpoint - camera can POST events here
app.post('/api/push', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  const ct = req.headers['content-type'] || '';
  console.log(`[PUSH] Received ${ct} (${req.body?.length || 0} bytes)`);
  try {
    const raw = req.body?.toString() || '';
    let eventData = {};
    if (ct.includes('json')) { try { eventData = JSON.parse(raw); } catch {} }
    const plateNumber = eventData.PlateNumber || eventData.plateNumber || extractField(raw, 'PlateNumber');
    if (plateNumber && plateNumber.length > 1) {
      addEvent({
        id: uuidv4(), plateNumber,
        plateColor: eventData.PlateColor || extractField(raw, 'PlateColor') || 'Unknown',
        vehicleColor: eventData.VehicleColor || '', lane: eventData.PhysicalLane || 0,
        speed: eventData.Speed || 0, timestamp: new Date().toISOString(), source: 'push',
      });
      console.log(`[PUSH] Plate: ${plateNumber}`);
    }
  } catch (err) { console.error('[PUSH] Error:', err.message); }
  res.status(200).send('OK');
});

// Search camera storage for traffic records
app.get('/api/records', async (req, res) => {
  try {
    const { start, end, channel = 1 } = req.query;
    const now = new Date();
    const startTime = start || fmtTime(new Date(now - 24 * 3600000));
    const endTime = end || fmtTime(now);
    // Step 1: Create finder
    const createResp = await cam('/cgi-bin/mediaFileFind.cgi?action=factory.create');
    const createText = await createResp.text();
    const objMatch = createText.match(/result=(\d+)/);
    if (!objMatch) throw new Error('factory.create failed: ' + createText.trim());
    const oid = objMatch[1];
    // Step 2: Start search
    await cam(`/cgi-bin/mediaFileFind.cgi?action=findFile&object=${oid}&condition.Channel=${channel}&condition.StartTime=${encodeURIComponent(startTime)}&condition.EndTime=${encodeURIComponent(endTime)}&condition.Flags[0]=Event&condition.Events[0]=TrafficJunction`);
    // Step 3: Get results
    const nextResp = await cam(`/cgi-bin/mediaFileFind.cgi?action=findNextFile&object=${oid}&count=100`);
    const nextText = await nextResp.text();
    // Step 4: Close
    await cam(`/cgi-bin/mediaFileFind.cgi?action=close&object=${oid}`).catch(() => {});
    res.json({ records: parseFileResults(nextText), query: { startTime, endTime }, raw: nextText.substring(0, 3000) });
  } catch (err) {
    console.error('[RECORDS]', err.message);
    res.status(500).json({ error: err.message, records: [] });
  }
});

// Proxy camera file/image
app.get('/api/camera-file', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    
    // Fallback array for Dahua Image Download APIs
    let uris = [ filePath ];
    if (filePath.startsWith('/') && !filePath.includes('cgi-bin')) {
      const p = encodeURIComponent(filePath);
      uris = [
        `/cgi-bin/loadfile.cgi?action=download&file=${filePath}`,
        `/cgi-bin/mediaFileFind.cgi?action=downloadFile&filepath=${filePath}`,
        `/cgi-bin/RPC_Loadfile${filePath}`, 
        `/RPC_Loadfile${filePath}`,
        `/cgi-bin/loadfile.cgi?action=loadfile&class=Data&stream=${p}`
      ];
    }
    
    let resp = null;
    let lastStatus = '';
    for (const u of uris) {
      console.log(`[DOWNLOAD] Trying: ${u}`);
      try {
         const tempResp = await dahua.fetch(`${CAMERA_URL}${u}`, { method: 'GET', timeout: 5000 });
         lastStatus = tempResp.status;
         
         if (tempResp.ok) {
            const cl = tempResp.headers.get('content-length');
            const ct = tempResp.headers.get('content-type') || '';
            const isText = ct.includes('text') || ct.includes('json');
            
            // Si no tiene longitud, o tiene > 100 bytes, o claramente es imagen, lo damos por bueno
            // Rechazamos solo si es un error escondido en 200 OK text de < 100 bytes
            if (!isText || (cl && parseInt(cl) > 100)) {
               resp = tempResp;
               console.log(`[DOWNLOAD] SUCCESS with ${u}`);
               break;
            } else {
               // Consumir para evitar leaks
               await tempResp.text(); 
            }
         } else {
            await tempResp.text(); // discard
         }
      } catch (e) {
         console.log(`[DOWNLOAD] timeout o error con ${u}: ${e.message}`);
      }
    }
    
    if (!resp) {
       console.log(`[DOWNLOAD] ALL FAILED for ${filePath}`);
       return res.status(502).json({ error: `Not found or camera rejected. (Last: ${lastStatus})` });
    }
    
    const ct = resp.headers.get('content-type');
    if (ct && !ct.includes('text')) {
       res.setHeader('Content-Type', ct);
    } else {
       // Force a generic image fallback if Dahua didn't send one
       res.setHeader('Content-Type', 'image/jpeg');
    }
    
    res.setHeader('Cache-Control', 'public, max-age=86400');
    resp.body.pipe(res);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ZIP Endpoint for multiple images
const archiver = require('archiver');
app.post('/api/download-images', express.json(), async (req, res) => {
  try {
    const { paths } = req.body;
    if (!paths || !Array.isArray(paths)) return res.status(400).json({ error: 'No paths provided' });
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="fotos_placas_${Date.now()}.zip"`);
    
    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);
    archive.on('warning', err => { if (err.code !== 'ENOENT') console.error(err); });
    archive.on('error', err => { console.error(err); });

    for (let i = 0; i < paths.length; i++) {
        const filePath = paths[i];
        if (!filePath) continue;
        const p = encodeURIComponent(filePath);
        const uris = [
          `/cgi-bin/loadfile.cgi?action=download&file=${filePath}`, 
          `/cgi-bin/loadfile.cgi?action=download&file=${p}`,
          `/cgi-bin/mediaFileFind.cgi?action=downloadFile&filepath=${filePath}`, 
          `/RPC_Loadfile${filePath}`
        ];
        
        let fileResp = null;
        for (const u of uris) {
           const tempResp = await cam(u);
           if (tempResp.ok && tempResp.headers.get('content-length') > 100) {
              fileResp = tempResp;
              break;
           }
        }
        
        if (fileResp) {
            const fileName = filePath.split('/').pop() || `imagen_${i}.jpg`;
            archive.append(fileResp.body, { name: fileName });
        }
    }
    archive.finalize();
  } catch(err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// PTZ control
app.post('/api/ptz', async (req, res) => {
  const { action, speed = 1 } = req.body;
  const map = { up:'Up', down:'Down', left:'Left', right:'Right', zoomIn:'ZoomTele', zoomOut:'ZoomWide', focusNear:'FocusNear', focusFar:'FocusFar' };
  const code = map[action];
  if (!code) return res.status(400).json({ error: `Invalid: ${action}` });
  try {
    await cam(`/cgi-bin/ptz.cgi?action=start&channel=1&code=${code}&arg1=0&arg2=${speed}&arg3=0`);
    res.json({ success: true, action });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

app.post('/api/ptz/stop', async (req, res) => {
  const { action } = req.body;
  const map = { up:'Up', down:'Down', left:'Left', right:'Right', zoomIn:'ZoomTele', zoomOut:'ZoomWide' };
  try {
    await cam(`/cgi-bin/ptz.cgi?action=stop&channel=1&code=${map[action]||'Up'}&arg1=0&arg2=0&arg3=0`);
    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// Camera config
app.get('/api/config', async (req, res) => {
  try {
    const resp = await cam(`/cgi-bin/configManager.cgi?action=getConfig&name=${req.query.name || 'TrafficSnap'}`);
    res.json({ config: await resp.text() });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ===== HELPERS =====
function fmtTime(d) { return d.toISOString().replace('T', ' ').substring(0, 19); }
function extractField(text, field) {
  if (!text) return null;
  const m = text.match(new RegExp(`${field}[\\s]*[:=][\\s]*([^\\s&;"']+)`));
  return m ? m[1] : null;
}
function parseFileResults(text) {
  const records = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^items\[(\d+)\]\.(.+?)=(.*)$/);
    if (m) {
       const i = parseInt(m[1]); 
       const keyPath = m[2];
       const val = m[3].trim();
       while (records.length <= i) records.push({});
       
       if (!records[i].FilePaths) records[i].FilePaths = [];
       
       // Capture ANY file path (e.g. FilePath, PlateFilePath, or value ending in .jpg)
       if (keyPath.endsWith('FilePath') || val.toLowerCase().endsWith('.jpg') || val.toLowerCase().endsWith('.png')) {
           if (!records[i].FilePaths.includes(val)) {
               records[i].FilePaths.push(val);
           }
       }
       
       // Try to set root properties for quick access
       if (!keyPath.includes('.')) {
           // items[0].PlateNumber
           records[i][keyPath] = val;
       } else {
           // items[0].Detail.PlateNumber => extract PlateNumber
           const lastKey = keyPath.split('.').pop();
           if (!records[i][lastKey]) {
               records[i][lastKey] = val;
           }
       }
    }
  }
  
  // Post-process to fix FilePath and PlateNumber
  for (const r of records) {
    if (!r.FilePath && r.FilePaths && r.FilePaths.length > 0) {
      r.FilePath = r.FilePaths[0];
    }
    if (!r.PlateNumber && r.FilePaths && r.FilePaths.length > 0) {
      for (const fp of r.FilePaths) {
        const fileBase = fp.split('/').pop() || '';
        const plateMatch = fileBase.match(/_([A-Z0-9]{5,8})_/i) || fileBase.match(/\[([A-Z0-9]{5,8})\]/i);
        if (plateMatch) {
           r.PlateNumber = plateMatch[1];
           break;
        }
      }
    }
  }

  // GROUP by StartTime + PlateNumber to merge Vehicle and Plate images
  const grouped = [];
  for (const r of records) {
    if (!r.FilePath && (!r.FilePaths || r.FilePaths.length === 0)) continue;
    
    // Attempt to find existing group
    const existing = grouped.find(g => 
       g.StartTime === r.StartTime && 
       ((g.PlateNumber && g.PlateNumber === r.PlateNumber) || (!g.PlateNumber && !r.PlateNumber))
    );

    if (existing) {
       // Merge FilePaths
       if (r.FilePaths) {
           for (const fp of r.FilePaths) {
               if (!existing.FilePaths.includes(fp)) {
                   existing.FilePaths.push(fp);
               }
           }
       } else if (r.FilePath && !existing.FilePaths.includes(r.FilePath)) {
           existing.FilePaths.push(r.FilePath);
       }
    } else {
       if (!r.FilePaths) r.FilePaths = r.FilePath ? [r.FilePath] : [];
       grouped.push(r);
    }
  }
  
  return grouped;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== BACKGROUND EVENT SUBSCRIBER =====
async function subscribeToEvents() {
  console.log('[EVENTS] Starting camera event subscription...');
  while (true) {
    try {
      const resp = await cam('/cgi-bin/eventManager.cgi?action=attach&codes=[TrafficJunction,TrafficCarPlate]&heartbeat=5');
      if (!resp.ok) { console.error(`[EVENTS] HTTP ${resp.status}`); await sleep(10000); continue; }
      console.log('[EVENTS] Connected to camera event stream');
      await new Promise((resolve, reject) => {
        let buffer = '';
        resp.body.on('data', (chunk) => {
          buffer += chunk.toString();
          const parts = buffer.split(/--[a-zA-Z0-9]+\r?\n/);
          buffer = parts.pop() || '';
          for (const part of parts) { if (part.trim()) processEventChunk(part); }
        });
        resp.body.on('end', resolve);
        resp.body.on('error', reject);
      });
    } catch (err) { console.error(`[EVENTS] ${err.message}`); }
    console.log('[EVENTS] Reconnecting in 5s...');
    await sleep(5000);
  }
}

function processEventChunk(text) {
  try {
    const codeMatch = text.match(/Code=(\w+)/);
    if (!codeMatch) return;
    const code = codeMatch[1];
    if (!code.includes('Traffic')) return;
    const jsonMatch = text.match(/(\{[\s\S]*\})/);
    let d = {};
    if (jsonMatch) { try { d = JSON.parse(jsonMatch[1]); } catch {} }
    const plate = d.PlateNumber || d.TrafficCar?.PlateNumber || extractField(text, 'PlateNumber');
    if (plate && plate !== 'unknown' && plate.length > 1) {
      const evt = {
        id: uuidv4(), plateNumber: plate,
        plateColor: d.PlateColor || d.TrafficCar?.PlateColor || extractField(text, 'PlateColor') || 'Unknown',
        vehicleColor: d.VehicleColor || d.TrafficCar?.VehicleColor || '',
        lane: d.PhysicalLane || parseInt(extractField(text, 'PhysicalLane') || '0'),
        speed: d.Speed || 0, timestamp: new Date().toISOString(), eventCode: code, source: 'subscribe',
      };
      addEvent(evt);
      console.log(`[EVENTS] 🚗 ${evt.plateNumber} | ${evt.plateColor} | Lane ${evt.lane}`);
    }
  } catch (err) { console.error('[EVENTS] Parse:', err.message); }
}

// ===== START =====
app.listen(SERVER_PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server: http://0.0.0.0:${SERVER_PORT}`);
  console.log(`📷 Camera: ${CAMERA_URL}`);
  console.log('📡 GET /api/health | /api/diagnose | /api/snapshot | /api/events | /api/event-stream | /api/records\n');
  subscribeToEvents().catch(err => console.error('[EVENTS] Fatal:', err));
});
