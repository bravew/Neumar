---
summary: "Rationale behind key architectural choices — Tauri, sidecar API, SSE, i18n, database, pnpm, Linear, memory, and more"
read_when:
  - Understanding why a particular technology or pattern was chosen
  - Evaluating alternatives for a system component
  - Onboarding and learning the architecture rationale
title: "Design Decisions"
---

# Key Design Decisions

## Why Tauri over Electron?

Tauri provides a significantly smaller bundle size (~10MB vs ~100MB+), uses the system
webview instead of bundling Chromium, and offers fine-grained capability-based permissions.
The Rust backend enables efficient process and memory management for sidecar orchestration.

## Why a Sidecar API Instead of Embedded Node.js?

The agent SDKs (Claude, Codex) require a Node.js runtime. Rather than embedding Node.js
in the Rust binary, the API runs as a separate sidecar process:
- **Isolation** — API crashes don't take down the UI
- **Development ergonomics** — can develop/debug API independently
- **SDK compatibility** — native Node.js runtime for npm packages
- **Hot reload** — API can be restarted without restarting the entire app

## Why SSE over WebSockets?

Server-Sent Events provide a simpler protocol for the primary use case (server → client
streaming). The unidirectional nature matches the agent execution pattern. User actions
(approve, cancel) use separate HTTP requests.

## Why Custom i18n Instead of a Library?

The i18n needs are modest (6 languages, ~300 keys). A custom system provides type-safe
translations, zero bundle overhead, and simple nested object access without the complexity
of libraries like react-intl or i18next.

## Why Dual Database Backend?

SQLite (via Tauri plugin) is the primary persistence layer for the desktop app. IndexedDB
fallback enables running the frontend as a standalone web app during development without
Tauri, preserving the full development experience.

## Why pnpm Workspaces?

The monorepo structure with pnpm workspaces provides:
- Shared dependency deduplication
- Independent versioning for frontend and API
- Unified scripts for development, building, and testing
- Single lockfile for reproducible builds

## Why Webhook + Polling for Linear?

Webhooks are the primary mode for real-time ticket processing — Linear explicitly discourages
polling. However, polling is offered as a dev-only fallback for local development without
a tunnel. The UI clearly labels polling as "Dev Only" and shows a warning when enabled.

## Why Functional Services Instead of Classes?

All pipeline services (`linear.ts`, `pipeline.ts`, `slack.ts`) use the **functional pattern**
with module-level state and exported functions — matching the existing `agent.ts` and
`preview.ts` conventions. This provides:
- Simpler module-level singleton behavior (no `getInstance()` boilerplate)
- Tree-shakeable exports
- Consistency with the existing codebase conventions

## Why Configurable Pipeline Concurrency with Isolated Worktrees?

The pipeline supports configurable concurrency (`maxConcurrentPipelines`, default 3) using
**isolated git worktrees** per pipeline run. Each pipeline creates its own worktree from the
base repository, so concurrent executions never conflict — each has an independent working
tree, branch, and staging area. The concurrency cap is a safeguard against overwhelming
the host machine with CPU/memory and to stay within API rate limits.

## Why Hybrid Search (Vector + FTS5) for Memory?

Pure vector search excels at paraphrase matching ("I like TypeScript" matches "my preferred
language is TS") but misses exact tokens (IDs, environment variable names, code symbols).
FTS5 BM25 excels at exact keyword matching but lacks semantic understanding. Combining both
via Reciprocal Rank Fusion (RRF) provides the best of both worlds without needing score
normalization — RRF only uses rank positions, not raw scores.

## Why sqlite-vec Instead of a Separate Vector Database?

The application already uses SQLite for all persistence. Adding a separate vector database
(Pinecone, Qdrant, etc.) would increase complexity, add a network dependency, and break the
"offline-capable" design principle. `sqlite-vec` provides native vector search as a SQLite
extension, keeping everything in a single database file with zero additional infrastructure.

## Why Local Embedding Model as Default?

The default `gte-multilingual-base` model (768 dimensions, ~340 MB int8 ONNX) runs locally via
`onnxruntime-node` with `AutoTokenizer` for tokenization — no API calls, no API key, and no
network dependency. It supports ~75 languages with an 8192-token context window, covering all
locales supported by the application (en, zh, es, fr, hi, pt). The `@huggingface/transformers` pipeline
is bypassed because gte-multilingual-base uses a custom "NewModel" architecture class that
transformers.js v3 doesn't recognize; instead, we use `AutoTokenizer` (which works independently
of model class validation) + direct ONNX Runtime inference with mean pooling and L2
normalization. The model is pre-downloaded and bundled with the Tauri distribution package, so
the memory system works immediately out of the box with zero configuration and no first-launch
download. Cloud providers (OpenAI, Gemini) are offered as optional alternatives.

## Why Persist Pipeline State to Disk?

Pipeline state is written to `~/.<slug>/pipeline-state.json` on every status change
because the PR review loop can last up to 24 hours. Without persistence, an API server
restart (crash, update, or system reboot) would orphan active pipelines. On restart,
pipelines in `awaiting_review` status automatically resume their review polling loops.

---

*See also: [System Overview](overview.md) · [Security](../security/index.md)*
