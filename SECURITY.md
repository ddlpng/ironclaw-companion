# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.2.x   | ✅ Yes     |
| 1.1.x   | ⚠️ Best-effort |
| < 1.1   | ❌ No      |

---

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

1. Open a [GitHub Security Advisory](https://github.com/ddlpng/ironclaw-companion/security/advisories/new) (private disclosure)
2. Or email the maintainer directly (see GitHub profile)

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You will receive a response within **72 hours**. If confirmed, a patch will be released within **7 days** for critical issues.

---

## Security Model

IronClaw Companion is a **local-only** desktop application. It connects exclusively to a locally running IronClaw gateway (`127.0.0.1:3000` by default). No data is sent to external servers by the app itself.

### Trust Boundaries

```
[User Input] → [Renderer (sandboxed)] → [contextBridge (preload)] → [Main Process] → [Local IronClaw Gateway]
```

- The **renderer** is sandboxed and has no direct Node.js or OS access
- All IPC calls go through `contextBridge` — no `nodeIntegration`
- The **main process** validates all inputs before acting on them
- The **local gateway** is the only external party the app communicates with

---

## Protections in Place

| Category | Protection |
|----------|-----------|
| **XSS** | All API/agent text `escapeHtml()`-processed before DOM insertion; code blocks extracted to safe placeholders first |
| **IPC security** | Every IPC handler validates `event.sender === mainWindow.webContents` — rejects calls from unexpected sources |
| **Input validation** | Host regex, port range 1–65535, token max 2048 chars, key max 128 chars |
| **Class injection** | Job status CSS classes whitelisted to known values only |
| **Prototype pollution** | Store rejects `__proto__`, `constructor`, `prototype` keys |
| **Rate limiting** | Token-bucket: 1 stream/sec for chat, 5 memory searches/10s |
| **Stream ID** | Validated against `stream_\d+` regex on both preload and main process |
| **Buffer caps** | 10 MB HTTP · 8 MB SSE · 128 KB per-line · 65 KB per chunk |
| **Response size** | 200-job DOM cap; memory card text capped at 600 chars |
| **URL safety** | `openExternal` allows only `http://` and `https://` — no `file://`, `javascript:` |
| **Auth token** | Sent as `Authorization: Bearer` header — never in URL |
| **Renderer sandbox** | `sandbox: true` — full Chromium process isolation |
| **CSP** | `default-src 'none'`, strict `connect-src`, no `unsafe-inline` |
| **Atomic writes** | Temp + rename for config — no corruption on crash; `mode 0o600` (owner-only) |
| **Memory caps** | Chat: 200 messages max; formatMessage: 200 KB max; content per message: 32 KB |
| **Timer safety** | GC timers `.unref()`; `isDestroyed()` guard before every IPC send |
| **Date validation** | `new Date(ts)` checked with `isNaN()` before display |
| **Score bounds** | Memory relevance score clamped to `[0, 1]` before display |

---

## Known Limitations

- The app trusts the **local IronClaw gateway** completely. If the gateway is compromised, the app could display attacker-controlled content. Defense: all gateway responses are still XSS-sanitized before rendering.
- **Auth token** is stored in `userData/ironclaw-companion.json` (owner-readable only, mode 0600). Do not use high-privilege tokens.
- **Export chat** writes to user's downloads folder — file content is raw markdown, which may contain agent-generated content. Open exported files only in trusted Markdown viewers.

---

## Changelog

### v1.2.1 (Security Patch)
- Fixed: IPC sender validation missing on `get-config`, `api-status`, `api-jobs`, `open-web-gateway`, `open-external`, `set-connection`, `get-app-version`
- Fixed: `isDestroyed()` guard missing in `checkConnection()` — could send IPC to destroyed window on shutdown
- Fixed: Job status CSS class injection — whitelisted to known values
- Fixed: Job title/ID/date not length-capped — could cause UI overflow with malicious gateway data
- Fixed: Memory card `path` variable shadowed built-in `path` module name
- Fixed: Memory relevance score not validated — NaN/Infinity could appear in UI
- Fixed: `exportChat()` anchor not appended to DOM before `.click()` — download unreliable in some Electron versions
- Fixed: Streaming error message not sanitized before display
- Fixed: Stream chunk size not validated client-side — defense-in-depth against huge chunks

---

## Dependency Security

Every release runs `npm audit` before publishing. Current status: **0 known vulnerabilities**.

```bash
npm audit
```
