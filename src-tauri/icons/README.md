# App icons

Drop a square, opaque source image at `icons/icon.png` (at least 1024×1024) and run:

```sh
cargo tauri icon icons/icon.png
```

That regenerates all required macOS/iOS/Windows/Linux icon sizes in this directory. The generated `icon.icns` is what ends up in the `.app` bundle.

No icon is included in the repository by default — add your own.