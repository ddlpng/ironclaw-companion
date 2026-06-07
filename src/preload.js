'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ─── Listener registry — prevents duplicate/leaked handlers ──────────────────
const _listeners = {};

function _on(channel, cb) {
  if (_listeners[channel]) {
    ipcRenderer.removeListener(channel, _listeners[channel]);
  }
  const wrapper = (_, data) => cb(data);
  _listeners[channel] = wrapper;
  ipcRenderer.on(channel, wrapper);
}

// ─── Whitelist of channels the renderer may listen on ────────────────────────
const ALLOWED_RECEIVE = new Set([
  'connection-status',
  'chat-stream-chunk',
  'chat-stream-done',
  'chat-stream-error',
  'update-available',
]);

contextBridge.exposeInMainWorld('ironclawAPI', {
  // Config
  getConfig:  ()       => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // Connection
  getConnectionStatus: ()    => ipcRenderer.invoke('get-connection-status'),
  setConnection:       (cfg) => ipcRenderer.invoke('set-connection', cfg),
  onConnectionStatus:  (cb)  => _on('connection-status', cb),

  // API calls
  apiStatus:       ()      => ipcRenderer.invoke('api-status'),
  apiJobs:         ()      => ipcRenderer.invoke('api-jobs'),
  apiMemorySearch: (query) => ipcRenderer.invoke('api-memory-search', query),
  apiStats:        ()      => ipcRenderer.invoke('api-stats'),

  // Chat history persistence (per-session)
  chatHistoryLoad:  (sessionId) => ipcRenderer.invoke('chat-history-load', sessionId),
  chatHistorySave:  (messages, sessionId) => ipcRenderer.invoke('chat-history-save', messages, sessionId),
  chatHistoryClear: (sessionId) => ipcRenderer.invoke('chat-history-clear', sessionId),

  // Session management
  getSessions:      ()    => ipcRenderer.invoke('get-sessions'),
  createSession:   (name) => ipcRenderer.invoke('create-session', name),
  deleteSession:   (id)   => ipcRenderer.invoke('delete-session', id),

  // Multi-agent profiles
  getProfiles:        ()       => ipcRenderer.invoke('get-profiles'),
  getActiveProfileId: ()       => ipcRenderer.invoke('get-active-profile-id'),
  activateProfile:    (id)     => ipcRenderer.invoke('activate-profile', id),
  saveProfile:        (data)   => ipcRenderer.invoke('save-profile', data),
  deleteProfile:      (id)     => ipcRenderer.invoke('delete-profile', id),

  // Update checker
  getUpdateInfo:   ()    => ipcRenderer.invoke('get-update-info'),
  onUpdateAvailable: (cb)  => _on('update-available', cb),

  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Streaming chat
  chatStreamStart: (message, streamId) => {
    if (typeof message  !== 'string' || !message.trim())  return;
    if (typeof streamId !== 'string' || !/^stream_\d+$/.test(streamId)) return;
    ipcRenderer.send('chat-stream-start', { message, streamId });
  },
  onChatStreamChunk: (cb) => _on('chat-stream-chunk', cb),
  onChatStreamDone:  (cb) => _on('chat-stream-done',  cb),
  onChatStreamError: (cb) => _on('chat-stream-error', cb),

  onUpdateAvailable: (cb) => _on('update-available', cb),

  // Utilities
  openWebGateway: ()    => ipcRenderer.invoke('open-web-gateway'),
  openExternal:   (url) => ipcRenderer.invoke('open-external', url),

  removeListeners: (channel) => {
    if (!ALLOWED_RECEIVE.has(channel)) return;
    if (_listeners[channel]) {
      ipcRenderer.removeListener(channel, _listeners[channel]);
      delete _listeners[channel];
    }
  },
});
