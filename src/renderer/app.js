/* ─── IronClaw Companion — Renderer ──────────────────────────────────── */
'use strict';

const api = window.ironclawAPI;

// ─── State ────────────────────────────────────────────────────────────────
let config = {
  host: '127.0.0.1',
  port: 3000,
  token: '',
  useHttps: false,
  minimizeToTray: true,
  notifications: true,
  theme: 'dark',
  fontSize: 14,
  sendOnEnter: true,
};

let streamCounters = {};
let activeStreamId = null;
let isStreaming = false;
const MAX_MESSAGES = 200; // cap chat history to prevent unbounded memory growth
let messages = []; // chat history
let jobsRefreshTimer = null;

// ─── Init ─────────────────────────────────────────────────────────────────
let _initialized = false;

async function init() {
  if (_initialized) return; // guard against double-init
  _initialized = true;

  config = await api.getConfig() || config;
  applyTheme(config.theme);
  applyFontSize(config.fontSize);
  setupSettingsForm();
  setupNavigation();
  setupChat();       // registers IPC listeners via preload (deduped there)
  setupJobs();
  setupMemory();
  setupStatus();
  setupConnectionListener();
  await loadPersistedChatHistory();  // load saved messages from disk
  checkInitialStatus();
}

// Load persisted chat history from store
async function loadPersistedChatHistory() {
  try {
    const saved = await api.chatHistoryLoad();
    if (Array.isArray(saved)) {
      messages = saved;
      // Render saved messages to UI
      const area = document.getElementById('messagesArea');
      const welcome = document.getElementById('welcomeScreen');
      if (welcome) welcome.remove();
      
      if (saved.length > 0) {
        saved.forEach(msg => {
          if (msg.role && msg.content) {
            const el = buildMessageEl(msg.role, msg.content);
            area.appendChild(el);
          }
        });
        area.scrollTop = area.scrollHeight;
      } else {
        area.appendChild(buildWelcomeScreen());
      }
    }
  } catch (e) {
    console.error('[Chat] Failed to load history:', e);
    const area = document.getElementById('messagesArea');
    area.appendChild(buildWelcomeScreen());
  }
}

// Persist chat history to store (debounced)
let _saveHistoryTimer = null;
function persistChatHistory() {
  clearTimeout(_saveHistoryTimer);
  _saveHistoryTimer = setTimeout(() => {
    api.chatHistorySave(messages).catch(e => console.error('[Chat] Failed to save history:', e));
  }, 500);  // 500ms debounce
}

// ─── Theme ─────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'dark');
}

function applyFontSize(size) {
  document.documentElement.style.setProperty('--font-size-base', `${size}px`);
  document.querySelectorAll('.messages-area, .msg-bubble, textarea').forEach(el => {
    el.style.fontSize = `${size}px`;
  });
}

// ─── Navigation ────────────────────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById(`tab-${tab}`);
      if (panel) panel.classList.add('active');
      if (tab === 'jobs') loadJobs();
      if (tab === 'status') loadStatus();
    });
  });
}

// ─── Connection ────────────────────────────────────────────────────────────
function setupConnectionListener() {
  api.onConnectionStatus((data) => {
    updateConnectionUI(data.status, data.data);
  });
}

async function checkInitialStatus() {
  const status = await api.getConnectionStatus();
  updateConnectionUI(status, null);
  if (status === 'connected') {
    const res = await api.apiStatus();
    if (res.ok) updateConnectionUI('connected', res.data);
  }
}

function updateConnectionUI(status, data) {
  const dot = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  const sendBtn = document.getElementById('sendBtn');

  dot.className = 'conn-dot ' + status;

  if (status === 'connected') {
    label.textContent = 'Connected';
    const input = document.getElementById('messageInput');
    if (!isStreaming) {
      sendBtn.disabled = !input.value.trim();
    }

    // update model badge
    if (data && data.model) {
      document.getElementById('modelBadge').textContent = data.model;
    }
  } else if (status === 'connecting') {
    label.textContent = 'Connecting…';
    sendBtn.disabled = true;
  } else {
    label.textContent = 'Disconnected';
    sendBtn.disabled = true;
  }
}

