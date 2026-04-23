import SwiftUI
import WebKit

struct DocumentWindow: View {
    let document: MarkdownDocument

    @State private var toc: [TocItem] = []
    @State private var activeAnchor: String? = nil
    @State private var sidebarVisible: Bool = true
    @StateObject private var bridge = WebBridge()

    var body: some View {
        ZStack(alignment: .topLeading) {
            WebViewBridge(source: document.source, bridge: bridge)
                .ignoresSafeArea()

            if sidebarVisible {
                Sidebar(
                    items: toc,
                    active: activeAnchor,
                    onSelect: { id in bridge.scrollTo(id) }
                )
                .frame(width: 240)
                .transition(.move(edge: .leading).combined(with: .opacity))
                .zIndex(1)
            }

            Toolbar(
                onToggleSidebar: { withAnimation(.spring(duration: 0.24)) { sidebarVisible.toggle() } },
                onZoomIn:  { bridge.setZoom(bridge.currentZoom + 0.1) },
                onZoomOut: { bridge.setZoom(bridge.currentZoom - 0.1) },
                onReset:   { bridge.setZoom(1.0) },
                onPrint:   { bridge.print() }
            )
            .padding(.top, 8)
            .padding(.trailing, 12)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .zIndex(2)
        }
        .onReceive(NotificationCenter.default.publisher(for: .markviewToggleSidebar)) { _ in
            withAnimation(.spring(duration: 0.24)) { sidebarVisible.toggle() }
        }
        .onReceive(bridge.$toc.receive(on: RunLoop.main)) { self.toc = $0 }
        .onReceive(bridge.$activeAnchor.receive(on: RunLoop.main)) { self.activeAnchor = $0 }
    }
}

struct TocItem: Identifiable, Hashable {
    var id: String
    var level: Int
    var text: String
}