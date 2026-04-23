import SwiftUI

struct Sidebar: View {
    let items: [TocItem]
    let active: String?
    let onSelect: (String) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            nav
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .modifier(GlassSurface(shape: Rectangle()))
        .overlay(alignment: .trailing) {
            Rectangle()
                .fill(.separator)
                .frame(width: 1)
                .frame(maxHeight: .infinity)
        }
    }

    private var header: some View {
        Text("Contents")
            .font(.system(size: 11, weight: .semibold))
            .kerning(0.6)
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .padding(.horizontal, 14)
            .padding(.top, 36)   // clear the NSWindow traffic-light area
            .padding(.bottom, 8)
    }

    private var nav: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: true) {
                LazyVStack(alignment: .leading, spacing: 1) {
                    if items.isEmpty {
                        Text("No headings")
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 14).padding(.top, 10)
                    } else {
                        ForEach(items) { item in row(for: item) }
                    }
                }
                .padding(.vertical, 4)
            }
            .onChange(of: active) { _, newActive in
                guard let id = newActive else { return }
                withAnimation(.easeInOut(duration: 0.2)) {
                    proxy.scrollTo(id, anchor: .center)
                }
            }
        }
    }

    @ViewBuilder
    private func row(for item: TocItem) -> some View {
        let isActive = item.id == active
        let indent = CGFloat(max(0, item.level - 1)) * 12

        Button {
            onSelect(item.id)
        } label: {
            HStack(spacing: 0) {
                Text(item.text)
                    .font(.system(size: 13, weight: isActive ? .semibold : .regular))
                    .foregroundStyle(isActive ? Color.accentColor : Color.primary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 4)
            .padding(.leading, 8 + indent)
            .padding(.trailing, 8)
            .background {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(isActive ? Color.accentColor.opacity(0.14) : Color.clear)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focusable(true)
        .padding(.horizontal, 6)
        .id(item.id)
    }
}