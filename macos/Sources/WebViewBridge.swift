import SwiftUI
import WebKit
import Combine

final class WebBridge: ObservableObject {
    @Published var toc: [TocItem] = []
    @Published var activeAnchor: String? = nil
    @Published var currentZoom: Double = 1.0

    fileprivate weak var webView: WKWebView?

    /// JSON-encode a Swift value to a JavaScript literal. Because JSON is a
    /// subset of JavaScript, any JSON-encoded value is a valid JS literal —
    /// this eliminates escaping pitfalls for unusual file paths and anchors.
    private static func jsLiteral(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(
            withJSONObject: [value],
            options: [.fragmentsAllowed]
        ),
        let str = String(data: data, encoding: .utf8),
        str.count >= 2 else {
            return "null"
        }
        // Strip the surrounding [ and ].
        return String(str.dropFirst().dropLast())
    }

    func scrollTo(_ anchor: String) {
        let lit = Self.jsLiteral(anchor)
        webView?.evaluateJavaScript("""
          (function() {
            const id = \(lit);
            const el = document.getElementById(id);
            if (el) {
              el.scrollIntoView({behavior:'smooth', block:'start'});
              history.replaceState(null, '', '#' + encodeURIComponent(id));
            }
          })();
        """)
    }

    func setZoom(_ z: Double) {
        let clamped = max(0.6, min(2.0, z))
        currentZoom = clamped
        let lit = Self.jsLiteral(String(format: "%.3f", clamped))
        webView?.evaluateJavaScript("""
          document.getElementById('doc')?.style.setProperty('--markview-zoom', \(lit));
        """)
    }

    func print() {
        guard let webView else { return }
        let info = NSPrintInfo.shared
        info.topMargin = 36; info.bottomMargin = 36
        info.leftMargin = 36; info.rightMargin = 36
        let op = webView.printOperation(with: info)
        op.showsPrintPanel = true
        op.run()
    }

    /// Push a new markdown source into the renderer (used on initial load and
    /// when the same window is repurposed for a different document).
    func loadSource(_ source: String, path: String? = nil) {
        guard let webView else { return }
        // JSONSerialization cannot encode Swift's Optional.none directly;
        // substitute NSNull(), which encodes to the JSON literal `null`.
        let payload: [String: Any] = [
            "path": (path as Any?) ?? NSNull(),
            "source": source,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let json = String(data: data, encoding: .utf8) else { return }
        // The renderer listens for `markview-reload` and re-renders in place.
        webView.evaluateJavaScript("""
          window.dispatchEvent(new CustomEvent('markview-reload', { detail: \(json) }));
        """)
    }
}

struct WebViewBridge: NSViewRepresentable {
    let source: String
    let bridge: WebBridge

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let ucc = WKUserContentController()
        ucc.add(context.coordinator, name: "markview")
        // Tell the renderer that it's embedded in the Swift Liquid Glass shell
        // so its stylesheet skips the opaque page background.
        ucc.addUserScript(WKUserScript(
            source: "document.documentElement.classList.add('mv-transparent-bg');",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        config.userContentController = ucc
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let wv = WKWebView(frame: .zero, configuration: config)
        wv.setValue(false, forKey: "drawsBackground") // transparent — Liquid Glass shows through
        wv.navigationDelegate = context.coordinator

        bridge.webView = wv
        context.coordinator.bridge = bridge
        context.coordinator.pendingSource = source

        if let distURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web/dist") {
            wv.loadFileURL(distURL, allowingReadAccessTo: distURL.deletingLastPathComponent())
        }
        return wv
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        if context.coordinator.lastLoadedSource != source {
            context.coordinator.lastLoadedSource = source
            bridge.loadSource(source)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        weak var bridge: WebBridge?
        var pendingSource: String?
        var lastLoadedSource: String?

        func userContentController(_ ucc: WKUserContentController, didReceive msg: WKScriptMessage) {
            guard let dict = msg.body as? [String: Any],
                  let kind = dict["kind"] as? String else { return }
            switch kind {
            case "toc":
                if let raw = dict["toc"] as? [[String: Any]] {
                    let items: [TocItem] = raw.compactMap { e in
                        guard let id = e["id"] as? String,
                              let text = e["text"] as? String,
                              let level = e["level"] as? Int else { return nil }
                        return TocItem(id: id, level: level, text: text)
                    }
                    DispatchQueue.main.async { self.bridge?.toc = items }
                }
            case "ready":
                DispatchQueue.main.async { self.bridge?.objectWillChange.send() }
            default: break
            }
        }

        func webView(_ webView: WKWebView, didFinish _: WKNavigation!) {
            if let source = pendingSource {
                bridge?.loadSource(source)
                lastLoadedSource = source
                pendingSource = nil
            }
        }
    }
}