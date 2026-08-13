# AGENTS.md

Guidance for AI coding agents (OpenAI Codex, Cursor, OpenCode, Aider, etc.) working in this repository. Format follows the [agents.md](https://agents.md/) open standard. Mirrors `CLAUDE.md` — keep both in sync when editing.

## Project overview

Desktop AI agent application:

- **Frontend** (`src/`) — React 19 + Vite 7 + Tailwind CSS 4 + Radix UI.
- **Backend** (`src-api/`) — Hono 4 + `@anthropic-ai/claude-agent-sdk` + `@modelcontextprotocol/sdk` + `@linear/sdk`. Hosted as a Node server in dev (port 5126) and as a packaged sidecar binary in production (port 2620).
- **Desktop shell** (`src-tauri/`) — Tauri 2 + Rust, with `tauri-plugin-sql` (SQLite), `tauri-plugin-shell`, `tauri-plugin-fs`.
- **Branding** — product name, identifiers, theme, and icons live per brand under `branding/<slug>/`. Active brand selected via `branding.json` at the repo root. Only `branding/default/` is checked in; custom brand folders are gitignored.

## Setup commands

```bash
pnpm install                  # install all workspace deps

pnpm dev:all                  # API server + Tauri desktop app
pnpm dev:api                  # API only (port 5126)
pnpm dev:web                  # Web frontend only (port 3420) — fastest HMR, no Tauri cache
pnpm dev:app                  # Tauri shell — predev:app runs brand:sync + check-rust + ensure-api-binary first
```

Branding switch: `pnpm brand:sync -- --brand=<slug>`. `predev:app` and `prebuild` run brand-sync automatically. Default is `default`.

Required toolchain: Node ≥20, pnpm ≥9. Rust ≥1.70 only for Tauri builds.

## Build and release

```bash
pnpm build                                # frontend (Vite)
pnpm build:api                            # API workspace
./scripts/build.sh mac-arm                # full desktop build (mac-arm | mac-intel | linux | windows)
./scripts/build.sh mac-arm --sign         # default notarized release build, no bundled CLIs
./scripts/build.sh mac-arm --with-cli --sign   # optional oversized build with bundled CLIs
pnpm release:new                          # bump + tag flow
pnpm release:publish                      # publish artifacts
```

## Test commands

```bash
pnpm test:fast                # Frontend + API unit/integration (everyday default)
pnpm test                     # Frontend Vitest only (vitest.config.ts)
pnpm test:api                 # API Vitest (src-api/vitest.config.ts)
pnpm test:e2e                 # Real server spawn (src-api/vitest.e2e.config.ts)
pnpm test:gate                # Eval gate tier (EVALS_TIER=gate)
pnpm vitest run path/to/file  # Run a single file
pnpm test -t 'pattern'        # Run a single test by title
```

`pnpm test:all` spawns Playwright + real-server processes. Don't run it casually — reserve it for pre-release sweeps.

Test layout:
- `src/__tests__/` — React Testing Library
- `src-api/test/unit/` — mocked unit tests
- `src-api/test/integration/` — Hono `app.request` integration
- `src-api/test/e2e/` — real server spawn

## Validation gate

Run before opening a PR:

```bash
pnpm validate    # brand:check + lint + typecheck:all + format:check + check:component-size
```

Components are capped at **350 lines** — `scripts/check-component-size.mjs` enforces this in CI.

After editing any `src/` file, format it before validating to avoid lint failures:

```bash
npx oxfmt <file>
```

Linting uses [oxlint](https://oxc.rs/) (Rust-based, ~50× faster than ESLint). Configs in `.oxlintrc.json` (frontend) and `src-api/.oxlintrc.json` (backend).

## Code style

- **TypeScript** strict (`tsconfig.json`, `src-api/tsconfig.json`). Target Node ≥20 / modern browsers.
- **Path alias** `@/*` is **scoped per workspace** — resolves to `src/*` from the frontend tsconfig and to `src-api/src/*` from `src-api/tsconfig.json`. Do not import across the boundary.
- **Imports** sorted by oxfmt's built-in `sortImports` (configured in `.oxfmtrc.jsonc`).
- **IDs** use `crypto.randomUUID()` — never `Date.now()` (collisions on rapid calls).
- **Module-level constants** — extract regex, config objects, and stable props (e.g. plugin configs) to module scope; inline objects break React memoization.

### Frontend conventions (`src/`)

- **Styling** — Tailwind CSS 4, Radix UI primitives, `cn()` helper for conditional classes.
- **i18n** — every user-visible string goes through `useLanguage()`. Update **all 6 locales** (`en`, `zh`, `es`, `fr`, `hi`, `pt`) in `src/config/locale/`.
- **Stale closures** — in `useCallback` with sparse deps, read current values from refs, not state captured at creation.
- **Functional setState** — use `setState(prev => …)` when reading current state in async callbacks; never close over state during streaming.
- **Effect cleanup** — every `fetch()` in `useEffect` must use `AbortController` aborted in cleanup. Required for React 19 StrictMode double-mount.
- **Effects vs user intent** — track manual interactions with a ref and skip auto-effects after the user has acted.
- **try/catch/finally** — never unconditionally overwrite error status in `finally`; use a flag to track whether `catch` ran.

### Backend conventions (`src-api/`)

- **Logging** — `createLogger('Name')` from `@/shared/utils/logger`; never `console.*`.
  ```ts
  import { createLogger } from '@/shared/utils/logger';
  const logger = createLogger('MyService');
  ```
- **Workspace root** — never `process.cwd()` (wrong in the Tauri sidecar). Use:
  ```ts
  import { getSetting } from '@/shared/db/operations';
  const workspaceRoot = getSetting('workDir') ?? process.cwd();
  ```
- **Hono dynamic status types** — use `ContentfulStatusCode` from `hono/utils/http-status` when passing dynamic codes to `c.json()`.
- **Upstream errors** — forward meaningful HTTP status (401, 403, 502); don't swallow to 200.

## Architecture

```
src/
  app/pages/          Route pages (Home, TaskDetail, Library, Setup)
  components/         By feature (task, settings, library, layout, ui)
  shared/             Hooks, database, utilities, providers
  config/locale/      i18n messages (en, zh, es, fr, hi, pt)
src-api/
  src/core/agent/     BaseAgent + registry → extensions/agent/{claude,codex,deepagents}
  src/app/api/        Hono routes: agent, providers, mcp, linear, files, health, channels, graphify
  src/shared/         MCP, provider manager, services (Linear pipeline, channels, graphify)
src-tauri/            Rust shell, SQLite, sidecar config
branding/             Per-brand assets and config (only branding/default/ is in git)
```

- **Dev** — Vite (3420) + Node API (5126).
- **Prod** — Tauri webview + API sidecar binary (2620).
- **DB** — SQLite (Tauri) / IndexedDB (browser). Tables: `sessions`, `tasks`, `messages`, `files`.
- **MCP** — loads from `~/.claude/settings.json` and `~/.<slug>/mcp.json`. `<slug>` comes from `branding.json` and changes when `brand:sync` runs.
- **Modes** — sidebar modes are registry-driven; adding one starts in `src/shared/modes/modes.builtin.ts` and follows `dev-doc/runbooks/modes.md`. Video Mode operations are documented in `dev-doc/runbooks/video-mode.md`.

### Channels runtime

- Active multi-channel runtime: `src-api/src/shared/channels/{slack,discord,telegram,lark}/`, loaded by `ChannelManager` (`channel-manager.ts`), started in `src-api/src/index.ts` via `getChannelManager().loadAndStartAll()`.
- **Slack** is the parity baseline — interactive Block Kit forms, App Home, assistant threads, reactions, file `uploadV2`, bot-thread tracking with DB restore. Other providers are catching up; current plan: `dev-doc/plan/05-29-Channels/`.
- A separate generic gateway tree under `src-api/src/shared/services/gateway/channels/` is reference / migration target — **not** the active runtime.
- The legacy Slack Gateway (`src-api/src/shared/services/slack-gateway.ts` + `/slack/gateway/*`) is distinct and used only by `SlackGatewaySettings.tsx`.

## Security

- **SSRF** — validate user-supplied URLs before any server-side `fetch()`. Block private IPs (`10.*`, `172.16-31.*`, `192.168.*`, `169.254.*`), cloud metadata hostnames, non-HTTPS (except localhost). Use the helper in `@/shared/utils/url-validator`.
- **GitHub Actions** — never interpolate `${{ … }}` in `run:` blocks. Use `env:` blocks and validate format.
- **Workspace isolation** — all file operations stay confined to the user-configured workspace directory.

## Commit and PR conventions

- Branch from the current `main`. Conventional Commits style (`feat:`, `fix:`, `chore(release):`, etc.) — see `git log` for examples.
- **Commit locally, do not push** unless the user explicitly asks. Batching pushes lets them review local history first.
- Run `pnpm validate` before requesting a review.
- PR title ≤70 chars; body explains *why*, not just *what*.

## Tech stack snapshot

| Layer | Key dependencies |
|---|---|
| Frontend | React 19, Vite 7, Tailwind CSS 4, Radix UI, react-router-dom 7, react-markdown |
| Backend | Hono 4, `@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk`, `@linear/sdk`, Zod 4 |
| Channels | `@slack/bolt` 4, `@slack/web-api` 7, `discord.js` 14, `grammy` 1, `@larksuiteoapi/node-sdk` 1 |
| Desktop | Tauri 2, `tauri-plugin-sql` (SQLite), `tauri-plugin-shell`, `tauri-plugin-fs` |
| Build | pnpm workspaces, esbuild, `@yao-pkg/pkg`, TypeScript 5.8 |
| Quality | oxlint, oxfmt |

## Graphify knowledge graph

This project ships a graph at `graphify-out/` built by the [graphifyy](https://pypi.org/project/graphifyy/) PyPI package (two y's; CLI binary is `graphify`).

- Before answering architecture or codebase questions, read `graphify-out/GRAPH_REPORT.md` for god-nodes and community structure.
- If `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files.
- The desktop app rebuilds the graph via Library → Knowledge Graph → "Rebuild now" (POST `/graphify/rebuild`).

When working outside the app, prefer `uv` (it picks a compatible Python ≥3.10 and avoids polluting the system interpreter):

```bash
# One-shot rebuild (no install, ephemeral environment)
uv tool run --from graphifyy graphify update .

# Or install once, then run directly
uv tool install graphifyy
graphify update .                # re-extract code files (no LLM)
graphify watch .                 # auto-rebuild on file changes
```

Fallback if `uv` isn't available: `pipx install graphifyy && graphify update .`.

Avoid the legacy `python3 -c "from graphify.watch import _rebuild_code; …"` snippet — it imports a private API that was removed after graphifyy 0.3.x.

## Codacy (optional)

If the Codacy MCP server is connected, run `codacy_cli_analyze` after edits per `.cursor/rules/codacy.mdc`. Otherwise ignore — it is not required for local development.

## Sync

This file mirrors `CLAUDE.md`. When updating either, update both. Subdirectory `AGENTS.md` files (if introduced for monorepo subprojects) take precedence per the agents.md spec — keep them small and link back here for shared rules.
