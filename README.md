# ⚔ IronClaw Companion

> **Desktop interface for [IronClaw](https://github.com/nearai/ironclaw) AI Agent** — secure, local-first, zero cloud dependency.

[![Release](https://img.shields.io/github/v/release/ddlpng/ironclaw-companion?style=flat-square&color=e05252)](https://github.com/ddlpng/ironclaw-companion/releases)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-42-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-brightgreen?style=flat-square)](https://github.com/ddlpng/ironclaw-companion/releases)

---

## 📥 Download

**[→ Latest Release: v1.5.0](https://github.com/ddlpng/ironclaw-companion/releases/latest)**

| Platform | File | Note |
|----------|------|------|
| Linux (x64) | `IronClaw Companion-1.5.0.AppImage` | Portable, chmod +x and run |
| Linux (x64) | `ironclaw-companion_1.5.0_amd64.deb` | Debian/Ubuntu package |
| Windows (x64) | `ironclaw-companion-1.3.0-win-x64.zip` | Portable, no install needed |

**Linux AppImage:**
```bash
chmod +x "IronClaw Companion-1.5.0.AppImage"
./"IronClaw Companion-1.5.0.AppImage"
```

---

## ✨ Features

### v1.5.0 — Latest

| Feature | Description |
|---------|-------------|
| 🤖 **Agent Switcher** | Discord-style sidebar with color-coded avatars + initials — click to switch agent profiles instantly |
| 📤 **Export Modal** | Choose export format: Markdown / JSON (with full metadata) / Plain Text / Copy to Clipboard |
| 🔍 **Search Enhanced** | Date filter (Today / 7d / 30d / All), role filter (User / Agent), text highlight in bubbles, match count "X of Y" |
| 📌 **Pins Nav Button** | Pinned message badge count in sidebar, click any pin to scroll & highlight the original message |
| 🎨 **Midnight Blue Theme** | Deep blue aesthetic — `#0a0f1e` background, `#3b82f6` accent |
| ⌨️ **New Shortcuts** | `Ctrl+,` → Settings, `Alt+←/→` → navigate sessions, `Ctrl+E` → Export modal |
| 🔢 **Token Cost Estimate** | Token counter now shows estimated cost alongside count: `~1,234 tokens · ~$0.001` |

### v1.3.0

| Feature | Description |
|---------|-------------|
| 🔒 **Encrypted Token** | API token stored via OS keychain (`safeStorage`) — never plaintext on disk |
| 🔄 **Auto-Update Checker** | Checks GitHub releases on startup, shows banner + download link |
| 💬 **Multi-Session Chat** | Up to 20 named sessions, per-session history, instant switching |
| 🤖 **Multi-Agent Profiles** | Switch between IronClaw instances without touching Settings |
| 🖼️ **Inline Images** | Agent-sent image URLs render directly in chat |
| 🎨 **Syntax Highlighting** | Code blocks get full language-aware highlighting (highlight.js) |
| `/` **Slash Commands** | `/help`, `/clear`, `/export`, `/pins`, `/session`, `/agent`, `/status` |
| 📌 **Pinned Messages** | Pin important messages for quick reference |
| ⌨️ **Keyboard Shortcuts** | Ctrl+1–5 tabs, Ctrl+K palette, Ctrl+F search, Ctrl+E export, Ctrl+N new session |

### v1.2.x — Security Hardening

| Feature | Description |
|---------|-------------|
| 🛡️ **IPC Hardening** | 9 security fixes — sender verification, type guards, rate limiting |
| 📋 **SECURITY.md** | Responsible disclosure policy, architecture notes |
| 🔑 **Token Guard** | API token never exposed to renderer process |

---

## 🚀 Getting Started

### Prerequisites

- [IronClaw](https://github.com/nearai/ironclaw) running locally
- Default gateway: `http://127.0.0.1:3000`

### Setup

1. Download & run the AppImage (Linux) or exe (Windows)
2. Open **Settings** (`Ctrl+,` or tab 5)
3. Set your IronClaw host/port
4. Paste your API token — encrypted and stored securely
5. Click **Test Connection** → **Save**

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command palette |
| `Ctrl+F` | Search chat |
| `Ctrl+,` | Settings *(v1.5)* |
| `Ctrl+1–5` | Switch tabs (Chat / Jobs / Memory / Status / Settings) |
| `Ctrl+N` | New chat session |
| `Ctrl+E` | Export modal *(v1.5)* |
| `Ctrl+P` | Pinned messages panel |
| `Alt+←/→` | Navigate between sessions *(v1.5)* |
| `Enter` | Send message (configurable) |
| `Shift+Enter` | New line |

## 💬 Slash Commands

Type `/` in the chat input for autocomplete:

| Command | Action |
|---------|--------|
| `/help` | List all commands |
| `/clear` | Clear chat history |
| `/export` | Open export modal |
| `/pins` | Show pinned messages panel |
| `/session` | List chat sessions |
| `/agent` | List agent profiles |
| `/status` | Jump to Status tab |

---

## 🤖 Multi-Agent Profiles

Manage multiple IronClaw instances from one app:

- v1.5: **Agent Switcher sidebar** — color-coded avatars with initials, Discord-style
- Click any agent avatar to switch instantly
- Click **+** to add a new agent profile
- Max 20 profiles

---

## 📤 Export

Export the current chat in any format via `Ctrl+E` or `/export`:

| Format | Description |
|--------|-------------|
| **Markdown** | Headers, timestamps, formatted for reading |
| **JSON** | Full metadata: session name, agent name, host, timestamps |
| **Plain Text** | Clean readable text, no markup |
| **Clipboard** | Copy entire chat to clipboard instantly |

---

## 🛡️ Security

- API token encrypted via Electron `safeStorage` (OS keychain / DPAPI)
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
npm start             # dev mode
npm run build:linux   # build AppImage + deb
npm run build:win     # build Windows exe
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
    styles.css     # All styles (includes all themes)
    vendor/        # Local highlight.js (syntax highlighting)
```

---

## 📋 Changelog

### v1.5.0
- Agent Switcher sidebar — Discord-style avatars with color-coded initials
- Export Modal — Markdown / JSON (metadata) / Plain Text / Copy to Clipboard
- Search: date filter, role filter, inline text highlighting, match count
- Pins nav button with badge count + click-to-scroll-and-highlight
- Midnight Blue theme (`#0a0f1e` bg, `#3b82f6` accent)
- Keyboard shortcuts: `Ctrl+,` (settings), `Alt+←/→` (session nav)
- Token counter now shows estimated cost (~$0.001 per 1K tokens)

### v1.3.0
- Encrypted API token storage (OS keychain via safeStorage)
- Auto-update checker (GitHub releases API)
- Multi-session chat with per-session history
- Multi-agent profiles — switch instances from profile bar
- Inline image rendering in chat
- Syntax highlighting for code blocks (highlight.js)
- Slash commands with autocomplete
- Pinned messages with side panel
- Full keyboard shortcuts

### v1.2.1
- 9 IPC security hardening fixes
- SECURITY.md added

### v1.2.0
- Token counter, exponential backoff ping
- Command palette (Ctrl+K), search (Ctrl+F)
- Agent profiles bar, export to Markdown

### v1.1.0
- Initial release: streaming chat, jobs, memory, status, tray

---

## 📄 License

MIT © 2026 IronClaw Companion contributors

---

*Built for [IronClaw](https://github.com/nearai/ironclaw) by NEAR AI*
