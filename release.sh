#!/usr/bin/env bash
# =============================================================================
# ProseDown — build, sign, notarize, and package for distribution.
#
# Produces dist/ProseDown.dmg: signed, notarized, stapled, ready for upload to
# GitHub Releases and consumable by a Homebrew Cask.
#
# Prerequisites (one-time, on this machine):
#   1. Developer ID Application cert in the login keychain. Verify with:
#        security find-identity -v -p codesigning
#   2. Keychain profile for notarytool.  Create with an app-specific password
#      from https://appleid.apple.com → Sign-In & Security → App-Specific
#      Passwords:
#        xcrun notarytool store-credentials "ProseDown-Notarization" \
#          --apple-id  <your-apple-id@example.com> \
#          --team-id   28FC5D45XH \
#          --password  <app-specific-password>
#      Override the profile name via PROSEDOWN_NOTARY_PROFILE if you prefer
#      to reuse an existing profile (e.g. Interviewer-Notarization).
#
# Usage: ./release.sh
# =============================================================================
set -euo pipefail

APP_NAME="ProseDown"
TEAM_ID="28FC5D45XH"
SIGNING_IDENTITY="Developer ID Application: The Photo Map LLC (${TEAM_ID})"
NOTARY_PROFILE="${PROSEDOWN_NOTARY_PROFILE:-ProseDown-Notarization}"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${PROJECT_DIR}/dist"
# Cargo workspace puts the target dir at the repo root, not under src-tauri/.
BUNDLE_ROOT="${PROJECT_DIR}/target/release/bundle"
APP_BUNDLE="${BUNDLE_ROOT}/macos/${APP_NAME}.app"
DMG_OUT="${DIST_DIR}/${APP_NAME}.dmg"

# ---------- helpers --------------------------------------------------------
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
step()  { echo "${GREEN}==>${NC} $*"; }
warn()  { echo "${YELLOW}warn:${NC} $*" >&2; }
fail()  { echo "${RED}error:${NC} $*" >&2; exit 1; }

# ---------- preflight ------------------------------------------------------
step "Preflight checks"

command -v cargo        >/dev/null || fail "cargo not found"
command -v cargo-tauri  >/dev/null 2>&1 || cargo tauri --version >/dev/null 2>&1 \
  || fail "cargo-tauri not found — install with: cargo install tauri-cli --version '^2'"
command -v xcrun        >/dev/null || fail "xcrun not found (install Xcode Command Line Tools)"
command -v hdiutil      >/dev/null || fail "hdiutil not found"

security find-identity -v -p codesigning | grep -q "${SIGNING_IDENTITY}" \
  || fail "signing identity not in keychain: ${SIGNING_IDENTITY}"

if ! xcrun notarytool history --keychain-profile "${NOTARY_PROFILE}" >/dev/null 2>&1; then
  cat >&2 <<EOF
${RED}error:${NC} notarytool keychain profile '${NOTARY_PROFILE}' not found.

Create it once with an app-specific password from appleid.apple.com:

  xcrun notarytool store-credentials "${NOTARY_PROFILE}" \\
    --apple-id <your-apple-id@example.com> \\
    --team-id  ${TEAM_ID} \\
    --password <app-specific-password>

Or set PROSEDOWN_NOTARY_PROFILE to reuse another profile, e.g.:

  PROSEDOWN_NOTARY_PROFILE=Interviewer-Notarization ./release.sh
EOF
  exit 1
fi

# ---------- clean ----------------------------------------------------------
step "Cleaning previous dist/"
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

# ---------- build ----------------------------------------------------------
step "Building web bundle + Tauri release (signs via APPLE_SIGNING_IDENTITY)"
APPLE_SIGNING_IDENTITY="${SIGNING_IDENTITY}" cargo tauri build

[[ -d "${APP_BUNDLE}" ]] || fail "app bundle not found: ${APP_BUNDLE}"

step "Verifying app signature"
codesign --verify --deep --strict --verbose=2 "${APP_BUNDLE}"

# ---------- notarize .app --------------------------------------------------
step "Notarizing ${APP_NAME}.app"
APP_ZIP="${DIST_DIR}/${APP_NAME}.app.zip"
ditto -c -k --keepParent "${APP_BUNDLE}" "${APP_ZIP}"
xcrun notarytool submit "${APP_ZIP}" --keychain-profile "${NOTARY_PROFILE}" --wait
rm -f "${APP_ZIP}"

step "Stapling .app"
xcrun stapler staple "${APP_BUNDLE}"

# ---------- package DMG ----------------------------------------------------
step "Building DMG from stapled .app"
STAGING="${DIST_DIR}/dmg-staging"
rm -rf "${STAGING}"
mkdir -p "${STAGING}"
cp -R "${APP_BUNDLE}" "${STAGING}/"
ln -s /Applications "${STAGING}/Applications"

hdiutil create \
  -volname "${APP_NAME}" \
  -srcfolder "${STAGING}" \
  -ov -format UDZO \
  "${DMG_OUT}"

rm -rf "${STAGING}"

step "Signing DMG"
codesign --force --sign "${SIGNING_IDENTITY}" "${DMG_OUT}"

# ---------- notarize DMG ---------------------------------------------------
step "Notarizing DMG"
xcrun notarytool submit "${DMG_OUT}" --keychain-profile "${NOTARY_PROFILE}" --wait

step "Stapling DMG"
xcrun stapler staple "${DMG_OUT}"

# ---------- verification + output -----------------------------------------
step "Gatekeeper assessment"
spctl --assess --type open --context context:primary-signature --verbose=2 "${DMG_OUT}" \
  || warn "spctl assess returned non-zero — investigate before uploading"

VERSION="$(grep -E '"version"' "${PROJECT_DIR}/src-tauri/tauri.conf.json" \
             | head -n1 | sed -E 's/.*"version": "([^"]+)".*/\1/')"
SHA256="$(shasum -a 256 "${DMG_OUT}" | awk '{print $1}')"
SIZE="$(du -h "${DMG_OUT}" | awk '{print $1}')"

cat <<EOF

${GREEN}==> Release ready${NC}

  Path:    ${DMG_OUT}
  Version: ${VERSION}
  Size:    ${SIZE}
  SHA256:  ${SHA256}

Next steps:
  1. Create a GitHub release:
       gh release create v${VERSION} "${DMG_OUT}" \\
         --title "ProseDown ${VERSION}" --generate-notes
  2. Update the Homebrew Cask (Casks/prosedown.rb) with:
       version "${VERSION}"
       sha256  "${SHA256}"
       url     "https://github.com/chrischabot/ProseDown/releases/download/v${VERSION}/${APP_NAME}.dmg"
EOF
