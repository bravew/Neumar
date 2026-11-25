#!/bin/bash
# Smoke-test a downloaded daily preview DMG (#366). macOS only.
#
# Usage: scripts/daily-preview-smoke.sh <path-to.dmg>
#
# Checks, in order: the DMG mounts read-only, the .app layout exists, the app
# verifies as ad-hoc signed (not Developer ID, not notarized), and the bundled API
# sidecar starts against a throwaway NEUMAR_APP_DATA_DIR and answers /health.
# Everything it creates lives in one temp directory that the EXIT trap removes,
# and the DMG is always detached.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

fail() {
    echo "::error::$1" >&2
    exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "daily-preview-smoke.sh only runs on macOS"
[ $# -eq 1 ] && [ -f "$1" ] || fail "usage: daily-preview-smoke.sh <path-to.dmg>"
dmg="$1"

app_name=$(cd "$PROJECT_ROOT" && node -p "require('./branding.json').displayName")
binary_name=$(cd "$PROJECT_ROOT" && node -p "require('./branding.json').api.binaryName")

work=$(mktemp -d)
mount_dir="$work/mnt"
data_dir="$work/data"
mkdir -p "$mount_dir" "$data_dir"
sidecar_pid=""
mounted=false

cleanup() {
    if [ -n "$sidecar_pid" ]; then
        kill "$sidecar_pid" 2>/dev/null || true
        wait "$sidecar_pid" 2>/dev/null || true
    fi
    if [ "$mounted" = "true" ]; then
        hdiutil detach "$mount_dir" -quiet 2>/dev/null \
            || hdiutil detach -force "$mount_dir" -quiet 2>/dev/null \
            || echo "::warning::could not detach $mount_dir"
    fi
    rm -rf "$work"
}
trap cleanup EXIT

echo "Mounting $dmg read-only"
hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$dmg" -quiet \
    || fail "could not mount $dmg"
mounted=true

mounted_app="$mount_dir/$app_name.app"
[ -d "$mounted_app" ] || fail "app bundle not found in DMG: $app_name.app"
[ -f "$mounted_app/Contents/Info.plist" ] || fail "Info.plist missing from $app_name.app"

echo "Verifying signature"
codesign --verify --deep --strict "$mounted_app" || fail "codesign verification failed"
signature_info=$(codesign -dv "$mounted_app" 2>&1)
grep -q 'Signature=adhoc' <<<"$signature_info" \
    || fail "expected an ad-hoc signature (previews are not Developer ID signed)"

# Run a copy, not the read-only mount.
app="$work/$app_name.app"
ditto "$mounted_app" "$app"

sidecar=""
for candidate in "$app/Contents/MacOS/$binary_name" "$app/Contents/MacOS/$binary_name"-*; do
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then
        sidecar="$candidate"
        break
    fi
done
[ -n "$sidecar" ] || fail "API sidecar $binary_name not found in Contents/MacOS"

port=$(node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")

echo "Starting sidecar on 127.0.0.1:$port with an isolated data directory"
PORT="$port" NEUMAR_APP_DATA_DIR="$data_dir" NODE_ENV=production \
    "$sidecar" >"$work/sidecar.log" 2>&1 &
sidecar_pid=$!

healthy=false
for _ in $(seq 1 60); do
    if ! kill -0 "$sidecar_pid" 2>/dev/null; then
        sed 's/^/sidecar: /' "$work/sidecar.log" >&2 || true
        fail "sidecar exited before becoming healthy"
    fi
    if body=$(curl -fsS --max-time 2 "http://127.0.0.1:$port/health" 2>/dev/null) \
        && grep -q '"status":"ok"' <<<"$body"; then
        healthy=true
        break
    fi
    sleep 1
done
if [ "$healthy" != "true" ]; then
    sed 's/^/sidecar: /' "$work/sidecar.log" >&2 || true
    fail "sidecar did not report /health ok within 60s"
fi

[ -n "$(ls -A "$data_dir")" ] || fail "sidecar did not write to the isolated data directory"

echo "Smoke test passed: mount, layout, ad-hoc signature, sidecar /health"
