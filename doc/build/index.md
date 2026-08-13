---
summary: "Development workflow, production build pipeline (esbuild + pkg + Vite + Tauri), CI/CD matrix builds, and distribution formats"
read_when:
  - Setting up the development environment
  - Building for production
  - Working on CI/CD workflows
  - Understanding the build pipeline
title: "Build & Deployment"
---

# Build & Deployment

## Development Workflow

```bash
# Full development stack (recommended)
pnpm dev:all        # Runs API + Tauri app concurrently

# Or run individually:
pnpm dev:api        # API server on port 5126
pnpm dev:app        # Tauri desktop app (needs API running)
pnpm dev:web        # Web-only frontend via Vite (port 3420)
```

**Development ports:**
- `3420` — Vite dev server (frontend HMR)
- `1421` — Vite HMR WebSocket
- `5126` — API server (development)

## Production Build Pipeline

```
┌────────────┐     ┌──────────────┐     ┌──────────────┐
│ Build API  │     │Build Frontend│     │ Bundle CLIs  │
│  Sidecar   │     │  (Vite)      │     │ (optional)   │
│            │     │              │     │              │
│ esbuild →  │     │ vite build → │     │ Node.js +    │
│ CJS bundle │     │ dist/        │     │ Claude Code +│
│ → pkg →    │     │              │     │ Codex CLI    │
│ binary     │     │              │     │              │
└─────┬──────┘     └──────┬───────┘     └──────┬───────┘
      │                   │                     │
      ├── Copy native ────┤                     │
      │   addon files     │                     │
      │   (sherpa-onnx +  │                     │
      │    onnxruntime)   │                     │
      │                   │                     │
      └─────────┬─────────┘                     │
                │                               │
      ┌─────────▼──────────┐                    │
      │   Tauri Build      │◀───────────────────┘
      │                    │
      │ • Bundle webview   │
      │ • Include sidecar  │
      │ • Bundle native    │
      │ •   addon files    │
      │ • Sign (macOS)     │
      │ • Create installer │
      └────────┬───────────┘
               │
      ┌────────▼───────────┐
      │  Distribution      │
      │ • .dmg (macOS)     │
      │ • .msi (Windows)   │
      │ • .deb/.rpm (Linux)│
      └────────────────────┘
```

**Build commands:**

```bash
./scripts/build.sh mac-arm          # macOS Apple Silicon
./scripts/build.sh mac-intel         # macOS Intel
./scripts/build.sh linux             # Linux x86_64
./scripts/build.sh windows           # Windows x86_64

# Options:
./scripts/build.sh mac-arm --with-cli   # Bundle Claude Code + Codex CLIs
./scripts/build.sh mac-arm --sign       # Enable code signing + notarization (codesign for .node/.dylib)
```

### API Binary Compilation (two methods)

*Local builds* (`scripts/build.sh`):
1. **esbuild** bundles TypeScript → single CommonJS file (`dist/bundle.cjs`); `onnxruntime-node` and `sherpa-onnx-node` are marked `--external` because their native `.node` addons cannot be bundled
2. **Native addon copy** — `build.mjs` copies sherpa-onnx and onnxruntime native files (`.node` + `.dylib`) to `dist/sherpa-onnx/` and `dist/onnxruntime/` for Tauri resource bundling
3. **Tauri config update** — `update_tauri_config()` auto-detects native addon directories and adds their resource glob patterns to `tauri.conf.json`; the original config is backed up before modification and restored on exit via a shell trap
4. **@yao-pkg/pkg** compiles → platform-specific native binary

*CI builds* (`.github/workflows/build.yml`):
1. **Bun compile** (`bun build --compile`) → platform-specific native binary directly

Both produce the binary at `src-api/dist/<binaryName>-{target}`

### Frontend Chunk Splitting

The Vite build (`vite.config.ts`) uses manual chunk splitting to optimize load times:

| Chunk | Contents |
|-------|----------|
| `vendor-react` | react, react-dom, react-router-dom, @radix-ui components |
| `vendor-markdown` | react-markdown, react-syntax-highlighter, remark-gfm |

Additional build features:
- **PDF.js asset copying** plugin for custom bundling (avoids pnpm symlink issues)
- **PWA disabled** for Tauri builds (service workers conflict with webview)
- **Build date injection** — `__BUILD_DATE__` in `YYYY.MM.DD` format
- **Branding config injection** from `branding.json`

Combined with lazy-loaded routes (`React.lazy()`), the initial page load only downloads
the vendor-react chunk and the active page's code.

## Code Quality (Linting & Formatting)

