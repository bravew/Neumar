#!/bin/bash

# Build Script (brand values read from branding.json)
# Usage: ./scripts/build.sh [platform] [--with-cli]
# Platforms: linux, windows, mac-intel, mac-arm, all
# Options:
#   --with-cli  Bundle CLI tools (Claude Code + Codex) with shared Node.js

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# ============================================================================
# Read branding from branding.json (single source of truth)
# ============================================================================
BRAND_DISPLAY_NAME=$(node -e "console.log(require('./branding.json').displayName)")
BRAND_SLUG=$(node -e "console.log(require('./branding.json').slug)")
BRAND_BINARY_NAME=$(node -e "console.log(require('./branding.json').api.binaryName)")
BRAND_DATA_DIR=".${BRAND_SLUG}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Global variables
BUNDLE_CLI=false  # Bundle CLI tools (Claude Code + Codex) with shared Node.js
BUILD_PLATFORM="current"
SKIP_SIGNING=true  # Default: skip signing for faster builds

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required tools are installed
check_requirements() {
    log_info "Checking requirements..."

    if ! command -v pnpm &> /dev/null; then
        log_error "pnpm is not installed. Please install it first."
        exit 1
    fi

    if ! command -v cargo &> /dev/null; then
        log_error "Rust/Cargo is not installed. Please install it first."
        exit 1
    fi

    if ! command -v rustup &> /dev/null; then
        log_error "rustup is not installed. Please install it first."
        exit 1
    fi

    log_info "All requirements satisfied."
}

# Install dependencies
install_deps() {
    log_info "Installing dependencies..."
    pnpm install
}

# Pre-download the embedding model for bundling
download_embedding_model() {
    local models_dir="$PROJECT_ROOT/src-api/dist/models"

    # Check if model is already downloaded (look for actual model dirs, not just .gitkeep)
    if [ -d "$models_dir" ] && ls "$models_dir"/models--* &>/dev/null; then
        log_info "Embedding model already downloaded, skipping..."
        return 0
    fi

    log_info "Downloading embedding model (gte-multilingual-base, ~340 MB)..."
    cd "$PROJECT_ROOT"
    node src-api/scripts/download-model.mjs
    log_info "Embedding model downloaded to $models_dir"
}

# Build API sidecar for a specific target (using Node.js + esbuild + pkg)
build_api_sidecar() {
    local target="$1"
    log_info "Building API sidecar for $target (Node.js)..."

    cd "$PROJECT_ROOT/src-api"

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        pnpm install
    fi

    case "$target" in
        x86_64-unknown-linux-gnu)
            pnpm run build:binary:linux
            ;;
        x86_64-pc-windows-msvc)
            pnpm run build:binary:windows
            ;;
        x86_64-pc-windows-gnu)
            # Cross-compile Windows binary using pkg (same as MSVC, just different output name)
            PKG_NODE_RANGE=22 pnpm bundle && pnpm exec pkg dist/bundle.cjs --targets node22-win-x64 --output "dist/${BRAND_BINARY_NAME}-x86_64-pc-windows-gnu.exe" --options expose-gc
            ;;
        x86_64-apple-darwin)
            pnpm run build:binary:mac-intel
            ;;
        aarch64-apple-darwin)
            pnpm run build:binary:mac-arm
            ;;
        current)
            pnpm run build:binary
            ;;
        *)
            log_error "Unknown target for API sidecar: $target"
            exit 1
            ;;
    esac

    cd "$PROJECT_ROOT"
    log_info "API sidecar build completed for $target"
}

