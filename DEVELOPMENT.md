# Development Guide

A deeper reference for contributors who want to understand the internals.

---

## Architecture

IronClaw Companion is a single-window Electron app with 3 layers:

```
┌─────────────────────────────────────────┐
│  Renderer Process (src/renderer/)       │
│  index.html · app.js · styles.css       │
│  ↕ contextBridge (preload.js)           │
├─────────────────────────────────────────┤
│  Main Process (src/main.js)             │
│  Window mgmt · IPC handlers · HTTP      │
│  ↕ Electron IPC                         │
├─────────────────────────────────────────┤
│  Store (src/store.js)                   │
│  JSON file · 1MB guard · 512KB/value    │
└─────────────────────────────────────────┘
         ↓ HTTP / SSE
┌─────────────────────────────────────────┐
│  IronClaw Agent  (localhost:3000)        │
│  /v1/chat/completions (stream)          │
│  /v1/jobs · /v1/status                  │
└─────────────────────────────────────────┘
```

---

## Key Files

### `src/main.js`
- Creates the BrowserWindow
- Registers IPC handlers: `store-get`, `store-set`, `fetch-stream`, `fetch-json`
- Handles streaming via `node-fetch` → `ipcMain` events → renderer

### `src/preload.js`
- Exposes safe APIs to renderer via `contextBridge.exposeInMainWorld`
- API surface: `window.api.store`, `window.api.fetchStream`, `window.api.fetchJson`

### `src/store.js`
- Persistent JSON storage at `userData/store.json`
- Limits: 1MB total, 512KB per value
- Sync read (`get`), sync write (`set`), sync delete (`delete`)

### `src/renderer/app.js`
- All UI logic: chat, command palette, jobs dashboard, settings, search
- Key globals: `state`, `store`, `DOM`
- Key functions:
  - `sendMessage()` — send + stream response
  - `togglePalette()` — show/hide Ctrl+K palette
  - `loadJobs()` — fetch and render jobs list
  - `loadStatus()` — fetch agent status
  - `exportChat()` — save chat as Markdown

---

## IronClaw API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/chat/completions` | POST | Send message, stream response |
| `/v1/jobs` | GET | List all jobs |
| `/v1/jobs/:id` | GET | Get single job |
| `/v1/status` | GET | Agent status / health |

### Streaming Chat

```js
// Request body
{
  model: "ironclaw",
  messages: [{ role: "user", content: "Hello" }],
  stream: true
}

// Response: SSE stream
// data: {"choices":[{"delta":{"content":"Hi"}}]}
// data: [DONE]
```

---

## Token Counting

Rough estimate only — not exact:

```js
const tokens = Math.round(totalChars / 4);
// warn at 60k tokens
// danger at 100k tokens
```

---

## Reconnection Logic

Exponential backoff for ping:

```
Base: 4000ms
Double each failure: 4s → 8s → 16s → 32s → 60s (cap)
Reset on success
```

---

## Adding a New Command to Command Palette

In `app.js`, find the `PALETTE_COMMANDS` array and add:

```js
{
  id: 'my-command',
  label: 'My Command',
  description: 'What it does',
  icon: '🔧',
  action: () => { /* your code */ }
}
```

---

## Adding a New Setting

1. Add UI in `index.html` (Settings panel section)
2. Add read/write in `app.js` using `store.get('key')` / `store.set('key', value)`
3. Apply the setting in the appropriate init function

---

## Building

```bash
# Development
npm start

# Production build (Windows exe)
npm run build
# Requires Wine on Linux: sudo apt install wine
# Output: dist/IronClaw Companion 1.x.x.exe
```

---

## Debugging

**Main process logs:**
```bash
npm start
# Logs appear in terminal
```

**Renderer logs:**
```
Help → Toggle DevTools → Console
```

**Store file location:**
```
Windows: %APPDATA%\ironclaw-companion\store.json
Linux:   ~/.config/ironclaw-companion/store.json
macOS:   ~/Library/Application Support/ironclaw-companion/store.json
```

---

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "Failed to connect" | IronClaw not running | Start agent first |
| Blank window | Renderer crash | Check DevTools console |
| Build fails | Wine missing | `sudo apt install wine` |
| Store corrupted | Manual edit | Delete `store.json` |

---

## Roadmap

- [ ] Agent selector (multi-agent support)
- [ ] Inline image rendering in chat
- [ ] i18n / translations
- [ ] Themes (light mode)
- [ ] Plugin system
- [ ] Auto-update

PRs welcome for any of these! 🦾
