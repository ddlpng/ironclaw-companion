'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, Notification, safeStorage } = require('electron');
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

// ─── Encrypted token storage (safeStorage) ───────────────────────────────
function getEncryptedToken() {
  const encrypted = store.get('tokenEncrypted');
  if (!encrypted) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(encrypted, 'base64');
      return safeStorage.decryptString(buf);
    }
  } catch (e) {
    console.error('[Store] Failed to decrypt token:', e.message);
  }
  return '';
}

function setEncryptedToken(token) {
  if (!token) {
    store.delete('tokenEncrypted');
    return;
  }
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(token);
      store.set('tokenEncrypted', encrypted.toString('base64'));
    } else {
      // Fallback: store plaintext if encryption not available
      store.set('tokenEncrypted', null);
      store.set('token', token);
    }
  } catch (e) {
    console.error('[Store] Failed to encrypt token:', e.message);
    store.set('token', token);
  }
}

// ─── Auto-update checker (GitHub releases) ─────────────────────────
const GITHUB_REPO = 'ddlpng/ironclaw-companion';
let _updateCheckDone = false;

async function checkForUpdates() {
  if (_updateCheckDone) return;
  _updateCheckDone = true;
  
  try {
    const currentVersion = app.getVersion();
    // Fetch releases from GitHub API
    const res = await fetch('https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest', {
      headers: { 'User-Agent': 'IronClaw-Companion' }
    });
    if (!res.ok) return;
    const data = await res.json();
    const latestTag = data.tag_name?.replace(/^v/, '') || '';
    if (!latestTag) return;
    
    const latest = parseInt(latestTag.replace(/\./g, ''), 10);
    const current = parseInt(currentVersion.replace(/\./g, ''), 10);
    if (latest > current) {
      store.set('updateAvailable', latestTag);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', { version: latestTag, url: data.html_url });
      }
    }
  } catch (e) {
    console.error('[Update] Check failed:', e.message);
  }
}

// ─── Chat Sessions ──────────────────────────────────────────────
const MAX_SESSIONS = 20;
const MAX_SESSION_MESSAGES = 200;

function getSessions() {
  return store.get('chatSessions', [{ id: 'default', name: 'Default', createdAt: Date.now() }]);
}

function createSession(name) {
  const sessions = getSessions();
  if (sessions.length >= MAX_SESSIONS) return null;
  const id = 'session_' + Date.now();
  const session = { id, name: name || 'New Chat', createdAt: Date.now() };
  sessions.push(session);
  store.set('chatSessions', sessions);
  return session;
}

function deleteSession(id) {
  if (id === 'default') return false;
  const sessions = getSessions().filter(s => s.id !== id);
  store.set('chatSessions', sessions);
  store.delete('chatHistory_' + id);
  return true;
}

function getSessionMessages(sessionId) {
  const key = sessionId === 'default' ? 'chatHistory' : 'chatHistory_' + sessionId;
  const history = store.get(key, []);
  return Array.isArray(history) ? history.slice(-MAX_SESSION_MESSAGES) : [];
}

function saveSessionMessages(sessionId, messages) {
  const key = sessionId === 'default' ? 'chatHistory' : 'chatHistory_' + sessionId;
  const safe = messages.slice(-MAX_SESSION_MESSAGES).map(m => ({
    role: typeof m.role === 'string' ? m.role.slice(0, 20) : 'user',
    content: typeof m.content === 'string' ? m.content.slice(0, 32_000) : '',
    timestamp: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
  }));
  store.set(key, safe);
}

// ─── Multi-Agent Profiles ──────────────────────────────────────────────────────
const MAX_PROFILES = 20;

function getProfiles() {
  return store.get('agentProfiles', [
    { id: 'default', name: 'Local Agent', host: '127.0.0.1', port: 3000, token: '', useHttps: false },
  ]);
}

function getActiveProfileId() {
  return store.get('activeProfileId', 'default');
}

