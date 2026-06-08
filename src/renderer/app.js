/* ─── IronClaw Companion — Renderer ──────────────────────────────────── */
'use strict';

// Highlight.js is loaded via index.html (local bundle)

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

// ─── Session state ─────────────────────────────────────────────────────
let currentSessionId = 'default';
let sessions = [{ id: 'default', name: 'Default', createdAt: Date.now() }];

// ─── Agent profile state ──────────────────────────────────────────────
let agentProfiles = [];
let activeProfileId = 'default';

// ─── Pinned messages state ────────────────────────────────────────────────
let pinnedMessages = []; // [{ id, role, content, timestamp }]

// ─── Init ─────────────────────────────────────────────────────────────────
let _initialized = false;

async function init() {
  if (_initialized) return; // guard against double-init
  _initialized = true;

  config = await api.getConfig() || config;
  applyTheme(config.theme);
  applyFontSize(config.fontSize);
  setupSessionSelector();  // multi-session management
  await loadAgentProfiles(); // multi-agent profiles
  loadPinnedMessages();      // pinned messages
  setupSettingsForm();
  setupNavigation();
  setupChat();       // registers IPC listeners via preload (deduped there)
  setupJobs();
  setupMemory();
  setupStatus();
  setupConnectionListener();
  await loadPersistedChatHistory();  // load saved messages from disk
  checkInitialStatus();
  checkForUpdates();  // auto-update checker
}

