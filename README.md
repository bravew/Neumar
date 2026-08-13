<p align="center">
  <img src="public/logo.png" alt="Neumar logo" width="88" />
</p>

<h1 align="center">Neumar</h1>

<p align="center">
  Desktop AI agent workspace for tasks, design, video, automation, channels, and local knowledge.
</p>

<p align="center">
  <a href="https://github.com/bravew/Neumar/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/bravew/Neumar/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/bravew/Neumar/actions/workflows/security.yml"><img alt="Security" src="https://github.com/bravew/Neumar/actions/workflows/security.yml/badge.svg" /></a>
  <a href="https://github.com/bravew/Neumar/actions/workflows/build.yml"><img alt="Build" src="https://github.com/bravew/Neumar/actions/workflows/build.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" /></a>
</p>

<p align="center">
  <img src="https://neumar.app/images/neumar-hero.jpg" alt="Neumar desktop app screenshot" width="860" />
</p>

## What It Is

Neumar is a local-first desktop application that runs AI agent work from a React UI, a Hono API sidecar, and a Tauri shell. In development it runs Vite on port `3420` and the API on port `5126`. In production Tauri hosts the webview and starts the packaged API sidecar on port `2620`.

The app is built for long-running agent work: streaming tasks, workspace files, generated artifacts, design and video projects, approvals, memory, channel agents, and integrations that need local credentials or filesystem access.

## Features

| Area | Current capability |
|---|---|
| Agent workspace | Streaming task runs, task history, task detail views, branch and regenerate flows, file/artifact capture, preview servers, usage and budget tracking. |
| Agent runtimes | Claude Agent SDK, Codex SDK/CLI, OpenAI-compatible HTTP agents, local CLI adapters, MCP shims, runtime detection, install/update options, auth checks, and per-run approvals. |
| Local CLI support | Runtime catalog includes Claude Code, Codex CLI, Gemini CLI, OpenCode, Cursor Agent, DeepSeek TUI, GitHub Copilot CLI, Kiro, Hermes, Kimi, and Pi. |
| Providers | Presets for Anthropic Claude, OpenAI Codex, Gemini, OpenAI, Azure OpenAI, OpenRouter, BytePlus ModelArk, local OpenAI-compatible servers, and specialized media providers such as Hedra, HeyGen, OmniHuman, VEED Fabric, and ElevenLabs. |
| MCP and skills | Loads user and brand MCP config, exposes MCP bridge/runtime routes, ships built-in skills from `skills/`, and supports plugin-scoped prompt/tool behavior. |
| Plugin marketplace | Installed/built-in/remote plugins, manifest validation, marketplace sources, config values, trust tiers, capability grants, and surface-aware plugin use. |
| Design Mode | Project-based artifact creation for prototypes, documents, decks, images, audio, and design systems with prompt templates, skills, critique, previews, source editing, sketching, comments, imports, exports, and handoff packages. |
| Video Mode | Remotion and HTML video pipelines, project editor, timeline operations, templates, captions, narration/music, source analysis, auto-cut, reframe, transitions, overlays, render jobs, and Video MCP tools. |
| Automation | Routine scheduler, running/history views, approvals, agent profiles, queues, and Linear ticket-to-PR pipeline support. |
| Channels | Active runtime for Slack, Discord, Telegram, and Lark/Feishu via `ChannelManager`; Slack is the parity baseline with Block Kit, App Home, thread restore, reactions, and file upload. |
| Cloud and media libraries | Google Drive, Box, Dropbox, OneDrive, and Immich adapters, connection cache, path mappings, search, thumbnails, content jobs, timeline media views, and local asset catalog indexing. |
| Publish pipeline | Local archive plus Box, Dropbox, OneDrive, and Immich destination adapters, publish job ledger, per-leg approval, retry state, quotas, versioning policy, and resumable upload infrastructure. |
| Memory and retrieval | Long-term memory CRUD, hybrid search, sqlite-vec embeddings when available, embedding cache, entity graph, workspace RAG index, and Graphify knowledge graph rebuild/read APIs. |
| Speech and conversation | Speech routes, WebSocket support, local/provider STT and TTS settings, VAD dependencies, and conversation-oriented runtime hooks. |
| Desktop shell | Tauri 2 app with SQLite, filesystem/dialog/shell/process plugins, Stronghold API-key vault, keychain-backed vault password, notifications, autostart, updater, workspace watcher, capture, and sidecar management. |
| Branding | Product name, identifiers, theme, icons, sidecar binary name, and URLs come from `branding/<slug>/`; the active brand is synced from root `branding.json`. |

