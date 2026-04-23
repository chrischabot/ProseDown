#!/usr/bin/env bash
# Hot-reloading Tauri dev loop: Vite dev server + live Rust rebuilds.
# Usage: ./dev.sh [extra cargo-tauri args]
set -euo pipefail

cd "$(dirname "$0")"

if ! cargo tauri --version >/dev/null 2>&1; then
  echo "dev.sh: installing tauri-cli (one-time)…"
  cargo install tauri-cli --version '^2.0' --locked
fi

exec cargo tauri dev "$@"
