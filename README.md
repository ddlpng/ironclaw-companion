# ⚔️ IronClaw Companion

A secure, cross-platform desktop companion app for [IronClaw](https://github.com/nearai/ironclaw) AI Agent — built with Electron.

Connect to your local IronClaw Web Gateway and chat with your AI agent, monitor jobs, search memory, and track connection status — all from a clean native desktop UI.

---

## 📸 Features

- 💬 **Real-time chat** with streaming responses (SSE)
- 📋 **Jobs dashboard** — view active and completed agent tasks
- 🧠 **Memory search** — query your agent's knowledge base
- 🔌 **Connection monitor** — live status with auto-reconnect
- 🌙 **Dark / Light theme** support
- 🔔 **System tray** — minimize to tray, desktop notifications
- ⚙️ **Settings** — configure host, port, auth token, font size

---

## 📥 Download

Go to the [**Releases page**](https://github.com/ddlpng/ironclaw-companion/releases/latest) and download the file for your OS:

| Platform | File | Notes |
|---|---|---|
| 🐧 Linux (any distro) | `IronClaw.Companion-1.1.0.AppImage` | No install needed — just run |
| 🐧 Linux (Debian/Ubuntu) | `ironclaw-companion_1.1.0_amd64.deb` | `sudo dpkg -i` to install |

> **Latest release: v1.1.0** — Security Hardening update. See [Changelog](#-changelog) below.

---

## 🚀 Quick Start

### Linux — AppImage
```bash
chmod +x "IronClaw Companion-1.1.0.AppImage"
./"IronClaw Companion-1.1.0.AppImage"
```

### Linux — .deb
```bash
sudo dpkg -i ironclaw-companion_1.1.0_amd64.deb
# Launch from app menu or:
ironclaw-companion
```

---

## ⚙️ Configuration

1. Open the app → click the **Settings** tab (⚙️)
2. Fill in your IronClaw Web Gateway details:

| Field | Default | Description |
|---|---|---|
| **Host** | `127.0.0.1` | Your IronClaw gateway hostname or IP |
| **Port** | `3000` | Gateway port |
| **Auth Token** | *(empty)* | Token if your gateway requires auth |
| **Use HTTPS** | Off | Enable for TLS connections |

3. Click **Save** — the app connects automatically

### Finding your IronClaw gateway URL

If you're running IronClaw locally with the default settings:
- Host: `127.0.0.1`
- Port: `3000`
- URL: `http://127.0.0.1:3000`

For remote servers, use the server's IP/domain and the port you configured.

---

## 🔒 Security

Built with security as a first-class concern. Every release passes `npm audit` with 0 vulnerabilities.

| Protection | Implementation |
|---|---|
| **XSS Prevention** | All agent/user text HTML-escaped before render; code blocks extracted to safe placeholders first; apostrophes escaped (`&#x27;`) |
| **IPC Sender Validation** | All IPC handlers verify `event.sender === mainWindow.webContents` — rogue renderers/webviews cannot send commands |
| **Rate Limiting** | Token-bucket limiter: max 1 chat stream/sec, max 5 memory searches/10s |
| **Stream ID Enforcement** | `streamId` validated with strict `stream_\d+` regex on both preload and main process |
| **Buffer & Size Caps** | 10 MB HTTP response cap · 8 MB SSE stream cap · 128 KB per-line buffer guard |
| **Host Validation** | `0.0.0.0` blocked · token max 2048 chars · `Array.isArray()` guard on config objects |
| **Store Hardening** | `isSafeKey()` rejects `__proto__`, `constructor`, `prototype` · key max 128 chars · value max 512 KB |
| **URL Injection** | `openExternal` only allows `http://` and `https://` — `file://`, `javascript:` etc. are blocked |
| **Auth Token Safety** | Token sent via `Authorization: Bearer` header only — never in URL query strings |
| **Renderer Sandbox** | `sandbox: true` — renderer runs in Chromium's full process sandbox |
| **Content Security Policy** | `default-src 'none'`, `connect-src 'none'`, `object-src 'none'`, `base-uri 'none'` |
| **Atomic Config Writes** | Config saved via temp file + rename — no corruption on crash · file mode `0o600` (owner-only) |
| **Memory Caps** | Chat history capped at 200 messages · `formatMessage` capped at 200 KB |
| **Timer Safety** | GC timers use `.unref()` (won't prevent clean exit) · `isDestroyed()` guard before IPC sends |

---

## 🛠️ Build from Source

**Requirements:**
- Node.js 18+
- npm 9+

```bash
git clone https://github.com/ddlpng/ironclaw-companion.git
cd ironclaw-companion
npm install

# Run in development mode
npm run dev

# Build for your platform
npm run build:linux   # AppImage + .deb
npm run build:win     # Windows installer + portable
npm run build:mac     # macOS .dmg + .zip
```

---

## 📁 Project Structure

```
ironclaw-companion/
├── src/
│   ├── main.js          # Electron main process
│   ├── preload.js       # Secure IPC bridge (contextBridge)
│   ├── store.js         # Atomic config persistence
│   └── renderer/
│       ├── index.html   # App shell
│       ├── app.js       # UI logic
│       └── styles.css   # Styles (dark/light themes)
├── assets/              # Icons (SVG, PNG, ICO, ICNS)
└── package.json
```

---

## 📋 Changelog

### v1.1.0 — Security Hardening *(2026-06-06)*
- IPC sender validation (rogue renderer protection)
- Token-bucket rate limiting on all IPC channels
- `streamId` regex enforcement on preload + main process
- `0.0.0.0` host blocked, token max 2048 chars
- 10 MB HTTP response cap, 8 MB SSE stream cap, 128 KB per-line guard
- Store: prototype pollution protection, key/value size caps
- Renderer: `escapeHtml` apostrophe fix, chat history cap (200 msg), message format cap (200 KB)
- Memory search debounce (400 ms)
- Timer GC with `.unref()`, `isDestroyed()` guard before IPC sends

### v1.0.0 — Initial Release *(2026-06-01)*
- Real-time streaming chat (SSE)
- Jobs dashboard, memory search, status monitor
- Dark/Light theme, system tray, desktop notifications
- Atomic config persistence, full XSS prevention
- `npm audit` 0 vulnerabilities

---

## 🤝 Related

- [IronClaw](https://github.com/nearai/ironclaw) — The AI Agent runtime this app connects to
- [IronClaw Docs](https://docs.ironclaw.com) — Official documentation

---

## 📄 License

MIT — see [LICENSE](LICENSE)
