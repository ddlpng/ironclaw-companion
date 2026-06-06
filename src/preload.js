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

  // Chat history persistence
  chatHistoryLoad:  ()         => ipcRenderer.invoke('chat-history-load'),
  chatHistorySave:  (messages) => ipcRenderer.invoke('chat-history-save', messages),
  chatHistoryClear: ()         => ipcRenderer.invoke('chat-history-clear'),

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