# Bundle CLI tools (Claude Code + Codex) with shared Node.js runtime
# This creates a single cli-bundle with one Node.js and both CLI packages
bundle_cli_tools() {
    local target="$1"

    if [ "$BUNDLE_CLI" != "true" ]; then
        log_info "Skipping CLI bundling (use --with-cli to enable)"
        return 0
    fi

    log_info "Bundling CLI tools with shared Node.js for $target..."

    local output_dir="$PROJECT_ROOT/src-api/dist"
    local bundle_dir="$output_dir/cli-bundle"

    # Clean up old bundles
    rm -rf "$bundle_dir"
    rm -rf "$output_dir/claude-bundle"
    rm -rf "$output_dir/codex-bundle"
    mkdir -p "$bundle_dir"

    # Determine platform-specific settings
    local node_platform=""
    local node_arch=""
    local node_ext=""

    case "$target" in
        x86_64-unknown-linux-gnu)
            node_platform="linux"
            node_arch="x64"
            ;;
        x86_64-pc-windows-msvc|x86_64-pc-windows-gnu)
            node_platform="win"
            node_arch="x64"
            node_ext=".exe"
            ;;
        x86_64-apple-darwin)
            node_platform="darwin"
            node_arch="x64"
            ;;
        aarch64-apple-darwin)
            node_platform="darwin"
            node_arch="arm64"
            ;;
        current)
            local os_name=$(uname -s)
            local arch=$(uname -m)
            case "$os_name" in
                Darwin)
                    node_platform="darwin"
                    node_arch=$([ "$arch" = "arm64" ] && echo "arm64" || echo "x64")
                    ;;
                Linux)
                    node_platform="linux"
                    node_arch="x64"
                    ;;
                *)
                    node_platform="linux"
                    node_arch="x64"
                    ;;
            esac
            ;;
        *)
            node_platform="linux"
            node_arch="x64"
            ;;
    esac

    # Node.js version - fixed for stability
    local node_version="22.2.0"
    local node_filename="node-v${node_version}-${node_platform}-${node_arch}"
    local node_url="https://nodejs.org/dist/v${node_version}/${node_filename}.tar.gz"

    # For Windows, use .zip format
    if [ "$node_platform" = "win" ]; then
        node_url="https://nodejs.org/dist/v${node_version}/${node_filename}.zip"
    fi

    # Cache directory for Node.js downloads
    local cache_dir="$HOME/${BRAND_DATA_DIR}/cache"
    local cached_node="$cache_dir/${node_filename}/node${node_ext}"
    mkdir -p "$cache_dir"

    # Check if we have a cached Node.js binary
    if [ -f "$cached_node" ]; then
        log_info "Using cached Node.js v${node_version} for ${node_platform}-${node_arch}"
        cp "$cached_node" "$bundle_dir/node${node_ext}"
        chmod +x "$bundle_dir/node${node_ext}" 2>/dev/null || true
    else
        log_info "Downloading Node.js v${node_version} for ${node_platform}-${node_arch}..."

        local temp_dir=$(mktemp -d)
        cd "$temp_dir"

        local download_success=false

        # Try to download
        if [ "$node_platform" = "win" ]; then
            if curl -fsSL "$node_url" -o node.zip 2>/dev/null; then
                unzip -q node.zip
                cp "${node_filename}/node.exe" "$bundle_dir/node.exe"
                # Cache for future builds
                mkdir -p "$cache_dir/${node_filename}"
                cp "${node_filename}/node.exe" "$cache_dir/${node_filename}/node.exe"
                download_success=true
            fi
        else
            if curl -fsSL "$node_url" | tar xz 2>/dev/null; then
                cp "${node_filename}/bin/node" "$bundle_dir/node"
                chmod +x "$bundle_dir/node"
                # Cache for future builds
                mkdir -p "$cache_dir/${node_filename}"
                cp "${node_filename}/bin/node" "$cache_dir/${node_filename}/node"
                download_success=true
            fi
        fi

        # Fallback to local node if download fails
        if [ "$download_success" != "true" ]; then
            log_warn "Failed to download Node.js, trying local node..."
            if command -v node &> /dev/null; then
                cp "$(which node)" "$bundle_dir/node${node_ext}"
                chmod +x "$bundle_dir/node${node_ext}" 2>/dev/null || true
            else
                log_error "Node.js not available"
                cd "$PROJECT_ROOT"
                rm -rf "$temp_dir"
                return 1
            fi
        else
            log_info "Node.js cached at $cache_dir/${node_filename}/"
        fi

        cd "$PROJECT_ROOT"
        rm -rf "$temp_dir"
    fi

    # Note: npm is NOT bundled - Live Preview requires system Node.js/npm
    # This keeps the bundle size smaller and avoids V8 compatibility issues
    # Users without Node.js will only have Static Preview available

    # Verify Node.js binary
    if [ ! -f "$bundle_dir/node${node_ext}" ]; then
        log_error "Node.js binary not found"
        return 1
    fi

    log_info "Node.js binary ready"

    # Install both CLI packages
    cd "$bundle_dir"
    echo '{"name":"cli-bundle","private":true,"type":"module"}' > package.json

    log_info "Installing @anthropic-ai/claude-code and @openai/codex..."
    npm install @anthropic-ai/claude-code @openai/codex --registry="${NPM_REGISTRY:-https://registry.npmmirror.com}" 2>&1 | tail -15

    # Verify installations
    local claude_cli_path=""
    if [ -f "node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs" ]; then
        claude_cli_path="@anthropic-ai/claude-code/cli-wrapper.cjs"
    elif [ -f "node_modules/@anthropic-ai/claude-code/cli.js" ]; then
        claude_cli_path="@anthropic-ai/claude-code/cli.js"
    fi

    if [ -z "$claude_cli_path" ]; then
        log_error "Claude Code installation failed"
        cd "$PROJECT_ROOT"
        return 1
    fi

    local codex_cli_path="@openai/codex/bin/codex.js"
    if [ ! -f "node_modules/$codex_cli_path" ]; then
        log_error "Codex installation failed"
        cd "$PROJECT_ROOT"
        return 1
    fi

    log_info "Both CLI packages installed successfully"

    # Clean up unused platform-specific vendor binaries
    # This reduces bundle size significantly (keeping only the target platform)
    log_info "Cleaning up unused platform binaries..."

    # Determine which platform dirs to keep for each package
    local codex_keep=""      # @openai/codex uses: aarch64-apple-darwin, x86_64-apple-darwin, etc.
    local claude_keep=""     # @anthropic-ai/claude-code uses: arm64-darwin, x64-darwin, etc.

    case "$target" in
        x86_64-unknown-linux-gnu)
            codex_keep="x86_64-unknown-linux-musl"
            claude_keep="x64-linux"
            ;;
        x86_64-pc-windows-msvc|x86_64-pc-windows-gnu)
            codex_keep="x86_64-pc-windows-msvc"
            claude_keep="x64-win32"
            ;;
        x86_64-apple-darwin)
            codex_keep="x86_64-apple-darwin"
            claude_keep="x64-darwin"
            ;;
        aarch64-apple-darwin)
            codex_keep="aarch64-apple-darwin"
            claude_keep="arm64-darwin"
            ;;
        current)
            local os_name=$(uname -s)
            local arch=$(uname -m)
            case "$os_name" in
                Darwin)
                    if [ "$arch" = "arm64" ]; then
                        codex_keep="aarch64-apple-darwin"
                        claude_keep="arm64-darwin"
                    else
                        codex_keep="x86_64-apple-darwin"
                        claude_keep="x64-darwin"
                    fi
                    ;;
                Linux)
                    codex_keep="x86_64-unknown-linux-musl"
                    claude_keep="x64-linux"
                    ;;
                *)
                    codex_keep="x86_64-unknown-linux-musl"
                    claude_keep="x64-linux"
                    ;;
            esac
            ;;
    esac

    # Clean @openai/codex vendor directory
    local codex_vendor="node_modules/@openai/codex/vendor"
    if [ -d "$codex_vendor" ] && [ -n "$codex_keep" ]; then
        log_info "Cleaning @openai/codex vendor (keeping $codex_keep)..."
        for dir in "$codex_vendor"/*; do
            local dirname=$(basename "$dir")
            if [ "$dirname" != "$codex_keep" ] && [ -d "$dir" ]; then
                rm -rf "$dir"
                log_info "  Removed codex/vendor/$dirname"
            fi
        done
    fi

    # Clean @anthropic-ai/claude-code vendor/ripgrep directory
    local claude_rg_vendor="node_modules/@anthropic-ai/claude-code/vendor/ripgrep"
    if [ -d "$claude_rg_vendor" ] && [ -n "$claude_keep" ]; then
        log_info "Cleaning @anthropic-ai/claude-code vendor/ripgrep (keeping $claude_keep)..."
        for item in "$claude_rg_vendor"/*; do
            local itemname=$(basename "$item")
            # Keep the target platform dir and any non-directory files (like COPYING)
            if [ -d "$item" ] && [ "$itemname" != "$claude_keep" ]; then
                rm -rf "$item"
                log_info "  Removed claude-code/vendor/ripgrep/$itemname"
            fi
        done
    fi

    log_info "Platform cleanup completed"

    # Copy .wasm files to bundle root (some may be needed at runtime)
    cp node_modules/@anthropic-ai/claude-code/*.wasm . 2>/dev/null || true

    # Remove quarantine attribute from all files in cli-bundle
    # This prevents SIGTRAP errors when running binaries on macOS
    # Must be done BEFORE signing, as quarantine can cause issues even with signed binaries
    if [ "$node_platform" = "darwin" ]; then
        log_info "Removing quarantine attributes from cli-bundle..."
        xattr -r -d com.apple.quarantine . 2>/dev/null || true
        # Also remove other extended attributes that might cause issues
        xattr -r -c . 2>/dev/null || true
        log_info "Quarantine attributes removed"
    fi

    # Sign all native modules and binaries for macOS notarization
    # Apple notarization requires:
    # 1. All binaries signed with Developer ID certificate
    # 2. Secure timestamp included
    # 3. Hardened runtime enabled
    # Node.js binary needs special entitlements for JIT compilation
    if [ "$node_platform" = "darwin" ] && [ "$SKIP_SIGNING" != "true" ]; then
        log_info "Signing all Mach-O binaries for macOS notarization..."

        # Get signing identity from environment or use default
        local signing_identity="${APPLE_SIGNING_IDENTITY:-Developer ID Application}"
        local entitlements_file="$PROJECT_ROOT/src-tauri/entitlements.plist"

        # Find and sign ALL Mach-O binary files (not just by extension)
        find . -type f | while read -r file; do
            if file "$file" 2>/dev/null | grep -q "Mach-O"; then
                local filename=$(basename "$file")
                log_info "  Signing: $file"
                # Node binary needs special entitlements for JIT
                if [ "$filename" = "node" ] || [ "$filename" = "node.exe" ]; then
                    codesign --force --timestamp --options runtime \
                        --entitlements "$entitlements_file" \
                        --sign "$signing_identity" "$file" 2>&1 || {
                        log_warn "  Failed to sign $file, trying with specific identity..."
                        local identity=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')
                        if [ -n "$identity" ]; then
                            codesign --force --timestamp --options runtime \
                                --entitlements "$entitlements_file" \
                                --sign "$identity" "$file"
                        fi
                    }
                else
                    codesign --force --timestamp --options runtime --sign "$signing_identity" "$file" 2>&1 || {
                        log_warn "  Failed to sign $file, trying with specific identity..."
                        local identity=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')
                        if [ -n "$identity" ]; then
                            codesign --force --timestamp --options runtime --sign "$identity" "$file"
                        fi
                    }
                fi
            fi
        done

        log_info "Native module signing completed"
    fi

    cd "$PROJECT_ROOT"

    # Create launcher scripts for both CLIs
    create_cli_launcher "$output_dir" "$node_platform" "claude" "$claude_cli_path" "$target"
    create_cli_launcher "$output_dir" "$node_platform" "codex" "$codex_cli_path" "$target"

    # Verify
    local bundle_size=$(du -sh "$bundle_dir" 2>/dev/null | cut -f1)
    log_info "CLI bundling completed for $target"
    log_info "Bundle size: $bundle_size (shared Node.js + both CLIs)"
}

# Helper function to create launcher scripts
create_cli_launcher() {
    local output_dir="$1"
    local node_platform="$2"
    local cli_name="$3"
    local cli_path="$4"
    local target="$5"

    local output_name="$cli_name"
    if [ "$node_platform" = "win" ]; then
        output_name="${cli_name}.cmd"
        # Windows batch launcher
        cat > "$output_dir/$output_name" << BATCH_EOF
@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "BUNDLE_DIR=%SCRIPT_DIR%cli-bundle"
if not exist "%BUNDLE_DIR%\\node.exe" set "BUNDLE_DIR=%SCRIPT_DIR%..\\Resources\\cli-bundle"
"%BUNDLE_DIR%\\node.exe" "%BUNDLE_DIR%\\node_modules\\${cli_path}" %*
BATCH_EOF
    else
        # Unix shell launcher - searches multiple locations for bundle
        cat > "$output_dir/$output_name" << SHELL_EOF
#!/bin/bash
SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"

# Search for cli-bundle in multiple locations
# 1. Same directory as launcher (development / Linux)
# 2. ../Resources/_up_/src-api/dist/cli-bundle (macOS app bundle - Tauri resources)
# 3. ../Resources/cli-bundle (legacy location)
for DIR in "\$SCRIPT_DIR/cli-bundle" "\$SCRIPT_DIR/../Resources/_up_/src-api/dist/cli-bundle" "\$SCRIPT_DIR/../Resources/cli-bundle"; do
    if [ -f "\$DIR/node" ] && [ -d "\$DIR/node_modules" ]; then
        BUNDLE_DIR="\$DIR"
        break
    fi
done

if [ -z "\$BUNDLE_DIR" ]; then
    echo "Error: cli-bundle not found" >&2
    echo "Searched in:" >&2
    echo "  - \$SCRIPT_DIR/cli-bundle" >&2
    echo "  - \$SCRIPT_DIR/../Resources/_up_/src-api/dist/cli-bundle" >&2
    exit 1
fi

exec "\$BUNDLE_DIR/node" "\$BUNDLE_DIR/node_modules/${cli_path}" "\$@"
SHELL_EOF
        chmod +x "$output_dir/$output_name"
    fi

    # Create target-specific launcher (Tauri adds target triple suffix to externalBin)
    local target_suffix=""
    case "$target" in
        x86_64-unknown-linux-gnu|x86_64-pc-windows-msvc|x86_64-pc-windows-gnu|x86_64-apple-darwin|aarch64-apple-darwin)
            target_suffix="-$target"
            ;;
        current)
            local os_name=$(uname -s)
            local arch=$(uname -m)
            case "$os_name" in
                Darwin)
                    target_suffix=$([ "$arch" = "arm64" ] && echo "-aarch64-apple-darwin" || echo "-x86_64-apple-darwin")
                    ;;
                Linux)
                    target_suffix="-x86_64-unknown-linux-gnu"
                    ;;
            esac
            ;;
    esac

    if [ -n "$target_suffix" ]; then
        local target_launcher="$output_dir/${cli_name}${target_suffix}"
        if [ "$node_platform" = "win" ]; then
            target_launcher="$output_dir/${cli_name}${target_suffix}.cmd"
        fi
        cp "$output_dir/$output_name" "$target_launcher"
        chmod +x "$target_launcher" 2>/dev/null || true
        log_info "Created launcher: $target_launcher"
    fi
}

# Update tauri.conf.json to include or remove CLI bundle sidecar
# Also adds native addon resources (sherpa-onnx, onnxruntime) if they exist
update_tauri_config() {
    local config_file="$PROJECT_ROOT/src-tauri/tauri.conf.json"
    local dist_dir="$PROJECT_ROOT/src-api/dist"

    if [ "$BUNDLE_CLI" = "true" ]; then
        log_info "Updating tauri.conf.json to include CLI bundle sidecar..."

        # Use node to properly update JSON config
        node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));

// Ensure arrays exist
if (!config.bundle.externalBin) {
    config.bundle.externalBin = [];
}
if (!Array.isArray(config.bundle.resources)) {
    config.bundle.resources = [];
}

// Add unified CLI bundle (both Claude and Codex share one Node.js)
// Add launcher scripts for both CLIs
if (!config.bundle.externalBin.includes('../src-api/dist/claude')) {
    config.bundle.externalBin.unshift('../src-api/dist/claude');
}
if (!config.bundle.externalBin.includes('../src-api/dist/codex')) {
    config.bundle.externalBin.unshift('../src-api/dist/codex');
}

// Add cli-bundle as resource (contains shared Node.js + both CLI packages)
const cliResource = '../src-api/dist/cli-bundle/**/*';
if (!config.bundle.resources.includes(cliResource)) {
    // Remove old separate bundle resources
    config.bundle.resources = config.bundle.resources.filter(r =>
        !r.includes('claude-bundle') && !r.includes('codex-bundle')
    );
    config.bundle.resources.push(cliResource);
}
console.log('Added unified CLI bundle config');