// ─── Chat ──────────────────────────────────────────────────────────────────
function setupChat() {
  const input = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    const connected = document.getElementById('connDot').classList.contains('connected');
    sendBtn.disabled = !input.value.trim() || isStreaming || !connected;
  });

  // Send on Enter
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && config.sendOnEnter) {
      e.preventDefault();
      if (!sendBtn.disabled) sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  // Clear chat
  document.getElementById('clearChatBtn').addEventListener('click', () => {
    messages = [];
    const area = document.getElementById('messagesArea');
    area.innerHTML = '';
    area.appendChild(buildWelcomeScreen());
  });

  // Open web gateway
  document.getElementById('openGatewayBtn').addEventListener('click', () => {
    api.openWebGateway();
  });

  // Quick action buttons (welcome screen)
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('quick-action-btn')) {
      const msg = e.target.dataset.msg;
      if (msg) {
        input.value = msg;
        input.dispatchEvent(new Event('input'));
        sendMessage();
      }
    }
  });

  // Setup streaming listeners
  api.onChatStreamChunk(({ streamId, chunk }) => {
    if (streamId !== activeStreamId) return;
    appendToStreamBubble(streamId, chunk);
  });

  api.onChatStreamDone(({ streamId }) => {
    if (streamId !== activeStreamId) return;
    finalizeStream(streamId);
  });

  api.onChatStreamError(({ streamId, error }) => {
    if (streamId !== activeStreamId) return;
    finalizeStream(streamId, error);
  });
}

function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text || isStreaming) return;

  // Hide welcome screen
  const welcome = document.getElementById('welcomeScreen');
  if (welcome) welcome.remove();

  // Add user message
  appendMessage('user', text);
  messages.push({ role: 'user', content: text, timestamp: Date.now() });
  // Trim history if it exceeds cap (keep most recent)
  if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
  persistChatHistory();

  input.value = '';
  input.style.height = 'auto';
  document.getElementById('sendBtn').disabled = true;

  // Start streaming response
  const streamId = `stream_${Date.now()}`;
  activeStreamId = streamId;
  isStreaming = true;

  showStreamingIndicator(true);
  createStreamBubble(streamId);

  api.chatStreamStart(text, streamId);
}

function appendMessage(role, content) {
  const area = document.getElementById('messagesArea');
  const msg = buildMessageEl(role, content);
  area.appendChild(msg);
  area.scrollTop = area.scrollHeight;
}

function buildMessageEl(role, content) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'user' ? 'U' : '⚔';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'msg-content';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = formatMessage(content);

  const time = document.createElement('div');
  time.className = 'msg-time';
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  contentDiv.appendChild(bubble);
  contentDiv.appendChild(time);
  msg.appendChild(avatar);
  msg.appendChild(contentDiv);
  return msg;
}

