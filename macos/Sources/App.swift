import SwiftUI
import AppKit

@main
struct MarkviewApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        // `DocumentGroup(viewing:)` is the canonical SwiftUI pattern for a
        // read-only document viewer: it auto-wires Finder double-click,
        // File → Open, File → Open Recent, window-per-document, and
        // deduplication of already-open files, all via the system's
        // LaunchServices + Apple Events — no AppDelegate routing needed.
        DocumentGroup(viewing: MarkdownDocument.self) { file in
            DocumentWindow(document: file.document)
                .frame(minWidth: 480, minHeight: 320)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .commands {
            // Keyboard shortcut for the in-window sidebar toggle.
            CommandGroup(after: .textFormatting) {
                Button("Toggle Sidebar") {
                    NotificationCenter.default.post(name: .markviewToggleSidebar, object: nil)
                }
                .keyboardShortcut("\\", modifiers: [.command])
            }
            // DocumentGroup supplies File → New by default; Markview is a
            // viewer so we disable it. File → Open/Open Recent are kept.
            CommandGroup(replacing: .newItem) { EmptyView() }
        }
    }
}

/// Minimal delegate — DocumentGroup handles file opens natively, so this only
/// exists to keep the app alive when the last window closes (standard macOS
/// document-app behavior on macOS 26).
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}

extension Notification.Name {
    static let markviewToggleSidebar = Notification.Name("ai.markview.toggleSidebar")
}