function activateProfile(id) {
  const profiles = getProfiles();
  const profile = profiles.find(p => p.id === id);
  if (!profile) return false;
  store.set('activeProfileId', id);
  store.set('host', profile.host);
  store.set('port', profile.port);
  setEncryptedToken(profile.token || '');
  store.set('useHttps', Boolean(profile.useHttps));
  return true;
}

function upsertProfile(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'Invalid data' };
  const errors = validateConnectionConfig(data);
  if (errors.length) return { ok: false, errors };

  const profiles = getProfiles();
  const idx = profiles.findIndex(p => p.id === data.id);
  if (idx >= 0) {
    profiles[idx] = {
      ...profiles[idx],
      name: typeof data.name === 'string' ? data.name.slice(0, 64) : profiles[idx].name,
      host: data.host,
      port: parseInt(data.port, 10) || 3000,
      useHttps: Boolean(data.useHttps),
    };
    if (data.token !== undefined) profiles[idx].token = data.token.slice(0, 2048);
    store.set('agentProfiles', profiles);
    return { ok: true, profile: profiles[idx] };
  }
  // New profile
  if (profiles.length >= MAX_PROFILES) return { ok: false, error: 'Max profiles reached (20)' };
  const newProfile = {
    id: 'profile_' + Date.now(),
    name: typeof data.name === 'string' ? data.name.slice(0, 64) : 'New Agent',
    host: data.host,
    port: parseInt(data.port, 10) || 3000,
    token: typeof data.token === 'string' ? data.token.slice(0, 2048) : '',
    useHttps: Boolean(data.useHttps),
  };
  profiles.push(newProfile);
  store.set('agentProfiles', profiles);
  return { ok: true, profile: newProfile };
}

function removeProfile(id) {
  if (id === 'default') return false;
  const profiles = getProfiles().filter(p => p.id !== id);
  store.set('agentProfiles', profiles);
  if (getActiveProfileId() === id) activateProfile('default');
  return true;
}

// Profile IPC
ipcMain.handle('get-profiles', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return [];
  // Don't expose tokens to renderer
  return getProfiles().map(({ token: _t, ...rest }) => rest);
});

ipcMain.handle('get-active-profile-id', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return 'default';
  return getActiveProfileId();
});

ipcMain.handle('activate-profile', (event, id) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  if (typeof id !== 'string' || id.length > 64) return false;
  const ok = activateProfile(id);
  if (ok) { stopPing(); startPing(); }
  return ok;
});

ipcMain.handle('save-profile', (event, data) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false };
  return upsertProfile(data);
});

ipcMain.handle('delete-profile', (event, id) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  if (typeof id !== 'string') return false;
  return removeProfile(id);
});

// ─── Rate limiter (simple token-bucket per IPC channel) ───────────────────────
const _rateLimits = {};
function rateLimit(key, maxCalls, windowMs) {
  const now = Date.now();
  if (!_rateLimits[key]) _rateLimits[key] = { calls: [], blocked: false };
  const bucket = _rateLimits[key];
  bucket.calls = bucket.calls.filter(t => now - t < windowMs);
  if (bucket.calls.length >= maxCalls) return false;
  bucket.calls.push(now);
  return true;
}

// Periodic cleanup
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
}, 60_000).unref();

// ─── Validation helpers ───────────────────────────────────────────────────────
const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9.\-]{0,251}[a-zA-Z0-9])?$/;
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
    frame: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      devTools: DEV_MODE,
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
    token:    getEncryptedToken() || store.get('token', ''),
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

    const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

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

  const MAX_STREAM_BYTES  = 8 * 1024 * 1024;
  const MAX_CHUNK_BYTES   = 64 * 1024;

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
      if (buffer.length > MAX_CHUNK_BYTES * 2) {
        streamAborted = true;
        req.destroy();
        onError(new Error('SSE line too long'));
        return;
      }

      const lines = buffer.split('\n');
      buffer = lines.pop();

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
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('connection-status', { status: 'connected', data: res.body });
        }
        showNotification('IronClaw Connected', 'Agent is online and ready.', 'connect');
      }
      return res.body;
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    if (connectionStatus !== 'disconnected') {
      connectionStatus = 'disconnected';
      updateTrayMenu();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('connection-status', { status: 'disconnected', error: err.message });
      }
    }
    return null;
  }
}

