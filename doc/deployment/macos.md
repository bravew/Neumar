---
summary: "Step-by-step macOS deployment guide — from a clean Mac Mini (Apple Silicon) to a running production application with launchd service"
read_when:
  - Deploying the application on a new Mac
  - Setting up a headless Mac Mini server
  - Building for macOS production
  - Configuring launchd background services
title: "macOS Deployment Guide"
---

# macOS Deployment Guide

> Deploy the application on a **brand-new Mac Mini** (Apple Silicon) running **macOS 26 (Tahoe)** from a completely clean state — nothing installed yet.
>
> **Branding:** Product name, paths, and identifiers are configured in [`/branding.json`](../../branding.json).
> Placeholders like `<slug>`, `<displayName>`, `<identifier>`, and `<binaryName>` refer to fields in that file.
> Run `pnpm brand:sync` after editing branding values.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites & System Requirements](#2-prerequisites--system-requirements)
3. [Phase 1 — macOS Initial Setup](#3-phase-1--macos-initial-setup)
4. [Phase 2 — Install Developer Toolchain](#4-phase-2--install-developer-toolchain)
5. [Phase 3 — Clone & Install the Project](#5-phase-3--clone--install-the-project)
6. [Phase 4 — Configure the Application](#6-phase-4--configure-the-application)
7. [Phase 5 — Development Mode](#7-phase-5--development-mode)
8. [Phase 6 — Production Build](#8-phase-6--production-build)
9. [Phase 7 — Run as a Background Service (launchd)](#9-phase-7--run-as-a-background-service-launchd)
10. [Phase 8 — Networking & Firewall](#10-phase-8--networking--firewall)
11. [Maintenance & Updates](#11-maintenance--updates)
12. [Troubleshooting](#12-troubleshooting)
13. [Quick Reference Card](#13-quick-reference-card)

---

## 1. Overview

This is a three-layer desktop AI agent application:

| Layer          | Technology                          | Purpose                        |
| -------------- | ----------------------------------- | ------------------------------ |
| **Frontend**   | React 19 + Vite 7 + Tailwind CSS 4 | Desktop UI (Tauri webview)     |
| **Backend API** | Node.js + Hono 4 + Claude Agent SDK | AI agent orchestration         |
| **Desktop Shell** | Tauri 2 + Rust + SQLite          | Native wrapper & sidecar mgmt  |

**Deployment target:** Mac Mini with Apple Silicon (M-series) running macOS 26 Tahoe.

---

## 2. Prerequisites & System Requirements

### Hardware

- Mac Mini with Apple Silicon (M1/M2/M3/M4)
- Minimum 16 GB RAM (recommended: 32 GB for comfortable builds)
- Minimum 50 GB free disk space (Xcode ~12 GB, Rust ~2 GB, node_modules ~1 GB, native addons ~70 MB, builds ~5 GB)

### Software (to be installed)

| Tool               | Version    | Purpose                                        |
| ------------------ | ---------- | ---------------------------------------------- |
| Xcode CLI Tools    | Latest     | C/C++ compiler, linker, macOS SDK              |
| Homebrew           | Latest     | Package manager                                |
| Node.js            | 20 or 22 LTS | JavaScript runtime for the API server        |
| pnpm               | 9+         | Fast, disk-efficient package manager           |
| Rust (via rustup)  | Stable     | Compile Tauri shell & native binaries          |
| Git                | Latest     | Source control (ships with Xcode CLI Tools)    |

> **Note on Node.js versions:** The CI pipeline and `@yao-pkg/pkg` binary targets use Node 20. Node 22 LTS works fine for local development and builds. Either version is supported.

### API Keys (required for runtime)

| Key                    | Where to obtain                        | Used by           |
| ---------------------- | -------------------------------------- | ------------------ |
| `ANTHROPIC_API_KEY`    | https://console.anthropic.com          | Claude agent       |
| `OPENAI_API_KEY`       | https://platform.openai.com            | Codex agent (optional) |
| Linear API Key         | https://linear.app/settings/api        | Linear pipeline (optional) |

---

## 3. Phase 1 — macOS Initial Setup

### 3.1 Complete macOS Setup Assistant

Power on the Mac Mini and follow the on-screen setup wizard. Configure:

- **Apple ID** — Sign in (required for Xcode tools)
- **Computer Name** — Pick something identifiable (e.g., `agent-server`)
- **Enable Remote Login (SSH)** — We'll enable this in System Settings later

### 3.2 Enable Remote Login (SSH)

If you plan to manage this Mac Mini headlessly:

```bash
# Open System Settings → General → Sharing → Remote Login → Toggle ON
# Or via command line:
sudo systemsetup -setremotelogin on
```

> **Tip:** After enabling SSH you can complete the rest of this guide remotely:
> ```bash
> ssh your-username@<mac-mini-ip>
> ```

### 3.3 Install Xcode Command Line Tools

This is the **first thing** to install — many other tools depend on it.

```bash
xcode-select --install
```

A dialog will appear. Click **Install** and wait for it to complete (~2-5 minutes on fast internet).

**Verify:**

```bash
xcode-select -p
# Expected output: /Library/Developer/CommandLineTools

gcc --version
# Should show Apple clang version
```

> **Note:** You do NOT need the full Xcode IDE (~12 GB). The Command Line Tools (~2 GB) are sufficient for Tauri builds. Only install the full Xcode if you plan to do iOS development.

### 3.4 Accept Xcode License (if prompted)

```bash
sudo xcodebuild -license accept
```

---

## 4. Phase 2 — Install Developer Toolchain

### 4.1 Install Homebrew

Homebrew is the de facto package manager for macOS. It installs to `/opt/homebrew` on Apple Silicon.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

After installation, add Homebrew to your PATH (the installer will show you the exact commands):

```bash
# Add to ~/.zprofile (persists across sessions)
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

**Verify:**

```bash
brew --version
# Homebrew 4.x.x
```

> **Best Practice:** Never run `brew` with `sudo`. Homebrew manages its own permissions.

### 4.2 Install Node.js (LTS)

Node.js 20 or 22 LTS are both supported. The project's `pkg` binary targets use `node20`.

**Option A — Direct via Homebrew (simplest):**

```bash
brew install node@22
```

**Option B — Via fnm (recommended for version flexibility):**

[fnm](https://github.com/Schniz/fnm) is a fast Node version manager:

```bash
brew install fnm

# Add to shell profile
echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> ~/.zshrc
source ~/.zshrc

# Install and use Node 22 LTS
fnm install 22
fnm default 22
```

**Verify:**

```bash
node --version
# v22.x.x

npm --version
# 10.x.x
```

### 4.3 Install pnpm

pnpm is required — the project uses pnpm workspaces.

```bash
# Option A — via Homebrew
brew install pnpm

# Option B — via Corepack (built into Node.js)
corepack enable
corepack prepare pnpm@latest --activate

# Option C — via npm
npm install -g pnpm
```

**Verify:**

```bash
pnpm --version
# 9.x.x or 10.x.x
```

### 4.4 Install Rust (via rustup)

Tauri 2 requires the Rust toolchain. Always install via `rustup` (not `brew install rust`), as it provides toolchain management.

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

When prompted, choose **option 1** (default installation).

After installation, load the environment:

```bash
source "$HOME/.cargo/env"
```

Add the Apple Silicon target (should be default, but just in case):

```bash
rustup target add aarch64-apple-darwin
```

**Verify:**

```bash
rustc --version
# rustc 1.8x.x

cargo --version
# cargo 1.8x.x

rustup show
# Should show: aarch64-apple-darwin as the default host
```

### 4.5 Install Git (if not present)

Git ships with Xcode Command Line Tools, but you can get a newer version:

```bash
# Check if git is already available
git --version

# If you want the latest:
brew install git
```

### 4.6 Summary — Verify All Tools

Run this one-liner to verify everything is installed:

```bash
echo "=== Toolchain Check ===" && \
  echo "Xcode CLT: $(xcode-select -p 2>/dev/null || echo 'NOT INSTALLED')" && \
  echo "Homebrew:   $(brew --version 2>/dev/null | head -1 || echo 'NOT INSTALLED')" && \
  echo "Node.js:    $(node --version 2>/dev/null || echo 'NOT INSTALLED')" && \
  echo "pnpm:       $(pnpm --version 2>/dev/null || echo 'NOT INSTALLED')" && \
  echo "Rust:       $(rustc --version 2>/dev/null || echo 'NOT INSTALLED')" && \
  echo "Cargo:      $(cargo --version 2>/dev/null || echo 'NOT INSTALLED')" && \
  echo "Git:        $(git --version 2>/dev/null || echo 'NOT INSTALLED')" && \
  echo "======================"
```

Expected output:

```
=== Toolchain Check ===
Xcode CLT: /Library/Developer/CommandLineTools
Homebrew:   Homebrew 4.x.x
Node.js:    v22.x.x
pnpm:       9.x.x
Rust:       rustc 1.8x.x (...)
Cargo:      cargo 1.8x.x (...)
Git:        git version 2.x.x
=======================
```

---

## 5. Phase 3 — Clone & Install the Project

### 5.1 Clone the Repository

```bash
# Choose your preferred development directory
mkdir -p ~/Dev && cd ~/Dev

# Clone via SSH (recommended — set up SSH key first)
git clone git@github.com:<your-org>/<repo-name>.git

# Or clone via HTTPS
git clone https://github.com/<your-org>/<repo-name>.git

cd <repo-name>
```

### 5.2 Install All Dependencies

The project uses pnpm workspaces with two packages: root (frontend) and `src-api` (backend).

```bash
pnpm install
```

This installs dependencies for both packages in one go. Expected output: ~1000+ packages, takes ~30-60 seconds.

**Verify the workspace structure:**

```bash
pnpm ls --depth 0
# Should show the frontend and API workspaces
```

### 5.3 Verify the Rust/Tauri Setup

```bash
# Check that the Tauri CLI is available via pnpm
pnpm tauri --version
# tauri-cli 2.x.x

# Ensure the Rust target is ready
rustup target list --installed
# Should include: aarch64-apple-darwin
```

### 5.4 Sync Branding (if needed)

If this is a custom brand or the first setup, sync branding to ensure all config files are up to date:

```bash
pnpm brand:sync
```

---

## 6. Phase 4 — Configure the Application

### 6.1 Create Application Data Directories

The application stores its data in `~/.<slug>/` (where `<slug>` is from `branding.json`):

```bash
mkdir -p ~/.<slug>/logs
```

### 6.2 Configure API Keys

API keys can be set in multiple ways. Choose one:

**Option A — Environment Variables (recommended for servers):**

Add to your shell profile (`~/.zshrc`):

```bash
# Anthropic API key (required for Claude agent)
export ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxxx"

# OpenAI API key (optional, for Codex agent)
export OPENAI_API_KEY="sk-xxxxxxxxxxxxx"
```

Then reload:

```bash
source ~/.zshrc
```

**Option B — Application UI (recommended for interactive use):**

Start the app and configure API keys in **Settings → Providers**. Keys are stored in the SQLite settings database at `~/.<slug>/database.db`.

**Option C — Config file (optional override):**

Create `~/.<slug>/config.json` with provider configuration:

```json
{
  "providers": [
    {
      "name": "Anthropic",
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "sk-ant-xxxxxxxxxxxxx"
    }
  ]
}
```

The config loader searches for config files in this order: `NEUMAR_CONFIG` env var → `.neumarar.config.json` → `./confineumarmar.json` → `~/.<slug>/config.json`.

### 6.3 Configure MCP Servers (Optional)

MCP (Model Context Protocol) servers provide additional tools to agents. Configuration is loaded from:

1. `~/.<slug>/mcp.json` — Application specific
2. `~/.claude/settings.json` — Shared with Claude Code

Example `~/.<slug>/mcp.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/your-username/workspace"]
    }
  }
}
```

### 6.4 Configure Linear Pipeline (Optional)

If using the Linear ticket-to-PR pipeline, configure via the app UI at **Settings → Connectors** or directly through the API. Configuration is encrypted and stored at `~/.<slug>/linear.enc.json`.

---

## 7. Phase 5 — Development Mode

### 7.1 Run Everything Together

The quickest way to start development:

```bash
pnpm dev:all
```

This runs two processes concurrently:
- **API server** on `http://localhost:5126`
- **Tauri desktop app** with Vite dev server on `http://localhost:3420`

> **First run will take longer** — Cargo needs to download and compile Rust crates (~3-5 minutes).

### 7.2 Run Components Separately

For more control, run in separate terminal windows:

```bash
# Terminal 1 — API server (hot-reloads on file changes)
pnpm dev:api

# Terminal 2 — Desktop app
pnpm dev:app

# Or just the web frontend (no Tauri desktop shell)
pnpm dev:web
```

### 7.3 Verify Everything Works

1. The Tauri window should open automatically
2. API health check: `curl http://localhost:5126/health`
3. Check dependencies: `curl http://localhost:5126/health/dependencies`

### 7.4 Code Quality Checks

```bash
# Run all checks (lint + typecheck + format)
pnpm validate

# Individual checks
pnpm lint           # ESLint (frontend)
pnpm typecheck:all  # TypeScript (frontend + API)
pnpm format:check   # Prettier format check
```

---

## 8. Phase 6 — Production Build

### 8.1 Build for Mac Mini (Apple Silicon)

The build script handles everything: API sidecar compilation, native addon bundling, frontend build, and Tauri packaging.

```bash
# Standard build (no code signing, fastest)
./scripts/build.sh mac-arm

# Build with bundled CLI tools (Claude Code + Codex)
./scripts/build.sh mac-arm --with-cli

# Full release build with code signing + notarization
./scripts/build.sh mac-arm --with-cli --sign
```

> **Build time:** ~5-10 minutes on Apple Silicon (first build longer due to Rust compilation).

### 8.2 What the Build Produces

```
src-tauri/target/aarch64-apple-darwin/release/bundle/
├── macos/
│   └── <displayName>.app         # The macOS application bundle
└── dmg/
    └── <displayName>_<version>_aarch64.dmg  # Distributable disk image
```

### 8.3 Build Pipeline Details

The build process follows these steps:

1. **pnpm install** — Ensures all dependencies are present
2. **API Sidecar** — esbuild bundles the TypeScript API → single CJS file (`dist/bundle.cjs`); `onnxruntime-node` and `sherpa-onnx-node` are marked `--external` because their native `.node` addons cannot be bundled by esbuild. Then `@yao-pkg/pkg` compiles to a native binary.
3. **Native addon copy** — `build.mjs` copies sherpa-onnx native files (`.node` + `.dylib`) to `dist/sherpa-onnx/` and onnxruntime native files to `dist/onnxruntime/`. These are bundled into the app via Tauri's `bundle.resources` and loaded at runtime from an absolute path using the `RESOURCES_DIR` environment variable.
4. **CLI Bundle** (optional) — Downloads Node.js + installs Claude Code & Codex
5. **Frontend** — Vite builds React app → `dist/`
6. **Tauri** — Compiles Rust shell, embeds frontend + API sidecar + native addons → `.app` bundle and `.dmg`
7. **Signing** (optional) — Code-signs all binaries + notarizes with Apple; notarization failures are propagated as build failures

The macOS DMG packaging path preserves Unicode filenames under HFS+ normalization. Keep
DesignMode catalog assets in normalized, ASCII-safe paths where possible, and verify any
renamed generated assets are reflected in `src-api/src/shared/services/design-mode/catalogs.ts`.

### 8.4 Install the Built App

```bash
# Option A — Open the DMG and drag to Applications
open src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg

# Option B — Copy the .app directly
cp -R "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/<displayName>.app" /Applications/
```

### 8.5 Code Signing & Notarization (for distribution)

To distribute the app outside the App Store, you need an **Apple Developer ID Certificate** — enroll at https://developer.apple.com.

The build script supports two notarization methods. Set the signing identity plus **one** of the following:

**Option A — App Store Connect API Key (recommended for CI/CD):**

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
export APPLE_API_ISSUER="12345678-abcd-efgh-ijkl-123456789012"   # Issuer ID from App Store Connect
export APPLE_API_KEY="A1B2C3D4E5"                                # Key ID
export APPLE_API_KEY_PATH="/path/to/AuthKey.p8"                  # Downloaded .p8 key file
```

**Option B — Apple ID + App-Specific Password (fallback):**

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
export APPLE_ID="your@email.com"
export APPLE_PASSWORD="abcd-efgh-ijkl-mnop"   # App-specific password from appleid.apple.com
export APPLE_TEAM_ID="YOUR_TEAM_ID"
```

Then build with signing:

```bash
./scripts/build.sh mac-arm --with-cli --sign
```

> See [Code Signing & Notarization Setup](code-signing-notarization.md) for the full guide including GitHub secrets setup.

---

## 9. Phase 7 — Run as a Background Service (launchd)

To run the API server as a persistent background service that starts on boot (useful for the Linear pipeline and headless operation).

### 9.1 Option A — Run the Built App

Simply add the `.app` to **System Settings → General → Login Items** to auto-launch on login. The app manages its own API sidecar process.

### 9.2 Option B — Run API Server via launchd (headless)

For headless server deployments where you only need the API (e.g., for the Linear pipeline):

**Create the launch agent plist:**

```bash
cat > ~/Library/LaunchAgents/<identifier>.api.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string><identifier>.api</string>

    <key>ProgramArguments</key>
    <array>
        <!-- Path to node — adjust to match your installation -->
        <string>/opt/homebrew/bin/node</string>
        <string>--import</string>
        <string>tsx</string>
        <string>src/index.ts</string>
    </array>

    <key>WorkingDirectory</key>
    <!-- Adjust this path to your project location -->
    <string>/Users/YOUR_USERNAME/Dev/<repo-name>/src-api</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PORT</key>
        <string>2620</string>
        <key>ANTHROPIC_API_KEY</key>
        <string>sk-ant-xxxxxxxxxxxxx</string>
        <!-- Add other env vars as needed -->
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/.<slug>/logs/api-stdout.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/.<slug>/logs/api-stderr.log</string>
</dict>
</plist>
EOF
```

> **Important:** Replace `YOUR_USERNAME` with your actual macOS username and update paths accordingly.

**Create the logs directory:**

```bash
mkdir -p ~/.<slug>/logs
```

**Load the service:**

```bash
# Load and start
launchctl load ~/Library/LaunchAgents/<identifier>.api.plist

# Check status
launchctl list | grep <identifier>

# View logs
tail -f ~/.<slug>/logs/api-stdout.log
tail -f ~/.<slug>/logs/api-stderr.log
```

**Manage the service:**

```bash
# Stop the service
launchctl unload ~/Library/LaunchAgents/<identifier>.api.plist

# Restart (unload then load)
launchctl unload ~/Library/LaunchAgents/<identifier>.api.plist
launchctl load ~/Library/LaunchAgents/<identifier>.api.plist
```

### 9.3 Option C — Run the Compiled API Binary via launchd

If you've built the API binary, you can run it directly without Node.js:

```bash
cat > ~/Library/LaunchAgents/<identifier>.api.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string><identifier>.api</string>

    <key>ProgramArguments</key>
    <array>
        <string>/Users/YOUR_USERNAME/Dev/<repo-name>/src-api/dist/<binaryName>-aarch64-apple-darwin</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PORT</key>
        <string>2620</string>
        <key>ANTHROPIC_API_KEY</key>
        <string>sk-ant-xxxxxxxxxxxxx</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/.<slug>/logs/api-stdout.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/.<slug>/logs/api-stderr.log</string>
</dict>
</plist>
EOF
```

> **Note:** The compiled binary is self-contained (Node.js is embedded via `@yao-pkg/pkg`), so you don't need Node.js installed on the machine to run it. If the memory system is enabled, the ONNX embedding model downloads automatically on first use to `~/.<slug>/cache/embeddings/`.

---

## 10. Phase 8 — Networking & Firewall

### 10.1 Ports Used

| Port  | Service               | Context      |
| ----- | --------------------- | ------------ |
| 3420  | Vite dev server       | Development  |
| 1421  | Vite HMR WebSocket    | Development  |
| 5126  | API server            | Development  |
| 2620  | API server (sidecar)  | Production   |

> See also: [Port Reference](../reference/ports.md)

### 10.2 Configure macOS Firewall

If the macOS firewall is enabled:

1. **System Settings → Network → Firewall → Options**
2. Click **+** and add the `.app` bundle (or the API binary)
3. Set to **Allow incoming connections**

Or via command line:

```bash
# Check firewall status
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# Add the app to the allow list
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "/Applications/<displayName>.app"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "/Applications/<displayName>.app"
```

### 10.3 Expose API to Local Network (for Linear Webhooks)

If this Mac Mini serves as a Linear pipeline server and needs to receive webhooks:

1. **Port forwarding** — Configure your router to forward external traffic to the Mac Mini's port 2620
2. **Use a tunnel service** (recommended for development):
   ```bash
   # Using ngrok
   brew install ngrok
   ngrok http 2620

   # Using Cloudflare Tunnel (more stable for production)
   brew install cloudflared
   cloudflared tunnel --url http://localhost:2620
   ```
3. Set the tunnel URL as your Linear webhook endpoint

### 10.4 Keep Mac Mini Awake (Headless)

Prevent the Mac Mini from sleeping:

```bash
# Disable sleep entirely
sudo pmset -a sleep 0
sudo pmset -a disablesleep 1

# Keep the system awake when on power (recommended for servers)
sudo pmset -a displaysleep 0
sudo pmset -a hibernatemode 0

# Verify settings
pmset -g
```

---

## 11. Maintenance & Updates

### 11.1 Update the Application

```bash
cd ~/Dev/<repo-name>

# Pull latest changes
git pull origin main

# Reinstall dependencies (in case they changed)
pnpm install

# Rebuild
./scripts/build.sh mac-arm
```

### 11.2 Update System Dependencies

```bash
# Update Homebrew packages (Node, pnpm, etc.)
brew update && brew upgrade

# Update Rust
rustup update

# Update pnpm (if installed via npm)
npm install -g pnpm@latest
```

### 11.3 Log Rotation

If running as a launchd service, logs will grow over time. Set up log rotation:

```bash
# Create a log rotation config
cat > ~/Library/LaunchAgents/<identifier>.logrotate.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string><identifier>.logrotate</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>
            LOG_DIR="$HOME/.<slug>/logs"
            for f in "$LOG_DIR"/*.log; do
                if [ -f "$f" ] && [ $(stat -f%z "$f") -gt 10485760 ]; then
                    mv "$f" "$f.$(date +%Y%m%d%H%M%S).bak"
                    touch "$f"
                fi
            done
            # Clean up backups older than 7 days
            find "$LOG_DIR" -name "*.bak" -mtime +7 -delete
        </string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>3</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/<identifier>.logrotate.plist
```

### 11.4 Monitor Disk Space

```bash
# Check overall disk usage
df -h /

# Check project size
du -sh ~/Dev/<repo-name>

# Clean Rust build cache (can reclaim several GB)
cd ~/Dev/<repo-name> && cargo clean --manifest-path src-tauri/Cargo.toml

# Clean pnpm cache
pnpm store prune

# Clean Homebrew cache
brew cleanup
```

---

## 12. Troubleshooting

### Xcode Command Line Tools issues

```bash
# Reset if corrupted
sudo rm -rf /Library/Developer/CommandLineTools
xcode-select --install
```

### Homebrew "not found" after install

```bash
# Apple Silicon Macs — add to PATH
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
source ~/.zprofile
```

### Rust compilation errors

```bash
# Ensure you have the latest stable toolchain
rustup update stable
rustup default stable

# Clear the build cache and rebuild
cd ~/Dev/<repo-name>
cargo clean --manifest-path src-tauri/Cargo.toml
```

### `pnpm tauri dev` fails with "framework not found"

This usually means Xcode CLT is incomplete:

```bash
sudo xcode-select --reset
xcode-select --install
```

### API sidecar binary won't run (killed by macOS)

For unsigned binaries, macOS Gatekeeper may block execution:

```bash
# Remove quarantine attribute
xattr -r -d com.apple.quarantine src-api/dist/<binaryName>-aarch64-apple-darwin

# Or allow in System Settings → Privacy & Security → "Allow Anyway"
```

### Port already in use

```bash
# Find what's using the port
lsof -i :5126
lsof -i :2620

# Kill the process
kill -9 <PID>
```

### Node.js version mismatch

```bash
# Check current version
node --version

# If using fnm, switch to v22
fnm use 22

# If using Homebrew, link the correct version
brew link --overwrite node@22
```

### ONNX embedding model not found

If the memory system fails to load the embedding model:

```bash
# The model downloads automatically on first use to:
ls ~/.<slug>/cache/embeddings/

# Verify native onnxruntime addon was bundled (production builds):
ls src-api/dist/onnxruntime/

# Verify native sherpa-onnx addon was bundled (production builds):
ls src-api/dist/sherpa-onnx/
```

### launchd service won't start

```bash
# Check for plist syntax errors
plutil -lint ~/Library/LaunchAgents/<identifier>.api.plist

# Check launchd error log
launchctl list | grep <identifier>

# View system logs for launch errors
log show --predicate 'senderImagePath contains "launchd"' --last 5m
```

### Build output too large

The `--with-cli` flag adds ~100 MB (shared Node.js + Claude Code + Codex). If you don't need CLI tools bundled:

```bash
# Build without CLI bundle (smaller)
./scripts/build.sh mac-arm
```

---

## 13. Quick Reference Card

### One-Time Setup (copy-paste sequence)

```bash
# 1. Install Xcode Command Line Tools
xcode-select --install

# 2. Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"

# 3. Install Node.js + pnpm
brew install node@22 pnpm

# 4. Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup target add aarch64-apple-darwin

# 5. Clone and install project
mkdir -p ~/Dev && cd ~/Dev
git clone <your-repo-url> <repo-name>
cd <repo-name>
pnpm install

# 6. Set API key
echo 'export ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxxx"' >> ~/.zshrc
source ~/.zshrc

# 7. Run!
pnpm dev:all
```

### Daily Commands

| Task                  | Command                                    |
| --------------------- | ------------------------------------------ |
| Start development     | `pnpm dev:all`                             |
| Start API only        | `pnpm dev:api`                             |
| Run all checks        | `pnpm validate`                            |
| Build for production  | `./scripts/build.sh mac-arm`               |
| Build with CLI tools  | `./scripts/build.sh mac-arm --with-cli`    |
| Release build (signed)| `./scripts/build.sh mac-arm --with-cli --sign` |
| Update dependencies   | `pnpm install`                             |
| Update Rust           | `rustup update`                            |
| Clean build artifacts | `cargo clean --manifest-path src-tauri/Cargo.toml` |
| Check API health      | `curl http://localhost:5126/health`        |

### Important Paths

| Path                           | Description                       |
| ------------------------------ | --------------------------------- |
| `~/.<slug>/`                   | App data, config, logs            |
| `~/.<slug>/database.db`       | SQLite database (sessions, tasks, memories, settings) |
| `~/.<slug>/config.json`       | Optional provider configuration override |
| `~/.<slug>/mcp.json`          | MCP server configuration          |
| `~/.<slug>/linear.enc.json`   | Linear pipeline config (encrypted)|
| `~/.<slug>/logs/`             | Application and service log files |
| `~/.<slug>/cache/embeddings/` | Local ONNX embedding model cache (auto-downloaded on first use) |
| `~/.claude/settings.json`     | Shared Claude Code settings       |
| `~/Dev/<repo-name>/`          | Project source code               |

---

*See also: [System Overview](../system/overview.md) · [Build & Deployment](../build/index.md) · [Port Reference](../reference/ports.md) · [File System Layout](../reference/file-system.md)*
