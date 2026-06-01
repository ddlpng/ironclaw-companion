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
| 🐧 Linux (any distro) | `IronClaw.Companion-1.0.0.AppImage` | No install needed — just run |
| 🐧 Linux (Debian/Ubuntu) | `ironclaw-companion_1.0.0_amd64.deb` | `sudo dpkg -i` to install |
| 🪟 Windows | `IronClaw.Companion.1.0.0.exe` | Portable — no install needed |

---

## 🚀 Quick Start

### Linux — AppImage
```bash
chmod +x IronClaw.Companion-1.0.0.AppImage
./IronClaw.Companion-1.0.0.AppImage
```

### Linux — .deb
```bash
sudo dpkg -i ironclaw-companion_1.0.0_amd64.deb
# Launch from app menu or:
ironclaw-companion
```

### Windows
Double-click `IronClaw.Companion.1.0.0.exe` — no installation required.

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

This app was built with security as a first-class concern:

| Protection | Implementation |
|---|---|
| **XSS Prevention** | All agent/user text is HTML-escaped before render; code blocks extracted to safe placeholders first |
| **URL Injection** | `openExternal` only allows `http://` and `https://` — `file://`, `javascript:` etc. are blocked |
| **Auth Token Safety** | Token sent via `Authorization: Bearer` header only — never in URL query strings |
| **IPC Security** | Channel whitelist in preload; listener deduplication prevents memory leaks |
| **Renderer Sandbox** | `sandbox: true` — renderer runs in Chromium's full process sandbox |
| **Content Security Policy** | `default-src 'none'`, `connect-src 'none'`, `object-src 'none'`, `base-uri 'none'` |
| **Atomic Config Writes** | Config saved via temp file + rename — no corruption on crash |
| **Input Validation** | Host, port, and message validated in both renderer and main process |
| **No Vulnerabilities** | `npm audit` → 0 vulnerabilities (Electron 42.3.0) |

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

## 🤝 Related

- [IronClaw](https://github.com/nearai/ironclaw) — The AI Agent runtime this app connects to
- [IronClaw Docs](https://docs.ironclaw.com) — Official documentation

---

## 📄 License

MIT — see [LICENSE](LICENSE)
