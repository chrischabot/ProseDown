# CLAUDE.md

Notes for Claude Code working in this repo.

## What this is

**ProseDown** is a native macOS markdown viewer built on Tauri 2 + a TypeScript/Vite renderer. The goal is the fastest possible cold-start-to-first-paint for opening a `.md` file from Finder. Performance isn't a nice-to-have — it's the product.

## Architecture at a glance

- **`src-tauri/`** — Rust shell. Handles CLI argv, Finder/Apple-Event `Opened` URLs, the native menu (File → Open, ⌘O), drag-and-drop, and the file watcher that emits `markview://reload` events when the open document changes on disk. A small IPC surface (`load_initial_document`, `open_document`, `push_toc`, `mark_ready`, `scroll_to`, `set_zoom`).
- **`web/`** — TypeScript + Vite renderer. `main.ts` boots, calls `bridge.ts` to fetch the initial document (Tauri invoke, or WebKit messageHandler, or `?file=` fallback for browser preview), and renders via a Web Worker (`worker.ts`) that owns markdown-it + plugins. Heavy pipelines (Shiki, KaTeX, Mermaid) are `import()`-ed lazily so documents pay only for what they use.
- **`macos/`** — Optional SwiftUI shell that hosts the same `web/dist` bundle in a native WKWebView with `.glassEffect(_:in:)` materials for the toolbar/sidebar. The Tauri and Swift paths share the renderer code and the IPC shape; the bridge in `web/src/bridge.ts` abstracts over both. The Swift shell injects `document.documentElement.classList.add('mv-transparent-bg')` at document-start so the renderer's stylesheet lets the native glass show through.

## Key naming quirks

The product was renamed from **Markview** to **ProseDown**. The rename was deliberately scoped — user-facing strings and the Rust crate/binary are `prosedown`, but the following internal identifiers were **intentionally left as `markview*`** because they're IPC contracts and CSS class names with no external visibility and high rename cost:

- CSS classes: `markview-root`, `markview-body`, `markview-doc`, `markview-alert`, `markview-mermaid`, etc.
- IPC event topics: `markview://reload`, `markview://toc`, `markview://scroll-to`, `markview://zoom`
- CSS custom property prefix: `--markview-zoom`, `--markview-max-content`
- Swift notification name: `ai.markview.toggleSidebar`
- WebKit messageHandler name: `markview`

**Don't rename these unless you're doing a coordinated full pass.** They tie together Rust ↔ TS ↔ Swift and a partial rename will break the IPC.

User-facing strings that _are_ ProseDown:

- Rust crate/binary: `prosedown` / `prosedown_lib` (`src-tauri/Cargo.toml`)
- Tauri `productName`, window title, bundle `identifier = "app.prosedown"`, publisher, copyright, long description (`src-tauri/tauri.conf.json`)
- macOS menu "ProseDown" submenu label (`src-tauri/src/main.rs`)
- Welcome placeholder text (`src-tauri/src/commands.rs` → `WELCOME`)
- `web/package.json` name: `prosedown-web`

## Commands

```sh
make install        # web deps + cargo fetch
make dev            # cargo tauri dev — hot-reloads the renderer via Vite HMR
make build          # full release — web bundle + signed .app/.dmg
make check          # cargo check -p prosedown
make typecheck      # tsgo --noEmit on the renderer
make test           # vitest run
make preview        # vite preview at :8080 — browser-only testing
make fmt            # cargo fmt
```

For CSS/TS changes, `cargo tauri dev` alone is enough — Vite HMR picks them up in place. `tauri.conf.json` edits and Rust code changes require a restart of `cargo tauri dev` (it does rebuild Rust on change, but config is read at startup).

## Performance guardrails

- **Don't move parsing onto the main thread.** `web/src/worker.ts` is non-negotiable; the main thread must stay responsive for scroll and input.
- **Don't statically import heavy modules.** Shiki, KaTeX, Mermaid, and anything over ~30 kB minified must be `import()`-ed only when the document needs it. See `main.ts` → `render()` for the pattern.
- **Don't add scroll listeners.** The active-ToC-entry tracker uses `IntersectionObserver` on purpose — see `sidebar.ts:watchActive`. Adding `scroll` listeners will trash the 60-fps budget on long docs.
- **Respect the document-size cap** (`MAX_DOC_BYTES = 20 MiB` in `commands.rs`). The watcher honours the same cap to prevent an accidental pathological file from OOM-ing the webview.

## Styling

- Body/headings use the macOS system stack (`-apple-system` → SF Pro Text). Code uses SF Mono. Declared in `web/tailwind.config.js`.
- Syntax highlighting is Shiki with dual-theme output — both `github-light` and `github-dark` are inlined, and the swap happens via `@media (prefers-color-scheme: dark)` in `prose-macos.css`. No re-highlight on theme change.
- GitHub-style palette is defined as CSS custom properties in `prose-macos.css` (`:root` for light, `@media (prefers-color-scheme: dark) :root` for dark). Use those vars instead of hard-coding colors.
- The Tailwind Typography `prose prose-slate` classes are applied on `#doc`. Be aware that `prose-slate` overrides `--tw-prose-pre-code` to `slate-200`, which is why `.markview-doc pre` sets an explicit `color` — don't remove that override or un-highlighted code goes near-invisible in light mode.

## Window chrome

- The Tauri window has `titleBarStyle: "Overlay"` and `hiddenTitle: true`. There is **no native titlebar**; the traffic lights float over the webview. A `<div class="mv-drag-region" data-tauri-drag-region>` at the top provides the grab area — `data-tauri-drag-region` is the attribute Tauri 2 looks for (the CSS `-webkit-app-region: drag` alone is _not_ enough in Tauri 2).
- Interactive chrome (toolbar, findbar, sidebar) must set `-webkit-app-region: no-drag` when it overlaps the titlebar band. Current layout puts them _below_ the band so there's no overlap — keep it that way.

## Testing

`vitest` covers markdown-it plugins, alert parsing, math delimiters, and a benchmark harness. Run with `make test`. The renderer doesn't have full-app integration tests — manual QA against `web/public/sample.md` and a few real-world READMEs is the current bar.

## Before shipping

Run, in order:

```sh
make typecheck
make test
make check
make build
```

The `.app` ends up in `src-tauri/target/release/bundle/macos/ProseDown.app`.
