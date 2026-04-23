# ProseDown

A fast, native markdown viewer for **macOS 26 (Tahoe)**.

Markdown is everywhere — READMEs, design docs, meeting notes, LLM output, issue descriptions. Opening a heavy IDE just to _read_ a `.md` file is friction. ProseDown is the thing you double-click from Finder and get a beautifully-rendered document before your hand leaves the trackpad.

## Goals

1. **Fastest startup.** Cold-click to first paint under ~300 ms on Apple Silicon. The Tauri shell is a thin Rust binary, the renderer is a single Vite bundle, and every heavy pipeline stage is dynamic-imported on demand.
2. **Fastest rendering.** Markdown parses off the main thread in a dedicated worker; syntax highlighting, KaTeX, and Mermaid are lazy-loaded only when the document actually needs them. A document with no code pays ~0 for Shiki; a document with no math pays ~0 for KaTeX.
3. **Fastest scrolling.** No virtualized list tricks, just careful CSS — GPU-composited fades, scoped `backdrop-filter`, and a ToC that uses `IntersectionObserver` instead of scroll listeners. 60 fps on long documents is the bar.
4. **Respect the platform.** macOS system fonts (SF Pro, SF Mono), GitHub light/dark palette, system appearance awareness, liquid-glass toolbar/sidebar, Finder double-click association, native File → Open and drag-and-drop.

## Features

| Feature | Where | Status |
|---|---|---|
| GFM markdown — tables, task lists, footnotes, GitHub alerts | `web/src/pipeline` | ✅ |
| Math — KaTeX, inline + block, CSS loaded lazily | `web/src/pipeline/math.ts` | ✅ |
| Syntax highlighting — Shiki, `github-light`/`github-dark` dual theme | `web/src/pipeline/shiki.ts` | ✅ |
| Diagrams — Mermaid, `IntersectionObserver`-triggered | `web/src/pipeline/mermaid.ts` | ✅ |
| Floating glass toolbar + ToC sidebar | `web/src/ui` | ✅ |
| Find-in-page (⌘F) with match navigation | `web/src/ui/findbar.ts` | ✅ |
| Live reload when the open file changes on disk | `src-tauri/src/watcher.rs` | ✅ |
| Finder double-click, `open -a`, and CLI argv loading | `src-tauri/src/main.rs` | ✅ |
| File → Open (⌘O), drag-and-drop anywhere in the window | `src-tauri/src/main.rs` | ✅ |
| Light/dark mode following the system appearance | `web/src/styles/prose-macos.css` | ✅ |
| Native Liquid Glass on macOS 26 (optional Swift shell) | `macos/Sources` | ✅ |

## Install

```sh
brew tap chrischabot/prosedown
brew install --cask prosedown
```

_(Tap and cask go live with the first signed release — see [`homebrew/prosedown.rb`](homebrew/prosedown.rb) for the template.)_

## Quickstart

Prereqs: Rust 1.77+, Node 22+, macOS 26 to run, Xcode 26 Command Line Tools to build a signed `.app`.

```sh
# One-time install
make install

# Dev loop — hot-reloads the renderer, live-rebuilds Rust
make dev            # or: cargo tauri dev

# Release build — produces ProseDown.app and a .dmg
make build          # or: cargo tauri build
```

### Opening a document

```sh
# Pass a path as argv[1]:
./src-tauri/target/release/prosedown /path/to/README.md

# Or, once installed, use Finder / the `open` command:
open -a ProseDown README.md
```

Inside the app: **File → Open** (⌘O), or drop a `.md` file anywhere in the window.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| ⌘O | Open file |
| ⌘\ | Toggle Table of Contents |
| ⌘F | Find in page |
| ⌘G / ⇧⌘G | Find next / previous |
| ⌘+ / ⌘− | Zoom in / out |
| ⌘0 | Actual size |
| ⌘P | Print |

## Project layout

```
ProseDown/
├─ README.md                  ← this file
├─ CLAUDE.md                  ← notes for Claude Code
├─ proposal.md                ← original architecture & rationale
├─ Cargo.toml                 ← Rust workspace
├─ src-tauri/                 ← Tauri 2 wrapper (Rust)
│  ├─ Cargo.toml
│  ├─ tauri.conf.json         ← window, bundle, file associations
│  ├─ capabilities/default.json
│  └─ src/
│     ├─ main.rs              ← entry: argv, Apple Events, menu, drag-drop
│     ├─ lib.rs               ← re-exports for tests / Swift shell
│     ├─ commands.rs          ← #[tauri::command] handlers
│     ├─ watcher.rs           ← debounced file watcher
│     └─ state.rs             ← shared AppState
├─ web/                       ← renderer (TS + Vite)
│  ├─ index.html              ← shell + CSP
│  ├─ src/
│  │  ├─ main.ts              ← bootstrap, parse-in-worker, lazy load
│  │  ├─ worker.ts            ← off-main-thread markdown parser
│  │  ├─ bridge.ts            ← Tauri / WebKit messageHandler abstraction
│  │  ├─ pipeline/            ← markdown, math, alerts, shiki, mermaid
│  │  ├─ ui/                  ← toolbar, sidebar, findbar, scroll memory
│  │  └─ styles/              ← tailwind + prose + chrome CSS
│  └─ public/sample.md        ← dev-time fallback document
└─ macos/                     ← optional SwiftUI Liquid Glass shell
```

## Performance budget

Measured on Apple Silicon, warm disk cache, README-size document.

| Phase | Budget | Notes |
|---|---|---|
| Parse + first viewport paint | 150 ms | `web/src/worker.ts` runs off the main thread |
| Cold-start to first paint (Tauri) | 300 ms | Includes WKWebView creation and HTML load |
| Bundle size (main chunk) | < 1 MB | Shiki/KaTeX/Mermaid are split off |

## Development

```sh
make typecheck      # tsgo --noEmit on the renderer
make check          # cargo check on the Rust crate
make test           # vitest — renderer unit tests
make preview        # serve web/dist at http://localhost:8080 for browser-only testing
make fmt            # cargo fmt
```

## Releasing (signed + notarized DMG)

`release.sh` builds, signs, notarizes, staples, and DMG-wraps the app in one shot. It produces `dist/ProseDown.dmg`, ready to upload to a GitHub release.

One-time machine setup:

```sh
# Stores your Apple app-specific password in the login keychain under
# the profile name ProseDown-Notarization (or whatever you set
# PROSEDOWN_NOTARY_PROFILE to).  Password is generated at
# appleid.apple.com → Sign-In & Security → App-Specific Passwords.
xcrun notarytool store-credentials "ProseDown-Notarization" \
  --apple-id <your-apple-id@example.com> \
  --team-id  28FC5D45XH \
  --password <app-specific-password>
```

Then for each release:

```sh
# Bump src-tauri/tauri.conf.json → "version" first, commit, tag.
./release.sh
# Script prints SHA256 + the gh release command to run.
```

## Status

Early alpha. Pre-1.0, APIs and CSS class names may churn. Feedback and bug reports welcome.

## License

MIT.
