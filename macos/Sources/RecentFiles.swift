import AppKit

enum RecentFiles {
    static func noteOpened(_ url: URL) {
        NSDocumentController.shared.noteNewRecentDocumentURL(url)
    }

    static var recent: [URL] {
        NSDocumentController.shared.recentDocumentURLs
    }

    static func clear() {
        NSDocumentController.shared.clearRecentDocuments(nil)
    }
}