## Architecture

```text
src/          React 19, Vite 8, Tailwind CSS 4, Radix UI, app routes, modes, UI
src-api/      Hono 4 API, agent runtimes, MCP, channels, SQLite, media, Linear
src-tauri/    Tauri 2 Rust shell, native plugins, migrations, packaged sidecar
packages/     Workspace packages, including @neumar/video-ir
src-video/    Remotion marketing/docs media project
skills/       Repo-shipped agent skills
branding/     Brand configs and generated visual assets
dev-doc/      Runbooks, plans, rollout notes, and feature architecture docs
graphify-out/ Generated code graph report and artifacts
```

Core flow:

1. The frontend renders the mode shell, routes, settings, library, and project workspaces.
2. The Hono API owns agent execution, provider config, local DB access, background workers, channel runtimes, previews, media jobs, and integration bridges.
3. Tauri supplies desktop-only filesystem, SQLite, Stronghold, updater, shell, process, notifications, capture, and sidecar lifecycle APIs.
4. Generated files and app state stay under the configured workspace and local app data unless a user connects an external provider.

## Tech Stack

| Layer | Main technologies |
|---|---|
| Frontend | React `19.2`, Vite `8`, TypeScript `6`, Tailwind CSS `4`, Radix UI, React Router `7`, Zustand, Streamdown, Remotion Player |
| Backend | Hono `4`, Node `>=20`, Claude Agent SDK, OpenAI Codex SDK, MCP SDK, Linear SDK, better-sqlite3, sqlite-vec, Zod `4`, Remotion Renderer |
| Desktop | Tauri `2`, Rust, `tauri-plugin-sql`, `fs`, `shell`, `stronghold`, `updater`, `autostart`, `notification`, `process` |
| Quality | pnpm workspaces, oxlint, oxfmt, Vitest, Playwright, component size guard, eval gate |
| Release | `@yao-pkg/pkg` API sidecar binaries, Tauri bundles, GitHub Actions release/build workflows |

## Requirements

| Dependency | Version | Needed for |
|---|---:|---|
| Node.js | `>=20` | Frontend, API, scripts |
| pnpm | `>=9` | Workspace package manager. The repo pins `pnpm@11.8.0`. |
| Rust | `>=1.70` | Tauri desktop builds and `pnpm dev:app` |
| At least one agent runtime or provider | current | Claude Code, Codex CLI, Gemini CLI, OpenAI-compatible provider, or another supported runtime |

Optional integrations use their own credentials from Settings or `src-api/.env`, including Google OAuth, Slack/Discord/Telegram/Lark bots, Linear, GitHub, cloud storage, and media providers.

## Quick Start

```bash
pnpm install

# Fast browser development: API + Vite, no Tauri shell.
pnpm dev:both-web

# Full desktop app: API + Tauri.
pnpm dev:all
```

Useful split commands:

```bash
pnpm dev:api       # Hono API on http://localhost:5126
pnpm dev:web       # Vite frontend on http://localhost:3420
pnpm dev:app       # Tauri shell. predev syncs brand/skills and checks Rust.
```

Use `pnpm dev:both-web` for most React/API work. Use `pnpm dev:all` or `pnpm dev:app` when validating native Tauri behavior such as filesystem access, Stronghold, capture, notifications, sidecar behavior, or desktop-only plugins.

## Configuration

```bash
# Optional OAuth/provider environment file for the API workspace.
cp src-api/.env.example src-api/.env

# Switch the active brand.
pnpm brand:sync -- --brand=default
pnpm brand:sync -- --brand=<slug>

# Check generated brand files in CI mode.
pnpm brand:check
```

Only `branding/default/` is tracked. Custom brand folders are gitignored. Brand sync updates Tauri config, icons, theme values, sidecar binary names, and app metadata from `branding.json`.

Secrets are stored outside normal settings persistence:

- Frontend provider API keys use the Tauri Stronghold vault when running in desktop mode.
- Channel bot credentials are migrated out of SQLite into an AES-256-GCM vault file.
- OAuth tokens use encrypted stores and sanitized connection metadata where applicable.

## Common Commands

```bash
pnpm build                  # Vite frontend build
pnpm build:api              # API TypeScript build
pnpm test:fast              # Frontend + API Vitest suites
pnpm test                   # Frontend Vitest only
pnpm test:api               # API Vitest only
pnpm test:e2e               # API real-server E2E
pnpm test:e2e:browser       # Playwright browser E2E
pnpm test:gate              # Eval gate tier
pnpm validate               # Full local PR gate
```

