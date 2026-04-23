# Fast Markdown Viewer for macOS 26 — Architecture Proposal

**Status:** Draft v1
**Target OS:** macOS 26 (Tahoe) only. No backward compatibility.
**Primary goal:** Double-click a `.md` file in Finder → a correctly-sized, fully-rendered, visually polished window in well under a second.
**Secondary goal:** Feel like a first-class macOS 26 app (Liquid Glass, native chrome, recent files, ToC), not an Electron skin.

---

## 1. Recommendation at a glance

Build a **hybrid app**: a thin native **SwiftUI shell** (window, toolbar, sidebar, Liquid Glass materials, document lifecycle, recent files menu) hosting a **Tauri-powered WKWebView** that runs the markdown rendering pipeline.

| Concern | Choice | Why |
|---|---|---|
| App wrapper | **Tauri 2.x** (Rust core) | ~0.4 s cold start, ~5–10 MB bundle, ~30–170 MB RAM vs Electron's 1.5–3 s, 150–250 MB, 400+ MB |
| Web runtime | **WKWebView** (Tauri default on macOS) | No Chromium to ship; shared system cache; native scroll, gestures, smooth zoom |
| Native chrome | **SwiftUI shell + NSWindow customisation** | `.glassEffect()` and the new Liquid Glass materials are **SwiftUI-only APIs** — unreachable from pure Tauri/Electron. A small Swift layer is the only way to get authentic Tahoe glass |
| Markdown parser | **markdown-it** + curated plugin set | Streaming, fastest mainstream parser, tiny, plugin ecosystem for GFM/footnotes/anchors |
| Math | **KaTeX** | Synchronous, ~280 KB gzipped, 5–10× faster than MathJax for typical documents |
| Code highlight | **Shiki** with on-demand grammar loading | VS Code-quality output; load only the languages that appear in the document |
| Diagrams | **beautiful-mermaid**, lazy-loaded | Only fetched when a ```` ```mermaid ```` fence is present |
| Styling | **Tailwind v4 + @tailwindcss/typography** | Hierarchy-aware prose classes, not flat styles; purged at build to a tiny CSS file |
| Build | **Vite** with static SSR of shell HTML | Zero runtime framework cost, no dev server in production |

**Rejected alternatives:** pure Electron (too slow, too heavy, no glass), pure SwiftUI (OP already confirmed this becomes a markdown-engine project), Tauri-only without Swift shell (can't render true Liquid Glass), native WebKit app without Tauri (loses Rust IPC, plugin ecosystem, updater, hot reload during dev).

---

## 2. Why Tauri, concretely

Measured on macOS for comparable minimal apps (from the research):

| Metric | Tauri 2 | Electron |
|---|---|---|
| Cold start | ~0.4 s | 1.5–3 s |
| Bundle size | 3–10 MB | 50–250 MB |
| Idle CPU | <1% | 1–5% |
| 6-window RAM | ~172 MB | ~409 MB |

For a double-click-to-read workflow, the 1-second gap between Tauri and Electron is the difference between "feels instant" and "feels like an app is launching." This alone disqualifies Electron for the stated goal.

Tauri's tradeoff — WKWebView instead of Chromium — is actually an **advantage** on macOS-only:

- No engine-version skew (we target one WKWebView, the system one on macOS 26).
- System-wide font rendering, text selection, accessibility, force-touch dictionary lookup all work for free.
- `backdrop-filter`, CSS container queries, `:has()`, native `print-color-adjust`, view transitions — all available in Tahoe's WebKit.

---

## 3. Resolving the Liquid Glass problem

Liquid Glass is a SwiftUI API (`.glassEffect()`, `GlassEffectContainer`, `.buttonStyle(.glass)`) introduced with Xcode 26. **It cannot be faithfully reproduced with `backdrop-filter: blur()` in CSS** — the real material is dynamic, context-aware, responds to Reduce Transparency / Increase Contrast automatically, and has the correct specular highlights.

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│  NSWindow (titled, fullSizeContentView, unified toolbar)    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  SwiftUI root                                         │  │
│  │  ┌──────────┐ ┌──────────────────────────────────┐    │  │
│  │  │ Sidebar  │ │ WKWebView (Tauri-managed)        │    │  │
│  │  │ (ToC)    │ │  — renders the document only     │    │  │
│  │  │ .glassEff│ │  — transparent background        │    │  │
│  │  │ ect()    │ │  — NO chrome, NO toolbar here    │    │  │
│  │  └──────────┘ └──────────────────────────────────┘    │  │
│  │  Toolbar: .glassEffect() buttons (ToC, Zoom, Find…)   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Ownership split:**

| Component | Owner | Rationale |
|---|---|---|
| `NSWindow`, title bar, traffic lights | SwiftUI | Auto-picks up Liquid Glass when built with Xcode 26 |
| Toolbar + buttons (ToC toggle, zoom, find, theme, export) | SwiftUI | `.buttonStyle(.glass)` is free glass |
| Sidebar container + ToC rows | SwiftUI | Real glass material behind translucent content |
| Document body (prose, code, math, mermaid, images) | WKWebView | Where the markdown rendering lives |
| Window sizing logic | Swift | Measures first-paint content height via JS bridge, sets frame before showing |

The ToC **data** is produced in JS (after parsing) and pushed to Swift over a `WKScriptMessageHandler`. Swift renders the sidebar natively. Clicking a ToC entry posts back a scroll command. This keeps the visible glass surfaces native while the heavy lifting stays in the webview.

**Integration path with Tauri:**

- Tauri 2 on macOS already hosts WKWebView via a Cocoa `NSView`. We take its `WKWebView` subview and embed it inside our SwiftUI hierarchy using `NSViewRepresentable`.
- A small Tauri plugin (Rust) exposes commands the SwiftUI shell can call: `open_document(path)`, `get_toc()`, `scroll_to(anchor)`, `set_zoom(level)`.
- The Swift side owns the app delegate (`NSApplicationDelegate`) so we correctly handle `application(_:openFiles:)` — this is how Finder double-click reaches us.

---

## 4. Rendering pipeline

Target: **first meaningful paint under 150 ms** after the webview has a document path, for documents up to ~50 KB. Larger docs render the first viewport in that budget and stream the rest.

```
file path  →  Rust (tokio::fs::read)  ──IPC──▶  worker (parser)
                                                    │
                                            markdown-it + plugins
                                                    │
                                       ┌────────────┼────────────┐
                                       ▼            ▼            ▼
                                  KaTeX pass   Shiki pass   Mermaid detect
                                  (sync)       (lazy per-   (set flag, don't
                                                lang)        render yet)
                                       │            │            │
                                       └────────────┼────────────┘
                                                    ▼
                                          HTML + ToC + lang-set
                                                    │
                                              main thread
                                                    │
                                        morph into DOM (idiomorph)
                                                    │
                                        IntersectionObserver:
                                          — render mermaid on scroll-in
                                          — decode images lazily
