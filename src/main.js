'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, Notification } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');

const Store = require('./store');
const store = new Store({ name: 'ironclaw-companion' });

let mainWindow = null;
let tray = null;
let connectionStatus = 'disconnected';
let pingInterval = null;
let notificationCooldown = {};

const DEV_MODE = process.argv.includes('--dev');

// ─── Rate limiter (simple token-bucket per IPC channel) ───────────────────────
const _rateLimits = {};
function rateLimit(key, maxCalls, windowMs) {
  const now = Date.now();
  if (!_rateLimits[key]) _rateLimits[key] = { calls: [], blocked: false };
  const bucket = _rateLimits[key];
  // Evict old entries
  bucket.calls = bucket.calls.filter(t => now - t < windowMs);
  if (bucket.calls.length >= maxCalls) return false;
  bucket.calls.push(now);
  return true;
}

// Periodic cleanup — prevents notificationCooldown + _rateLimits from growing unbounded
setInterval(() => {
  const now = Date.now();
  for (const key of Object.keys(notificationCooldown)) {
    if (now - notificationCooldown[key] > 120_000) delete notificationCooldown[key];
  }
  for (const key of Object.keys(_rateLimits)) {
    const b = _rateLimits[key];
    b.calls = b.calls.filter(t => now - t < 60_000);
    if (!b.calls.length) delete _rateLimits[key];
  }
}, 60_000).unref(); // .unref() so this timer won't keep the process alive

// ─── Validation helpers ───────────────────────────────────────────────────────
// Allow only safe hostnames/IPs (no protocol, no path, no special chars)
const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9.\-]{0,251}[a-zA-Z0-9])?$/;

// Blocked SSRF-adjacent hosts (0.0.0.0 routes to all interfaces on some OS)
const BLOCKED_HOSTS = new Set(['0.0.0.0', '0']);

function validateConnectionConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return ['Invalid config object'];
  if (
    !cfg.host ||
    typeof cfg.host !== 'string' ||
    !HOSTNAME_RE.test(cfg.host) ||
    cfg.host.length > 253 ||
    BLOCKED_HOSTS.has(cfg.host.toLowerCase())
  ) {
    errors.push('Invalid host (use hostname or IP, no protocol/path)');
  }
  const port = parseInt(cfg.port, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push('Invalid port (must be 1–65535)');
  }
  if (cfg.token !== undefined) {
    if (typeof cfg.token !== 'string') {
      errors.push('Token must be a string');
    } else if (cfg.token.length > 2048) {
      errors.push('Token too long (max 2048 chars)');
    }
  }
  return errors;
}

// Only allow http/https external URLs — no file://, javascript:, etc.
function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

// ─── Window ────────────────────────────────────────────────────────────────────
function createMainWindow() {
  const savedBounds = store.get('windowBounds', { width: 1000, height: 720 });

  mainWindow = new BrowserWindow({
    width:     Math.max(savedBounds.width  || 1000, 800),
    height:    Math.max(savedBounds.height || 720,  560),
    x: savedBounds.x,
    y: savedBounds.y,
    minWidth:  800,
    minHeight: 560,
    title: 'IronClaw Companion',
    backgroundColor: '#0d1117',
    // FIX: frame must be true (default) with hiddenInset on macOS.
    // Setting frame:false on macOS hides traffic-light buttons entirely.
    frame: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,            // extra isolation layer
      spellcheck: true,
      devTools: DEV_MODE,       // disable devtools in production
    },
    icon: getAppIcon(),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (DEV_MODE) mainWindow.webContents.openDevTools();
  });

  mainWindow.on('close', (e) => {
    if (store.get('minimizeToTray', true) && tray) {
      e.preventDefault();
      mainWindow.hide();
      return;
    }
    store.set('windowBounds', mainWindow.getBounds());
  });

  mainWindow.on('closed',  () => { mainWindow = null; });
  mainWindow.on('resize',  () => { if (mainWindow) store.set('windowBounds', mainWindow.getBounds()); });
  mainWindow.on('move',    () => { if (mainWindow) store.set('windowBounds', mainWindow.getBounds()); });

  return mainWindow;
}

function getAppIcon() {
  if (process.platform === 'darwin') return path.join(__dirname, '..', 'assets', 'icon.png');
  if (process.platform === 'win32')  return path.join(__dirname, '..', 'assets', 'icon.ico');
  return path.join(__dirname, '..', 'assets', 'icon.png');
}

