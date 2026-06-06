'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ─── Listener registry — prevents duplicate/leaked handlers ──────────────────
const _listeners = {};

function _on(channel, cb) {
  // Remove any previous listener for this channel to prevent accumulation
  if (_listeners[channel]) {
    ipcRenderer.removeListener(channel, _listeners[channel]);
  }
  const wrapper = (_, data) => cb(data);
  _listeners[channel] = wrapper;
  ipcRenderer.on(channel, wrapper);
}

// ─── Whitelist of channels the renderer may listen on (no open-ended access) ─
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

  // Streaming chat
  chatStreamStart: (message, streamId) => {
    if (typeof message  !== 'string' || !message.trim())  return;
    // Enforce stream ID format — must be "stream_<digits>" to match main process validation
    if (typeof streamId !== 'string' || !/^stream_\d+$/.test(streamId)) return;
    ipcRenderer.send('chat-stream-start', { message, streamId });
  },
  onChatStreamChunk: (cb) => _on('chat-stream-chunk', cb),
  onChatStreamDone:  (cb) => _on('chat-stream-done',  cb),
  onChatStreamError: (cb) => _on('chat-stream-error', cb),

  // Utilities
  openWebGateway: ()    => ipcRenderer.invoke('open-web-gateway'),
  openExternal:   (url) => ipcRenderer.invoke('open-external', url),

  // Cleanup (optional call on tab teardown)
  removeListeners: (channel) => {
    if (!ALLOWED_RECEIVE.has(channel)) return;
    if (_listeners[channel]) {
      ipcRenderer.removeListener(channel, _listeners[channel]);
      delete _listeners[channel];
    }
  },
});