```

**Key decisions:**

1. **Parse in a Web Worker.** The main thread stays free to paint the shell. Worker receives the raw markdown string over `postMessage` with a transferred `ArrayBuffer`.
2. **No framework.** No React, Vue, Svelte. The document view is static HTML mutated by a minimal TS module (~3 KB). Frameworks cost 30–150 KB of parse+execute at cold start — unacceptable for our budget.
3. **Shiki's fine-grained bundle.** `shiki/core` + dynamic `import('shiki/langs/python.mjs')` keyed on the languages actually present. A document with no code blocks pays zero Shiki cost.
4. **KaTeX CSS inlined** into the base stylesheet; KaTeX JS loaded only if `$…$` or `$$…$$` is detected during a cheap pre-scan.
5. **Mermaid is lazy.** `beautiful-mermaid` is a separate chunk; we only `import()` it when the first mermaid fence scrolls into view. ASCII-art fallback for accessibility.
6. **GFM via plugins** — `markdown-it-gfm-alerts`, `markdown-it-task-lists`, `markdown-it-footnote`, `markdown-it-anchor`, `markdown-it-attrs`.
7. **Sanitization** — everything runs through a strict allowlist (DOMPurify configured for the subset we allow). Remote images proxied/blocked per CSP.

**Tailwind Typography usage:**
The document root gets `class="prose prose-slate dark:prose-invert prose-lg max-w-[72ch]"`. Typography plugin handles heading scale, list spacing, inline code, blockquotes, tables, `<kbd>`, code block chrome. We ship a small `prose-macos.css` override that matches San Francisco text metrics and native selection colors.

---

## 5. Cold-start strategy

The shortest path from `Dock click / Finder double-click` to `visible rendered document` is what we optimise.

**Time budget (target on Apple Silicon M-class, warm disk cache):**

| Phase | Budget | Technique |
|---|---|---|
| Process launch + dyld | ~80 ms | Tauri's small binary; prewarmed with `-Os` + LTO + `strip` |
| NSWindow shown with glass chrome + spinner | +20 ms | Swift shell creates and shows the window **before** the webview finishes init |
| WKWebView init + local HTML load | +60 ms | HTML/CSS/JS inlined in a single `app.html` shipped in the bundle; loaded via `loadFileURL` |
| Read markdown from disk (Rust) | +5–15 ms | `tokio::fs::read` on a background thread, kicked off in `main()` before the webview is even ready |
| Parse + render first viewport | +50–100 ms | Worker; main thread swaps innerHTML once |
| Window resize to fit document | +5 ms | Swift receives content metrics, animates to target size |
| **Total first paint** | **~220–280 ms** | |

**Concrete tricks that matter:**

- **No JS framework, no router, no state library.** The app shell is ~4 KB gzipped of hand-written TS.
- **Single HTML file.** No additional network/disk fetches at load — CSS and critical JS are inlined; fonts are bundled as `font-face` with `font-display: block` (we want polished first paint, not FOUT).
- **Preload the parser worker as a blob URL** before the window is even shown, so the first `postMessage` hits a warm worker.
- **Apple Event handling in Swift.** `application(_:open:)` receives the URL directly from LaunchServices; we don't parse `argv`, don't round-trip through a shell.
- **No splash screen.** The glass window appears immediately with correct dimensions; content fades in when ready.
- **Window sizing heuristic.** Initial frame = `min(screen * 0.7, ideal-prose-width + chrome)`. Ideal prose width is `72ch` ≈ 780 pt plus sidebar plus padding. After first render we measure actual content height and animate to fit, capped at 90% screen height. Persists per-document via `NSDocument`'s autosave identifier.

---

## 6. Native features (document-viewer checklist)

| Feature | Implementation |
|---|---|
| Finder double-click opens app | `Info.plist` `CFBundleDocumentTypes` with `net.daringfireball.markdown` + `public.markdown` UTIs; `LSHandlerRank = Default` |
| Recent files | `NSDocumentController.sharedDocumentController().noteNewRecentDocumentURL(_:)` — gives free Dock menu, File → Open Recent, Spotlight integration |
| Multiple windows | Each document gets its own `NSWindow` + its own WKWebView; Tauri supports multi-window natively |
| Table of contents | Native sidebar, data supplied by JS; toggle button in toolbar with animation |
| Find in document | Native `⌘F` bar (Swift) bridged to JS `window.find()` or custom highlighter |
| Zoom | `⌘+ / ⌘- / ⌘0` — sets CSS variable `--zoom`, not transform (preserves reflow) |
| Print / Export PDF | WKWebView's native print support; File → Export as PDF uses `WKWebView.createPDF(configuration:)` |
| Dark mode | `NSApp.effectiveAppearance` → posted to JS; Tailwind `dark:` classes + KaTeX/Shiki theme swap |
| Live reload on file change | `FSEvents` (or Rust `notify` crate) watches the open file; re-renders in place, preserves scroll position |
| Drag & drop markdown onto window / Dock | Standard `NSDraggingDestination` |
| Services menu / Quick Look preview | Optional stretch goal — a separate `QLPreview` extension target sharing the renderer |

---

## 7. Project layout

```
markview/
├─ Cargo.toml                     # workspace
├─ crates/
│  ├─ markview-core/              # Rust: file I/O, parser host, FS watcher
│  └─ markview-tauri/             # Tauri commands + plugin glue
├─ web/
│  ├─ src/
│  │  ├─ main.ts                  # shell bootstrap (~4 KB)
│  │  ├─ worker.ts                # parser worker
│  │  ├─ pipeline/
│  │  │  ├─ markdown.ts           # markdown-it config
│  │  │  ├─ shiki.ts              # lazy language loader
│  │  │  ├─ katex.ts              # math pass
│  │  │  └─ mermaid.ts            # lazy diagram renderer
│  │  └─ styles/
│  │     ├─ tailwind.css
│  │     └─ prose-macos.css
│  ├─ index.html                  # single-file shell
│  └─ vite.config.ts
├─ macos/
│  ├─ Markview.xcodeproj
│  └─ Sources/
│     ├─ App.swift                # @main, NSApplicationDelegate
│     ├─ DocumentWindow.swift     # NSWindow + SwiftUI root
│     ├─ Toolbar.swift            # .glassEffect() toolbar
│     ├─ Sidebar.swift            # ToC sidebar, glass material
│     ├─ WebViewBridge.swift      # hosts Tauri's WKWebView
│     └─ RecentFiles.swift        # NSDocumentController integration
└─ tauri.conf.json
```

Build: `cargo tauri build` produces the webview + Rust; `xcodebuild` wraps it into a signed, notarised `.app` with the SwiftUI shell as the outermost binary.

---

## 8. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Liquid Glass API churn between Xcode 26 point releases | Medium | Low | Feature-detect with `#available(macOS 26, *)`; fall back to `NSVisualEffectView` |
| Embedding Tauri's WKWebView inside custom SwiftUI is non-standard | Medium | Medium | Prototype in week 1; if brittle, invert and let Swift own the WKWebView directly (skip Tauri's window manager, keep only its IPC + updater) |
| Shiki bundle creeps large if user opens polyglot docs | Low | Medium | Hard cap: ≤8 languages loaded per document; beyond that fall back to a plain `<pre>` with line numbers |
| `beautiful-mermaid` is a newer library — API stability unknown | Medium | Low | Abstract behind a `DiagramRenderer` interface; swap to upstream Mermaid if needed |
| Large documents (>1 MB markdown) stall the worker | Low | Medium | Chunked parsing: split on top-level headings, parse+render incrementally, virtualised scroll below the fold |
| Notarisation friction with mixed Rust/Swift binary | Low | Medium | Single outer Swift binary signed as normal; Tauri's Rust dylib signed as embedded framework |
| Tailwind v4 + Typography cascade conflicts with KaTeX/Shiki CSS | Medium | Low | Scope prose to `.markview-doc` root; KaTeX/Shiki styles emitted after Tailwind in build order |

