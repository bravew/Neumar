# Getting Started

This guide walks you from a fresh clone to a running development environment.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | 20+ | LTS recommended |
| **pnpm** | 9+ | `npm install -g pnpm` |
| **Rust** | stable | `rustup install stable` |
| **Claude Code CLI** | latest | Required for agent execution |
| **Git** | 2.x+ | |

### macOS extras
```bash
xcode-select --install          # Command-line tools
brew install pkg-config openssl # Native deps for Rust crates
```

### Linux extras
```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

---

## Installation

### 1. Clone

```bash
git clone https://github.com/<org>/neuma.git
cd neuma
```

### 2. Install dependencies

```bash
pnpm install
```

This installs all workspace packages (frontend, API, and Tauri build tooling).

### 3. Configure Claude Code CLI

The agent system auto-detects `claude` from your `$PATH`. Install it from [claude.ai/code](https://claude.ai/code) if you haven't already.

Verify:
```bash
claude --version
```

### 4. Set your API key

The app reads your Anthropic API key from the Claude Code CLI's existing configuration. No additional setup is required if you have already authenticated with `claude`.

Alternatively, add your key in the app's **Settings → Providers** after the first launch.

---

## Development

### Start everything (recommended)

```bash
pnpm dev:all
```

This starts both the API server (port 5126) and the Tauri desktop app concurrently. Hot-reload is enabled for the frontend; the API requires a restart for server-side changes.

### Start services individually

```bash
pnpm dev:api     # API only — http://localhost:5126
pnpm dev:web     # Browser frontend only — http://localhost:3420
```

### First run

1. The app opens a **Setup** wizard on first launch.
2. Choose a **workspace directory** — all agent-generated files are written here.
3. Confirm your AI provider (Claude Code CLI auto-detected).
4. Submit a task from the **Home** page.

---

## Environment Variables

The API reads these variables at startup. None are required for basic use.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5126` | API server port |
| `WORKSPACE_DIR` | `~/neuma` | Default workspace root |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

> **Note:** In Tauri production builds, `process.cwd()` is unreliable. The API always reads `workDir` from the SQLite `settings` table instead. See [[Configuration]].

---

## Project Structure

```
neuma/
├── src/              # React 19 frontend
├── src-api/          # Hono 4 API server
├── src-tauri/        # Rust/Tauri desktop shell
├── branding/         # Brand assets and config
├── branding.json     # Active brand (auto-synced)
├── doc/              # Developer documentation
├── scripts/          # Build helper scripts
├── wiki/             # This GitHub Wiki
└── package.json      # pnpm workspace root
```

---

## Code Quality

Run all checks before committing:

```bash
pnpm validate          # lint + typecheck + format check (all workspaces)
pnpm lint:fix          # Auto-fix lint issues
pnpm format            # Auto-format with Prettier
```

Individual commands:
```bash
pnpm lint              # ESLint
pnpm typecheck         # tsc (frontend)
pnpm typecheck:all     # tsc (frontend + API)
pnpm format:check      # Prettier dry-run
```

---

## Testing

```bash
pnpm test:fast         # Frontend unit + API integration (no E2E, fast)
pnpm test:all          # All suites including E2E (slower)
pnpm test:watch        # Frontend interactive watch mode
pnpm test:api:watch    # API integration interactive watch
pnpm test:coverage     # Generate coverage reports
```

See [[Testing]] for full details on test architecture and writing new tests.

---

## Next Steps

- [[Architecture]] — Understand how the three layers fit together
- [[Agent System]] — How task planning and execution works
- [[Configuration]] — MCP servers, branding, provider setup
- [[Contributing]] — Coding conventions and PR workflow
