# Contributing to IronClaw Companion

Thank you for your interest in contributing! 🎉  
IronClaw Companion is open source and we welcome contributions of all kinds.

---

## 🚀 Quick Start

```bash
# 1. Fork & clone
git clone https://github.com/YOUR_USERNAME/ironclaw-companion.git
cd ironclaw-companion

# 2. Install dependencies
npm install

# 3. Run in development mode
npm start
```

That's it — Electron will launch the app with DevTools enabled.

---

## 📋 Ways to Contribute

| Type | How |
|------|-----|
| 🐛 Bug reports | Open an [issue](https://github.com/ddlpng/ironclaw-companion/issues/new?template=bug_report.md) |
| 💡 Feature requests | Open an [issue](https://github.com/ddlpng/ironclaw-companion/issues/new?template=feature_request.md) |
| 🔧 Code | Fork → branch → PR |
| 📝 Documentation | Edit `README.md` or add docs |
| 🎨 Design | Screenshots, UI improvements, icons |
| 🌍 Translations | Add your language to `i18n/` (coming soon) |

---

## 🌿 Branch Strategy

```
main          ← stable, always working
dev           ← active development (PR here)
feat/xxx      ← new features
fix/xxx       ← bug fixes
docs/xxx      ← documentation only
```

**Always branch from `main` and PR back to `main`.**

---

## 🔧 Development Setup

### Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org))
- **npm** 9+
- **IronClaw** agent running locally ([setup](https://github.com/nearai/ironclaw))

### Project Structure

```
ironclaw-companion/
├── src/
│   ├── main.js          # Electron main process
│   ├── preload.js       # IPC bridge (contextBridge)
│   ├── store.js         # Persistent storage
│   └── renderer/
│       ├── index.html   # App shell
│       ├── app.js       # All UI logic
│       └── styles.css   # Dark theme styles
├── assets/              # Screenshots, icons, banners
├── package.json
└── README.md
```

### Useful Scripts

```bash
npm start          # Run in dev mode (hot-reload not included yet)
npm run build      # Build Windows exe (requires Wine on Linux)
npm run lint       # ESLint check (coming soon)
```

### Connecting to IronClaw

By default the app connects to `http://127.0.0.1:3000`.  
Start your IronClaw agent first, then launch the app.

See [IronClaw README](https://github.com/nearai/ironclaw) for agent setup.

---

## ✅ Pull Request Checklist

Before submitting a PR, make sure:

- [ ] Code runs without errors (`npm start`)
- [ ] No new console errors in DevTools
- [ ] UI looks correct in dark mode
- [ ] Existing features still work (manual smoke test)
- [ ] PR description explains **what** and **why**
- [ ] Screenshots attached if UI was changed

---

## 🐛 Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md).

Please include:
- OS & version (Windows 10/11, Linux distro)
- App version (check Settings → About)
- IronClaw version
- Steps to reproduce
- Expected vs actual behavior
- Console errors (Help → Toggle DevTools)

---

## 💡 Suggesting Features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md).

Good feature requests include:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you considered

---

## 🎨 Code Style

- **No build system required** — vanilla JS, CSS, HTML
- 2-space indentation
- Single quotes for strings
- Descriptive variable names
- Comment complex logic

---

## 📦 Building a Release

```bash
# Build Windows portable exe (Linux host needs Wine)
npm run build

# Output: dist/IronClaw Companion 1.x.x.exe
```

For cross-platform builds, see [electron-builder docs](https://www.electron.build/).

---

## 🤝 Code of Conduct

- Be respectful and inclusive
- Constructive feedback only
- Help others learn

---

## 📜 License

By contributing, you agree your code will be licensed under the [MIT License](LICENSE).

---

## 💬 Questions?

Open an [issue](https://github.com/ddlpng/ironclaw-companion/issues) or reach out in [NEAR Discord](https://discord.gg/nearprotocol).

Happy hacking! 🦾