// Add native addon resources if directories exist (created by build.mjs)
const nativeResources = [
    { dir: '$dist_dir/sharp', pattern: '../src-api/dist/sharp/**/*' },
    { dir: '$dist_dir/sherpa-onnx', pattern: '../src-api/dist/sherpa-onnx/**/*' },
    { dir: '$dist_dir/onnxruntime', pattern: '../src-api/dist/onnxruntime/**/*' },
];
for (const { dir, pattern } of nativeResources) {
    if (fs.existsSync(dir) && !config.bundle.resources.includes(pattern)) {
        config.bundle.resources.push(pattern);
        console.log('Added native addon resource: ' + pattern);
    }
}

// Ensure bundled skills are included (shipped with the app)
const skillsPattern = '../skills/**/*';
if (!config.bundle.resources.includes(skillsPattern)) {
    config.bundle.resources.push(skillsPattern);
    console.log('Added bundled skills resource');
}

fs.writeFileSync('$config_file', JSON.stringify(config, null, 2));
console.log('Config updated successfully');
"
        log_info "Updated tauri.conf.json with unified CLI bundle configuration"
    else
        log_info "Removing CLI bundle config from tauri.conf.json (not using --with-cli)..."

        # Remove CLI-related config when not bundling
        node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));

// Remove claude and codex from externalBin
if (config.bundle.externalBin) {
    config.bundle.externalBin = config.bundle.externalBin.filter(bin =>
        !bin.includes('claude') && !bin.includes('codex')
    );
}

// Remove cli-bundle from resources
if (config.bundle.resources) {
    config.bundle.resources = config.bundle.resources.filter(r =>
        !r.includes('cli-bundle') && !r.includes('claude-bundle') && !r.includes('codex-bundle')
    );
}

// Add native addon resources if directories exist (created by build.mjs)
if (!Array.isArray(config.bundle.resources)) {
    config.bundle.resources = [];
}
const nativeResources = [
    { dir: '$dist_dir/sharp', pattern: '../src-api/dist/sharp/**/*' },
    { dir: '$dist_dir/sherpa-onnx', pattern: '../src-api/dist/sherpa-onnx/**/*' },
    { dir: '$dist_dir/onnxruntime', pattern: '../src-api/dist/onnxruntime/**/*' },
];
for (const { dir, pattern } of nativeResources) {
    if (fs.existsSync(dir) && !config.bundle.resources.includes(pattern)) {
        config.bundle.resources.push(pattern);
        console.log('Added native addon resource: ' + pattern);
    }
}

// Ensure bundled skills are included (shipped with the app)
const skillsPattern = '../skills/**/*';
if (!config.bundle.resources.includes(skillsPattern)) {
    config.bundle.resources.push(skillsPattern);
    console.log('Added bundled skills resource');
}