// Load persisted chat history from store
async function loadPersistedChatHistory() {
  try {
    const saved = await api.chatHistoryLoad(currentSessionId);
    if (Array.isArray(saved)) {
      messages = saved;
      // Render saved messages to UI
      const area = document.getElementById('messagesArea');
      const welcome = document.getElementById('welcomeScreen');
      if (welcome) welcome.remove();
      
      if (saved.length > 0) {
        saved.forEach(msg => {
          if (msg.role && msg.content) {
            const el = buildMessageEl(msg.role, msg.content, msg.timestamp);
            area.appendChild(el);
          }
        });
        area.scrollTop = area.scrollHeight;
        updateTokenCounter();
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

// ─── Session Selector (NEW) ─────────────────────────────────────────
async function loadSessions() {
  try {
    sessions = await api.getSessions();
    if (!Array.isArray(sessions) || !sessions.length) {
      sessions = [{ id: 'default', name: 'Default', createdAt: Date.now() }];
    }
  } catch (e) {
    sessions = [{ id: 'default', name: 'Default', createdAt: Date.now() }];
  }
}

async function switchSession(sessionId) {
  // Save current session first
  persistChatHistory();
  
  currentSessionId = sessionId;
  
  // Clear and reload
  const area = document.getElementById('messagesArea');
  area.innerHTML = '';
  messages = [];
  
  await loadPersistedChatHistory();
  updateSessionSelectorUI();
}

async function createNewSession() {
  const name = 'Chat ' + (sessions.length + 1);
  const newSession = await api.createSession(name);
  if (newSession) {
    sessions.push(newSession);
    await switchSession(newSession.id);
  }
}

async function deleteCurrentSession() {
  if (currentSessionId === 'default') return;
  const ok = await api.deleteSession(currentSessionId);
  if (ok) {
    sessions = sessions.filter(s => s.id !== currentSessionId);
    await switchSession('default');
  }
}

function updateSessionSelectorUI() {
  const selector = document.getElementById('sessionSelector');
  if (!selector) return;
  
  const current = sessions.find(s => s.id === currentSessionId);
  selector.textContent = current?.name || 'Chat';
}

function setupSessionSelector() {
  // Load sessions on init
  loadSessions().then(() => {
    updateSessionSelectorUI();
  });
  
  // New session button
  const newBtn = document.getElementById('newSessionBtn');
  if (newBtn) {
    newBtn.addEventListener('click', createNewSession);
  }
  
  // Session dropdown
  const selector = document.getElementById('sessionSelector');
  const dropdown = document.getElementById('sessionDropdown');
  if (selector && dropdown) {
    selector.addEventListener('click', (e) => {
      e.stopPropagation();
      renderSessionDropdown();
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => {
      dropdown.style.display = 'none';
    });
  }
}

function renderSessionDropdown() {
  const dropdown = document.getElementById('sessionDropdown');
  if (!dropdown) return;
  
  dropdown.innerHTML = '';
  sessions.forEach(session => {
    const item = document.createElement('div');
    item.className = 'session-item' + (session.id === currentSessionId ? ' active' : '');
    item.innerHTML = `
      <span class="session-name">${escapeHtml(session.name)}</span>
      ${session.id !== 'default' ? '<span class="session-delete" data-id="' + session.id + '">✕</span>' : ''}
    `;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('session-delete')) {
        e.stopPropagation();
        currentSessionId = session.id;
        deleteCurrentSession();
      } else {
        switchSession(session.id);
      }
      dropdown.style.display = 'none';
    });
    dropdown.appendChild(item);
  });
}

// ─── Pinned messages ───────────────────────────────────────────────────────────────────
const MAX_PINS = 20;

function loadPinnedMessages() {
  try {
    const raw = localStorage.getItem('ironclaw-pins');
    pinnedMessages = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(pinnedMessages)) pinnedMessages = [];
  } catch (_) { pinnedMessages = []; }
}

function savePinnedMessages() {
  try {
    localStorage.setItem('ironclaw-pins', JSON.stringify(pinnedMessages.slice(0, MAX_PINS)));
  } catch (_) {}
}

function pinMessage(id, role, content, timestamp) {
  if (pinnedMessages.find(p => p.id === id)) {
    // already pinned — unpin
    pinnedMessages = pinnedMessages.filter(p => p.id !== id);
    savePinnedMessages();
    showToast('Unpinned');
    renderPinsPanel();
    updatePinsBadge(); // v1.5
    return;
  }
  if (pinnedMessages.length >= MAX_PINS) {
    showToast('Max 20 pins reached');
    return;
  }
  pinnedMessages.push({ id, role, content: content.slice(0, 2000), timestamp });
  savePinnedMessages();
  showToast('📌 Pinned!');
  renderPinsPanel();
  updatePinsBadge(); // v1.5
}

// v1.5: update the pins count badge on nav button
function updatePinsBadge() {
  const badge = document.getElementById('pinsNavBadge');
  if (!badge) return;
  const count = pinnedMessages.length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline-flex' : 'none';
}

// v1.5: scroll to a pinned message in the chat
function scrollToPinnedMessage(msgId) {
  const msgEl = document.querySelector(`[data-msg-id="${CSS.escape(msgId)}"]`);
  if (!msgEl) { showToast('Message not visible in current session'); return; }
  // Switch to chat tab first
  switchTab('chat');
  hidePinsPanel();
  msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const bubble = msgEl.querySelector('.msg-bubble');
  if (bubble) {
    bubble.classList.add('pin-scroll-target');
    setTimeout(() => bubble.classList.remove('pin-scroll-target'), 1600);
  }
}

function setupPinsPanel() {
  // Create the panel if it doesn't exist
  if (document.getElementById('pinsPanel')) return;
  const panel = document.createElement('div');
  panel.id = 'pinsPanel';
  panel.className = 'pins-panel hidden';
  panel.innerHTML = `
    <div class="pins-header">
      <span>📌 Pinned Messages</span>
      <button class="btn-icon" id="closePinsBtn">✕</button>
    </div>
    <div class="pins-list" id="pinsList"></div>
  `;
  document.querySelector('.main-content').appendChild(panel);
  document.getElementById('closePinsBtn').addEventListener('click', hidePinsPanel);
}

function showPinsPanel() {
  const panel = document.getElementById('pinsPanel');
  if (panel) { panel.classList.remove('hidden'); renderPinsPanel(); }
}

function hidePinsPanel() {
  const panel = document.getElementById('pinsPanel');
  if (panel) panel.classList.add('hidden');
}

function renderPinsPanel() {
  const list = document.getElementById('pinsList');
  if (!list) return;
  updatePinsBadge(); // v1.5: sync badge
  if (!pinnedMessages.length) {
    list.innerHTML = '<div class="empty-state"><p>No pinned messages yet.<br>Click the 📍 button on a message to pin it.</p></div>';
    return;
  }
  list.innerHTML = '';
  pinnedMessages.forEach(pin => {
    const item = document.createElement('div');
    item.className = 'pin-item';
    const time = pin.timestamp ? new Date(pin.timestamp).toLocaleString() : '';
    item.innerHTML = `
      <div class="pin-meta">${escapeHtml(pin.role === 'user' ? 'You' : 'IronClaw')} ${time ? '· ' + escapeHtml(time) : ''}</div>
      <div class="pin-content" style="cursor:pointer" title="Click to jump to message">${escapeHtml(pin.content.slice(0, 300))}${pin.content.length > 300 ? '…' : ''}</div>
      <button class="pin-remove-btn" data-id="${escapeHtml(pin.id)}">Unpin</button>
    `;
    // v1.5: click pin content to scroll to message
    item.querySelector('.pin-content').addEventListener('click', () => {
      scrollToPinnedMessage(pin.id);
    });
    item.querySelector('.pin-remove-btn').addEventListener('click', () => {
      pinnedMessages = pinnedMessages.filter(p => p.id !== pin.id);
      savePinnedMessages();
      renderPinsPanel();
      updatePinsBadge();
    });
    list.appendChild(item);
  });
}

// ─── Keyboard shortcuts ────────────────────────────────────────────────────────────────
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;

    // Tab switching: Ctrl+1..5
    if (e.key >= '1' && e.key <= '5') {
      const tabs = ['chat','jobs','memory','status','settings'];
      const tab = tabs[parseInt(e.key) - 1];
      if (tab) { e.preventDefault(); switchTab(tab); }
      return;
    }

    // Ctrl+P — Pinned messages panel
    if (e.key === 'p' || e.key === 'P') {
      const panel = document.getElementById('pinsPanel');
      if (panel) {
        e.preventDefault();
        panel.classList.contains('hidden') ? showPinsPanel() : hidePinsPanel();
      }
    }

    // Ctrl+N — New session
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      const btn = document.getElementById('newSessionBtn');
      if (btn) btn.click();
    }

    // Ctrl+E — Export chat (v1.5: opens modal)
    if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      exportChat();
    }

    // Ctrl+, — Settings (v1.5)
    if (e.key === ',') {
      e.preventDefault();
      switchTab('settings');
    }
  });

  // v1.5: Alt+Left/Right — navigate sessions
  document.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const idx = sessions.findIndex(s => s.id === currentSessionId);
      if (idx === -1) return;
      const next = e.key === 'ArrowRight'
        ? Math.min(idx + 1, sessions.length - 1)
        : Math.max(idx - 1, 0);
      if (next !== idx) switchSession(sessions[next].id);
    }
  });

  // Also add /pins shortcut to PALETTE_COMMANDS
  const pc = PALETTE_COMMANDS;
  if (pc && !pc.find(c => c.label === 'Pinned Messages')) {
    pc.push({ icon: '📌', label: 'Pinned Messages', kbd: 'Ctrl+P', action: () => { closePalette(); showPinsPanel(); } });
    pc.push({ icon: '📋', label: 'New Session', kbd: 'Ctrl+N', action: () => { closePalette(); document.getElementById('newSessionBtn')?.click(); } });
  }
}

// ─── Multi-Agent Profiles (NEW) ───────────────────────────────────────────
// v1.5 Agent avatar colors
const AGENT_COLORS = ['#e05252','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#6366f1'];

function getAgentColor(idx) {
  return AGENT_COLORS[idx % AGENT_COLORS.length];
}

