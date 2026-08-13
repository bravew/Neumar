# CLAUDE.md

Desktop AI agent app: React 19 + Vite frontend (`src/`), Hono + Claude Agent SDK backend (`src-api/`), Tauri 2 + Rust shell (`src-tauri/`). Product identity configured in `/branding.json`.

## Commands

```bash
pnpm dev:all                  # API server + Tauri desktop app
pnpm dev:api                  # API server only (port 5126)
pnpm dev:web                  # Web frontend only (port 3420) — fastest HMR, no Tauri cache
pnpm dev:app                  # Tauri shell — predev:app runs brand:sync + check-rust + ensure-api-binary first
pnpm validate                 # brand:check + lint + typecheck:all + format:check + check:component-size
```

Branding: `pnpm brand:sync -- --brand=<slug>` swaps `branding.json`, icons, and theme. Only `branding/default/` is tracked in git — custom brand folders are gitignored. `predev:app` and `prebuild` run `brand-sync.js` automatically.

### Tests

```bash
pnpm test:fast                # Frontend + API unit/integration (fast default)
pnpm test                     # Frontend Vitest only (vitest.config.ts)
pnpm test:api                 # API Vitest (src-api/vitest.config.ts)
pnpm test:e2e                 # Real server spawn (src-api/vitest.e2e.config.ts)
pnpm test:all                 # test + test:api + test:e2e + test:e2e:browser — heavy, runs Playwright
pnpm test:gate                # Eval gate tier (EVALS_TIER=gate)
pnpm vitest run path/to/file  # Single file
pnpm test -t 'pattern'        # Single test by title
```

Test layout: `src/__tests__/` (React Testing Library), `src-api/test/unit/` (mocked), `src-api/test/integration/` (Hono `app.request`), `src-api/test/e2e/` (real server spawn).

## Architecture

```
src/
  app/pages/          Route pages (Home, TaskDetail, Library, Setup)
  components/         By feature (task, settings, library, layout, ui)
  shared/             Hooks, database, utilities, providers
  config/locale/      i18n messages (en, zh, es, fr, hi, pt)
src-api/
  src/core/agent/     BaseAgent + registry → extensions/agent/{claude,codex,deepagents}
  src/app/api/        Hono routes: agent, providers, mcp, linear, files, health
  src/shared/         MCP, provider manager, services (Linear pipeline)
src-tauri/            Rust shell, SQLite, sidecar config
```

- **Dev**: Vite (3420) + Node API (5126). **Prod**: Tauri webview + API sidecar binary (2620)
- **DB**: SQLite (Tauri) / IndexedDB (browser). Tables: sessions, tasks, messages, files
- **MCP**: Loads from `~/.claude/settings.json` and `~/.<slug>/mcp.json` — `<slug>` comes from `branding.json` and changes when brand-sync runs
- **Modes**: Sidebar modes are registry-driven; adding one starts in `src/shared/modes/modes.builtin.ts` and follows `dev-doc/runbooks/modes.md`. Video Mode operations are documented in `dev-doc/runbooks/video-mode.md`.
- **Path alias**: `@/*` is **scoped per workspace** — resolves to `src/*` from the frontend tsconfig and to `src-api/src/*` from `src-api/tsconfig.json`. Imports do not cross the boundary.

### Channels runtime

- Active multi-channel runtime: `src-api/src/shared/channels/{slack,discord,telegram,lark}/` loaded by `ChannelManager` (`channel-manager.ts`), started in `src-api/src/index.ts` via `getChannelManager().loadAndStartAll()`.
- Slack (`shared/channels/slack/`) is the parity baseline — interactive Block Kit forms, App Home, assistant threads, reactions, file uploadV2, bot-thread tracking with DB restore. Other providers are catching up; current plan: `dev-doc/plan/05-29-Channels/`.
- A separate generic gateway tree under `src-api/src/shared/services/gateway/channels/` exists as reference / migration target — **not** the active runtime.
- A legacy Slack Gateway (`src-api/src/shared/services/slack-gateway.ts` + `/slack/gateway/*`) is distinct from the channels runtime and used by `SlackGatewaySettings.tsx` only.

## Conventions

- **Workspace isolation**: All file ops confined to user-configured workspace directory
- **Streaming-first**: Long-running ops use async generators
- **Import sorting**: oxfmt built-in `sortImports` (configured in `.oxfmtrc.jsonc`)
- **Styling**: Tailwind CSS 4, Radix UI primitives, `cn()` for conditional classes
- **i18n**: All user-visible strings via `useLanguage()` hook — always update all 6 locales (en, zh, es, fr, hi, pt)
- **Components**: Max 350 lines — hard-enforced by `scripts/check-component-size.mjs` as part of `pnpm validate` / CI; extract sub-components when exceeded
- **Formatting**: After writing or editing any `src/` file, run `npx oxfmt <file>` before calling `pnpm validate` — this avoids lint failures from formatting diffs
- **Linting**: Uses oxlint (Rust-based, ~50x faster than ESLint). Config in `.oxlintrc.json` / `src-api/.oxlintrc.json`

