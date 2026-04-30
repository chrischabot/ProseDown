#!/usr/bin/env bash
# =============================================================================
# ProseDown — end-to-end release script.
#
# Builds, signs, notarizes, packages, *and* publishes:
#   1. cargo tauri build     → release-mode .app, codesigned
#   2. xcrun notarytool      → Apple notarization of the .app
#   3. xcrun stapler         → embeds the notarization ticket
#   4. hdiutil               → DMG with Applications symlink
#   5. codesign + notarize   → DMG signed and notarized too
#   6. gh release create     → GitHub release with the DMG attached
#   7. brew tap update       → bumps version + sha in
#                              chrischabot/homebrew-prosedown/Casks/prosedown.rb
#
# After this script exits cleanly, end users can install via:
#   brew tap chrischabot/prosedown
#   brew install --cask prosedown
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
#   3. `gh` (GitHub CLI) installed and authenticated:  gh auth status
#      The token needs `repo` scope on both ProseDown and homebrew-prosedown.
#
# Set PROSEDOWN_SKIP_PUBLISH=1 to stop after building the DMG (steps 1–5);
# useful for dry-runs and smoke-testing a notarized build before publishing.
#
# Usage: ./release.sh
# =============================================================================
set -euo pipefail

APP_NAME="ProseDown"
TEAM_ID="28FC5D45XH"
SIGNING_IDENTITY="Developer ID Application: The Photo Map LLC (${TEAM_ID})"
NOTARY_PROFILE="${PROSEDOWN_NOTARY_PROFILE:-ProseDown-Notarization}"
GITHUB_REPO="chrischabot/ProseDown"
TAP_REPO="chrischabot/homebrew-prosedown"
CASK_PATH_IN_TAP="Casks/prosedown.rb"
SKIP_PUBLISH="${PROSEDOWN_SKIP_PUBLISH:-0}"

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
if [[ "${SKIP_PUBLISH}" != "1" ]]; then
  command -v gh         >/dev/null || fail "gh (GitHub CLI) not found — install with: brew install gh"
  gh auth status        >/dev/null 2>&1 || fail "gh not authenticated — run: gh auth login"
fi

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
TAG="v${VERSION}"

if [[ "${SKIP_PUBLISH}" == "1" ]]; then
  cat <<EOF

${GREEN}==> Build ready (publish skipped)${NC}

  Path:    ${DMG_OUT}
  Version: ${VERSION}
  Size:    ${SIZE}
  SHA256:  ${SHA256}

Re-run without PROSEDOWN_SKIP_PUBLISH to publish to GitHub + Homebrew tap.
EOF
  exit 0
fi

# ---------- publish: GitHub Release ----------------------------------------
step "Publishing GitHub release ${TAG}"
if gh release view "${TAG}" --repo "${GITHUB_REPO}" >/dev/null 2>&1; then
  warn "release ${TAG} already exists — re-uploading DMG with --clobber"
  gh release upload "${TAG}" "${DMG_OUT}" --repo "${GITHUB_REPO}" --clobber
else
  gh release create "${TAG}" "${DMG_OUT}" \
    --repo "${GITHUB_REPO}" \
    --title "${APP_NAME} ${VERSION}" \
    --notes "$(cat <<NOTES
${APP_NAME} ${VERSION} — fast, native macOS markdown viewer.

## Install via Homebrew
\`\`\`sh
brew tap chrischabot/prosedown
brew install --cask prosedown
\`\`\`

## Or download directly
Drag \`${APP_NAME}.app\` from the DMG to your Applications folder.

Signed with Developer ID and notarized by Apple — opens cleanly on first launch with no Gatekeeper warning.

Requires macOS 26 (Tahoe) or later.
NOTES
)"
fi
RELEASE_URL="https://github.com/${GITHUB_REPO}/releases/tag/${TAG}"

# ---------- publish: Homebrew tap -----------------------------------------
step "Updating Homebrew cask in ${TAP_REPO}"
TAP_CHECKOUT="$(mktemp -d)/homebrew-prosedown"
trap 'rm -rf "${TAP_CHECKOUT%/*}"' EXIT
gh repo clone "${TAP_REPO}" "${TAP_CHECKOUT}" -- --quiet

CASK_FILE="${TAP_CHECKOUT}/${CASK_PATH_IN_TAP}"
if [[ ! -f "${CASK_FILE}" ]]; then
  # First publish to a freshly-created tap repo: scaffold the cask from the
  # template kept alongside this script.
  mkdir -p "$(dirname "${CASK_FILE}")"
  cp "${PROJECT_DIR}/homebrew/prosedown.rb" "${CASK_FILE}"
fi

# In-place update of just the version + sha lines.  Using `sed` so any
# manual edits to other fields (livecheck, depends_on, zap paths) are
# preserved across releases.
sed -i '' -E \
  -e "s|^([[:space:]]*version )\"[^\"]*\"|\\1\"${VERSION}\"|" \
  -e "s|^([[:space:]]*sha256 )\"[^\"]*\"|\\1\"${SHA256}\"|" \
  "${CASK_FILE}"

# Belt & braces: confirm the substitution actually landed.  If the cask
# template ever changes shape and the regex stops matching, we want to
# fail here, not silently push a wrong-version cask.
grep -q "version \"${VERSION}\"" "${CASK_FILE}" \
  || fail "cask substitution failed: version line not updated in ${CASK_FILE}"
grep -q "sha256 \"${SHA256}\"" "${CASK_FILE}" \
  || fail "cask substitution failed: sha256 line not updated in ${CASK_FILE}"

if git -C "${TAP_CHECKOUT}" diff --quiet -- "${CASK_PATH_IN_TAP}"; then
  warn "cask already at version ${VERSION} with sha ${SHA256:0:12}… — nothing to push"
else
  git -C "${TAP_CHECKOUT}" add "${CASK_PATH_IN_TAP}"
  git -C "${TAP_CHECKOUT}" commit -m "${APP_NAME} ${VERSION}" >/dev/null
  git -C "${TAP_CHECKOUT}" push origin HEAD >/dev/null 2>&1
  step "Cask updated to ${VERSION}"
fi

cat <<EOF

${GREEN}==> Released ${APP_NAME} ${VERSION}${NC}

  DMG:     ${DMG_OUT}
  Size:    ${SIZE}
  SHA256:  ${SHA256}
  Release: ${RELEASE_URL}
  Tap:     https://github.com/${TAP_REPO}

Users can now install with:
  brew tap chrischabot/prosedown
  brew install --cask prosedown
EOF
