# Native Swift shell (optional)

The Tauri wrapper in `../src-tauri` is the default way to ship Markview. This folder is an **alternative path** that gives you authentic macOS 26 Liquid Glass for the chrome (toolbar + sidebar) at the cost of a second build system.

## When to use this

- You want real `.glassEffect(_:in:)` materials, not CSS `backdrop-filter` approximations.
- You want a native sidebar `LazyVStack` rather than in-webview DOM.
- You're willing to maintain a small SwiftUI app alongside the Rust/JS code.

## How the hybrid works

```
┌─────────────────────────────────────────────┐
│ NSWindow (macOS 26 → Liquid Glass titlebar) │
│  ┌────────┐  ┌────────────────────────────┐ │
│  │ Swift  │  │ WKWebView                  │ │
│  │ glass  │  │   loads web/dist/index.html│ │
│  │ sidebar│  │   renders the document     │ │
│  └────────┘  └────────────────────────────┘ │
│  Swift glass toolbar                        │
└─────────────────────────────────────────────┘
```

### File opening is handled by SwiftUI, not Apple Events

We use `DocumentGroup(viewing: MarkdownDocument.self)` as the top-level scene. This is the canonical SwiftUI pattern for read-only viewers and it wires the following for free, directly via LaunchServices:

- Finder double-click of a `.md`/`.markdown` file.
- `open -a Markview README.md` from the terminal.
- File → Open… (⌘O).
- File → Open Recent (populated automatically).
- One `NSWindow` per document, with de-duplication when the same file is opened twice.

Because `DocumentGroup` owns this routing, there is no custom `application(_:open:)` delegate method or `NotificationCenter` plumbing — the OS hands SwiftUI a `MarkdownDocument` already populated with the file's bytes.

### Inside a document window

- Swift owns the window, titlebar (inherits Liquid Glass when built with Xcode 26), toolbar, and sidebar.
- `WKWebView` hosts the same rendering pipeline Tauri would host — it loads the Vite-built `web/dist` that lives inside the `.app` bundle.
- Data crosses the boundary through a `WKScriptMessageHandler` named `markview` (see `WebViewBridge.swift`). The webview pushes ToC entries and ready signals; Swift pushes scroll/zoom commands back via `evaluateJavaScript` with **JSON-encoded** payloads (no hand-rolled escaping).

## Sources

| File | Responsibility |
|---|---|
| `App.swift` | `@main`, `DocumentGroup(viewing:)`, menu commands, ⌘\\ toggle |
| `MarkdownDocument.swift` | `FileDocument` conformance — declares the `.md` UTIs |
| `DocumentWindow.swift` | Per-document SwiftUI root — toolbar + sidebar + webview layout |
| `Toolbar.swift` | Glass toolbar, zoom/sidebar/print buttons |
| `Sidebar.swift` | Glass sidebar with ToC, active-section highlight |
| `WebViewBridge.swift` | `WKWebView` + message handler + Swift→JS helpers (JSON-safe) |
| `RecentFiles.swift` | Programmatic `noteNewRecentDocumentURL` wrapper (unused by default — `DocumentGroup` already tracks recents automatically; provided for future explicit calls) |

## Building

1. Open `Markview.xcodeproj` in **Xcode 26** (required for `.glassEffect`).
2. Build the Vite bundle first:
   ```sh
   cd ../web && npm ci && npm run build
   ```
3. Add the `web/dist` folder as a **blue folder reference** under a group named `web/dist` so the resources ship inside the `.app`:
   ```
   Markview.app/Contents/Resources/web/dist/index.html
   Markview.app/Contents/Resources/web/dist/assets/…
   ```
4. Build and run the Swift target. Double-click any `.md` file in Finder — `DocumentGroup` creates a new document window for it.

## Info.plist additions

`DocumentGroup` will populate `CFBundleDocumentTypes` from `MarkdownDocument.readableContentTypes` at build time. You still need `LSMinimumSystemVersion` for the macOS 26-only restriction:

```xml
<key>LSMinimumSystemVersion</key>
<string>26.0</string>
```

## Known deltas vs the Tauri path

- **Live reload on disk changes:** not yet wired in the Swift shell. `DocumentGroup` re-reads the file when the system considers it stale, but our custom `FSEvents`-style reload is only implemented in `src-tauri/src/watcher.rs`. Adding it to the Swift shell means either (a) observing `NSFilePresenter` on the open document or (b) bridging the Rust watcher via a Tauri plugin. Tracked for a later milestone.
- **`.glassEffect(_:in:)`:** Availability-guarded with `#available(macOS 26, *)`; older combinations fall back to `.thinMaterial` + a separator stroke.
- **Transparency:** `WKWebView.drawsBackground = false` so the native Liquid Glass material shows through behind the rendered document.

## Default path

The non-Swift path via `cargo tauri dev` / `cargo tauri build` remains fully functional. CSS `backdrop-filter` delivers a close approximation of glass for the toolbar and sidebar without the Xcode dependency.