function getAgentInitials(name) {
  return (name || 'A').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

async function loadAgentProfiles() {
  try {
    agentProfiles = await api.getProfiles();
    activeProfileId = await api.getActiveProfileId();
    if (!Array.isArray(agentProfiles) || !agentProfiles.length) {
      agentProfiles = [{ id: 'default', name: 'Local Agent', host: '127.0.0.1', port: 3000, useHttps: false }];
    }
    renderAgentProfileBar();
    renderAgentSwitcher(); // v1.5 sidebar agent switcher
  } catch (e) {
    console.error('[Profiles] Failed to load:', e);
  }
}

function renderAgentProfileBar() {
  const bar = document.getElementById('agentProfileBar');
  if (!bar) return;
  bar.innerHTML = '';

  agentProfiles.forEach(profile => {
    const btn = document.createElement('button');
    btn.className = 'agent-profile-btn' + (profile.id === activeProfileId ? ' active' : '');
    btn.title = `${profile.host}:${profile.port}`;
    btn.textContent = profile.name.slice(0, 16);
    btn.addEventListener('click', () => switchAgentProfile(profile.id));
    bar.appendChild(btn);
  });

  // Add profile button
  const addBtn = document.createElement('button');
  addBtn.className = 'agent-profile-add-btn';
  addBtn.title = 'Add Agent';
  addBtn.textContent = '+';
  addBtn.addEventListener('click', () => showAddProfileModal());
  bar.appendChild(addBtn);
}

async function switchAgentProfile(id) {
  const ok = await api.activateProfile(id);
  if (ok) {
    activeProfileId = id;
    renderAgentProfileBar();
    renderAgentSwitcher(); // v1.5: refresh sidebar switcher
    // Reload config to reflect new host/port
    config = await api.getConfig() || config;
    document.getElementById('cfgHost').value = config.host || '127.0.0.1';
    document.getElementById('cfgPort').value = config.port || 3000;
    showToast(`Switched to ${agentProfiles.find(p => p.id === id)?.name || id}`);
  }
}

function showAddProfileModal() {
  const modal = document.getElementById('addProfileModal');
  if (modal) { modal.style.display = 'flex'; return; }

  // Create inline modal dynamically
  const m = document.createElement('div');
  m.id = 'addProfileModal';
  m.className = 'modal-overlay';
  m.innerHTML = `
    <div class="modal-box">
      <h3>Add Agent Profile</h3>
      <label>Name<br><input id="profileName" type="text" value="New Agent" maxlength="64" /></label>
      <label>Host<br><input id="profileHost" type="text" value="127.0.0.1" /></label>
      <label>Port<br><input id="profilePort" type="number" value="3001" min="1" max="65535" /></label>
      <label>Token (optional)<br><input id="profileToken" type="password" /></label>
      <label style="flex-direction:row;gap:8px;align-items:center">
        <input id="profileHttps" type="checkbox" /> Use HTTPS
      </label>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary" id="saveProfileBtn">Save</button>
        <button class="btn btn-ghost" id="cancelProfileBtn">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(m);

  document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    const data = {
      name:     document.getElementById('profileName').value.trim() || 'New Agent',
      host:     document.getElementById('profileHost').value.trim(),
      port:     parseInt(document.getElementById('profilePort').value) || 3001,
      token:    document.getElementById('profileToken').value.trim(),
      useHttps: document.getElementById('profileHttps').checked,
    };
    const res = await api.saveProfile(data);
    if (res.ok) {
      agentProfiles.push(res.profile);
      renderAgentProfileBar();
      m.remove();
      showToast('Agent profile added');
    } else {
      showToast('Error: ' + (res.error || res.errors?.join(', ') || 'Failed'));
    }
  });
  document.getElementById('cancelProfileBtn').addEventListener('click', () => m.remove());
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
}

// v1.5: Discord-style agent switcher in sidebar
function renderAgentSwitcher() {
  const container = document.getElementById('agentSwitcher');
  if (!container) return;
  container.innerHTML = '<div class="agent-switcher-label">Agents</div>';
  const list = document.createElement('div');
  list.className = 'agent-switcher-list';

  agentProfiles.forEach((profile, idx) => {
    const btn = document.createElement('button');
    btn.className = 'agent-avatar-btn' + (profile.id === activeProfileId ? ' active' : '');
    btn.title = `${profile.name} (${profile.host}:${profile.port})`;
    const icon = document.createElement('span');
    icon.className = 'agent-avatar-icon';
    icon.style.background = getAgentColor(idx);
    icon.textContent = getAgentInitials(profile.name);
    const name = document.createElement('span');
    name.className = 'agent-avatar-name';
    name.textContent = profile.name.slice(0, 20);
    btn.appendChild(icon);
    btn.appendChild(name);
    btn.addEventListener('click', () => switchAgentProfile(profile.id));
    list.appendChild(btn);
  });

  // Add agent button
  const addBtn = document.createElement('button');
  addBtn.className = 'agent-add-btn';
  addBtn.title = 'Add Agent';
  addBtn.innerHTML = '<span class="agent-add-icon">+</span><span class="agent-add-label">Add Agent</span>';
  addBtn.addEventListener('click', () => showAddProfileModal());
  list.appendChild(addBtn);
  container.appendChild(list);
}

// Simple toast notification
function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg.slice(0, 120);
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2500);
}

// ─── Auto-update checker (NEW) ──────────────────────────────
async function checkForUpdates() {
  try {
    const info = await api.getUpdateInfo();
    if (info && info.available) {
      showUpdateBanner(info.version, info.url);
    }
    
    // Also listen for real-time update notifications
    api.onUpdateAvailable(({ version, url }) => {
      showUpdateBanner(version, url);
    });
  } catch (e) {
    console.error('[Update] Check failed:', e);
  }
}

function showUpdateBanner(version, url) {
  const banner = document.getElementById('updateBanner');
  if (!banner) return;
  
  banner.innerHTML = `
    <span>🔔 IronClaw Companion v${version} available!</span>
    <a href="#" class="update-link" data-url="${escapeHtml(url)}">Download</a>
  `;
  banner.style.display = 'flex';
  
  banner.querySelector('.update-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    const url = e.target.dataset.url;
    if (url) api.openExternal(url);
  });
}

// Persist chat history to store (debounced)
let _saveHistoryTimer = null;
function persistChatHistory() {
  clearTimeout(_saveHistoryTimer);
  _saveHistoryTimer = setTimeout(() => {
    api.chatHistorySave(messages, currentSessionId).catch(e => console.error('[Chat] Failed to save history:', e));
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
      // v1.5: pins is a floating overlay, not a regular tab
      if (tab === 'pins') {
        const pinsPanel = document.getElementById('pinsPanel');
        pinsPanel?.classList.contains('hidden') ? showPinsPanel() : hidePinsPanel();
        return;
      }
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

  // Whitelist status values to prevent class injection
  const safeStatus = ['connected', 'connecting', 'disconnected'].includes(status) ? status : 'disconnected';
  dot.className = 'conn-dot ' + safeStatus;

  if (safeStatus === 'connected') {
    label.textContent = 'Connected';
    const input = document.getElementById('messageInput');
    if (!isStreaming) {
      sendBtn.disabled = !input.value.trim();
    }

    // update model badge — escape to prevent XSS
    if (data && data.model && typeof data.model === 'string') {
      document.getElementById('modelBadge').textContent = data.model.slice(0, 80);
    }
  } else if (safeStatus === 'connecting') {
    label.textContent = 'Connecting…';
    sendBtn.disabled = true;
  } else {
    label.textContent = 'Disconnected';
    sendBtn.disabled = true;
  }
}


// ─── Prompt templates ──────────────────────────────────────────────────────
const DEFAULT_TEMPLATES = [
  { label: 'Summarize',      text: 'Please summarize what we\'ve discussed so far.' },
  { label: 'Active jobs',    text: 'Show my active jobs.' },
  { label: 'Search memory',  text: 'Search my memory for recent tasks.' },
  { label: 'What can you do', text: 'What can you do?' },
  { label: 'Extensions',     text: 'What extensions are installed?' },
  { label: 'Help',           text: 'How do I use you effectively?' },
];

function setupTemplates() {
  const btn = document.getElementById('templatesBtn');
  const dropdown = document.getElementById('templatesDropdown');

  // Build template items
  function renderTemplates() {
    dropdown.innerHTML = '';
    DEFAULT_TEMPLATES.forEach(t => {
      const item = document.createElement('div');
      item.className = 'template-item';
      item.innerHTML = `
        <span class="template-item-label">${escapeHtml(t.label)}</span>
        <span class="template-item-preview">${escapeHtml(t.text)}</span>
      `;
      item.addEventListener('click', () => {
        const input = document.getElementById('messageInput');
        input.value = t.text;
        input.dispatchEvent(new Event('input'));
        input.focus();
        dropdown.style.display = 'none';
      });
      dropdown.appendChild(item);
    });
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dropdown.style.display === 'none') {
      renderTemplates();
      dropdown.style.display = 'block';
    } else {
      dropdown.style.display = 'none';
    }
  });

  document.addEventListener('click', () => {
    dropdown.style.display = 'none';
  });
}

// ─── Token counter ─────────────────────────────────────────────────────────
function updateTokenCounter() {
  const el = document.getElementById('tokenCounter');
  if (!el) return;
  // Approximate: 1 token ≈ 4 chars for English text
  const totalChars = messages.reduce((sum, m) => sum + (m.content || '').length, 0);
  const approxTokens = Math.round(totalChars / 4);
  if (totalChars === 0) { el.textContent = ''; return; }
  // v1.5: show estimated cost at ~$0.001 per 1K tokens
  const costUsd = (approxTokens / 1000) * 0.001;
  const costStr = costUsd < 0.001 ? '<$0.001' : '$' + costUsd.toFixed(3);
  el.textContent = `~${approxTokens.toLocaleString()} tokens · ~${costStr}`;
  el.className = 'token-counter' + (approxTokens > 100000 ? ' danger' : approxTokens > 60000 ? ' warn' : '');
}

// ─── Chat search ───────────────────────────────────────────────────────────
let searchMatches = [];
let searchMatchIdx = 0;

function setupChatSearch() {
  const bar   = document.getElementById('chatSearchBar');
  const input = document.getElementById('chatSearchInput');
  const count = document.getElementById('chatSearchCount');
  const prev  = document.getElementById('chatSearchPrev');
  const next  = document.getElementById('chatSearchNext');
  const close = document.getElementById('chatSearchClose');
  const searchBtn = document.getElementById('searchChatBtn');

  function openSearch() {
    bar.classList.add('visible');
    input.focus();
    input.select();
  }

  function closeSearch() {
    bar.classList.remove('visible');
    input.value = '';
    clearSearchHighlights();
    searchMatches = [];
    count.textContent = '';
  }

  function clearSearchHighlights() {
    document.querySelectorAll('.msg-bubble mark').forEach(m => {
      m.replaceWith(document.createTextNode(m.textContent));
    });
    document.querySelectorAll('.msg-bubble.search-highlight').forEach(b => {
      b.classList.remove('search-highlight');
    });
  }

  // v1.5: highlight matching text inside bubble text nodes
  function highlightTextInBubble(bubble, query) {
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return;
        const before = document.createTextNode(text.slice(0, idx));
        const mark = document.createElement('mark');
        mark.textContent = text.slice(idx, idx + query.length);
        const after = document.createTextNode(text.slice(idx + query.length));
        const parent = node.parentNode;
        parent.insertBefore(before, node);
        parent.insertBefore(mark, node);
        parent.insertBefore(after, node);
        parent.removeChild(node);
      } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'MARK') {
        Array.from(node.childNodes).forEach(walk);
      }
    };
    Array.from(bubble.childNodes).forEach(walk);
  }

  function getSearchFilters() {
    const dateFilter = document.getElementById('searchDateFilter')?.value || 'all';
    const roleFilter = document.getElementById('searchRoleFilter')?.value || 'all';
    return { dateFilter, roleFilter };
  }

  function matchesFilters(bubble, dateFilter, roleFilter) {
    const msgEl = bubble.closest('.message');
    if (!msgEl) return true;
    // Role filter
    if (roleFilter === 'user' && !msgEl.classList.contains('user')) return false;
    if (roleFilter === 'agent' && !msgEl.classList.contains('agent')) return false;
    // Date filter
    if (dateFilter !== 'all') {
      const timeEl = msgEl.querySelector('.msg-time');
      const msgIdx = Array.from(document.querySelectorAll('.message')).indexOf(msgEl);
      const msgData = messages[msgIdx];
      const ts = msgData?.timestamp;
      if (ts) {
        const now = Date.now();
        const age = now - ts;
        if (dateFilter === 'today' && age > 86400000) return false;
        if (dateFilter === 'week' && age > 7 * 86400000) return false;
        if (dateFilter === 'month' && age > 30 * 86400000) return false;
      }
    }
    return true;
  }

  function runSearch(query) {
    clearSearchHighlights();
    searchMatches = [];
    if (!query.trim()) { count.textContent = ''; return; }
    const q = query.toLowerCase();
    const { dateFilter, roleFilter } = getSearchFilters();
    const bubbles = document.querySelectorAll('.msg-bubble');
    bubbles.forEach(bubble => {
      if (!matchesFilters(bubble, dateFilter, roleFilter)) return;
      const text = bubble.textContent;
      if (text.toLowerCase().includes(q)) {
        searchMatches.push(bubble);
        highlightTextInBubble(bubble, query); // v1.5: highlight text
      }
    });
    count.textContent = searchMatches.length ? `${searchMatchIdx + 1}/${searchMatches.length}` : 'No results';
    if (searchMatches.length) {
      searchMatchIdx = 0;
      highlightMatch();
    }
  }

  function highlightMatch() {
    document.querySelectorAll('.msg-bubble.search-highlight').forEach(b => b.classList.remove('search-highlight'));
    if (!searchMatches.length) return;
    searchMatchIdx = ((searchMatchIdx % searchMatches.length) + searchMatches.length) % searchMatches.length;
    const bubble = searchMatches[searchMatchIdx];
    bubble.classList.add('search-highlight');
    bubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
    count.textContent = `${searchMatchIdx + 1}/${searchMatches.length}`;
  }

  searchBtn.addEventListener('click', openSearch);
  close.addEventListener('click', closeSearch);
  prev.addEventListener('click', () => { searchMatchIdx--; highlightMatch(); });
  next.addEventListener('click', () => { searchMatchIdx++; highlightMatch(); });
  input.addEventListener('input', () => { searchMatchIdx = 0; runSearch(input.value); });
  // v1.5: re-run search when filters change
  document.getElementById('searchDateFilter')?.addEventListener('change', () => { searchMatchIdx = 0; runSearch(input.value); });
  document.getElementById('searchRoleFilter')?.addEventListener('change', () => { searchMatchIdx = 0; runSearch(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSearch(); }
    if (e.key === 'Enter')  { e.shiftKey ? searchMatchIdx-- : searchMatchIdx++; highlightMatch(); }
  });

  // Global Ctrl+F
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      const chatTab = document.getElementById('tab-chat');
      if (chatTab && chatTab.classList.contains('active')) {
        e.preventDefault();
        openSearch();
      }
    }
  });
}

// ─── Command palette (Ctrl+K) ──────────────────────────────────────────────
const PALETTE_COMMANDS = [
  { icon: '💬', label: 'Go to Chat',           kbd: '1',      action: () => switchTab('chat') },
  { icon: '💼', label: 'Go to Jobs',           kbd: '2',      action: () => switchTab('jobs') },
  { icon: '🗄',  label: 'Go to Memory',         kbd: '3',      action: () => switchTab('memory') },
  { icon: '📊', label: 'Go to Status',          kbd: '4',      action: () => switchTab('status') },
  { icon: '⚙️', label: 'Go to Settings',       kbd: '5',      action: () => switchTab('settings') },
  { icon: '🔍', label: 'Search Chat',           kbd: 'Ctrl+F', action: () => { closePalette(); document.getElementById('searchChatBtn').click(); } },
  { icon: '📥', label: 'Export Chat',           kbd: '',       action: () => { closePalette(); exportChat(); } },
  { icon: '🗑',  label: 'Clear Chat History',   kbd: '',       action: () => { closePalette(); showClearModal(); } },
  { icon: '🌐', label: 'Open Web Gateway',      kbd: '',       action: () => { closePalette(); api.openWebGateway(); } },
  { icon: '🔄', label: 'Refresh Jobs',          kbd: '',       action: () => { closePalette(); switchTab('jobs'); loadJobs(); } },
  { icon: '📡', label: 'Refresh Status',        kbd: '',       action: () => { closePalette(); switchTab('status'); loadStatus(); } },
];

let paletteOpen = false;
let paletteSelectedIdx = 0;

function openPalette() {
  const overlay = document.getElementById('paletteOverlay');
  const input   = document.getElementById('paletteInput');
  overlay.style.display = 'flex';
  paletteOpen = true;
  paletteSelectedIdx = 0;
  input.value = '';
  renderPaletteResults('');
  setTimeout(() => input.focus(), 10);
}

function closePalette() {
  document.getElementById('paletteOverlay').style.display = 'none';
  paletteOpen = false;
}

function renderPaletteResults(query) {
  const results = document.getElementById('paletteResults');
  results.innerHTML = '';
  const q = query.toLowerCase();
  const filtered = PALETTE_COMMANDS.filter(c => !q || c.label.toLowerCase().includes(q));

  if (!filtered.length) {
    results.innerHTML = '<div class="palette-section-label">No results</div>';
    return;
  }

  results.innerHTML = '<div class="palette-section-label">Commands</div>';
  filtered.forEach((cmd, i) => {
    const item = document.createElement('div');
    item.className = 'palette-item' + (i === paletteSelectedIdx ? ' selected' : '');
    item.innerHTML = `
      <span class="palette-item-icon">${cmd.icon}</span>
      <span class="palette-item-label">${escapeHtml(cmd.label)}</span>
      ${cmd.kbd ? `<span class="palette-item-kbd">${escapeHtml(cmd.kbd)}</span>` : ''}
    `;
    item.addEventListener('click', () => cmd.action());
    results.appendChild(item);
  });
}

function setupPalette() {
  const overlay = document.getElementById('paletteOverlay');
  const input   = document.getElementById('paletteInput');

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePalette();
  });

  input.addEventListener('input', () => {
    paletteSelectedIdx = 0;
    renderPaletteResults(input.value);
  });

  input.addEventListener('keydown', (e) => {
    const q = input.value.toLowerCase();
    const filtered = PALETTE_COMMANDS.filter(c => !q || c.label.toLowerCase().includes(q));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      paletteSelectedIdx = Math.min(paletteSelectedIdx + 1, filtered.length - 1);
      renderPaletteResults(input.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      paletteSelectedIdx = Math.max(paletteSelectedIdx - 1, 0);
      renderPaletteResults(input.value);
    } else if (e.key === 'Enter') {
      if (filtered[paletteSelectedIdx]) filtered[paletteSelectedIdx].action();
    } else if (e.key === 'Escape') {
      closePalette();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      paletteOpen ? closePalette() : openPalette();
    }
    if (paletteOpen && e.key === 'Escape') closePalette();
  });
}

function switchTab(tabName) {
  document.querySelectorAll('.nav-btn[data-tab]').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.nav-btn[data-tab="${tabName}"]`);
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`tab-${tabName}`);
  if (panel) panel.classList.add('active');
  if (tabName === 'jobs') loadJobs();
  if (tabName === 'status') loadStatus();
}

