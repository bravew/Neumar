#!/bin/bash

# Publish build artifacts to Cloudflare R2
#
# Works for both local builds and CI. Collects Tauri build artifacts,
# generates latest.json for the updater, and uploads everything to R2.
#
# Usage:
#   ./scripts/publish.sh                    # Publish current version
#   ./scripts/publish.sh --dry-run          # Show what would be uploaded
#   ./scripts/publish.sh --version 26.4.4   # Override version
#
# Credentials (env vars or .env.local):
#   CF_ACCOUNT_ID            Cloudflare account ID
#   CF_R2_ACCESS_KEY_ID      R2 API token access key
#   CF_R2_SECRET_ACCESS_KEY  R2 API token secret

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

step() { printf '\n%b==>%b %s\n' "$BLUE" "$NC" "$1"; }
ok()   { printf '  %bok%b %s\n' "$GREEN" "$NC" "$1"; }
warn() { printf '  %bwarn%b %s\n' "$YELLOW" "$NC" "$1"; }
fail() { printf '  %berror%b %s\n' "$RED" "$NC" "$1"; exit 1; }

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------

DRY_RUN=false
VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN=true; shift ;;
    --version)   VERSION="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: ./scripts/publish.sh [--dry-run] [--version x.y.z]"
      echo ""
      echo "Options:"
      echo "  --dry-run          Show what would be uploaded without uploading"
      echo "  --version x.y.z   Override version (default: from package.json)"
      echo ""
      echo "Credentials (set in env or .env.local):"
      echo "  CF_ACCOUNT_ID, CF_R2_ACCESS_KEY_ID, CF_R2_SECRET_ACCESS_KEY"
      exit 0
      ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# Load credentials from .env.local if present
# ---------------------------------------------------------------------------

if [ -f "$ROOT_DIR/.env.local" ]; then
  # shellcheck disable=SC1091
  set -a
  source "$ROOT_DIR/.env.local"
  set +a
  ok "Loaded credentials from .env.local"
fi

# ---------------------------------------------------------------------------
# Resolve version
# ---------------------------------------------------------------------------

if [ -z "$VERSION" ]; then
  VERSION=$(node -p "require('./package.json').version")
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fail "Invalid version format: $VERSION"
fi

R2_BUCKET="${R2_BUCKET:-neumar}"
R2_PUBLIC_URL="${R2_PUBLIC_URL:-https://cdn.neumar.app}"

echo ""
printf '%bPublish to Cloudflare R2%b\n' "$BLUE" "$NC"
printf '  version : %b%s%b\n' "$GREEN" "$VERSION" "$NC"
printf '  bucket  : %s\n' "$R2_BUCKET"
printf '  url     : %s\n' "$R2_PUBLIC_URL"
if $DRY_RUN; then
  printf '  mode    : %bDRY RUN%b\n' "$YELLOW" "$NC"
fi

# ---------------------------------------------------------------------------
# Collect build artifacts
# ---------------------------------------------------------------------------

step "Collecting build artifacts"

RELEASE_DIR=$(mktemp -d)
trap 'rm -rf "$RELEASE_DIR"' EXIT

FOUND=0