`pnpm validate` runs brand checks, lint, project-specific consistency checks, locale parity, plugin registry checks, typechecks, format checks for both workspaces, and the 350-line component guard.

After editing `src/`, format touched files with:

```bash
npx oxfmt <file>
```

## Build And Release

```bash
./scripts/build.sh mac-arm
./scripts/build.sh mac-intel
./scripts/build.sh linux
./scripts/build.sh windows

# Options
./scripts/build.sh mac-arm --sign
./scripts/build.sh mac-arm --with-cli --sign
```

The build script reads `branding.json`, builds the API sidecar through `src-api`, downloads required model/runtime assets when needed, and produces Tauri bundles. `--with-cli` bundles Claude Code and Codex CLI with a shared Node runtime and produces a larger artifact.

Release helpers:

```bash
pnpm release:new
pnpm release:publish
```

For frequent local macOS ARM64 release publishing to Cloudflare R2, use the
single target below. It builds the API sidecar and Tauri app, signs and
notarizes the app/DMG, recreates the updater archive, stages only the fresh
artifacts for the current version, uploads them to R2, and purges the CDN cache
for the stable installer and updater manifest URLs.

```bash
pnpm release:local:r2:mac-arm

# Same workflow, but stop at a dry-run R2 upload.
pnpm release:local:r2:mac-arm:dry
```

Required local release credentials:

- Apple Developer ID signing identity in the login keychain.
- Apple notarization credentials in the environment or keychain profile accepted
  by `xcrun notarytool`.
- Tauri updater signing key: `TAURI_SIGNING_PRIVATE_KEY` (and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key has one) in `.env.local` or
  the shell — must match the `pubkey` in `src-tauri/tauri.conf.json`. The
  private key is **not** checked into the repo; CI reads it from the
  `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret.
- Cloudflare R2 credentials in `.env.local` or the shell:
  `CF_ACCOUNT_ID`, `CF_R2_ACCESS_KEY_ID`, `CF_R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET`, and `R2_PUBLIC_URL`.
- Optional cache purge credentials: `CF_API_TOKEN` and `CF_ZONE_ID`.

GitHub workflows cover release PR quality/test/build gates, dependency and security scanning, tagged desktop builds, release artifact publication, docs-media checks, evals, and Homebrew cask updates.

## Security Notes

- Server-side fetches must pass URL validation. Private IP ranges, cloud metadata hosts, and non-HTTPS targets are blocked except explicit localhost cases.
- File operations are expected to stay inside the configured workspace root.
- Agent and plugin capabilities are policy-gated through trust tiers, reviewed manifests, explicit grants, and approval flows.
- Logs use the shared logger with sensitive key/token redaction.
- High-impact publish and channel operations support approvals, audit logs, and per-provider isolation.

## Documentation

- [Architecture](./doc/ARCHITECTURE.md)
- [Agent instructions](./AGENTS.md)
- [Mode registry runbook](./dev-doc/runbooks/modes.md)
- [Video Mode runbook](./dev-doc/runbooks/video-mode.md)
- [Channel connectors runbook](./dev-doc/runbooks/channel-connectors.md)
- [Publish runbook](./dev-doc/runbooks/publish.md)
- [Graphify report](./graphify-out/GRAPH_REPORT.md)

## Repository Workflow

Branch from `main`, use Conventional Commits, keep PR titles under 70 characters, and run `pnpm validate` before review. Commit locally unless a maintainer explicitly asks for a push.

The automatic CI workflow is scoped to release PR branches or manual dispatch. For ordinary PRs, run the relevant local commands and manually trigger workflows when needed.

## Acknowledgments

Neumar's design draws on ideas from several open-source projects:

- [WorkAny](https://github.com/workany-ai/workany) — desktop AI agent workspace shape: streaming task runs, workspace-scoped file access, and provider/runtime management.
- [Open Design](https://github.com/nexu-io/open-design) (Apache 2.0) — Design Mode: project-based artifact creation, prompt templates, and critique/preview workflows.
- [OpenCut](https://github.com/OpenCut-app/OpenCut) (MIT) — Video Mode: timeline editing concepts and render pipeline structure.

See [LICENSES.md](./LICENSES.md) for third-party license notices.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, validation commands, and PR conventions. Please also read the [Code of Conduct](./CODE_OF_CONDUCT.md). Report security issues per [SECURITY.md](./SECURITY.md) rather than filing a public issue.

## License

Licensed under the [Apache License 2.0](./LICENSE). Third-party notices and license-sensitive references are tracked in [LICENSES.md](./LICENSES.md).