// ─── Export chat (v1.5: modal with format options) ────────────────────────
function exportChat() {
  if (!messages.length) { showToast('No messages to export'); return; }
  // v1.5: show export format modal
  const modal = document.getElementById('exportModal');
  if (modal) { modal.style.display = 'flex'; return; }
  // Fallback: direct markdown export if modal not in DOM
  doExport('markdown');
}

function doExport(format) {
  const session = sessions.find(s => s.id === currentSessionId);
  const sessionName = session?.name || 'Chat';
  const activeProfile = agentProfiles.find(p => p.id === activeProfileId);
  const agentName = activeProfile?.name || 'IronClaw';
  const dateStr = new Date().toISOString().slice(0, 10);
  const safeSessionName = sessionName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  if (format === 'markdown') {
    const lines = messages.map(m => {
      const time = m.timestamp ? new Date(m.timestamp).toLocaleString() : '';
      const role = m.role === 'user' ? 'You' : agentName;
      const content = typeof m.content === 'string' ? m.content : '';
      return `**${role}**${time ? ` _(${time})_` : ''}\n\n${content}`;
    });
    const md = `# IronClaw Chat Export\n\n**Session:** ${sessionName}  \n**Agent:** ${agentName}  \n**Exported:** ${new Date().toLocaleString()}\n\n---\n\n` + lines.join('\n\n---\n\n');
    triggerDownload(md, `ironclaw-${safeSessionName}-${dateStr}.md`, 'text/markdown');

  } else if (format === 'json') {
    const data = {
      exportedAt: new Date().toISOString(),
      session: { id: currentSessionId, name: sessionName },
      agent: { id: activeProfileId, name: agentName, host: activeProfile?.host, port: activeProfile?.port },
      messageCount: messages.length,
      messages: messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
        timestamp: m.timestamp || null,
        timestampHuman: m.timestamp ? new Date(m.timestamp).toISOString() : null,
      }))
    };
    triggerDownload(JSON.stringify(data, null, 2), `ironclaw-${safeSessionName}-${dateStr}.json`, 'application/json');

  } else if (format === 'text') {
    const lines = messages.map(m => {
      const time = m.timestamp ? new Date(m.timestamp).toLocaleString() : '';
      const role = m.role === 'user' ? 'You' : agentName;
      const content = typeof m.content === 'string' ? m.content : '';
      return `[${role}${time ? ' · ' + time : ''}]\n${content}`;
    });
    triggerDownload(lines.join('\n\n'), `ironclaw-${safeSessionName}-${dateStr}.txt`, 'text/plain');

  } else if (format === 'clipboard') {
    const lines = messages.map(m => {
      const role = m.role === 'user' ? 'You' : agentName;
      const content = typeof m.content === 'string' ? m.content : '';
      return `${role}: ${content}`;
    });
    navigator.clipboard.writeText(lines.join('\n\n')).then(() => {
      showToast('✓ Chat copied to clipboard');
    }).catch(() => showToast('Clipboard access denied'));
    return;
  }
  showToast('Chat exported');
}

