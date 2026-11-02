# Fluent Feeds

A fast RSS / Atom reader for Windows 11, built with Electron and styled after Fluent Design
(Mica backdrop, native caption buttons, light/dark following the system theme).

## Features

- RSS 2.0, RSS 1.0 (RDF) and Atom 1.0
- Paste a feed URL **or a website address** – the feed is auto-discovered
- Three-pane layout: subscriptions, article list with thumbnails, reader
- Unread / starred smart views, full-text search, mark all read
- Background refresh every 30 minutes, taskbar unread badge
- OPML import / export
- Keyboard shortcuts: `J`/`K` next/previous, `M` toggle read, `S` star, `O` open in browser,
  `Ctrl+N` add feed, `Ctrl+F` search, `F5` refresh
- Article HTML is sanitised with a whitelist, the renderer is sandboxed with a strict CSP,
  and links open in your default browser

Data is stored as JSON in `%APPDATA%\Fluent Feeds\library.json`.

## Starter feeds

`feeds/hacking-with-ai.opml` has 22 verified feeds on AI security, prompt injection and general
security research. In the app use **Import OPML** (or File > Import OPML) and pick that file.

## Run

```powershell
cd fluent-feeds
npm install
npm start
```

## Build an installer

```powershell
npm run dist      # NSIS installer for x64 and arm64 in dist\
```

## Test

```powershell
npm test          # parser, store, service and OPML tests (node:test, no Electron needed)
```

## Layout

| Path | Purpose |
| --- | --- |
| `main.js` | Electron main process: window, menu, IPC, refresh timer |
| `preload.js` | Minimal, typed bridge exposed as `window.api` |
| `src/feed-parser.js` | RSS/Atom/RDF parsing and feed autodiscovery |
| `src/service.js` | Fetching, subscribing, refreshing |
| `src/store.js` | JSON persistence, read/star state, pruning |
| `src/opml.js` | OPML import/export |
| `renderer/` | UI (HTML, CSS, vanilla JS, HTML sanitiser) |

The Mica material and title-bar overlay need Windows 11; on other platforms the app still runs
with a plain window.