## Rules

### Git workflow

- **Commit locally, don't push**: When making code changes, commit to the current branch but do NOT run `git push` unless the user explicitly asks. Batching pushes lets the user review the local history before it goes remote.
- **Don't run `pnpm test:all` casually**: it spawns Playwright + real-server E2E processes. `pnpm test:fast` is the everyday default; reach for `test:all` only before a release.

### Codacy (optional)

If the Codacy MCP server is connected, run `codacy_cli_analyze` after edits per `.cursor/rules/codacy.mdc`. Otherwise ignore — it is not required for local development.

### Security

- **SSRF**: Validate user-supplied URLs before server-side `fetch()` — block private IPs (`10.*`, `172.16-31.*`, `192.168.*`, `169.254.*`), cloud metadata hostnames, non-HTTPS (except localhost)
- **GitHub Actions**: Never interpolate `${{ }}` in `run:` blocks — use `env:` blocks, validate format

### Backend (`src-api/`)

- **Logging**: Use `createLogger('Name')` from `@/shared/utils/logger` — never `console.*`
  ```typescript
  import { createLogger } from '@/shared/utils/logger';
  const logger = createLogger('MyService');
  ```
- **Workspace root**: Never use `process.cwd()` (wrong in Tauri sidecar) — use `getSetting('workDir')`
  ```typescript
  import { getSetting } from '@/shared/db/operations';
  const workspaceRoot = getSetting('workDir') ?? process.cwd();
  ```
- **Hono status types**: Use `ContentfulStatusCode` from `hono/utils/http-status` for dynamic HTTP status codes passed to `c.json()`
- **Upstream errors**: Forward meaningful HTTP status codes (401, 403, 502) — don't swallow to 200

### Frontend (`src/`)

- **Stale closures**: In `useCallback` with sparse deps, read current values from refs — not from state captured at creation time
- **Functional setState**: Use updater form `setState(prev => ...)` when reading current state in async callbacks — never close over state during streaming
- **Effect cleanup**: Every `fetch()` in `useEffect` must use `AbortController` aborted in cleanup — prevents state updates after unmount and handles React 19 StrictMode double-mount
- **Effects vs user intent**: When effects auto-update UI state, track user interactions with a ref and skip auto-behavior if the user has manually acted
- **try/catch/finally**: Never unconditionally overwrite error status in `finally` — use a flag to track whether catch ran
- **IDs**: Use `crypto.randomUUID()` — never `Date.now()` (collisions on rapid calls)
- **Module-level constants**: Extract regex, config objects, and stable props (e.g. plugin configs) to module scope — inline objects break memoization

## Tech Stack

| Layer | Key Dependencies |
|-------|-----------------|
| Frontend | React 19, Vite 7, Tailwind CSS 4, Radix UI, react-router-dom 7, react-markdown |
| Backend | Hono 4, @anthropic-ai/claude-agent-sdk, @modelcontextprotocol/sdk, @linear/sdk, Zod 4 |
| Desktop | Tauri 2, tauri-plugin-sql (SQLite), tauri-plugin-shell, tauri-plugin-fs |
| Build | pnpm workspaces, esbuild, @yao-pkg/pkg, TypeScript 5.8 |
| Quality | oxlint (linter), oxfmt (formatter) |

## graphify

This project has a graphify knowledge graph at `graphify-out/` (built by the [graphifyy](https://pypi.org/project/graphifyy/) PyPI package — two y's; CLI binary is `graphify`).

Rules:
- Before answering architecture or codebase questions, read `graphify-out/GRAPH_REPORT.md` for god nodes and community structure.
- If `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files.
- The neuma desktop app rebuilds `graphify-out/` on demand via Library → Knowledge Graph → "Rebuild now" (POST `/graphify/rebuild`).

When working outside the app, prefer `uv` (it picks a compatible Python ≥3.10 and avoids polluting the system interpreter):

```bash
# One-shot rebuild (no install, ephemeral environment)
uv tool run --from graphifyy graphify update .

# Or install once, then run directly
uv tool install graphifyy
graphify update .                # re-extract code files (no LLM)
graphify watch .                 # auto-rebuild on file changes
```

If `uv` is not available, fall back to `pipx install graphifyy` then `graphify update .`. Avoid the legacy `python3 -c "from graphify.watch import _rebuild_code; ..."` snippet — it imports a private API that was removed after graphifyy 0.3.x.
