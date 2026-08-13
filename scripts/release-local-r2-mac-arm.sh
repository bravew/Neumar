#!/bin/bash

# Build, sign/notarize, stage, and upload the local macOS ARM64 release to R2.
#
# Usage:
#   ./scripts/release-local-r2-mac-arm.sh
#   ./scripts/release-local-r2-mac-arm.sh --dry-run
#   ./scripts/release-local-r2-mac-arm.sh --with-cli
#   ./scripts/release-local-r2-mac-arm.sh --version 26.7.30

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

DRY_RUN=false
WITH_CLI=false
VERSION_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --with-cli)
      WITH_CLI=true
      shift
      ;;
    --version)
      VERSION_ARG="${2:-}"
      shift 2
      ;;
    -h|--help)
      sed -n '3,9p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -f "$ROOT_DIR/.env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.local"
  set +a
fi

VERSION="$VERSION_ARG"
if [ -z "$VERSION" ]; then
  VERSION="$(node -p "require('./package.json').version")"
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid version: $VERSION" >&2
  exit 1
fi

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  if [ ! -f "$ROOT_DIR/src-tauri/update-key.key" ]; then
    echo "TAURI_SIGNING_PRIVATE_KEY is not set and src-tauri/update-key.key is missing" >&2
    exit 1
  fi
  export TAURI_SIGNING_PRIVATE_KEY
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$ROOT_DIR/src-tauri/update-key.key")"
fi
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

build_args=(mac-arm --sign)
if $WITH_CLI; then
  build_args=(mac-arm --with-cli --sign)
fi

echo "==> Building signed local macOS ARM64 release v${VERSION}"
"$ROOT_DIR/scripts/build.sh" "${build_args[@]}"

brand_json="branding.json"
brand_display_name="$(node -p "require('./${brand_json}').displayName")"
brand_slug="$(node -p "require('./${brand_json}').slug")"
dmg_prefix="${brand_slug//-/}"
target_dir="$ROOT_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle"
app_path="$target_dir/macos/${brand_display_name}.app"
archive_path="$target_dir/macos/${brand_display_name}.app.tar.gz"
signature_path="$target_dir/macos/${brand_display_name}.app.tar.gz.sig"
dmg_path="$target_dir/dmg/${dmg_prefix}_${VERSION}_aarch64.dmg"

for artifact in "$app_path" "$archive_path" "$signature_path" "$dmg_path"; do
  if [ ! -e "$artifact" ]; then
    echo "Expected release artifact missing: $artifact" >&2
    exit 1
  fi
done

echo "==> Verifying local signatures and notarization"
codesign --verify --deep --strict "$app_path"
xcrun stapler validate "$app_path"
codesign --verify "$dmg_path"
xcrun stapler validate "$dmg_path"
hdiutil verify "$dmg_path"

release_dir="$(mktemp -d "/tmp/${brand_slug}-r2-release-${VERSION}.XXXXXX")"
trap 'rm -rf "$release_dir"' EXIT

cp "$archive_path" "$release_dir/${brand_display_name}_aarch64.app.tar.gz"
cp "$signature_path" "$release_dir/${brand_display_name}_aarch64.app.tar.gz.sig"
cp "$dmg_path" "$release_dir/"

echo "==> Staged R2 upload artifacts in $release_dir"
find "$release_dir" -maxdepth 1 -type f -print | sort | while read -r file; do
  shasum -a 256 "$file"
done

echo "==> Uploading staged artifacts to Cloudflare R2"
VERSION="$VERSION" RELEASE_DIR="$release_dir" DRY_RUN="$DRY_RUN" bash "$ROOT_DIR/scripts/r2-upload.sh"