function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function setupExportModal() {
  const modal = document.getElementById('exportModal');
  const closeBtn = document.getElementById('exportModalCloseBtn');
  if (!modal) return;

  modal.querySelectorAll('.export-fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fmt = btn.dataset.format;
      modal.style.display = 'none';
      doExport(fmt);
    });
  });

  if (closeBtn) closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
}

// ─── Clear modal ───────────────────────────────────────────────────────────
function showClearModal() {
  document.getElementById('clearModal').style.display = 'flex';
}

function hideClearModal() {
  document.getElementById('clearModal').style.display = 'none';
}

function doClearChat() {
  messages = [];
  const area = document.getElementById('messagesArea');
  area.innerHTML = '';
  area.appendChild(buildWelcomeScreen());
  api.chatHistoryClear(currentSessionId);
  updateTokenCounter();
  hideClearModal();
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

  // Clear chat — now shows confirmation dialog
  document.getElementById('clearChatBtn').addEventListener('click', showClearModal);
  document.getElementById('clearCancelBtn').addEventListener('click', hideClearModal);
  document.getElementById('clearConfirmBtn').addEventListener('click', doClearChat);
  document.getElementById('clearModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('clearModal')) hideClearModal();
  });

  // Export chat
  document.getElementById('exportChatBtn').addEventListener('click', exportChat);

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
    if (!streamId || typeof chunk !== 'string') return;
    if (streamId !== activeStreamId) return;
    // Guard: chunk must be a reasonable size
    if (chunk.length > 65536) return;
    appendToStreamBubble(streamId, chunk);
  });

  api.onChatStreamDone(({ streamId }) => {
    if (streamId !== activeStreamId) return;
    finalizeStream(streamId);
  });

  api.onChatStreamError(({ streamId, error }) => {
    if (streamId !== activeStreamId) return;
    // Sanitize error message before display
    const safeError = typeof error === 'string' ? error.slice(0, 200) : 'Stream error';
    finalizeStream(streamId, safeError);
  });

  setupTemplates();
  setupChatSearch();
  setupPalette();
  setupSlashAutocomplete();
  setupPinsPanel();
  setupKeyboardShortcuts();
  setupExportModal(); // v1.5
}