fs.writeFileSync('$config_file', JSON.stringify(config, null, 2));
console.log('Removed CLI bundle config');
"
        log_info "Removed CLI bundle config from tauri.conf.json"
    fi

    # Inject updater endpoint from branding.json/env so local signed builds use the
    # same R2 manifest that release publishing updates.
    local updater_url
    updater_url=$(node -e "const branding=require('./branding.json'); const base=(process.env.R2_PUBLIC_URL || 'https://cdn.neumar.app').replace(/\/$/, ''); console.log(branding.updater?.url || base + '/latest.json')")
    local config_file="$PROJECT_ROOT/src-tauri/tauri.conf.json"
    UPDATER_URL="$updater_url" CONFIG_FILE="$config_file" node -e "
const fs = require('fs');
const configFile = process.env.CONFIG_FILE;
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const updaterUrl = process.env.UPDATER_URL;
if (config.plugins && config.plugins.updater) {
    config.plugins.updater.endpoints = [updaterUrl];
    console.log('Updated updater endpoint: ' + updaterUrl);
}
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
"
}

# Update tauri.conf.json to disable signing
disable_signing_config() {
    if [ "$SKIP_SIGNING" != "true" ]; then
        return 0
    fi

    log_info "Disabling code signing in tauri.conf.json..."

    local config_file="$PROJECT_ROOT/src-tauri/tauri.conf.json"

    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));

// Remove macOS signing identity to disable signing
if (config.bundle && config.bundle.macOS) {
    delete config.bundle.macOS.signingIdentity;
}

// Remove Windows signCommand when signing is disabled (relic not available)
if (config.bundle && config.bundle.windows) {
    delete config.bundle.windows.signCommand;
}

fs.writeFileSync('$config_file', JSON.stringify(config, null, 2));
console.log('Signing disabled in config');
"
}

# Conditionally enable Windows signing if Azure env vars are set
configure_windows_signing() {
    local config_file="$PROJECT_ROOT/src-tauri/tauri.conf.json"

    if [ -z "$AZURE_CLIENT_ID" ] || [ -z "$AZURE_TENANT_ID" ] || [ -z "$AZURE_CLIENT_SECRET" ]; then
        log_info "Azure Key Vault credentials not set, disabling Windows code signing..."
        node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));
if (config.bundle && config.bundle.windows) {
    delete config.bundle.windows.signCommand;
}
fs.writeFileSync('$config_file', JSON.stringify(config, null, 2));
console.log('Windows signCommand removed (no Azure credentials)');
"
    else
        # Validate that relic.conf placeholders have been replaced
        if grep -q "VAULT_NAME\|CERT_NAME" "$PROJECT_ROOT/src-tauri/relic.conf"; then
            log_error "relic.conf still contains placeholder values. Update VAULT_NAME and CERT_NAME."
            exit 1
        fi
        log_info "Azure Key Vault credentials found, Windows signing enabled"
    fi
}

# Get version from tauri.conf.json
get_app_version() {
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$PROJECT_ROOT/src-tauri/tauri.conf.json', 'utf8'));
console.log(config.version || '0.0.0');
"
}

# Build for Linux (x86_64)
build_linux() {
    log_info "Building for Linux x86_64..."

    local target="x86_64-unknown-linux-gnu"
    local current_os=$(uname -s)

    # Check if we're on macOS trying to cross-compile for Linux
    if [ "$current_os" = "Darwin" ]; then
        log_error "Cross-compiling Linux Tauri apps from macOS is not supported."
        log_error "Tauri requires GTK libraries (pango, cairo, atk, etc.) which need a Linux sysroot."
        log_info ""
        log_info "Recommended solutions:"
        log_info "  1. Use GitHub Actions (already configured in .github/workflows/build.yml)"
        log_info "     - Push a tag: git tag v0.x.x && git push --tags"
        log_info "     - Or manually trigger the workflow from GitHub Actions page"
        log_info ""
        log_info "  2. Use Docker with a Linux image:"
        log_info "     docker run --rm -v \"\$(pwd)\":/app -w /app rust:latest bash -c \\"
        log_info "       'apt-get update && apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf nodejs npm && npm i -g pnpm && ./scripts/build.sh linux'"
        log_info ""
        log_info "  3. Build on a real Linux machine or VM"
        exit 1
    fi

    # Build API sidecar first
    build_api_sidecar "$target"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "$target"
    update_tauri_config

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    pnpm tauri build --target "$target"

    # Config restore removed - no longer needed

    log_info "Linux build completed!"
    log_info "Output: src-tauri/target/$target/release/bundle/"
}

# Build for Windows (x86_64)
build_windows() {
    log_info "Building for Windows x86_64..."

    local current_os=$(uname -s)
    local target=""

    # Determine target based on current platform
    if [ "$current_os" = "Darwin" ] || [ "$current_os" = "Linux" ]; then
        # Cross-compiling from macOS/Linux - use GNU toolchain
        target="x86_64-pc-windows-gnu"
        log_info "Cross-compiling from $current_os using GNU toolchain"

        # Check for MinGW
        if ! command -v x86_64-w64-mingw32-gcc &> /dev/null; then
            log_error "MinGW is required for cross-compilation to Windows"
            log_info "Install with: brew install mingw-w64 (macOS) or apt install mingw-w64 (Linux)"
            exit 1
        fi
    else
        # Building on Windows - use MSVC
        target="x86_64-pc-windows-msvc"
    fi

    # Build API sidecar first (pkg can cross-compile)
    build_api_sidecar "$target"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "$target"
    update_tauri_config

    # Configure Windows signing (removes signCommand if Azure creds unavailable)
    configure_windows_signing

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    # Set up linker for cross-compilation
    if [ "$target" = "x86_64-pc-windows-gnu" ]; then
        export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="x86_64-w64-mingw32-gcc"
        # Skip NSIS/MSI bundling when cross-compiling (requires network/Windows tools)
        log_info "Cross-compiling: skipping installer bundling (NSIS/MSI), generating exe only..."
        pnpm tauri build --target "$target" --no-bundle
    else
        pnpm tauri build --target "$target"
    fi

    log_info "Windows build completed!"
    if [ "$target" = "x86_64-pc-windows-gnu" ]; then
        log_info "Output: src-tauri/target/$target/release/${BRAND_SLUG}.exe"
        log_info "Note: MSI/NSIS installers require building on Windows"
    else
        log_info "Output: src-tauri/target/$target/release/bundle/"
    fi
}

# Build for macOS Intel (x86_64)
build_mac_intel() {
    log_info "Building for macOS Intel (x86_64)..."

    local target="x86_64-apple-darwin"

    # Build API sidecar first
    build_api_sidecar "$target"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "$target"
    update_tauri_config

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    # Temporarily hide Apple signing/notarization credentials from Tauri.
    # Tauri would notarize before native resource binaries (onnxruntime, sherpa-onnx)
    # are signed. We sign them in post_build_fixup, then notarize manually.
    export APPLE_SIGNING_IDENTITY="-"
    unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH
    pnpm tauri build --target "$target"
    # Restore credentials for manual signing/notarization
    export APPLE_SIGNING_IDENTITY="${_SAVED_APPLE_SIGNING_IDENTITY:-}"
    export APPLE_ID="${_SAVED_APPLE_ID:-}" APPLE_PASSWORD="${_SAVED_APPLE_PASSWORD:-}" APPLE_TEAM_ID="${_SAVED_APPLE_TEAM_ID:-}"
    export APPLE_API_KEY="${_SAVED_APPLE_API_KEY:-}" APPLE_API_ISSUER="${_SAVED_APPLE_API_ISSUER:-}" APPLE_API_KEY_PATH="${_SAVED_APPLE_API_KEY_PATH:-}"

    # Strip quarantine + sign native resources and cli-bundle (after Tauri build)
    post_build_fixup "$target"

    # Notarize the app (after all binaries are signed)
    notarize_app "$target"

    # Recreate updater archive after manual signing/notarization.
    recreate_updater_bundle "$target"

    # Recreate DMG after signing/notarization
    recreate_dmg "$target"

    log_info "macOS Intel build completed!"
    log_info "Output: src-tauri/target/$target/release/bundle/"
}

