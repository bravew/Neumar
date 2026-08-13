# Build and Deployment

Neuma produces self-contained desktop installers for macOS (Intel + Apple Silicon), Linux, and Windows. The build pipeline combines esbuild (API), Vite (frontend), and Tauri (desktop shell).

---

## Build Script

All platform builds go through `scripts/build.sh`:

```bash
./scripts/build.sh mac-arm     # macOS Apple Silicon (.dmg + .app)
./scripts/build.sh mac-intel   # macOS Intel (.dmg + .app)
./scripts/build.sh linux       # Linux (.deb + .rpm + .AppImage)
./scripts/build.sh windows     # Windows (.msi + .exe)
```

### Build Options

| Flag | Description |
|---|---|
| `--with-cli` | Bundle Claude Code CLI + Codex as sidecar |
| `--sign` | Enable code signing (requires certificates) |

Example:
```bash
./scripts/build.sh mac-arm --with-cli --sign
```

---

## Build Pipeline

### Step 1: API Server (esbuild)

```
src-api/src/index.ts
    │
    ▼ esbuild bundle (CommonJS, Node.js target)
    │
dist/api/index.js
    │
    ▼ Copy native addons
dist/api/
├── index.js
├── sherpa-onnx-node.node   (speech)
└── onnxruntime-node.node   (embeddings)
```

### Step 2: Compile to Binary

**Local:** `@yao-pkg/pkg` compiles the bundled JS + Node.js into a standalone binary.

**CI:** Bun `compile` produces a smaller, faster binary without embedding the Node.js runtime.

```bash
# CI example
bun build --compile --target=bun-linux-x64 dist/api/index.js \
  --outfile dist/neuma-api
```

### Step 3: Tauri Config Update

The build script updates `src-tauri/tauri.conf.json` with the resource file glob patterns for the API binary and native addons.

### Step 4: Frontend (Vite)

```
src/main.tsx
    │
    ▼ Vite build (tree-shaken, code-split)
    │
src-tauri/dist/   (Tauri reads from here)
├── index.html
├── assets/
│   ├── vendor-react-[hash].js     React 19
│   ├── vendor-ui-[hash].js        Radix UI
│   ├── vendor-markdown-[hash].js  react-markdown
│   └── [page]-[hash].js           Lazy route chunks
└── ...
```

Chunk splitting strategy:
- `vendor-react` — React + React DOM
- `vendor-ui` — Radix UI components
- `vendor-markdown` — Markdown rendering
- Per-page lazy chunks — Home, TaskDetail, Library, Setup

### Step 5: Tauri Build

```
tauri build
    │
    ├── macOS: .app bundle + .dmg installer
    ├── Linux: .deb + .rpm packages
    └── Windows: .msi + .exe installer
```

---

## CI/CD Pipeline

GitHub Actions runs builds on every release tag (`.github/workflows/build.yml`):

### Build Matrix

| Platform | Runner | Output |
|---|---|---|
| macOS Apple Silicon | `macos-latest` (ARM) | `.dmg`, `.app.tar.gz` |
| macOS Intel | `macos-13` (x86_64) | `.dmg`, `.app.tar.gz` |
| Linux | `ubuntu-22.04` | `.deb`, `.rpm`, `.AppImage` |
| Windows | `windows-latest` | `.msi`, `.exe` |

### Workflow Jobs

```
ci.yml
├── lint
├── typecheck
├── format-check
└── test (matrix: ubuntu + macos)

build.yml
├── build-api (per platform)
├── build-desktop (per platform, matrix)
└── release (draft GitHub release with artifacts)
```

### Release Artifacts

On a version tag push (`v*.*.*`):
1. Build runs the full matrix
2. All installers are uploaded as GitHub release assets
3. A draft release is created with the changelog

---

## Code Signing

### macOS

Requires:
- Apple Developer certificate (Developer ID Application)
- Notarization credentials (Apple ID + app-specific password)

```bash
./scripts/build.sh mac-arm --sign
```

The Tauri build configuration reads signing credentials from environment variables (set in CI secrets):
- `APPLE_CERTIFICATE` — base64-encoded p12
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

### Windows

Requires a code signing certificate (EV or OV). Configure in `src-tauri/tauri.conf.json` under `bundle.windows.certificateThumbprint`.

---

## Homebrew Cask

A Homebrew Cask formula is maintained for macOS distribution. After a release, the `update-cask.yml` workflow automatically:

1. Computes SHA256 of the new `.dmg`
2. Updates the version and hash in the Cask formula
3. Opens a PR in the Homebrew Casks repository

---

## Development Build Notes

For local Tauri development:

```bash
# Start everything (recommended)
pnpm dev:all

# Manual: start API first, then Tauri
pnpm dev:api &
pnpm tauri dev
```

The Tauri dev window connects to `localhost:3420` (Vite). The API connects to `localhost:5126`. Hot-reload is active for the frontend.

---

## Sidecar Binary in Production

The compiled API binary is bundled as a **Tauri sidecar**:

```
src-tauri/
└── binaries/
    └── neuma-api-<target-triple>   (e.g., neuma-api-aarch64-apple-darwin)
```

Tauri spawns this binary as a child process and kills it on app exit. The sidecar:
- Starts on port 2620
- Writes logs to `~/.<slug>/logs/<slug>.log`
- Reads/writes to `~/.<slug>/` for all persistent state

---

## Further Reading

- [[Architecture]] — Dual runtime model (dev vs production)
- [[Getting Started]] — Development environment setup
- [[Testing]] — Test runs in CI
- [[Configuration]] — Branding configuration for builds