---

## 9. Roadmap

**Milestone 1 — Skeleton (1 week of focused work)**
- SwiftUI window + glass toolbar + empty WKWebView
- Finder double-click → window with file path
- Minimal markdown-it render, no math/mermaid/shiki
- Target met: <500 ms cold start, correct window sizing

**Milestone 2 — Rendering (1 week)**
- Full pipeline: GFM, KaTeX, Shiki (lazy), images, links, footnotes, task lists
- Tailwind Typography styling, dark mode, font bundling
- Target met: visually polished for 90% of real-world README.md files

**Milestone 3 — Navigation & UX (1 week)**
- ToC sidebar (native), recent files, find, zoom, print/PDF
- Live reload on file change
- Multi-window, per-document size memory
- Target met: feels like a shipped Apple app

**Milestone 4 — Diagrams & polish (1 week)**
- beautiful-mermaid integration, SVG safety, broken-link diagnostics
- Accessibility audit (Reduce Transparency, VoiceOver of ToC and prose, keyboard-only nav)
- Performance regression suite: 10 real documents, assert <300 ms first paint
- Signed, notarised `.dmg`

---

## 10. Open questions for you

1. **Editing.** The scope says "viewer." Confirm: no editing, no command palette, no file tree? (This keeps the bundle under 10 MB. Adding editing pulls in CodeMirror/Monaco which changes the cold-start math.)
2. **Wiki-link style.** GFM only, or also `[[wikilinks]]` and `[[embeds]]` Obsidian-style?
3. **Remote content.** Should remote images load, or be blocked by default with a click-to-load affordance? (Privacy + cold-start implication.)
4. **Quick Look plugin.** Worth a Milestone 5, or out of scope?
5. **Distribution.** Direct `.dmg` download, Mac App Store, or both? (MAS adds sandboxing constraints that affect FSEvents and Apple Events.)

---

## 11. TL;DR

> Tauri + WKWebView inside a SwiftUI 26 glass shell. markdown-it → KaTeX → (lazy) Shiki → (lazy) beautiful-mermaid, run in a worker, styled with Tailwind Typography. Native NSWindow, native toolbar, native sidebar, native recent files. Target: first paint under 300 ms, bundle under 10 MB, zero framework overhead in the webview. One week to skeleton, four weeks to shippable.