# Sign cli-bundle in Resources and re-sign app bundle (unified bundle with both Claude and Codex)
# Note: Tauri copies cli-bundle to Contents/Resources/_up_/src-api/dist/cli-bundle via resources config
# We do NOT copy to Contents/MacOS as that causes signing failures due to symlinks in node_modules/.bin
# Post-build fixup: strip quarantine attributes (always) and sign cli-bundle (if signing enabled)
post_build_fixup() {
    local target="$1"

    local app_bundle=""
    case "$target" in
        aarch64-apple-darwin|x86_64-apple-darwin)
            app_bundle="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/${BRAND_DISPLAY_NAME}.app"
            ;;
        current)
            local arch=$(uname -m)
            if [ "$arch" = "arm64" ]; then
                app_bundle="$PROJECT_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/${BRAND_DISPLAY_NAME}.app"
            else
                app_bundle="$PROJECT_ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/${BRAND_DISPLAY_NAME}.app"
            fi
            ;;
        *)
            log_warn "Platform $target may not need signing"
            return 0
            ;;
    esac

    if [ ! -d "$app_bundle" ]; then
        log_warn "App bundle not found at $app_bundle"
        return 0
    fi

    # Always strip quarantine from the entire app bundle (covers sidecar binary)
    # This prevents macOS from blocking execution of the pkg-compiled API binary
    log_info "  Removing quarantine attributes from app bundle..."
    xattr -r -d com.apple.quarantine "$app_bundle" 2>/dev/null || true

    # Handle cli-bundle quarantine stripping (always, regardless of signing)
    local cli_bundle_path="$app_bundle/Contents/Resources/_up_/src-api/dist/cli-bundle"
    if [ "$BUNDLE_CLI" = "true" ]; then
        # Find cli-bundle in Resources (Tauri copies to _up_/src-api/dist/cli-bundle)
        if [ -d "$cli_bundle_path" ]; then
            log_info "  Found cli-bundle at: $cli_bundle_path"

            # Always remove quarantine and extended attributes regardless of signing
            # This prevents SIGTRAP errors and macOS blocking sidecar execution
            log_info "  Removing quarantine attributes..."
            xattr -r -d com.apple.quarantine "$cli_bundle_path" 2>/dev/null || true
            xattr -r -c "$cli_bundle_path" 2>/dev/null || true

            # Remove symlinks in .bin directory that cause signing failures
            local bin_dir="$cli_bundle_path/node_modules/.bin"
            if [ -d "$bin_dir" ]; then
                log_info "  Removing .bin symlinks that cause signing issues..."
                rm -rf "$bin_dir"
            fi
        else
            log_warn "  cli-bundle not found at expected location: $cli_bundle_path"
        fi
    fi

    if [ "$SKIP_SIGNING" = "true" ]; then
        log_info "Skipping binary signing (signing disabled, quarantine stripped)"
        return 0
    fi

    local signing_identity="${APPLE_SIGNING_IDENTITY:-Developer ID Application}"
    local entitlements="$PROJECT_ROOT/src-tauri/entitlements.plist"

    # Sign the API sidecar binary (pkg-compiled, placed in Contents/MacOS by Tauri)
    # Tauri may include either the exact binary name or a target-suffixed variant.
    local macos_dir="$app_bundle/Contents/MacOS"
    for sidecar in "$macos_dir"/${BRAND_BINARY_NAME} "$macos_dir"/${BRAND_BINARY_NAME}-*; do
        [ -e "$sidecar" ] || continue
        if [ -f "$sidecar" ] && file "$sidecar" 2>/dev/null | grep -q "Mach-O"; then
            log_info "  Signing API sidecar: $(basename "$sidecar")"
            codesign --force --timestamp --options runtime \
                --entitlements "$entitlements" \
                --sign "$signing_identity" "$sidecar" || {
                log_error "Failed to sign API sidecar: $sidecar"
                return 1
            }
        fi
    done

    # Sign cli-bundle Mach-O binaries (only when bundled with CLI)
    if [ "$BUNDLE_CLI" = "true" ] && [ -d "$cli_bundle_path" ]; then
        log_info "Signing cli-bundle in app bundle Resources..."
        # Sign all Mach-O binaries in cli-bundle with entitlements
        # Node.js requires JIT and unsigned memory entitlements to run properly
        log_info "  Signing cli-bundle Mach-O binaries with entitlements..."
        local cli_sign_failed=false
        while read -r file; do
            if file "$file" 2>/dev/null | grep -q "Mach-O"; then
                local filename=$(basename "$file")
                log_info "    Signing: $filename"
                # Node binary needs special entitlements for JIT
                if [ "$filename" = "node" ] || [ "$filename" = "node.exe" ]; then
                    if ! codesign --force --timestamp --options runtime \
                        --entitlements "$entitlements" \
                        --sign "$signing_identity" "$file"; then
                        log_warn "    Failed to sign: $filename"
                        cli_sign_failed=true
                    fi
                else
                    if ! codesign --force --timestamp --options runtime \
                        --sign "$signing_identity" "$file"; then
                        log_warn "    Failed to sign: $filename"
                        cli_sign_failed=true
                    fi
                fi
            fi
        done < <(find "$cli_bundle_path" -type f)
        if [ "$cli_sign_failed" = "true" ]; then
            log_error "One or more cli-bundle binaries failed to sign"
            return 1
        fi
    fi

    # Sign native binaries in Resources
    # These must be individually signed before the outer bundle is sealed for notarization.
    # Runs for all macOS builds (--sign or --with-cli --sign), not just BUNDLE_CLI builds.
    local resources_dir="$app_bundle/Contents/Resources/_up_/src-api/dist"
    for native_dir in "$resources_dir/sharp" "$resources_dir/onnxruntime" "$resources_dir/sherpa-onnx"; do
        if [ -d "$native_dir" ]; then
            local dir_name=$(basename "$native_dir")
            log_info "  Signing $dir_name native binaries..."
            local sign_failed=false
            while read -r file; do
                if file "$file" 2>/dev/null | grep -q "Mach-O"; then
                    local filename=$(basename "$file")
                    log_info "    Signing: $filename"
                    if ! codesign --force --timestamp --options runtime \
                        --sign "$signing_identity" "$file"; then
                        log_warn "    Failed to sign: $filename"
                        sign_failed=true
                    fi
                fi
            done < <(find "$native_dir" -type f)
            if [ "$sign_failed" = "true" ]; then
                log_error "One or more $dir_name binaries failed to sign"
                return 1
            fi
        fi
    done

    # Re-sign the entire app bundle with entitlements
    log_info "  Re-signing entire app bundle..."
    codesign --force --deep --timestamp --options runtime \
        --entitlements "$entitlements" \
        --sign "$signing_identity" "$app_bundle" || {
        log_error "Failed to re-sign app bundle"
        return 1
    }

    # Verify signature
    if codesign --verify --deep --strict "$app_bundle" 2>&1; then
        log_info "App bundle signature verified successfully"
    else
        log_error "App bundle signature verification failed"
        return 1
    fi
}

