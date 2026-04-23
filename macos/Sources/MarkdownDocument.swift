import SwiftUI
import UniformTypeIdentifiers

/// A read-only markdown document. We only use `FileDocument` for its native
/// integration with `DocumentGroup` (Finder open, Open Recent, window routing).
/// Writes are explicitly unsupported — Markview is a viewer.
struct MarkdownDocument: FileDocument {
    static let readableContentTypes: [UTType] = {
        var types: [UTType] = [.plainText]
        if let md = UTType(filenameExtension: "md") { types.append(md) }
        if let mdown = UTType(filenameExtension: "markdown") { types.append(mdown) }
        if let dfm = UTType(importedAs: "net.daringfireball.markdown") as UTType? {
            types.append(dfm)
        }
        return types
    }()

    static let writableContentTypes: [UTType] = []

    var source: String = ""

    init() {}

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            self.source = ""
            return
        }
        self.source = String(decoding: data, as: UTF8.self)
    }

    /// Required by the protocol but never called for a `DocumentGroup(viewing:)`.
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        throw CocoaError(.featureUnsupported)
    }
}