// ─── Slash commands ──────────────────────────────────────────────────────
const SLASH_COMMANDS = [
  { cmd: '/help',    desc: 'Show available commands' },
  { cmd: '/clear',   desc: 'Clear chat history' },
  { cmd: '/export',  desc: 'Export chat to Markdown' },
  { cmd: '/pins',    desc: 'Show pinned messages' },
  { cmd: '/session', desc: 'List chat sessions' },
  { cmd: '/agent',   desc: 'List agent profiles' },
  { cmd: '/status',  desc: 'Show connection status' },
];

function handleSlashCommand(text) {
  const lower = text.toLowerCase().trim();
  if (lower === '/help') {
    const helpText = SLASH_COMMANDS.map(c => `\`${c.cmd}\` — ${c.desc}`).join('\n');
    appendSystemMessage('**Available commands:**\n' + helpText);
    return true;
  }
  if (lower === '/clear') {
    showClearModal();
    return true;
  }
  if (lower === '/export') {
    exportChat();
    showToast('Chat exported');
    return true;
  }
  if (lower === '/pins') {
    showPinsPanel();
    return true;
  }
  if (lower === '/session') {
    const list = sessions.map((s, i) => `${s.id === currentSessionId ? '▶️' : '▫️'} **${s.name}**`).join('\n');
    appendSystemMessage('**Sessions:**\n' + list);
    return true;
  }
  if (lower === '/agent') {
    const list = agentProfiles.map(p => `${p.id === activeProfileId ? '▶️' : '▫️'} **${p.name}** (${p.host}:${p.port})`).join('\n');
    appendSystemMessage('**Agent Profiles:**\n' + (list || 'No profiles'));
    return true;
  }
  if (lower === '/status') {
    const tab = document.querySelector('.nav-btn[data-tab="status"]');
    if (tab) tab.click();
    return true;
  }
  return false; // not a slash command
}