The project uses **oxlint** for linting and **oxfmt** for formatting (migrated from ESLint + Prettier in #115). Both are Rust-based tools, providing ~50x faster execution than their JavaScript predecessors.

### Linting

- **Tool:** [oxlint](https://oxc.rs/docs/guide/usage/linter) (Rust-based)
- **Config:** `.oxlintrc.json` (frontend), `src-api/.oxlintrc.json` (backend)
- **Command:** `pnpm lint` (runs oxlint across the workspace)

### Formatting

- **Tool:** [oxfmt](https://oxc.rs/docs/guide/usage/formatter) (Rust-based)
- **Config:** `.oxfmtrc.jsonc`
- **Features:** Built-in `sortImports` for automatic import ordering
- **Commands:**
  - `pnpm format` — format all files
  - `pnpm format:check` — check formatting without modifying
  - `npx oxfmt <file>` — format a single file (run before `pnpm validate` after editing)

### Validation

```bash
pnpm validate         # lint + typecheck:all + format:check
```

Runs linting, TypeScript type checking for both frontend and backend, and formatting checks in sequence.

## Testing

The project uses **Vitest** as a single framework for unit, integration, and E2E testing across all layers.

### Test Suites

| Suite | Config | Pool | Description |
|-------|--------|------|-------------|
| Frontend | `vitest.config.ts` | `forks` | React component tests via jsdom + React Testing Library |
| API integration | `src-api/vitest.config.ts` | `forks` | Hono route tests using `app.request()` — no server needed |
| Gate evals | `src-api/vitest.config.ts` | `forks` | Deterministic `src-api/test/evals/**/*.eval.ts` cases tagged `[gate]`; no paid provider calls |
| Periodic evals | `src-api/vitest.eval.config.ts` | `forks` | Scheduled or manual eval cases with `EVALS_TIER=periodic`; writes artifacts under `~/.neuma/evals` |
| API E2E | `src-api/vitest.e2e.config.ts` | `vmForks` | Spawns a real API process; tests via raw `fetch()` |

### Commands

```bash
# Run individual suites
pnpm test                # Frontend component tests
pnpm test:api            # API integration tests
pnpm test:e2e            # API E2E (spawns real server — slower)

# Watch mode
pnpm test:watch          # Frontend, interactive
pnpm test:api:watch      # API integration, interactive

# Coverage
pnpm test:coverage       # Frontend, V8 coverage report
pnpm test:api:coverage   # API, V8 coverage report (70% threshold)

# Convenience
pnpm test:fast           # Frontend + API integration (no E2E)
pnpm test:all            # All three suites
pnpm test:ci             # All three suites (CI alias)
pnpm test:e2e:verbose    # E2E with server stdout/stderr (debugging)

# Eval gates
pnpm eval:list --json    # List registered eval cases
pnpm eval:select --json  # Select cases from the git diff / touchfiles
pnpm test:gate           # Run deterministic gate evals
pnpm test:periodic       # Run periodic evals (requires EVALS_TIER=periodic workflow/env)
pnpm eval:compare        # Compare latest eval artifacts under ~/.neuma/evals
```

### Directory Layout

```
src-api/test/
├── global-setup.ts          # Runs once per suite: isolates HOME, clears API keys
├── setup.ts                 # Per-file: restores real timers after fake-timer tests
├── test-env.ts              # installTestEnv() helper
├── helpers/
│   ├── spawn-api.ts         # spawnApiInstance / stopApiInstance (E2E)
│   ├── http-client.ts       # getJson / postJson / collectSSE
│   ├── stream.ts            # parseSSEText / collectAsyncGen
│   ├── poll.ts              # pollUntil (waits for server ready)
│   ├── free-port.ts         # getFreePort (dynamic port allocation)
│   ├── temp-home.ts         # withTempHome (isolated filesystem)
│   ├── db.ts                # createTestDb (in-memory SQLite)
│   ├── fixtures.ts          # makeSessionId / makeTaskId / makeProviderConfig
│   ├── mock-llm.ts          # createMockAgentStream / collectMessages
│   └── mock-mcp.ts          # createMockMcpConfig / mockMcpLoader
├── evals/
│   ├── registry.ts          # Static case registry used by eval-list/eval-select
│   ├── gate.eval.ts         # Runs all gate-tier cases as deterministic Vitest tests
│   ├── periodic.eval.ts     # Runs periodic-tier cases only when EVALS_TIER=periodic
│   ├── result-store.ts      # Writes redacted result artifacts to ~/.neuma/evals
│   └── cases/*.case.ts      # Typed eval cases with touchfiles and budgets
├── integration/api/
│   ├── health.test.ts       # Health route via Hono app.request()
│   └── providers.test.ts    # Providers route with mocked registries
└── e2e/
    └── api-lifecycle.e2e.test.ts   # Server start/stop, health, 404, concurrency

src/__tests__/
├── setup.ts                 # Imports @testing-library/jest-dom + Tauri mocks
├── mocks/tauri.ts           # vi.mock() stubs for all @tauri-apps/* packages
└── components/
    └── ChatInput.test.tsx   # Render + interaction tests for ChatInput
```

### Writing New Tests

**Integration (API routes):**
```typescript
import { describe, expect, it, vi } from 'vitest';

// Mock heavy deps before importing the route
vi.mock('@/core/agent/registry', () => ({ getAgentRegistry: () => ({...}) }));

describe('My Route', () => {
  it('returns 200', async () => {
    const { myRoutes } = await import('@/app/api/my-route');
    const res = await myRoutes.request('/endpoint');
    expect(res.status).toBe(200);
  });
});
```

**E2E (real server):**
```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getJson, postJson } from '../helpers/http-client';
import { type ApiInstance, spawnApiInstance, stopApiInstance } from '../helpers/spawn-api';

describe('My E2E', () => {
  let api: ApiInstance;
  beforeAll(async () => { api = await spawnApiInstance('my-suite'); });
  afterAll(async () => { await stopApiInstance(api); });

  it('health check', async () => {
    const { status, json } = await getJson(api.baseUrl, '/health');
    expect(status).toBe(200);
  });
});
```

**Frontend components:**
```typescript
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MyComponent } from '@/components/MyComponent';

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({ t: { /* keys */ } }),
}));

describe('MyComponent', () => {
  it('renders', () => {
    render(<MyComponent />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
```

### Environment Isolation

Every test run starts with a clean environment:
- `global-setup.ts` creates a temp `HOME` directory and deletes `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LINEAR_API_KEY`, and `PORT` from the process environment
- E2E tests additionally spawn servers with their own isolated `HOME` per `spawnApiInstance()` call
- All temp directories are removed in teardown

### Coverage Thresholds

| Layer | Lines | Functions | Branches | Statements |
|-------|-------|-----------|----------|------------|
| API (`src-api/src/**`) | 70% | 70% | 55% | 70% |
| Frontend (`src/**`) | — | — | — | — |

## Release Process

Releases follow a **tag-driven** model: CI builds only run when a `v*` tag is pushed to `main`. Normal commits to `main` never trigger a build.

### Cutting a Release

**Option A — GitHub Actions (recommended for team releases):**

1. Go to **Actions → Release → Run workflow**
2. Enter a bump type or explicit version:

   | Input | Example result |
   |-------|---------------|
   | `patch` | `26.3.5` → `26.3.6` |
   | `minor` | `26.3.5` → `26.4.0` (new month) |
   | `major` | `26.3.5` → `27.1.0` (new year) |
   | `26.3.5` | explicit version |

3. Optionally tick **Dry run** to preview the changelog without pushing.
4. Click **Run workflow** — the workflow bumps versions, updates `CHANGELOG.md`, pushes a release commit + tag, which automatically triggers **Build and Release**.

> **First-time setup:** The tag push in `release.yml` uses `GH_RELEASE_TOKEN` (a classic PAT with `contents: write`) so it can trigger downstream workflows. Without it, `build.yml` won't fire automatically. Add the secret at *Settings → Secrets → Actions*.

**Option B — Local script:**

```bash
node scripts/release.mjs patch        # patch bump
node scripts/release.mjs 26.3.5      # explicit version
node scripts/release.mjs patch --dry-run   # preview only
git push --follow-tags origin main   # triggers build.yml
```

**Option C — Local release + publish:**

```bash
./scripts/release.sh patch            # bump, changelog, commit, tag
git push origin main --tags           # triggers CI build + R2 publish
```

Or to build and publish entirely from your machine:

```bash
./scripts/release.sh patch
git push origin main --tags
pnpm release:build-and-publish:mac-arm        # build + sign + upload to R2
```

### What the release script does

1. Bumps `version` in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
2. Collects conventional commits (`feat`, `fix`, `perf`, breaking) since the last tag
3. Prepends a new section to `CHANGELOG.md`
4. Creates a `chore(release): vX.Y.Z` commit + annotated git tag

### Version format

`YY.M.PATCH` — e.g. `26.3.5` = year 2026, March, patch 3.

### Changelog conventions

Commit messages should follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(auth): add Google OAuth login
fix(streaming): prevent state update after unmount
perf(agent): reduce token usage on retry
feat!: drop support for legacy provider format   ← breaking change
```

Commits that don't match the pattern are silently omitted from the auto-generated entry. The generated entry is always prepended — you can edit `CHANGELOG.md` afterward to add prose context before releasing.

---

## CI/CD

### Build & Release (`.github/workflows/build.yml`)

| Step | Description |
|------|-------------|
| Matrix strategy | Linux, Windows, macOS (Intel + ARM) |
| System deps | WebKit GTK (Linux) |
| Toolchains | Node.js 20, pnpm (latest via action-setup@v4), Bun, Rust |
| API sidecar | Bun compile for each platform |
| CLI bundle | Optional Node.js + Claude Code + Codex — **off by default** (~100 MB extra); enable via `with_cli: true` input |
| Windows signing | Azure Key Vault + [relic](https://github.com/sassoftware/relic) — installs Go binary when `AZURE_CLIENT_ID` is set |
| macOS signing | Certificate import → `security import` into temp keychain |
| macOS notarization | API key (`APPLE_API_KEY` + `APPLE_API_ISSUER` + `APPLE_API_KEY_CONTENT`) preferred; Apple ID fallback |
| Frontend | `pnpm build` (Vite) |
| Desktop app | `tauri-action` (builds + signs) |
| Artifacts | DEB/RPM, MSI/EXE/NSIS ZIP, DMG/APP tar.gz (includes `.sig` files for auto-updater) |
| Release | GitHub release (draft) with all artifacts; repo name read from `branding.json` |
| R2 publish | Uploads installers + `latest.json` to Cloudflare R2 CDN via `scripts/r2-upload.sh` |

## Distribution

| Channel | URL | Notes |
|---------|-----|-------|
| **Cloudflare R2 CDN** | `https://cdn.neumar.app/installer/neumar.dmg` | Primary distribution — stable download URLs |
| **Tauri auto-updater** | `https://cdn.neumar.app/latest.json` | Checked by the app on startup |
| **GitHub Releases** | `github.com/bravew/Neuma/releases` | Draft releases with all artifacts |

### R2 CDN Layout

```
neumar (R2 bucket)
├── latest.json                              # Updater manifest (5 min cache)
├── installer/
│   ├── neumar.dmg                           # Stable download links (1 hr cache)
│   ├── neumar-setup.exe
│   ├── neumar.msi
│   └── neumar.AppImage
└── releases/
    └── v26.4.4/
        ├── latest.json                      # Versioned copy (immutable)
        ├── Neumar_aarch64.app.tar.gz        # Updater bundles (immutable)
        ├── Neumar_aarch64.app.tar.gz.sig
        └── ...
```

### Publishing Locally

Publish build artifacts to R2 from your machine instead of waiting for CI:

```bash
# Prerequisites
brew install awscli

# Credentials — set in .env.local (already gitignored):
#   CF_ACCOUNT_ID=...
#   CF_R2_ACCESS_KEY_ID=...
#   CF_R2_SECRET_ACCESS_KEY=...

# Build + sign + upload in one step
pnpm release:build-and-publish:mac-arm

# Or step by step:
pnpm release:publish:dry              # preview what would be uploaded
pnpm release:publish                  # upload only (after a previous build)
```

**Available commands:**

| Command | Description |
|---------|-------------|
| `pnpm release:build-and-publish:mac-arm` | Build signed macOS ARM app + upload to R2 |
| `pnpm release:publish` | Upload existing build artifacts to R2 |
| `pnpm release:publish:dry` | Preview what would be uploaded |

### Auto-Updater

The app uses **Tauri's updater plugin** (`tauri-plugin-updater`) for seamless in-app updates:

1. On startup (5s delay) and every hour, the app fetches `https://cdn.neumar.app/latest.json`
2. If a newer version exists with a platform entry (e.g. `darwin-aarch64`), the Tauri updater downloads the `.app.tar.gz`, verifies the signature against the embedded public key, extracts, and replaces the app binary
3. User clicks "Restart" → `tauri-plugin-process` relaunches the app

**Fallback**: If the Tauri updater fails (e.g. missing platform in `latest.json`), the app falls back to a direct HTTP fetch of `latest.json` for version comparison, and opens the CDN download URL in the browser.

**TLS**: The updater uses `native-tls` (macOS Security.framework) instead of `rustls` to ensure proper system root certificate loading.

**Building with updater signing** (required for in-app updates):
```bash
pnpm release:build-and-publish:mac-arm    # sets signing env vars automatically
```

### Required Secrets

| Secret | Where | Purpose |
|--------|-------|---------|
| `CF_ACCOUNT_ID` | GitHub Actions + `.env.local` | Cloudflare account ID |
| `CF_R2_ACCESS_KEY_ID` | GitHub Actions + `.env.local` | R2 API token access key |
| `CF_R2_SECRET_ACCESS_KEY` | GitHub Actions + `.env.local` | R2 API token secret |

---

*See also: [System Overview](../system/overview.md) · [Configuration & Branding](../backend/configuration.md) · [Desktop Shell](../desktop/index.md) · [Code Signing](../deployment/code-signing-notarization.md)*