function createStreamBubble(streamId) {
  const area = document.getElementById('messagesArea');
  const msg = document.createElement('div');
  msg.className = 'message agent';
  msg.id = `stream_msg_${streamId}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = '⚔';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'msg-content';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.id = `stream_bubble_${streamId}`;
  bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';

  const time = document.createElement('div');
  time.className = 'msg-time';
  time.id = `stream_time_${streamId}`;

  contentDiv.appendChild(bubble);
  contentDiv.appendChild(time);
  msg.appendChild(avatar);
  msg.appendChild(contentDiv);
  area.appendChild(msg);
  area.scrollTop = area.scrollHeight;

  streamCounters[streamId] = '';
}

function appendToStreamBubble(streamId, chunk) {
  const bubble = document.getElementById(`stream_bubble_${streamId}`);
  if (!bubble) return;

  streamCounters[streamId] = (streamCounters[streamId] || '') + chunk;
  bubble.innerHTML = formatMessage(streamCounters[streamId]);

  const area = document.getElementById('messagesArea');
  area.scrollTop = area.scrollHeight;
}

function finalizeStream(streamId, error) {
  isStreaming = false;
  showStreamingIndicator(false);

  const bubble = document.getElementById(`stream_bubble_${streamId}`);
  const timeEl = document.getElementById(`stream_time_${streamId}`);

  if (error) {
    if (bubble) {
      bubble.innerHTML = `<span style="color:var(--accent)">⚠ ${escapeHtml(error)}</span>`;
    }
  } else {
    const content = streamCounters[streamId] || '';
    if (bubble) bubble.innerHTML = formatMessage(content);
    messages.push({ role: 'agent', content, timestamp: Date.now() });
    persistChatHistory();
  }

  if (timeEl) {
    timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  delete streamCounters[streamId];
  activeStreamId = null;

  // Re-enable send if we have input
  const input = document.getElementById('messageInput');
  const connDot = document.getElementById('connDot');
  if (input.value.trim() && connDot.classList.contains('connected')) {
    document.getElementById('sendBtn').disabled = false;
  }
}

function buildWelcomeScreen() {
  const div = document.createElement('div');
  div.id = 'welcomeScreen';
  div.className = 'welcome-screen';
  div.innerHTML = `
    <div class="welcome-icon">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64">
        <path d="M32 6L8 18V34C8 47.255 18.745 58 32 58C45.255 58 56 47.255 56 34V18L32 6Z"
              stroke="#e05252" stroke-width="3" stroke-linejoin="round" fill="none"/>
        <path d="M22 28L28 34L42 20" stroke="#e05252" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h3>IronClaw Agent</h3>
    <p>Your secure, privacy-first AI assistant.<br/>Connect to your local IronClaw instance to start chatting.</p>
    <div class="quick-actions">
      <button class="quick-action-btn" data-msg="What can you do?">What can you do?</button>
      <button class="quick-action-btn" data-msg="Show my active jobs">Active jobs</button>
      <button class="quick-action-btn" data-msg="Search my memory for recent tasks">Search memory</button>
      <button class="quick-action-btn" data-msg="What extensions are installed?">Extensions</button>
    </div>
  `;
  return div;
}

function showStreamingIndicator(show) {
  const el = document.getElementById('streamingIndicator');
  el.classList.toggle('hidden', !show);
}

/**
 * Safe markdown-to-HTML renderer.
 * All user/agent text is treated as untrusted.
 * Strategy: escape everything first, then selectively re-introduce
 * only the HTML tags we generated ourselves.
 */
const MAX_FORMAT_CHARS = 200_000; // 200 KB — prevent DoS from huge agent responses

function formatMessage(text) {
  if (typeof text !== 'string') return '';
  if (!text) return '';
  if (text.length > MAX_FORMAT_CHARS) {
    text = text.slice(0, MAX_FORMAT_CHARS) + '\n\n[…response truncated at 200 KB]';
  }

  // Step 1: Extract code blocks BEFORE any other processing
  // Replace them with placeholders so we don't accidentally mangle their content
  const codeBlocks = [];
  text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
    return `\x00CODE${idx}\x00`;
  });

  const inlineCodes = [];
  text = text.replace(/`([^`\n]{1,500})`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00INLINE${idx}\x00`;
  });

  // Step 2: Escape ALL HTML in the remaining text
  text = escapeHtml(text);

  // Step 3: Apply safe inline markdown (on already-escaped text)
  // Bold: **...**  (no nesting, capped at 300 chars)
  text = text.replace(/\*\*([^*\n]{1,300})\*\*/g, '<strong>$1</strong>');
  // Italic: *...*
  text = text.replace(/\*([^*\n]{1,200})\*/g, '<em>$1</em>');

  // Step 4: Line breaks
  text = text.split('\n').map(line => line || '<br/>').join('\n');

  // Step 5: Restore code placeholders (already escaped)
  text = text.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i, 10)] || '');
  text = text.replace(/\x00INLINE(\d+)\x00/g, (_, i) => inlineCodes[parseInt(i, 10)] || '');

  return text;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;'); // FIX: escape apostrophes too (defense-in-depth)
}

// ─── Jobs ──────────────────────────────────────────────────────────────────
function setupJobs() {
  document.getElementById('refreshJobsBtn').addEventListener('click', loadJobs);
}

async function loadJobs() {
  const grid = document.getElementById('jobsGrid');
  grid.innerHTML = '<div class="empty-state"><p>Loading jobs…</p></div>';

  const res = await api.apiJobs();
  if (!res.ok) {
    grid.innerHTML = `<div class="empty-state"><p style="color:var(--accent)">Error: ${escapeHtml(res.error || 'Could not fetch jobs')}</p></div>`;
    return;
  }

  const jobs = Array.isArray(res.data) ? res.data
    : (res.data?.jobs || res.data?.data || []);

  if (!jobs.length) {
    grid.innerHTML = '<div class="empty-state"><p>No jobs found. Your agent has no active or recent jobs.</p></div>';
    return;
  }

  grid.innerHTML = '';
  jobs.forEach(job => {
    const card = buildJobCard(job);
    grid.appendChild(card);
  });
}

function buildJobCard(job) {
  const status = (job.status || 'unknown').toLowerCase();
  const card = document.createElement('div');
  card.className = 'job-card';

  const dot = document.createElement('div');
  dot.className = `job-status-dot ${status}`;

  const info = document.createElement('div');
  info.className = 'job-info';

  const title = document.createElement('div');
  title.className = 'job-title';
  title.textContent = job.title || job.description || job.id || 'Unnamed Job';

  const meta = document.createElement('div');
  meta.className = 'job-meta';
  const parts = [];
  if (job.id) parts.push(`ID: ${job.id}`);
  if (job.created_at || job.createdAt) {
    const d = new Date(job.created_at || job.createdAt);
    parts.push(d.toLocaleString());
  }
  meta.textContent = parts.join(' · ') || status;

  info.appendChild(title);
  info.appendChild(meta);

  const badge = document.createElement('div');
  badge.className = `job-badge ${status}`;
  badge.textContent = status.charAt(0).toUpperCase() + status.slice(1);

  card.appendChild(dot);
  card.appendChild(info);
  card.appendChild(badge);
  return card;
}

// ─── Memory ────────────────────────────────────────────────────────────────
function debounce(fn, delayMs) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

function setupMemory() {
  const input = document.getElementById('memorySearchInput');
  const btn = document.getElementById('memorySearchBtn');
  const debouncedSearch = debounce(searchMemory, 400); // prevent search spam on rapid typing

  btn.addEventListener('click', searchMemory);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchMemory();
  });
  // Optional: also debounce on input (live-search feel, still rate-limited server-side)
  input.addEventListener('input', debouncedSearch);
}

async function searchMemory() {
  const query = document.getElementById('memorySearchInput').value.trim();
  if (!query) return;

  const results = document.getElementById('memoryResults');
  results.innerHTML = '<div class="empty-state"><p>Searching…</p></div>';

  const res = await api.apiMemorySearch(query);
  if (!res.ok) {
    results.innerHTML = `<div class="empty-state"><p style="color:var(--accent)">Error: ${escapeHtml(res.error || 'Search failed')}</p></div>`;
    return;
  }

  const items = Array.isArray(res.data) ? res.data
    : (res.data?.results || res.data?.hits || []);

  if (!items.length) {
    results.innerHTML = '<div class="empty-state"><p>No results found for that query.</p></div>';
    return;
  }

  results.innerHTML = '';
  items.forEach(item => {
    const card = buildMemoryCard(item);
    results.appendChild(card);
  });
}

function buildMemoryCard(item) {
  const card = document.createElement('div');
  card.className = 'memory-card';

  const path = document.createElement('div');
  path.className = 'memory-path';
  path.textContent = item.path || item.id || 'unknown';

  const content = document.createElement('div');
  content.className = 'memory-content';
  const text = item.content || item.text || item.snippet || JSON.stringify(item, null, 2);
  content.textContent = text.length > 600 ? text.slice(0, 600) + '…' : text;

  const score = document.createElement('div');
  score.className = 'memory-score';
  if (item.score !== undefined) score.textContent = `Relevance: ${(item.score * 100).toFixed(1)}%`;

  card.appendChild(path);
  card.appendChild(content);
  if (item.score !== undefined) card.appendChild(score);
  return card;
}

// ─── Status ────────────────────────────────────────────────────────────────
function setupStatus() {
  document.getElementById('refreshStatusBtn').addEventListener('click', loadStatus);
}

async function loadStatus() {
  const connEl  = document.getElementById('statusConnection');
  const modelEl = document.getElementById('statusModel');
  const versionEl = document.getElementById('statusVersion');
  const uptimeEl = document.getElementById('statusUptime');
  const rawEl   = document.getElementById('statusRaw');

  connEl.textContent = '…';

  const res = await api.apiStatus();

  if (!res.ok) {
    connEl.textContent = 'Disconnected';
    connEl.style.color = 'var(--accent)';
    rawEl.textContent = res.error || 'Could not reach IronClaw';
    return;
  }

  connEl.textContent = 'Online';
  connEl.style.color = 'var(--green)';

  const d = res.data || {};
  modelEl.textContent = d.model || d.llm_backend || d.llm || '—';
  versionEl.textContent = d.version || d.v || '—';

  if (d.uptime_seconds !== undefined) {
    const s = d.uptime_seconds;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    uptimeEl.textContent = h > 0 ? `${h}h ${m}m` : `${m}m`;
  } else {
    uptimeEl.textContent = '—';
  }

  rawEl.textContent = JSON.stringify(d, null, 2);
}

// ─── Settings ──────────────────────────────────────────────────────────────
function setupSettingsForm() {
  // Populate
  document.getElementById('cfgHost').value = config.host || '127.0.0.1';
  document.getElementById('cfgPort').value = config.port || 3000;
  document.getElementById('cfgToken').value = config.token || '';
  document.getElementById('cfgHttps').checked = config.useHttps || false;
  document.getElementById('cfgTheme').value = config.theme || 'dark';
  document.getElementById('cfgFontSize').value = config.fontSize || 14;
  document.getElementById('fontSizeLabel').textContent = config.fontSize || 14;
  document.getElementById('cfgMinimize').checked = config.minimizeToTray !== false;
  document.getElementById('cfgNotifications').checked = config.notifications !== false;
  document.getElementById('cfgSendOnEnter').checked = config.sendOnEnter !== false;

  // Font size live preview
  document.getElementById('cfgFontSize').addEventListener('input', (e) => {
    document.getElementById('fontSizeLabel').textContent = e.target.value;
    applyFontSize(parseInt(e.target.value));
  });

  // Theme live preview
  document.getElementById('cfgTheme').addEventListener('change', (e) => {
    applyTheme(e.target.value);
  });

  // Token visibility toggle
  document.getElementById('toggleTokenBtn').addEventListener('click', () => {
    const input = document.getElementById('cfgToken');
    const btn = document.getElementById('toggleTokenBtn');
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = 'Hide';
    } else {
      input.type = 'password';
      btn.textContent = 'Show';
    }
  });

  // Test connection
  document.getElementById('testConnectionBtn').addEventListener('click', async () => {
    const resultEl = document.getElementById('testResult');
    resultEl.textContent = 'Testing…';
    resultEl.className = 'test-result';

    // Temporarily apply settings from form
    await api.setConnection({
      host: document.getElementById('cfgHost').value.trim(),
      port: parseInt(document.getElementById('cfgPort').value) || 3000,
      token: document.getElementById('cfgToken').value.trim(),
      useHttps: document.getElementById('cfgHttps').checked,
    });

    // Wait a moment for connection check
    await new Promise(r => setTimeout(r, 1200));
    const res = await api.apiStatus();
    if (res.ok) {
      resultEl.textContent = '✓ Connected successfully!';
      resultEl.className = 'test-result ok';
    } else {
      resultEl.textContent = `✗ ${res.error || 'Could not connect'}`;
      resultEl.className = 'test-result err';
    }
  });

  // Save settings
  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const hostVal = document.getElementById('cfgHost').value.trim();
    const portVal = parseInt(document.getElementById('cfgPort').value) || 3000;
    const saveResult = document.getElementById('saveResult');

    // Client-side validation (main process validates too)
    if (!hostVal || hostVal.includes('/') || hostVal.includes(' ')) {
      saveResult.textContent = '\u2717 Invalid host';
      saveResult.className = 'save-result err';
      setTimeout(() => { saveResult.textContent = ''; }, 3000);
      return;
    }
    if (portVal < 1 || portVal > 65535) {
      saveResult.textContent = '\u2717 Port must be 1–65535';
      saveResult.className = 'save-result err';
      setTimeout(() => { saveResult.textContent = ''; }, 3000);
      return;
    }

    const newConfig = {
      host:           hostVal,
      port:           portVal,
      token:          document.getElementById('cfgToken').value.trim(),
      useHttps:       document.getElementById('cfgHttps').checked,
      theme:          document.getElementById('cfgTheme').value,
      fontSize:       Math.min(Math.max(parseInt(document.getElementById('cfgFontSize').value) || 14, 11), 20),
      minimizeToTray: document.getElementById('cfgMinimize').checked,
      notifications:  document.getElementById('cfgNotifications').checked,
      sendOnEnter:    document.getElementById('cfgSendOnEnter').checked,
    };

    const res = await api.saveConfig(newConfig);
    if (res.ok) {
      config = newConfig;
      saveResult.textContent = '\u2713 Saved!';
      saveResult.className = 'save-result ok';
    } else {
      const errMsg = res.errors ? res.errors.join(', ') : 'Save failed';
      saveResult.textContent = `\u2717 ${errMsg}`;
      saveResult.className = 'save-result err';
    }
    setTimeout(() => { saveResult.textContent = ''; }, 2500);
  });

  // Quick links
  document.getElementById('linkDocs').addEventListener('click', (e) => {
    e.preventDefault();
    api.openExternal('https://docs.ironclaw.com');
  });
  document.getElementById('linkGithub').addEventListener('click', (e) => {
    e.preventDefault();
    api.openExternal('https://github.com/nearai/ironclaw');
  });
  document.getElementById('linkWebGateway').addEventListener('click', (e) => {
    e.preventDefault();
    api.openWebGateway();
  });
  document.getElementById('linkNearAI').addEventListener('click', (e) => {
    e.preventDefault();
    api.openExternal('https://agent.near.ai/');
  });
}

// ─── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