// ─── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) throw new Error('empty icon');
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  tray.setToolTip('IronClaw Companion');
  updateTrayMenu();

  tray.on('click', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const statusLabel =
    connectionStatus === 'connected'   ? '🟢 Connected'    :
    connectionStatus === 'connecting'  ? '🟡 Connecting…'  : '🔴 Disconnected';

  const menu = Menu.buildFromTemplate([
    { label: 'IronClaw Companion', enabled: false },
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    { label: 'Open',  click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'Quit',  click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

// ─── Config helpers ────────────────────────────────────────────────────────────
function getConnectionConfig() {
  return {
    host:     store.get('host',     '127.0.0.1'),
    port:     parseInt(store.get('port', 3000), 10) || 3000,
    token:    store.get('token',    ''),
    useHttps: store.get('useHttps', false),
  };
}

// ─── HTTP client ───────────────────────────────────────────────────────────────
function apiRequest(method, reqPath, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const cfg = getConnectionConfig();
    const proto = cfg.useHttps ? 'https' : 'http';
    let url;
    try {
      url = new URL(`${proto}://${cfg.host}:${cfg.port}${reqPath}`);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${e.message}`));
    }

    const headers = { 'Content-Type': 'application/json' };
    if (cfg.token) headers['Authorization'] = `Bearer ${cfg.token}`;

    const options = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      method,
      headers,
      timeout: timeoutMs,
    };

    const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB hard cap

    const lib = cfg.useHttps ? https : http;
    const req = lib.request(options, (res) => {
      let data = '';
      let bytesReceived = 0;
      let aborted = false;

      res.on('data', (chunk) => {
        bytesReceived += chunk.length;
        if (bytesReceived > MAX_RESPONSE_BYTES) {
          aborted = true;
          req.destroy();
          reject(new Error('Response too large'));
          return;
        }
        data += chunk;
      });

      res.on('end', () => {
        if (aborted) return;
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error',   (e) => reject(e));
    req.on('timeout', ()  => { req.destroy(); reject(new Error('Request timed out')); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function streamChat(message, onChunk, onDone, onError) {
  const cfg = getConnectionConfig();
  const proto = cfg.useHttps ? 'https' : 'http';
  let url;
  try {
    url = new URL(`${proto}://${cfg.host}:${cfg.port}/api/chat`);
  } catch (e) {
    onError(e);
    return null;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Accept':       'text/event-stream',
  };
  if (cfg.token) headers['Authorization'] = `Bearer ${cfg.token}`;

  const body = JSON.stringify({ message });

  const options = {
    hostname: url.hostname,
    port:     url.port,
    path:     url.pathname,
    method:   'POST',
    headers,
    timeout:  90000,
  };

  const MAX_STREAM_BYTES  = 8 * 1024 * 1024; // 8 MB total stream cap
  const MAX_CHUNK_BYTES   = 64 * 1024;         // 64 KB per SSE chunk

  const lib = cfg.useHttps ? https : http;
  const req = lib.request(options, (res) => {
    let buffer = '';
    let totalBytes = 0;
    let streamAborted = false;

    res.on('data', (chunk) => {
      if (streamAborted) return;

      totalBytes += chunk.length;
      if (totalBytes > MAX_STREAM_BYTES) {
        streamAborted = true;
        req.destroy();
        onError(new Error('Stream exceeded size limit'));
        return;
      }

      buffer += chunk.toString();
      // Prevent unbounded buffer growth from a malicious/buggy server with no newlines
      if (buffer.length > MAX_CHUNK_BYTES * 2) {
        streamAborted = true;
        req.destroy();
        onError(new Error('SSE line too long'));
        return;
      }

      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep partial last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { onDone(); return; }
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content ?? parsed.delta ?? parsed.text;
          if (typeof text === 'string') onChunk(text);
          else if (typeof parsed === 'string') onChunk(parsed);
        } catch {
          if (data) onChunk(data);
        }
      }
    });

    res.on('end',   () => { if (!streamAborted) onDone(); });
    res.on('error', (e) => { if (!streamAborted) onError(e); });
  });

  req.on('error',   (e)  => onError(e));
  req.on('timeout', ()   => { req.destroy(); onError(new Error('Stream timed out')); });
  req.write(body);
  req.end();
  return req;
}

// ─── Connection ping ───────────────────────────────────────────────────────────
async function checkConnection() {
  try {
    const res = await apiRequest('GET', '/api/status', null, 6000);
    if (res.status === 200 || res.status === 204) {
      if (connectionStatus !== 'connected') {
        connectionStatus = 'connected';
        updateTrayMenu();
        mainWindow?.webContents.send('connection-status', { status: 'connected', data: res.body });
        showNotification('IronClaw Connected', 'Agent is online and ready.', 'connect');
      }
      return res.body;
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    if (connectionStatus !== 'disconnected') {
      connectionStatus = 'disconnected';
      updateTrayMenu();
      mainWindow?.webContents.send('connection-status', { status: 'disconnected', error: err.message });
    }
    return null;
  }
}

function startPing() {
  if (pingInterval) clearInterval(pingInterval);
  connectionStatus = 'connecting';
  updateTrayMenu();
  mainWindow?.webContents.send('connection-status', { status: 'connecting' });
  checkConnection();
  pingInterval = setInterval(checkConnection, 8000);
}

function stopPing() {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
}

// ─── Notifications ─────────────────────────────────────────────────────────────
function showNotification(title, body, cooldownKey) {
  if (!store.get('notifications', true)) return;
  if (cooldownKey) {
    const now = Date.now();
    if (notificationCooldown[cooldownKey] && (now - notificationCooldown[cooldownKey]) < 60_000) return;
    notificationCooldown[cooldownKey] = now;
  }
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

// ─── IPC Handlers ──────────────────────────────────────────────────────────────

// Config read
ipcMain.handle('get-config', () => {
  return store.get('config', {
    host: '127.0.0.1', port: 3000, token: '', useHttps: false,
    minimizeToTray: true, notifications: true, theme: 'dark',
    fontSize: 14, sendOnEnter: true,
  });
});

// Config save — validate before persisting
ipcMain.handle('save-config', (event, config) => {
  if (!config || typeof config !== 'object') return { ok: false, error: 'Invalid config' };
  const errors = validateConnectionConfig(config);
  if (errors.length) return { ok: false, errors };

  store.set('config', config);
  store.set('host',           config.host);
  store.set('port',           parseInt(config.port, 10) || 3000);
  store.set('token',          config.token || '');
  store.set('useHttps',       Boolean(config.useHttps));
  store.set('minimizeToTray', Boolean(config.minimizeToTray));
  store.set('notifications',  Boolean(config.notifications));
  stopPing();
  startPing();
  return { ok: true };
});

// API proxies
ipcMain.handle('api-status', async () => {
  try {
    const res = await apiRequest('GET', '/api/status');
    return { ok: res.status >= 200 && res.status < 300, data: res.body, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('api-jobs', async () => {
  try {
    const res = await apiRequest('GET', '/api/jobs');
    return { ok: res.status >= 200 && res.status < 300, data: res.body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('api-memory-search', async (event, query) => {
  if (typeof query !== 'string') return { ok: false, error: 'Invalid query' };
  // Rate limit: max 5 memory searches per 10 seconds
  if (!rateLimit('memory-search', 5, 10_000)) return { ok: false, error: 'Too many requests — slow down' };
  const safeQuery = query.slice(0, 500).replace(/[\r\n]/g, ' '); // strip newlines from query string
  try {
    const res = await apiRequest('GET', `/api/memory?q=${encodeURIComponent(safeQuery)}`);
    return { ok: res.status >= 200 && res.status < 300, data: res.body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Streaming chat
const STREAM_ID_RE = /^stream_\d+$/; // only allow internally generated stream IDs
ipcMain.on('chat-stream-start', (event, payload) => {
  // Verify the sender is our own renderer (not a rogue renderer/webview)
  if (!mainWindow || event.sender !== mainWindow.webContents) return;

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  const { streamId } = payload;
  let { message } = payload;

  // Validate + sanitise in main process (don't trust renderer)
  if (typeof message !== 'string' || !message.trim()) return;
  if (typeof streamId !== 'string' || !STREAM_ID_RE.test(streamId)) return;

  // Rate limit: max 1 stream per second (prevents spam)
  if (!rateLimit('chat-stream', 1, 1_000)) {
    event.sender.send('chat-stream-error', { streamId, error: 'Sending too fast — please wait a moment' });
    return;
  }

  message = message.slice(0, 32_000); // hard cap

  streamChat(
    message,
    (chunk) => { if (mainWindow && !mainWindow.isDestroyed()) event.sender.send('chat-stream-chunk', { streamId, chunk }); },
    ()      => { if (mainWindow && !mainWindow.isDestroyed()) event.sender.send('chat-stream-done',  { streamId }); },
    (err)   => { if (mainWindow && !mainWindow.isDestroyed()) event.sender.send('chat-stream-error', { streamId, error: err.message }); },
  );
});

// Open web gateway — FIX: never include token in URL (browser history leaks)
ipcMain.handle('open-web-gateway', () => {
  const cfg = getConnectionConfig();
  const proto = cfg.useHttps ? 'https' : 'http';
  const url = `${proto}://${cfg.host}:${cfg.port}`;
  if (isSafeExternalUrl(url)) shell.openExternal(url);
});

// Open external URL — FIX: only allow http/https
ipcMain.handle('open-external', (event, url) => {
  if (typeof url === 'string' && isSafeExternalUrl(url)) {
    shell.openExternal(url);
  }
});

// Connection management
ipcMain.handle('get-connection-status', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return 'disconnected';
  return connectionStatus;
});

ipcMain.handle('set-connection', (event, cfg) => {
  if (!cfg || typeof cfg !== 'object') return { ok: false, error: 'Invalid config' };
  const errors = validateConnectionConfig(cfg);
  if (errors.length) return { ok: false, errors };

  store.set('host',     cfg.host);
  store.set('port',     parseInt(cfg.port, 10) || 3000);
  store.set('token',    cfg.token || '');
  store.set('useHttps', Boolean(cfg.useHttps));
  stopPing();
  startPing();
  return { ok: true };
});

// ─── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Recommended for Windows toast notifications
  if (process.platform === 'win32') app.setAppUserModelId('com.ironclaw.companion');

  createMainWindow();
  createTray();
  startPing();

  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
    else mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { stopPing(); app.quit(); }
});

app.on('before-quit', () => {
  app.isQuiting = true;
  stopPing();
  if (mainWindow) store.set('windowBounds', mainWindow.getBounds());
});
