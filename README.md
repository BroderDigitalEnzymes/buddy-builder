<p align="center">
  <img src="assets/icon-256.png" width="120" height="120" alt="Buddy Builder" />
</p>

<h1 align="center">Buddy Builder</h1>

<p align="center">
  A desktop GUI for <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>.<br/>
  Manage multiple sessions, search conversations, and work with AI — visually.
</p>

<p align="center">
  <a href="https://buddy-builder.io">Website</a> &middot;
  <a href="https://www.npmjs.com/package/buddy-builder">npm</a>
</p>

---

## Features

- **Multiple sessions** — Run several Claude Code sessions side-by-side, each in its own project directory
- **Session management** — Rename, favorite, resume, and pop out sessions into separate windows
- **Full-text search** — Search across all your conversations by content or title
- **Permission control** — Approve tool use requests visually, with bulk approve support
- **Auto-naming** — Sessions are automatically given descriptive titles after a few exchanges
- **Desktop notifications** — Get notified when a session is waiting for input
- **System tray** — Minimize to tray and keep sessions running in the background

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — `npm install -g @anthropic-ai/claude-code`

## Install

```sh
npm install -g buddy-builder
```

## Launch

```sh
buddy-builder
```

## Development

```sh
git clone https://github.com/BroderDigitalEnzymes/buddy-builder.git
cd buddy-builder
npm install
npm run dev
```

## License

ISC
