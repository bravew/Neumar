#!/bin/bash
# Sign all native Mach-O binaries in resource directories before Tauri bundles them.
# Tauri signs sidecars (externalBin) automatically but NOT files inside "resources".
# Without this, Apple notarization rejects the app.

set -euo pipefail

IDENTITY="${APPLE_SIGNING_IDENTITY:-Developer ID Application: YONG WANG (U87X2ZQ22K)}"
ENTITLEMENTS="$(dirname "$0")/entitlements.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$(cd "$SCRIPT_DIR/../src-api/dist" && pwd)"

# Resource directories that Tauri bundles (from tauri.conf.json resources)
RESOURCE_DIRS=(
  "$DIST_DIR/cli-bundle"
  "$DIST_DIR/sherpa-onnx"
  "$DIST_DIR/onnxruntime"
)

SIGNED=0
SKIPPED=0

sign_binary() {
  local file="$1"
  local relpath="${file#$DIST_DIR/}"

  # Check if it's a Mach-O binary
  if ! file "$file" | grep -q "Mach-O"; then
    return
  fi

  # Check if already properly signed (not ad-hoc)
  if codesign -dv "$file" 2>&1 | grep -q "Authority=Developer ID"; then
    echo "  [skip] $relpath (already signed)"
    SKIPPED=$((SKIPPED + 1))
    return
  fi

  echo "  [sign] $relpath"
  codesign --force --sign "$IDENTITY" --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" "$file"
  SIGNED=$((SIGNED + 1))
}

echo "=== Signing native binaries for notarization ==="
echo "Identity: $IDENTITY"
echo "Entitlements: $ENTITLEMENTS"
echo ""

for dir in "${RESOURCE_DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    echo "Warning: $dir not found, skipping"
    continue
  fi

  echo "Scanning ${dir#$DIST_DIR/}/ ..."

  # Find all files and check if they're Mach-O binaries
  while IFS= read -r -d '' file; do
    sign_binary "$file"
  done < <(find "$dir" -type f \( -name "*.dylib" -o -name "*.node" -o -name "rg" \) -print0)
done

echo ""
echo "=== Done: $SIGNED signed, $SKIPPED already signed ==="
