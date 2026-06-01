# ⚔️ IronClaw Companion

> **Desktop companion app for your IronClaw AI Agent**  
> Secure chat, job monitoring, memory search — all in one native desktop app.

![IronClaw Companion](assets/icon.svg)

---

## ✨ Features

| Feature | Description |
|---|---|
| **💬 Chat** | Real-time streaming chat with your IronClaw agent via SSE |
| **⚡ Parallel Jobs** | Monitor and track all running/pending/completed jobs |
| **🧠 Memory Search** | Hybrid FTS + vector search over your agent's persistent memory |
| **📊 Agent Status** | Live connection health, model info, uptime, raw status data |
| **🔔 Tray + Notifications** | System tray icon with connection status, desktop notifications |
| **⚙️ Settings** | Configure host/port/token, theme, font size, behavior |
| **🌐 Quick Links** | Open Web Gateway, NEAR AI Dashboard, GitHub, Docs |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- IronClaw running locally (`ironclaw` CLI)
- Web Gateway enabled (default: `http://127.0.0.1:3000`)

### Install & Run
```bash
cd ironclaw-companion
npm install
npm start
```

### Connect
1. Open **Settings** tab
2. Set **Host** and **Port** (defaults: `127.0.0.1` : `3000`)
3. Paste your `GATEWAY_AUTH_TOKEN` from IronClaw startup logs
4. Click **Test Connection** → Save Settings

---

## 🔧 IronClaw Web Gateway Config

In your IronClaw environment:
```bash
# Enable Web Gateway (enabled by default)
GATEWAY_ENABLED=true

# Set a stable auth token (optional, auto-generated if not set)
export GATEWAY_AUTH_TOKEN="your-secure-token-here"

# Default host/port
GATEWAY_HOST=127.0.0.1
GATEWAY_PORT=3000
```

Get the auto-generated token from IronClaw startup logs:
```
[IronClaw] Web Gateway token: <your-token>
```

---

## 🏗️ Build for Distribution

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

Outputs go to `dist/` folder.

---

## 📁 Project Structure

```
ironclaw-companion/
├── src/
│   ├── main.js          # Electron main process
│   ├── preload.js       # Secure IPC bridge
│   ├── store.js         # Persistent settings store
│   └── renderer/
│       ├── index.html   # App shell
│       ├── styles.css   # Theming + layout
│       └── app.js       # UI logic + streaming chat
├── assets/
│   ├── icon.svg         # App icon (source)
│   ├── tray-icon.svg    # System tray icon
│   └── generate-icons.sh # Icon build script
└── package.json
```

---

## 🔌 API Endpoints Used

| Endpoint | Method | Description |
|---|---|---|
| `/api/status` | GET | Agent health + model info |
| `/api/chat` | POST | Send message (streaming SSE) |
| `/api/jobs` | GET | List parallel jobs |
| `/api/memory` | GET | Search agent memory |

All requests use `Authorization: Bearer <token>` when configured.

---

## 🎨 Themes

- **Dark** (default) — GitHub-style dark
- **Darker** — Deep space black
- **Light** — Clean light mode

---

## 🛡️ Security

- Context isolation enabled (`contextIsolation: true`)
- Node integration disabled in renderer
- All API calls go through Electron's main process
- Auth token stored in user's app data directory
- CSP headers enforced in renderer

---

## 🔗 Links

- [IronClaw Docs](https://docs.ironclaw.com)
- [IronClaw GitHub](https://github.com/nearai/ironclaw)
- [NEAR AI Dashboard](https://agent.near.ai/)
- [NEAR AI Cloud](https://cloud.near.ai/)

---

## 📄 License

MIT — Same as IronClaw