// Exponential backoff: 4s → 8s → 16s → 32s → 60s (cap)
const PING_BASE_MS  = 4_000;
const PING_MAX_MS   = 60_000;
let   _pingBackoff  = PING_BASE_MS;
let   _pingTimeout  = null;

function schedulePing() {
  if (_pingTimeout) return;
  _pingTimeout = setTimeout(async () => {
    _pingTimeout = null;
    const ok = await checkConnection();
    if (ok) {
      _pingBackoff = PING_BASE_MS;  // reset on success
    } else {
      _pingBackoff = Math.min(_pingBackoff * 2, PING_MAX_MS);
    }
    schedulePing();
  }, _pingBackoff);
}

function startPing() {
  stopPing();
  _pingBackoff = PING_BASE_MS;
  connectionStatus = 'connecting';
  updateTrayMenu();
  mainWindow?.webContents.send('connection-status', { status: 'connecting' });
  checkConnection().then(ok => {
    if (!ok) _pingBackoff = Math.min(_pingBackoff * 2, PING_MAX_MS);
    schedulePing();
  });
}

function stopPing() {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  if (_pingTimeout) { clearTimeout(_pingTimeout); _pingTimeout = null; }
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

// ─── Chat History Persistence (per-session) ─────────────────────────
ipcMain.handle('chat-history-load', (event, sessionId) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return [];
  const sid = sessionId || 'default';
  return getSessionMessages(sid);
});

ipcMain.handle('chat-history-save', (event, messages, sessionId) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  if (!Array.isArray(messages)) return;
  const sid = sessionId || 'default';
  saveSessionMessages(sid, messages);
});

ipcMain.handle('chat-history-clear', (event, sessionId) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  const sid = sessionId || 'default';
  if (sid === 'default') {
    saveSessionMessages('default', []);
  } else {
    store.delete('chatHistory_' + sid);
  }
});

// ─── Session Management ──────────────────────────────────────────────
ipcMain.handle('get-sessions', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return [];
  return getSessions();
});

ipcMain.handle('create-session', (event, name) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return null;
  return createSession(name);
});

ipcMain.handle('delete-session', (event, id) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  return deleteSession(id);
});

ipcMain.handle('get-update-info', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { available: false };
  const ver = store.get('updateAvailable');
  return ver ? { available: true, version: ver } : { available: false };
});

// ─── Gateway Stats ─────────────────────────────────────────────────────────────
ipcMain.handle('api-stats', async (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: 'unauthorized' };
  try {
    // Try common stats/metrics endpoints
    const endpoints = ['/api/stats', '/api/metrics', '/metrics', '/api/info'];
    for (const ep of endpoints) {
      try {
        const res = await apiRequest('GET', ep, null, 5000);
        if (res.status >= 200 && res.status < 300) {
          return { ok: true, data: res.body, endpoint: ep };
        }
      } catch { /* try next */ }
    }
    return { ok: false, error: 'No stats endpoint available' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ─── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-config', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return {};
  return store.get('config', {
    host: '127.0.0.1', port: 3000, token: '', useHttps: false,
    minimizeToTray: true, notifications: true, theme: 'dark',
    fontSize: 14, sendOnEnter: true,
  });
});

ipcMain.handle('save-config', (event, config) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: 'unauthorized' };
  if (!config || typeof config !== 'object') return { ok: false, error: 'Invalid config' };
  const errors = validateConnectionConfig(config);
  if (errors.length) return { ok: false, errors };

  store.set('config', config);
  store.set('host',           config.host);
  store.set('port',           parseInt(config.port, 10) || 3000);
  setEncryptedToken(config.token || '');
  store.set('useHttps',       Boolean(config.useHttps));
  store.set('minimizeToTray', Boolean(config.minimizeToTray));
  store.set('notifications',  Boolean(config.notifications));
  stopPing();
  startPing();
  return { ok: true };
});

