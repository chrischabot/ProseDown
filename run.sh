#!/usr/bin/env bash
# Build the web bundle, package ProseDown.app/.dmg, and launch it.
# Usage: ./run.sh [file.md ...]
set -euo pipefail

cd "$(dirname "$0")"

if ! cargo tauri --version >/dev/null 2>&1; then
  echo "run.sh: installing tauri-cli (one-time)…"
  cargo install tauri-cli --version '^2.0' --locked
fi

cargo tauri build

APP="$(ls -td target/release/bundle/macos/ProseDown.app src-tauri/target/release/bundle/macos/ProseDown.app 2>/dev/null | head -n1 || true)"
if [ -z "${APP:-}" ]; then
  echo "run.sh: could not locate built ProseDown.app under target/release/bundle/macos/" >&2
  exit 1
fi

echo "run.sh: launching $APP"
if [ "$#" -gt 0 ]; then
  open -a "$APP" "$@"
else
  open "$APP"
fi
