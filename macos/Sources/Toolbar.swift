import SwiftUI

struct Toolbar: View {
    let onToggleSidebar: () -> Void
    let onZoomIn: () -> Void
    let onZoomOut: () -> Void
    let onReset: () -> Void
    let onPrint: () -> Void

    var body: some View {
        HStack(spacing: 2) {
            tbButton(systemName: "sidebar.left", help: "Toggle Sidebar (⌘\\)", action: onToggleSidebar)
            divider
            tbButton(systemName: "minus.magnifyingglass", help: "Zoom Out (⌘−)", action: onZoomOut)
            tbButton(systemName: "1.magnifyingglass",     help: "Actual Size (⌘0)", action: onReset)
            tbButton(systemName: "plus.magnifyingglass",  help: "Zoom In (⌘+)", action: onZoomIn)
            divider
            tbButton(systemName: "printer", help: "Print (⌘P)", action: onPrint)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .modifier(GlassSurface(shape: RoundedRectangle(cornerRadius: 12, style: .continuous)))
    }

    private func tbButton(systemName: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 14, weight: .medium))
                .frame(width: 28, height: 24)
        }
        .buttonStyle(.plain)
        .help(help)
        .contentShape(Rectangle())
    }

    private var divider: some View {
        Rectangle()
            .fill(.separator)
            .frame(width: 1, height: 16)
            .padding(.horizontal, 2)
    }
}

/// Applies the native Liquid Glass material on macOS 26, falling back to
/// `.thinMaterial` on earlier SDK/runtime combinations.
struct GlassSurface<S: Shape>: ViewModifier {
    let shape: S

    func body(content: Content) -> some View {
        #if compiler(>=6.0)
        if #available(macOS 26, *) {
            // `.glassEffect(_:in:)` is the macOS 26 SDK API.
            content.glassEffect(.regular, in: shape)
        } else {
            content.background(.thinMaterial, in: shape)
                .overlay(shape.stroke(.separator))
        }
        #else
        content.background(.thinMaterial, in: shape)
            .overlay(shape.stroke(.separator))
        #endif
    }
}