#!/usr/bin/env bash
# Cargo `runner` shim used during `tauri dev` on macOS.
#
# Why this exists: Tauri's debug binary is (a) not codesigned with
# entitlements.plist and (b) not inside a .app bundle, so macOS has no
# Info.plist to read. WKWebView's microphone broker requires BOTH the
# audio-input entitlement AND NSMicrophoneUsageDescription in Info.plist —
# without the bundle structure it refuses to create the sandbox extension
# and getUserMedia() silently returns zeroed audio.
#
# What this does:
#   1. Builds a throwaway Neumar-Dev.app skeleton next to the debug binary
#      with Info.plist (NSMicrophoneUsageDescription, etc.) and a hardlink
#      to the freshly compiled executable.
#   2. Ad-hoc codesigns the .app with src-tauri/entitlements.plist.
#   3. Execs the binary via its in-bundle path so dyld + TCC find the
#      bundle and treat it as a real app.
#
# Wired up via src-tauri/.cargo/config.toml:
#   [target.'cfg(target_os = "macos")']
#   runner = "../scripts/sign-dev-macos.sh"
#
# Cargo invokes this with the binary path as $1 followed by any runtime args.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "sign-dev-macos.sh: missing binary path" >&2
  exit 1
fi

BIN="$1"
shift

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAURI_DIR="$SCRIPT_DIR/../src-tauri"
ENTITLEMENTS="$TAURI_DIR/entitlements.plist"
SOURCE_INFO_PLIST="$TAURI_DIR/Info.plist"

BIN_NAME="$(basename "$BIN")"
BIN_DIR="$(dirname "$BIN")"
APP_BUNDLE="$BIN_DIR/Neumar-Dev.app"
APP_MACOS="$APP_BUNDLE/Contents/MacOS"
APP_BIN="$APP_MACOS/$BIN_NAME"
APP_INFO="$APP_BUNDLE/Contents/Info.plist"

mkdir -p "$APP_MACOS"

# Write a dev Info.plist with bundle identity and usage descriptions.
# The identifier must match tauri.conf.json so TCC permission grants
# persist across rebuilds. Usage descriptions are kept in sync with
# src-tauri/Info.plist by hand — they rarely change.
cat > "$APP_INFO" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>$BIN_NAME</string>
    <key>CFBundleIdentifier</key>
    <string>ai.neumar</string>
    <key>CFBundleName</key>
    <string>Neumar Dev</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.0.0-dev</string>
    <key>CFBundleVersion</key>
    <string>0</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>Neumar uses the microphone for voice commands and dictation to the AI agent.</string>
    <key>NSScreenCaptureUsageDescription</key>
    <string>Neumar uses screen recording to provide visual context to the AI agent for better assistance.</string>
    <key>NSLocationWhenInUseUsageDescription</key>
    <string>Neumar uses your approximate location to provide location-aware context to the AI agent.</string>
</dict>
</plist>
PLIST

# Hardlink the freshly built binary into the bundle. Hardlink (not symlink)
# so NSBundle's executable-path walk finds the bundle root. Recreated each
# run because cargo overwrites $BIN with a new inode on rebuild.
rm -f "$APP_BIN"
ln "$BIN" "$APP_BIN" 2>/dev/null || cp "$BIN" "$APP_BIN"

# Ad-hoc sign the bundle with entitlements. --force is idempotent.
if [[ -f "$ENTITLEMENTS" ]]; then
  codesign --force --sign - --entitlements "$ENTITLEMENTS" "$APP_BUNDLE" \
    >/dev/null 2>&1 || echo "sign-dev-macos.sh: codesign failed" >&2
fi

exec "$APP_BIN" "$@"