ipcMain.handle('api-status', async (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: 'unauthorized' };
  try {
    const res = await apiRequest('GET', '/api/status');
    return { ok: res.status >= 200 && res.status < 300, data: res.body, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('api-jobs', async (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: 'unauthorized' };
  try {
    const res = await apiRequest('GET', '/api/jobs');
    return { ok: res.status >= 200 && res.status < 300, data: res.body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('api-memory-search', async (event, query) => {
  if (typeof query !== 'string') return { ok: false, error: 'Invalid query' };
  if (!rateLimit('memory-search', 5, 10_000)) return { ok: false, error: 'Too many requests — slow down' };
  const safeQuery = query.slice(0, 500).replace(/[\r\n]/g, ' ');
  try {
    const res = await apiRequest('GET', `/api/memory?q=${encodeURIComponent(safeQuery)}`);
    return { ok: res.status >= 200 && res.status < 300, data: res.body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Streaming chat
const STREAM_ID_RE = /^stream_\d+$/;
ipcMain.on('chat-stream-start', (event, payload) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  const { streamId } = payload;
  let { message } = payload;

  if (typeof message !== 'string' || !message.trim()) return;
  if (typeof streamId !== 'string' || !STREAM_ID_RE.test(streamId)) return;

  if (!rateLimit('chat-stream', 1, 1_000)) {
    event.sender.send('chat-stream-error', { streamId, error: 'Sending too fast — please wait a moment' });
    return;
  }

  message = message.slice(0, 32_000);

  streamChat(
    message,
    (chunk) => { if (mainWindow && !mainWindow.isDestroyed()) event.sender.send('chat-stream-chunk', { streamId, chunk }); },
    ()      => { if (mainWindow && !mainWindow.isDestroyed()) event.sender.send('chat-stream-done',  { streamId }); },
    (err)   => { if (mainWindow && !mainWindow.isDestroyed()) event.sender.send('chat-stream-error', { streamId, error: err.message }); },
  );
});

ipcMain.handle('open-web-gateway', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  const cfg = getConnectionConfig();
  const proto = cfg.useHttps ? 'https' : 'http';
  const url = `${proto}://${cfg.host}:${cfg.port}`;
  if (isSafeExternalUrl(url)) shell.openExternal(url);
});

ipcMain.handle('open-external', (event, url) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  if (typeof url === 'string' && isSafeExternalUrl(url)) {
    shell.openExternal(url);
  }
});

ipcMain.handle('get-connection-status', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return 'disconnected';
  return connectionStatus;
});

ipcMain.handle('set-connection', (event, cfg) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: 'unauthorized' };
  if (!cfg || typeof cfg !== 'object') return { ok: false, error: 'Invalid config' };
  const errors = validateConnectionConfig(cfg);
  if (errors.length) return { ok: false, errors };

  store.set('host',     cfg.host);
  store.set('port',     parseInt(cfg.port, 10) || 3000);
  setEncryptedToken(cfg.token || '');
  store.set('useHttps', Boolean(cfg.useHttps));
  stopPing();
  startPing();
  return { ok: true };
});

// ─── App version ────────────────────────────────────────────────────────────────
ipcMain.handle('get-app-version', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return null;
  return app.getVersion();
});

// ─── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.ironclaw.companion');

  createMainWindow();
  createTray();
  startPing();
  
  // Auto-update checker (delayed start)
  setTimeout(checkForUpdates, 5000);

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