function appendSystemMessage(text) {
  const area = document.getElementById('messagesArea');
  const el = document.createElement('div');
  el.className = 'message system';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble system-bubble';
  bubble.innerHTML = formatMessage(text);
  el.appendChild(bubble);
  area.appendChild(el);
  area.scrollTop = area.scrollHeight;
}

// Setup slash command autocomplete in input
function setupSlashAutocomplete() {
  const input = document.getElementById('messageInput');
  let acMenu = null;

  function closeAc() {
    if (acMenu) { acMenu.remove(); acMenu = null; }
  }

  input.addEventListener('input', () => {
    const val = input.value;
    if (!val.startsWith('/')) { closeAc(); return; }
    const query = val.toLowerCase();
    const matches = SLASH_COMMANDS.filter(c => c.cmd.startsWith(query));
    if (!matches.length) { closeAc(); return; }

    closeAc();
    acMenu = document.createElement('div');
    acMenu.className = 'slash-ac-menu';
    matches.forEach(c => {
      const item = document.createElement('div');
      item.className = 'slash-ac-item';
      item.innerHTML = `<span class="slash-ac-cmd">${escapeHtml(c.cmd)}</span><span class="slash-ac-desc">${escapeHtml(c.desc)}</span>`;
      item.addEventListener('click', () => {
        input.value = c.cmd;
        input.dispatchEvent(new Event('input'));
        closeAc();
        input.focus();
      });
      acMenu.appendChild(item);
    });

    const inputRect = input.getBoundingClientRect();
    acMenu.style.bottom = (window.innerHeight - inputRect.top + 4) + 'px';
    acMenu.style.left = inputRect.left + 'px';
    acMenu.style.width = inputRect.width + 'px';
    document.body.appendChild(acMenu);
  });

  input.addEventListener('keydown', (e) => {
    if (!acMenu) return;
    const items = acMenu.querySelectorAll('.slash-ac-item');
    const selected = acMenu.querySelector('.slash-ac-item.selected');
    const idx = Array.from(items).indexOf(selected);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[Math.min(idx + 1, items.length - 1)];
      items.forEach(i => i.classList.remove('selected'));
      if (next) next.classList.add('selected');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = items[Math.max(idx - 1, 0)];
      items.forEach(i => i.classList.remove('selected'));
      if (prev) prev.classList.add('selected');
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      const sel = acMenu.querySelector('.slash-ac-item.selected') || items[0];
      if (sel) { sel.click(); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      closeAc();
    }
  });

  document.addEventListener('click', (e) => {
    if (acMenu && !acMenu.contains(e.target) && e.target !== input) closeAc();
  });
}

function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text || isStreaming) return;

  // Handle slash commands locally
  if (text.startsWith('/')) {
    const handled = handleSlashCommand(text);
    if (handled) {
      input.value = '';
      input.style.height = 'auto';
      return;
    }
  }

  // Hide welcome screen
  const welcome = document.getElementById('welcomeScreen');
  if (welcome) welcome.remove();

  // Add user message
  appendMessage('user', text);
  messages.push({ role: 'user', content: text, timestamp: Date.now() });
  // Trim history if it exceeds cap (keep most recent)
  if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
  persistChatHistory();
  updateTokenCounter();

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