# Submit a file for notarization. Tries API key first, then Apple ID, then keychain profile.
submit_notarization() {
    local file="$1"
    local label="$2"  # "app" or "DMG" for log messages

    if [ -n "$APPLE_API_KEY" ] && [ -n "$APPLE_API_ISSUER" ] && [ -n "$APPLE_API_KEY_PATH" ]; then
        log_info "Submitting $label to Apple notary service via API key..."
        xcrun notarytool submit "$file" \
            --key "$APPLE_API_KEY_PATH" \
            --key-id "$APPLE_API_KEY" \
            --issuer "$APPLE_API_ISSUER" \
            --wait 2>&1
    elif [ -n "$APPLE_ID" ] && [ -n "$APPLE_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
        log_info "Submitting $label to Apple notary service via Apple ID..."
        xcrun notarytool submit "$file" \
            --apple-id "$APPLE_ID" \
            --password "$APPLE_PASSWORD" \
            --team-id "$APPLE_TEAM_ID" \
            --wait 2>&1
    else
        log_info "Submitting $label to Apple notary service using keychain profile..."
        xcrun notarytool submit "$file" \
            --keychain-profile "notarytool-profile" \
            --wait 2>&1
    fi
}

notarization_submission_id() {
    awk '/^[[:space:]]*id: / { print $2; exit }'
}

print_notarization_log() {
    local submission_id="$1"
    local label="$2"

    if [ -z "$submission_id" ]; then
        return 0
    fi

    log_info "Fetching $label notarization log for submission $submission_id..."

    if [ -n "$APPLE_API_KEY" ] && [ -n "$APPLE_API_ISSUER" ] && [ -n "$APPLE_API_KEY_PATH" ]; then
        xcrun notarytool log "$submission_id" \
            --key "$APPLE_API_KEY_PATH" \
            --key-id "$APPLE_API_KEY" \
            --issuer "$APPLE_API_ISSUER" 2>&1 || true
    elif [ -n "$APPLE_ID" ] && [ -n "$APPLE_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
        xcrun notarytool log "$submission_id" \
            --apple-id "$APPLE_ID" \
            --password "$APPLE_PASSWORD" \
            --team-id "$APPLE_TEAM_ID" 2>&1 || true
    else
        xcrun notarytool log "$submission_id" \
            --keychain-profile "notarytool-profile" 2>&1 || true
    fi
}

verify_macos_app_signature() {
    local app_path="$1"

    log_info "Verifying app signature: $app_path"
    codesign --verify --deep --strict --verbose=4 "$app_path"
}

verify_dmg_app_signature() {
    local dmg_path="$1"
    local mount_dir
    mount_dir=$(mktemp -d)

    log_info "Verifying app signature inside DMG..."

    if ! hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$dmg_path" >/dev/null; then
        rm -rf "$mount_dir"
        log_error "Failed to mount DMG for signature verification"
        return 1
    fi

    local app_in_dmg="$mount_dir/${BRAND_DISPLAY_NAME}.app"
    if [ ! -d "$app_in_dmg" ]; then
        hdiutil detach "$mount_dir" -quiet || true
        rm -rf "$mount_dir"
        log_error "App bundle not found inside DMG at $app_in_dmg"
        return 1
    fi

    local verify_status=0
    verify_macos_app_signature "$app_in_dmg" || verify_status=$?

    hdiutil detach "$mount_dir" -quiet || true
    rm -rf "$mount_dir"

    return "$verify_status"
}

# Notarize the app bundle (after all signing is complete)
notarize_app() {
    local target="$1"

    if [ "$SKIP_SIGNING" = "true" ]; then
        return 0
    fi

    log_info "Notarizing app bundle..."

    local app_path=""
    case "$target" in
        aarch64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/${BRAND_DISPLAY_NAME}.app"
            ;;
        x86_64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/${BRAND_DISPLAY_NAME}.app"
            ;;
        current)
            local arch=$(uname -m)
            if [ "$arch" = "arm64" ]; then
                app_path="$PROJECT_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/${BRAND_DISPLAY_NAME}.app"
            else
                app_path="$PROJECT_ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/${BRAND_DISPLAY_NAME}.app"
            fi
            ;;
        *)
            return 0
            ;;
    esac

    if [ ! -d "$app_path" ]; then
        log_error "App bundle not found at $app_path"
        return 1
    fi

    # Create a zip for notarization
    local temp_zip=$(mktemp).zip
    log_info "Creating zip for notarization..."
    ditto -c -k --keepParent "$app_path" "$temp_zip"

    # Submit for notarization
    local notarize_output
    notarize_output=$(submit_notarization "$temp_zip" "app") || {
        log_error "App notarization submission failed. Check credentials (API key or Apple ID)."
        echo "$notarize_output"
        rm -f "$temp_zip"
        return 1
    }

    rm -f "$temp_zip"

    if echo "$notarize_output" | grep -q "status: Accepted"; then
        log_info "App notarization successful!"

        # Staple the notarization ticket to the app
        log_info "Stapling notarization ticket to app..."
        xcrun stapler staple "$app_path" || {
            log_error "Failed to staple app notarization ticket"
            return 1
        }
    else
        log_error "App notarization failed:"
        echo "$notarize_output"
        print_notarization_log "$(echo "$notarize_output" | notarization_submission_id)" "app"
        return 1
    fi
}

# Recreate and sign updater archive after modifying/notarizing app bundle.
recreate_updater_bundle() {
    local target="$1"

    # Tauri creates the updater archive before post_build_fixup/notarize_app.
    # Recreate it so shell-launcher code signatures and stapled tickets survive.
    if [ "$BUNDLE_CLI" != "true" ] && [ "$SKIP_SIGNING" = "true" ]; then
        return 0
    fi

    if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
        log_warn "Skipping updater archive recreation; TAURI_SIGNING_PRIVATE_KEY is not set"
        return 0
    fi

    local app_path=""
    case "$target" in
        aarch64-apple-darwin|x86_64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/${BRAND_DISPLAY_NAME}.app"
            ;;
        current)
            local arch=$(uname -m)
            if [ "$arch" = "arm64" ]; then
                app_path="$PROJECT_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/${BRAND_DISPLAY_NAME}.app"
            else
                app_path="$PROJECT_ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/${BRAND_DISPLAY_NAME}.app"
            fi
            ;;
        *)
            return 0
            ;;
    esac

    if [ ! -d "$app_path" ]; then
        log_error "App bundle not found at $app_path"
        return 1
    fi

    local bundle_dir
    bundle_dir="$(dirname "$app_path")"
    local archive="$bundle_dir/${BRAND_DISPLAY_NAME}.app.tar.gz"

    log_info "Recreating updater archive with signed app bundle..."
    rm -f "$archive" "$archive.sig"
    (
        cd "$bundle_dir"
        # macOS bsdtar writes extended attributes as AppleDouble `._*` entries
        # unless COPYFILE_DISABLE is set. Tauri's updater uses the Rust tar
        # reader directly, so those hidden metadata entries become real files
        # and can break update extraction.
        COPYFILE_DISABLE=1 tar --exclude '._*' --exclude '.DS_Store' -czf "$(basename "$archive")" "${BRAND_DISPLAY_NAME}.app"
    )

    pnpm tauri signer sign "$archive" >/dev/null

    if [ ! -f "$archive.sig" ]; then
        log_error "Updater archive signature was not created: $archive.sig"
        return 1
    fi

    local archive_size
    archive_size=$(du -h "$archive" | cut -f1)
    log_info "Updater archive ready: $archive ($archive_size)"
}