# Arch mapping: Tauri target triple → architecture suffix
collect_platform() {
  local target="$1" arch="$2"
  local bundle_dir="src-tauri/target/${target}/release/bundle"

  if [ ! -d "$bundle_dir" ]; then
    return
  fi

  # macOS: .dmg, .app.tar.gz, .app.tar.gz.sig
  for f in "$bundle_dir"/dmg/*.dmg; do
    [ -f "$f" ] || continue
    cp "$f" "$RELEASE_DIR/"
    ok "$(basename "$f")"
    FOUND=$((FOUND + 1))
  done

  for f in "$bundle_dir"/macos/*.app.tar.gz; do
    [ -f "$f" ] || continue
    filename=$(basename "$f")
    # Add architecture to filename if missing (Tauri 2 omits it)
    if [[ ! "$filename" == *"$arch"* ]]; then
      newname="${filename%.app.tar.gz}_${arch}.app.tar.gz"
    else
      newname="$filename"
    fi
    cp "$f" "$RELEASE_DIR/$newname"
    ok "$newname"
    FOUND=$((FOUND + 1))
  done

  for f in "$bundle_dir"/macos/*.app.tar.gz.sig; do
    [ -f "$f" ] || continue
    filename=$(basename "$f")
    if [[ ! "$filename" == *"$arch"* ]]; then
      newname="${filename%.app.tar.gz.sig}_${arch}.app.tar.gz.sig"
    else
      newname="$filename"
    fi
    cp "$f" "$RELEASE_DIR/$newname"
    ok "$newname"
    FOUND=$((FOUND + 1))
  done

  # Windows: .nsis.zip, .nsis.zip.sig, .msi, .exe
  for ext in ".nsis.zip" ".nsis.zip.sig" ".msi" ".exe"; do
    for f in "$bundle_dir"/nsis/*"$ext"; do
      [ -f "$f" ] || continue
      cp "$f" "$RELEASE_DIR/"
      ok "$(basename "$f")"
      FOUND=$((FOUND + 1))
    done
  done

  # Linux: .AppImage, .AppImage.tar.gz, .AppImage.tar.gz.sig, .deb, .rpm
  for ext in ".AppImage" ".AppImage.tar.gz" ".AppImage.tar.gz.sig"; do
    for f in "$bundle_dir"/appimage/*"$ext"; do
      [ -f "$f" ] || continue
      cp "$f" "$RELEASE_DIR/"
      ok "$(basename "$f")"
      FOUND=$((FOUND + 1))
    done
  done

  for f in "$bundle_dir"/deb/*.deb "$bundle_dir"/rpm/*.rpm; do
    [ -f "$f" ] || continue
    cp "$f" "$RELEASE_DIR/"
    ok "$(basename "$f")"
    FOUND=$((FOUND + 1))
  done
}

collect_platform "aarch64-apple-darwin" "aarch64"
collect_platform "x86_64-apple-darwin" "x64"
collect_platform "x86_64-unknown-linux-gnu" "x86_64"
collect_platform "x86_64-pc-windows-msvc" "x86_64"

if [ "$FOUND" -eq 0 ]; then
  fail "No build artifacts found. Run ./scripts/build.sh first."
fi

# Check that updater bundles (.app.tar.gz + .sig) exist
UPDATER_COUNT=$(find "$RELEASE_DIR" -name "*.app.tar.gz" -o -name "*.AppImage.tar.gz" -o -name "*.nsis.zip" | wc -l | tr -d ' ')
SIG_COUNT=$(find "$RELEASE_DIR" -name "*.app.tar.gz.sig" -o -name "*.AppImage.tar.gz.sig" -o -name "*.nsis.zip.sig" | wc -l | tr -d ' ')

if [ "$UPDATER_COUNT" -eq 0 ]; then
  warn "No updater bundles found (.app.tar.gz). Build with TAURI_SIGNING_PRIVATE_KEY set to enable updater."
  echo ""
  echo "  To build with updater signing:"
  echo "    export TAURI_SIGNING_PRIVATE_KEY=\$(cat src-tauri/update-key.key)"
  echo "    ./scripts/build.sh mac-arm --sign"
  echo ""
  if [ -t 0 ]; then
    read -p "  Continue without updater bundles? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      exit 0
    fi
  else
    warn "Non-interactive mode — continuing without updater bundles"
  fi
fi

if [ "$UPDATER_COUNT" -gt 0 ] && [ "$SIG_COUNT" -eq 0 ]; then
  warn "Updater bundles found but no signatures (.sig). The updater won't work without signatures."
fi

# ---------------------------------------------------------------------------
# Upload via r2-upload.sh
# ---------------------------------------------------------------------------

step "Uploading to R2"

if $DRY_RUN; then
  echo ""
  echo "  Would upload to s3://${R2_BUCKET}:"
  echo ""
  for f in "$RELEASE_DIR"/*; do
    [ -f "$f" ] || continue
    filename=$(basename "$f")
    size=$(du -h "$f" | cut -f1 | tr -d ' ')
    case "$filename" in
      *.dmg)
        echo "    releases/v${VERSION}/$filename  ($size)"
        echo "    installer/neumar.dmg  ← $filename  ($size)"
        ;;
      *.exe)
        echo "    releases/v${VERSION}/$filename  ($size)"
        echo "    installer/neumar-setup.exe  ← $filename  ($size)"
        ;;
      *.msi)
        echo "    releases/v${VERSION}/$filename  ($size)"
        echo "    installer/neumar.msi  ← $filename  ($size)"
        ;;
      *.AppImage)
        echo "    releases/v${VERSION}/$filename  ($size)"
        echo "    installer/neumar.AppImage  ← $filename  ($size)"
        ;;
      *.deb)
        echo "    releases/v${VERSION}/$filename  ($size)"
        echo "    installer/neumar.deb  ← $filename  ($size)"
        ;;
      *.rpm)
        echo "    releases/v${VERSION}/$filename  ($size)"
        echo "    installer/neumar.rpm  ← $filename  ($size)"
        ;;
      latest.json)
        echo "    latest.json  ($size)"
        ;;
      *)
        echo "    releases/v${VERSION}/$filename  ($size)"
        ;;
    esac
  done
  echo ""
  echo "  + latest.json → s3://${R2_BUCKET}/latest.json"
  echo "  + latest.json → s3://${R2_BUCKET}/releases/v${VERSION}/latest.json"
  echo ""
  ok "Dry run complete"
  exit 0
fi

# Verify credentials
for var in CF_ACCOUNT_ID CF_R2_ACCESS_KEY_ID CF_R2_SECRET_ACCESS_KEY; do
  if [ -z "${!var:-}" ]; then
    fail "$var is not set. Add it to .env.local or export it."
  fi
done

# Verify aws cli
if ! command -v aws &> /dev/null; then
  fail "AWS CLI not found. Install it: brew install awscli"
fi

export VERSION
export R2_BUCKET
export R2_PUBLIC_URL
export RELEASE_DIR

bash "$SCRIPT_DIR/r2-upload.sh"

echo ""
printf '%b========================================%b\n' "$GREEN" "$NC"
printf '%b  Published v%s to R2!%b\n' "$GREEN" "$VERSION" "$NC"
printf '%b========================================%b\n' "$GREEN" "$NC"
echo ""
echo "  Updater manifest: ${R2_PUBLIC_URL}/latest.json"
echo "  Installer:        ${R2_PUBLIC_URL}/installer/"
echo ""