function buildMessageEl(role, content, timestamp) {
  const msg = document.createElement('div');
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  msg.className = `message ${role}`;
  msg.dataset.msgId = msgId;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'user' ? 'U' : '⚔';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'msg-content';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = formatMessage(content);

  // Apply syntax highlighting to code blocks
  if (window.hljs) {
    bubble.querySelectorAll('pre code').forEach(el => window.hljs.highlightElement(el));
  }

  // Copy button
  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-msg-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.title = 'Copy message';
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(content).then(() => {
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('copied');
      }, 1500);
    }).catch(() => {});
  });

  // Pin button
  const isPinned = pinnedMessages.some(p => p.id === msgId);
  const pinBtn = document.createElement('button');
  pinBtn.className = 'pin-msg-btn' + (isPinned ? ' pinned' : '');
  pinBtn.title = isPinned ? 'Unpin message' : 'Pin message';
  pinBtn.textContent = isPinned ? '📌' : '📍';
  pinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const ts2 = timestamp || Date.now();
    pinMessage(msgId, role, content, ts2);
    const nowPinned = pinnedMessages.some(p => p.id === msgId);
    pinBtn.textContent = nowPinned ? '📌' : '📍';
    pinBtn.classList.toggle('pinned', nowPinned);
    pinBtn.title = nowPinned ? 'Unpin message' : 'Pin message';
  });

  const time = document.createElement('div');
  time.className = 'msg-time';
  const ts = timestamp ? new Date(timestamp) : new Date();
  time.textContent = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  contentDiv.appendChild(copyBtn);
  contentDiv.appendChild(pinBtn);
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
    if (bubble) {
      bubble.innerHTML = formatMessage(content);
      // Apply syntax highlighting to code blocks
      if (window.hljs) {
        bubble.querySelectorAll('pre code').forEach(el => window.hljs.highlightElement(el));
      }
    }
    messages.push({ role: 'agent', content, timestamp: Date.now() });
    persistChatHistory();
    updateTokenCounter();
    // Add copy button to finalized stream bubble
    const msgEl = document.getElementById(`stream_msg_${streamId}`);
    if (msgEl) {
      const contentDiv = msgEl.querySelector('.msg-content');
      if (contentDiv && !contentDiv.querySelector('.copy-msg-btn')) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-msg-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.title = 'Copy message';
        const finalContent = content;
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(finalContent).then(() => {
            copyBtn.textContent = 'Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }, 1500);
          }).catch(() => {});
        });
        contentDiv.insertBefore(copyBtn, contentDiv.firstChild);
      }
    }
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

  // Step 6: Inline image rendering — detect image URLs and render <img>
  // Only render https:// image URLs to prevent local file access
  text = text.replace(
    /https:\/\/[^\s<>"']{5,500}\.(png|jpg|jpeg|gif|webp|svg)(\?[^\s<>"']{0,200})?/gi,
    (match) => {
      const safeUrl = match.replace(/'/g, '%27').replace(/"/g, '%22');
      // Wrap in anchor so user can open in browser; img renders inline
      return `<span class="inline-img-wrap"><img class="inline-img" src="${safeUrl}" alt="image" loading="lazy" onerror="this.parentElement.innerHTML='<span class=img-err>[image failed to load]</span>'"/></span>`;
    }
  );

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

  const rawJobs = Array.isArray(res.data) ? res.data
    : (res.data?.jobs || res.data?.data || []);

  // Limit rendered jobs to prevent DOM flood
  const jobs = Array.isArray(rawJobs) ? rawJobs.slice(0, 200) : [];

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
  // Whitelist safe CSS class values for status to prevent class injection
  const RAW_STATUS = typeof job.status === 'string' ? job.status.toLowerCase() : 'unknown';
  const SAFE_STATUSES = new Set(['running', 'queued', 'done', 'failed', 'pending', 'cancelled', 'unknown']);
  const status = SAFE_STATUSES.has(RAW_STATUS) ? RAW_STATUS : 'unknown';

  const card = document.createElement('div');
  card.className = 'job-card';

  const dot = document.createElement('div');
  dot.className = `job-status-dot ${status}`;

  const info = document.createElement('div');
  info.className = 'job-info';

  const title = document.createElement('div');
  title.className = 'job-title';
  // Use textContent — never innerHTML — for API-sourced data
  const rawTitle = job.title || job.description || job.id || 'Unnamed Job';
  title.textContent = String(rawTitle).slice(0, 200);

  const meta = document.createElement('div');
  meta.className = 'job-meta';
  const parts = [];
  if (job.id) parts.push(`ID: ${String(job.id).slice(0, 64)}`);
  if (job.created_at || job.createdAt) {
    const ts = job.created_at || job.createdAt;
    // Validate timestamp before constructing Date
    const d = new Date(ts);
    if (!isNaN(d.getTime())) parts.push(d.toLocaleString());
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

  const pathEl = document.createElement('div');
  pathEl.className = 'memory-path';
  const rawPath = item.path || item.id || 'unknown';
  pathEl.textContent = String(rawPath).slice(0, 512);

  const content = document.createElement('div');
  content.className = 'memory-content';
  const text = item.content || item.text || item.snippet || JSON.stringify(item, null, 2);
  const safeText = typeof text === 'string' ? text : String(text);
  content.textContent = safeText.length > 600 ? safeText.slice(0, 600) + '…' : safeText;

  const score = document.createElement('div');
  score.className = 'memory-score';
  if (item.score !== undefined) {
    const safeScore = typeof item.score === 'number' && isFinite(item.score)
      ? Math.min(Math.max(item.score, 0), 1)
      : 0;
    score.textContent = `Relevance: ${(safeScore * 100).toFixed(1)}%`;
  }

  card.appendChild(pathEl);
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