# Recreate DMG after modifying app bundle
recreate_dmg() {
    local target="$1"

    # Recreate DMG when we've modified the app after Tauri's initial build:
    # - --sign: native resources were signed after Tauri created the DMG
    # - --with-cli: cli-bundle was added after Tauri created the DMG
    if [ "$BUNDLE_CLI" != "true" ] && [ "$SKIP_SIGNING" = "true" ]; then
        return 0
    fi

    log_info "Recreating DMG with signed/updated app bundle..."

    local app_path=""
    local dmg_dir=""
    local dmg_name=""
    local version=$(get_app_version)

    # Derive DMG-safe name (remove spaces and hyphens for filename)
    local dmg_prefix="${BRAND_SLUG//-/}"

    case "$target" in
        aarch64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/${BRAND_DISPLAY_NAME}.app"
            dmg_dir="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/dmg"
            dmg_name="${dmg_prefix}_${version}_aarch64.dmg"
            ;;
        x86_64-apple-darwin)
            app_path="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/macos/${BRAND_DISPLAY_NAME}.app"
            dmg_dir="$PROJECT_ROOT/src-tauri/target/$target/release/bundle/dmg"
            dmg_name="${dmg_prefix}_${version}_x64.dmg"
            ;;
        *)
            log_warn "DMG recreation not needed for $target"
            return 0
            ;;
    esac

    if [ ! -d "$app_path" ]; then
        log_error "App bundle not found at $app_path"
        return 1
    fi

    if [ "$SKIP_SIGNING" != "true" ]; then
        verify_macos_app_signature "$app_path"
    fi

    # Remove old DMG and create new one
    rm -f "$dmg_dir"/*.dmg
    mkdir -p "$dmg_dir"

    local dmg_output="$dmg_dir/$dmg_name"
    local staging_dir
    staging_dir=$(mktemp -d)

    log_info "Creating DMG with signed app bundle..."
    ditto --rsrc --extattr --noqtn "$app_path" "$staging_dir/${BRAND_DISPLAY_NAME}.app"
    ln -s /Applications "$staging_dir/Applications"

    if [ "$SKIP_SIGNING" != "true" ]; then
        verify_macos_app_signature "$staging_dir/${BRAND_DISPLAY_NAME}.app"
    fi

    # APFS preserves Unicode filenames exactly; HFS+ normalizes them and can
    # break sealed code-signature resource paths inside the app bundle.
    # UDZO (zlib) is Tauri's default — most universally compatible across
    # macOS versions. UDBZ (bzip2) saves ~5% but has shown intermittent
    # "can't be opened" failures on some user systems; opt in via env if
    # needed. See dev-doc/plan/2026-05-05-package-size-optimization.md CP5a.
    local dmg_format="${NEUMAR_DMG_FORMAT:-UDZO}"
    hdiutil create -volname "${BRAND_DISPLAY_NAME}" -srcfolder "$staging_dir" -ov -format "$dmg_format" -fs APFS "$dmg_output"
    rm -rf "$staging_dir"

    if [ -f "$dmg_output" ]; then
        local dmg_size=$(du -h "$dmg_output" | cut -f1)
        log_info "DMG created: $dmg_output ($dmg_size)"

        if [ "$SKIP_SIGNING" != "true" ]; then
            verify_dmg_app_signature "$dmg_output"
        fi

        # Sign, notarize and staple the DMG if signing is enabled
        if [ "$SKIP_SIGNING" != "true" ]; then
            local signing_identity="${APPLE_SIGNING_IDENTITY:-Developer ID Application}"

            # Sign the DMG
            log_info "Signing DMG..."
            codesign --force --timestamp --sign "$signing_identity" "$dmg_output"

            # Notarize the DMG
            log_info "Notarizing DMG (this may take a few minutes)..."
            local notarize_output
            notarize_output=$(submit_notarization "$dmg_output" "DMG") || {
                log_error "DMG notarization submission failed."
                echo "$notarize_output"
                return 1
            }

            if echo "$notarize_output" | grep -q "status: Accepted"; then
                log_info "DMG notarization successful"

                # Staple the notarization ticket
                log_info "Stapling notarization ticket to DMG..."
                xcrun stapler staple "$dmg_output" || {
                    log_error "Failed to staple DMG notarization ticket"
                    return 1
                }
            else
                log_error "DMG notarization failed:"
                echo "$notarize_output"
                print_notarization_log "$(echo "$notarize_output" | notarization_submission_id)" "DMG"
                return 1
            fi
        fi

        log_info "DMG ready: $dmg_output"
    else
        log_error "Failed to recreate DMG"
        return 1
    fi
}

# Build for macOS Apple Silicon (aarch64)
build_mac_arm() {
    log_info "Building for macOS Apple Silicon (aarch64)..."

    local target="aarch64-apple-darwin"

    # Build API sidecar first
    build_api_sidecar "$target"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "$target"
    update_tauri_config

    # Add target if not exists
    rustup target add "$target" 2>/dev/null || true

    # Temporarily hide Apple signing/notarization credentials from Tauri.
    # Tauri would notarize before native resource binaries (onnxruntime, sherpa-onnx)
    # are signed. We sign them in post_build_fixup, then notarize manually.
    export APPLE_SIGNING_IDENTITY="-"
    unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH
    pnpm tauri build --target "$target"
    # Restore credentials for manual signing/notarization
    export APPLE_SIGNING_IDENTITY="${_SAVED_APPLE_SIGNING_IDENTITY:-}"
    export APPLE_ID="${_SAVED_APPLE_ID:-}" APPLE_PASSWORD="${_SAVED_APPLE_PASSWORD:-}" APPLE_TEAM_ID="${_SAVED_APPLE_TEAM_ID:-}"
    export APPLE_API_KEY="${_SAVED_APPLE_API_KEY:-}" APPLE_API_ISSUER="${_SAVED_APPLE_API_ISSUER:-}" APPLE_API_KEY_PATH="${_SAVED_APPLE_API_KEY_PATH:-}"

    # Strip quarantine + sign native resources and cli-bundle (after Tauri build)
    post_build_fixup "$target"

    # Notarize the app (after all binaries are signed)
    notarize_app "$target"

    # Recreate updater archive after manual signing/notarization.
    recreate_updater_bundle "$target"

    # Recreate DMG after signing/notarization
    recreate_dmg "$target"

    log_info "macOS Apple Silicon build completed!"
    log_info "Output: src-tauri/target/$target/release/bundle/"
}

# Build for current platform
build_current() {
    log_info "Building for current platform..."

    # Build API sidecar first
    build_api_sidecar "current"

    # Bundle CLI tools if requested (unified bundle with both Claude and Codex)
    bundle_cli_tools "current"
    update_tauri_config

    # Temporarily hide Apple signing/notarization credentials from Tauri.
    # Tauri would notarize before native resource binaries are signed.
    export APPLE_SIGNING_IDENTITY="-"
    unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH
    pnpm tauri build
    # Restore credentials for manual signing/notarization
    export APPLE_SIGNING_IDENTITY="${_SAVED_APPLE_SIGNING_IDENTITY:-}"
    export APPLE_ID="${_SAVED_APPLE_ID:-}" APPLE_PASSWORD="${_SAVED_APPLE_PASSWORD:-}" APPLE_TEAM_ID="${_SAVED_APPLE_TEAM_ID:-}"
    export APPLE_API_KEY="${_SAVED_APPLE_API_KEY:-}" APPLE_API_ISSUER="${_SAVED_APPLE_API_ISSUER:-}" APPLE_API_KEY_PATH="${_SAVED_APPLE_API_KEY_PATH:-}"

    # Strip quarantine + sign native resources and cli-bundle
    post_build_fixup "current"

    # Notarize the app (after all binaries are signed)
    notarize_app "current"

    # Recreate updater archive after manual signing/notarization.
    recreate_updater_bundle "current"

    # Recreate DMG after signing/notarization
    recreate_dmg "current"

    log_info "Build completed!"
    log_info "Output: src-tauri/target/release/bundle/"
}


# Show help
show_help() {
    echo "${BRAND_DISPLAY_NAME} Build Script"
    echo ""
    echo "Usage: ./scripts/build.sh [platform] [options]"
    echo ""
    echo "Platforms:"
    echo "  linux       - Build for Linux x86_64"
    echo "  windows     - Build for Windows x86_64 (cross-compile from macOS/Linux supported)"
    echo "  mac-intel   - Build for macOS Intel (x86_64) ~30MB"
    echo "  mac-arm     - Build for macOS Apple Silicon (aarch64) ~27MB"
    echo "  current     - Build for current platform (default)"
    echo "  all         - Build for all platforms (requires cross-compilation setup)"
    echo ""
    echo "Options:"
    echo "  --with-cli      Bundle CLI tools (Claude Code + Codex) with shared Node.js"
    echo "                  This creates a unified bundle (~100MB) containing:"
    echo "                  - One Node.js binary (shared)"
    echo "                  - @anthropic-ai/claude-code"
    echo "                  - @openai/codex"
    echo "                  Allows out-of-box Claude Code and Codex sandbox support"
    echo "  --sign          Enable code signing and notarization (macOS)"
    echo "                  Default: signing is DISABLED for faster builds"
    echo "  --no-sign       Explicitly disable signing (default behavior)"
    echo ""
    echo "Requirements:"
    echo "  - pnpm"
    echo "  - Node.js (for API sidecar)"
    echo "  - Rust (cargo, rustup)"
    echo "  - MinGW (for Windows cross-compilation from macOS/Linux)"
    echo "    macOS: brew install mingw-w64"
    echo "    Linux: apt install mingw-w64"
    echo ""
    echo "Examples:"
    echo "  ./scripts/build.sh                     # Build for current platform (no signing)"
    echo "  ./scripts/build.sh mac-arm             # Build for Apple Silicon (fast, no signing)"
    echo "  ./scripts/build.sh mac-arm --with-cli  # Build with bundled CLI tools"
    echo "  ./scripts/build.sh mac-arm --sign      # Build with signing and notarization"
    echo "  ./scripts/build.sh mac-arm --with-cli --sign  # Full release build"
    echo "  ./scripts/build.sh windows             # Cross-compile for Windows from macOS"
    echo "  ./scripts/build.sh windows --with-cli  # Windows with bundled CLI tools"
    echo ""
    echo "Note: Cross-compilation requires proper toolchain setup."
    echo "      For CI/CD builds, use GitHub Actions workflow instead."
    echo ""
    echo "CLI bundling (--with-cli):"
    echo "  Creates a unified cli-bundle with one shared Node.js binary and both CLIs:"
    echo "  - Claude Code CLI: for AI-assisted coding"
    echo "  - Codex CLI: for sandbox execution (macOS/Linux)"
    echo "  This saves ~80MB compared to bundling each CLI separately."
}

# Parse arguments and set global variables
# Sets: BUNDLE_CLI, BUILD_PLATFORM, SKIP_SIGNING
parse_args() {
    BUILD_PLATFORM="current"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --with-cli)
                BUNDLE_CLI=true
                shift
                ;;
            # Keep legacy flags for backwards compatibility
            --with-claude|--with-codex)
                BUNDLE_CLI=true
                log_warn "Note: --with-claude and --with-codex are deprecated. Use --with-cli instead (bundles both)."
                shift
                ;;
            --sign)
                SKIP_SIGNING=false
                shift
                ;;
            --no-sign)
                SKIP_SIGNING=true
                shift
                ;;
            -h|--help|help)
                show_help
                exit 0
                ;;
            linux|windows|mac-intel|mac-arm|current|all)
                BUILD_PLATFORM="$1"
                shift
                ;;
            *)
                log_error "Unknown argument: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# Main
main() {
    # Parse arguments first (sets BUILD_PLATFORM, BUNDLE_CLI, SKIP_SIGNING)
    parse_args "$@"

    if [ "$BUNDLE_CLI" = "true" ]; then
        log_info "CLI bundling enabled (Claude Code + Codex with shared Node.js)"
    fi

    # Back up tauri.conf.json before any modifications.
    # Build steps (disable_signing_config, update_tauri_config) modify it in place;
    # the trap restores it on exit so dev mode keeps a clean config.
    local tauri_conf="$PROJECT_ROOT/src-tauri/tauri.conf.json"
    local tauri_conf_bak="$tauri_conf.build-backup"
    cp "$tauri_conf" "$tauri_conf_bak"
    trap "if [ -f \"${tauri_conf_bak}\" ]; then mv \"${tauri_conf_bak}\" \"${tauri_conf}\"; fi" EXIT

    if [ "$SKIP_SIGNING" = "true" ]; then
        log_info "Code signing disabled (use --sign to enable)"
        # Use ad-hoc signing (no certificate required, faster)
        export APPLE_SIGNING_IDENTITY="-"
        # Unset all Apple credentials to prevent Tauri from signing/notarizing
        unset APPLE_CERTIFICATE
        unset APPLE_CERTIFICATE_PASSWORD
        unset APPLE_ID
        unset APPLE_PASSWORD
        unset APPLE_TEAM_ID
        unset APPLE_API_KEY
        unset APPLE_API_ISSUER
        unset APPLE_API_KEY_PATH
        # Also modify config file to remove signing identity
        disable_signing_config
    else
        log_info "Code signing enabled"
        # Save Apple notarization credentials — we need to temporarily hide them
        # from Tauri (which would notarize before native resources are signed)
        # and restore them for our manual notarize_app step afterward.
        _SAVED_APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-Developer ID Application}"
        _SAVED_APPLE_ID="${APPLE_ID:-}"
        _SAVED_APPLE_PASSWORD="${APPLE_PASSWORD:-}"
        _SAVED_APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"
        _SAVED_APPLE_API_KEY="${APPLE_API_KEY:-}"
        _SAVED_APPLE_API_ISSUER="${APPLE_API_ISSUER:-}"
        _SAVED_APPLE_API_KEY_PATH="${APPLE_API_KEY_PATH:-}"
    fi

    # Disable updater artifact signing when TAURI_SIGNING_PRIVATE_KEY is not set.
    # This key is a CI-only secret; without it Tauri fails trying to sign the .tar.gz updater bundle.
    if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
        log_info "TAURI_SIGNING_PRIVATE_KEY not set, disabling updater artifacts"
        node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$tauri_conf', 'utf8'));
config.bundle.createUpdaterArtifacts = false;
fs.writeFileSync('$tauri_conf', JSON.stringify(config, null, 2));
"
    else
        # Validate that the updater pubkey has been configured
        local pubkey
        pubkey=$(node -p "require('$tauri_conf').plugins?.updater?.pubkey || ''")
        if [ -z "$pubkey" ] || [ "$pubkey" = "REPLACE_WITH_PUBLIC_KEY" ]; then
            log_error "TAURI_SIGNING_PRIVATE_KEY is set but updater pubkey is missing in tauri.conf.json."
            log_error "Generate a keypair with: npx tauri signer generate -w ~/.tauri/update-key.key"
            log_error "Then set the public key in plugins.updater.pubkey."
            exit 1
        fi
        log_info "TAURI_SIGNING_PRIVATE_KEY set, enabling updater artifacts"
        node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$tauri_conf', 'utf8'));
config.bundle.createUpdaterArtifacts = true;
fs.writeFileSync('$tauri_conf', JSON.stringify(config, null, 2));
"
    fi

    local platform="$BUILD_PLATFORM"

    check_requirements
    install_deps

    case "$platform" in
        linux)
            build_linux
            ;;
        windows)
            build_windows
            ;;
        mac-intel)
            build_mac_intel
            ;;
        mac-arm)
            build_mac_arm
            ;;
        current)
            build_current
            ;;
        all)
            log_warn "Building for all platforms requires cross-compilation setup."
            log_warn "Consider using GitHub Actions for cross-platform builds."
            build_linux
            build_windows
            build_mac_intel
            build_mac_arm
            ;;
    esac

    # Summary
    if [ "$BUNDLE_CLI" = "true" ]; then
        log_info "Build completed with bundled CLI tools (Claude Code + Codex)"
    else
        log_info "Build completed (no CLI tools bundled)"
    fi
}

main "$@"
