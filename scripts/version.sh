#!/bin/bash

# Version Management Script (brand name read from branding.json)
# Usage:
#   ./scripts/version.sh          # Show current version
#   ./scripts/version.sh 0.2.0    # Set new version and sync to all files

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Files that contain version
ROOT_PACKAGE="$PROJECT_ROOT/package.json"
API_PACKAGE="$PROJECT_ROOT/src-api/package.json"
TAURI_CONF="$PROJECT_ROOT/src-tauri/tauri.conf.json"
CARGO_TOML="$PROJECT_ROOT/src-tauri/Cargo.toml"

# Get current version from root package.json
get_current_version() {
    node -p "require('$ROOT_PACKAGE').version"
}

# Update version in a JSON file
update_json_version() {
    local file="$1"
    local version="$2"
    local name=$(basename "$file")

    if [ -f "$file" ]; then
        node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('$file', 'utf8'));
pkg.version = '$version';
fs.writeFileSync('$file', JSON.stringify(pkg, null, 2) + '\n');
"
        echo -e "  ${GREEN}✓${NC} $name -> $version"
    else
        echo -e "  ${YELLOW}⚠${NC} $name not found"
    fi
}

# Update version in Cargo.toml
update_cargo_version() {
    local file="$1"
    local version="$2"
    local name=$(basename "$file")

    if [ -f "$file" ]; then
        # Use sed to replace version line (handles both "0.1.0" and "0.1.0" formats)
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS sed
            sed -i '' "s/^version = \"[^\"]*\"/version = \"$version\"/" "$file"
        else
            # Linux sed
            sed -i "s/^version = \"[^\"]*\"/version = \"$version\"/" "$file"
        fi
        echo -e "  ${GREEN}✓${NC} $name -> $version"
    else
        echo -e "  ${YELLOW}⚠${NC} $name not found"
    fi
}

# Show current versions
show_versions() {
    echo -e "${BLUE}Current versions:${NC}"

    if [ -f "$ROOT_PACKAGE" ]; then
        local v=$(node -p "require('$ROOT_PACKAGE').version")
        echo -e "  package.json:           $v"
    fi

    if [ -f "$API_PACKAGE" ]; then
        local v=$(node -p "require('$API_PACKAGE').version")
        echo -e "  src-api/package.json:   $v"
    fi

    if [ -f "$TAURI_CONF" ]; then
        local v=$(node -p "require('$TAURI_CONF').version")
        echo -e "  tauri.conf.json:        $v"
    fi

    if [ -f "$CARGO_TOML" ]; then
        local v=$(grep "^version" "$CARGO_TOML" | head -1 | sed 's/version = "\(.*\)"/\1/')
        echo -e "  Cargo.toml:             $v"
    fi
}

# Sync all versions
sync_versions() {
    local version="$1"

    echo -e "${BLUE}Syncing version to $version...${NC}"

    update_json_version "$ROOT_PACKAGE" "$version"
    update_json_version "$API_PACKAGE" "$version"
    update_json_version "$TAURI_CONF" "$version"
    update_cargo_version "$CARGO_TOML" "$version"

    echo -e "${GREEN}Done!${NC}"
}

# Validate version format (semver)
validate_version() {
    local version="$1"
    if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
        echo "Error: Invalid version format. Use semver (e.g., 0.2.0, 1.0.0-beta.1)"
        exit 1
    fi
}

# Main
main() {
    cd "$PROJECT_ROOT"

    if [ -z "$1" ]; then
        # No argument: show current versions
        show_versions
    else
        # Argument provided: set new version
        validate_version "$1"
        sync_versions "$1"
        echo ""
        show_versions
    fi
}

main "$@"
