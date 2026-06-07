# ⚔ IronClaw Companion

> **Desktop interface for [IronClaw](https://github.com/nearai/ironclaw) AI Agent** — secure, local-first, zero cloud dependency.

[![Release](https://img.shields.io/github/v/release/ddlpng/ironclaw-companion?style=flat-square&color=e05252)](https://github.com/ddlpng/ironclaw-companion/releases)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-42-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows-0078d7?style=flat-square&logo=windows)](https://github.com/ddlpng/ironclaw-companion/releases)

---

## 📥 Download

**[→ Latest Release: v1.3.0](https://github.com/ddlpng/ironclaw-companion/releases/latest)**

| Platform | File | Note |
|----------|------|------|
| Windows (x64) | `ironclaw-companion-v1.3.0-win-x64.zip` | Portable, no install needed |

**Extract → run `IronClaw Companion.exe`**. No installer, no admin rights required.

---

## ✨ Features

### v1.3.0 — Latest

| Feature | Description |
|---------|-------------|
| 🔒 **Encrypted Token** | API token stored via OS keychain (`safeStorage`) — never plaintext on disk |
| 🔄 **Auto-Update Checker** | Checks GitHub releases on startup, shows banner + download link |
| 💬 **Multi-Session Chat** | Up to 20 named sessions, per-session history, instant switching |
| 🤖 **Multi-Agent Profiles** | Switch between IronClaw instances without touching Settings |
| 🖼️ **Inline Images** | Agent-sent `https://...` image URLs render directly in chat |
| 🎨 **Syntax Highlighting** | Code blocks get full language-aware highlighting (highlight.js) |
| `/` **Slash Commands** | `/help`, `/clear`, `/export`, `/pins`, `/session`, `/agent`, `/status` |
| 📌 **Pinned Messages** | Pin important messages for quick reference (Ctrl+P) |
| ⌨️ **Keyboard Shortcuts** | Ctrl+1–5 tabs, Ctrl+K palette, Ctrl+F search, Ctrl+E export, Ctrl+N new session |

### v1.2.x — Security Hardening

| Feature | Description |
|---------|-------------|
| 🛡️ **IPC Hardening** | 9 security fixes — sender verification, type guards, rate limiting |
| 📋 **SECURITY.md** | Responsible disclosure policy, architecture notes |
| 🔑 **Token Guard** | API token never exposed to renderer process |

### v1.1.0 — Core

| Feature | Description |
|---------|-------------|
| 💬 **Streaming Chat** | Real-time streamed responses from IronClaw agent |
| 📊 **Jobs Monitor** | View active/completed agent jobs with live status |
| 🧠 **Memory Search** | Semantic search across agent memory |
| 📡 **Status Dashboard** | Model, version, uptime, raw API data |
| 🔔 **System Tray** | Minimize to tray, desktop notifications |
| 🎨 **Themes** | Dark / Light / Midnight / Forest |
| 📤 **Export Chat** | Download conversation as Markdown |
| 🔍 **Chat Search** | Ctrl+F search within current session |
| ⌨️ **Command Palette** | Ctrl+K for quick navigation |

---

## 🚀 Getting Started

### Prerequisites

- [IronClaw](https://github.com/nearai/ironclaw) running locally
- Default gateway: `http://127.0.0.1:3000`

### Setup

1. Download & extract the zip
2. Run `IronClaw Companion.exe`
3. Open **Settings** (tab 5 or Ctrl+5)
4. Set your IronClaw host/port
5. Paste your API token — it's encrypted and stored securely
6. Click **Test Connection** → **Save**

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command palette |
| `Ctrl+F` | Search chat |
| `Ctrl+1–5` | Switch tabs (Chat / Jobs / Memory / Status / Settings) |
| `Ctrl+N` | New chat session |
| `Ctrl+E` | Export chat |
| `Ctrl+P` | Pinned messages |
| `Enter` | Send message (configurable) |
| `Shift+Enter` | New line |

## 💬 Slash Commands

Type `/` in the chat input for autocomplete:

| Command | Action |
|---------|--------|
| `/help` | List all commands |
| `/clear` | Clear chat history |
| `/export` | Export chat to Markdown |
| `/pins` | Show pinned messages panel |
| `/session` | List chat sessions |
| `/agent` | List agent profiles |
| `/status` | Jump to Status tab |

---

## 🤖 Multi-Agent Profiles

Manage multiple IronClaw instances from one app:

1. Click **+** in the profile bar at the top
2. Enter name, host, port, and optional token
3. Click any profile to switch instantly

Perfect for local dev + remote server, or multiple agent configs.

---

## 🛡️ Security

- API token encrypted via Electron `safeStorage` (OS keychain on Windows = DPAPI)
- IPC channels fully validated — no arbitrary code execution from renderer
- CSP locked: `script-src 'self'`, no inline scripts, no remote scripts
- Rate limiting on all IPC channels (10 req/s burst protection)
- Token never stored in plaintext; never sent to renderer process

See [SECURITY.md](SECURITY.md) for the full security model and disclosure policy.

---

## 🔧 Development

```bash
git clone https://github.com/ddlpng/ironclaw-companion.git
cd ironclaw-companion
npm install
npm start           # dev mode
npm run build:win   # build Windows exe
```

### Project Structure

```
src/
  main.js          # Electron main process — IPC, ping, profiles
  preload.js       # Secure bridge (contextBridge)
  store.js         # Encrypted storage (electron-store)
  renderer/
    app.js         # UI logic — chat, sessions, profiles, slash commands
    index.html     # Single page shell
    styles.css     # All styles
    vendor/        # Local highlight.js (syntax highlighting)
```

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — issues, PRs, and discussions welcome.

**Quick contributor setup:**
```bash
npm install
npm start
# Make changes → test → submit PR to `dev` branch
```

---

## 📋 Changelog

### v1.3.0
- Encrypted API token storage (OS keychain via safeStorage)
- Auto-update checker (GitHub releases API)
- Multi-session chat with per-session history
- Multi-agent profiles — switch instances from profile bar
- Inline image rendering in chat
- Syntax highlighting for code blocks (highlight.js)
- Slash commands with autocomplete (`/help`, `/clear`, `/export`, etc.)
- Pinned messages with side panel (Ctrl+P)
- Full keyboard shortcuts (Ctrl+1–5, Ctrl+K, Ctrl+F, Ctrl+E, Ctrl+N, Ctrl+P)

### v1.2.1
- 9 IPC security hardening fixes
- SECURITY.md added

### v1.2.0
- Token counter (warn at 60k, danger at 100k)
- Exponential backoff ping
- Command palette (Ctrl+K)
- Search within chat (Ctrl+F)
- Agent profiles bar
- Export to Markdown

### v1.1.0
- Initial release: streaming chat, jobs, memory, status, tray

---

## 📄 License

MIT © 2026 IronClaw Companion contributors

---

*Built for [IronClaw](https://github.com/nearai/ironclaw) by NEAR AI*
