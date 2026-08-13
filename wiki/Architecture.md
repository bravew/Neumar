# Architecture

Neuma is a cross-platform desktop AI agent application built from three independently deployable layers that collaborate through well-defined interfaces.

---

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Tauri 2 Desktop Shell (Rust)                                   │
│                                                                 │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐ │
│  │  React 19 Frontend       │  │  Hono 4 API Server           │ │
│  │  (Vite / WebView)        │  │  (Node.js sidecar)           │ │
│  │                          │  │                              │ │
│  │  • Task UI               │  │  • Agent registry            │ │
│  │  • Plan approval         │  │  • MCP integration           │ │
│  │  • Artifact preview      │  │  • Memory system             │ │
│  │  • Settings              │  │  • Linear pipeline           │ │
│  │  • Voice I/O             │  │  • OAuth / integrations      │ │
│  └──────────┬───────────────┘  └──────────────┬───────────────┘ │
│             │ HTTP + SSE                       │ SQLite          │
│             └────────────────┬─────────────────┘                │
│                              │                                   │
│              ┌───────────────▼──────────────┐                   │
│              │  SQLite Database              │                   │
│              │  (tauri-plugin-sql)           │                   │
│              └──────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
         │                              │
    External Integrations         Local Resources
    • Anthropic Claude            • Workspace files
    • OpenAI                      • Sherpa-ONNX models
    • Linear                      • MCP servers
    • GitHub CLI                  • Skills
    • Slack                       • Logs
    • Google APIs
```

---

## Dual Runtime Model

The app behaves differently in development vs production — a deliberate architectural choice.

### Development
```
pnpm dev:all
├── Vite dev server → localhost:3420  (HMR, instant feedback)
└── Node API server → localhost:5126  (hot-restart with nodemon)
    └── Tauri window → loads localhost:3420
```

### Production
```
Tauri app bundle
├── Bundled frontend  (built by Vite, embedded in webview)
└── Sidecar binary    (Hono API compiled with pkg/Bun)
    └── Listens on port 2620
```

The sidecar model was chosen over embedding Node.js directly so:
- The API can use the full Claude Agent SDK without Tauri packaging constraints
- The API hot-reloads independently during development
- Production builds are fully self-contained (no Node.js installation required)

---

## Three Layers

### 1. Tauri Desktop Shell (`src-tauri/`)

**Language:** Rust
**Role:** OS integration, window management, SQLite bridge, sidecar lifecycle

Responsibilities:
- Spawn and kill the API sidecar binary
- Provide file system access (scoped capabilities)
- Host the WebView that renders the frontend
- Run SQLite via `tauri-plugin-sql` with versioned migrations
- Integrate native platform features (macOS CoreLocation for geolocation)

### 2. React Frontend (`src/`)

**Language:** TypeScript
**Role:** UI, user interaction, real-time streaming display

Key patterns:
- **React Router v7** with lazy-loaded pages (Suspense-based)
- **Dual database backend** — SQLite (Tauri) or IndexedDB (browser dev)
- **Streaming-first UI** — renders SSE events in real time via `useAgent` hook
- **Functional setState** in async callbacks to prevent stale closures
- **AbortController** cleanup on every `useEffect` fetch

### 3. Hono API Server (`src-api/`)

**Language:** TypeScript (Node.js)
**Role:** Agent orchestration, external integrations, persistent state

Core subsystems:
- **Agent registry** — plugin-based (Claude, Codex, DeepAgents)
- **MCP manager** — built-in + user-configured servers
- **Memory system** — SQLite + sqlite-vec ANN + FTS5
- **Linear pipeline** — autonomous ticket-to-PR orchestration
- **Speech service** — TTS/STT with multiple providers
- **OAuth system** — Google, Slack, Notion with PKCE
- **TaskEventBus** — fan-out SSE for cross-client observation

---

## Data Flow

### Task Execution

```
User types prompt
      │
      ▼
POST /agent/plan          ← Frontend sends task
      │
      ▼
SSE stream (plan events)  ← Agent generates task plan
      │
      ▼
User approves plan
      │
      ▼
POST /agent/execute
      │
      ▼
SSE stream (exec events)  ← Tool calls, file ops, MCP
      │
      ▼
Persist to SQLite          ← Messages, files, cost
      │
      ▼
TaskEventBus fan-out       ← Observer clients (cross-device)
```

See [[Agent System]] for the full two-phase execution lifecycle.

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Desktop framework | Tauri over Electron | ~10 MB bundle vs ~120 MB; Rust security |
| API architecture | Sidecar over embedded | SDK compatibility, hot reload in dev |
| Client↔Server | SSE over WebSockets | Simpler for server→client streaming; HTTP/2 compatible |
| i18n | Custom over library | Zero bundle overhead; type-safe |
| Database | SQLite (single file) | No separate DB process; offline; portable |
| Dev DB fallback | IndexedDB | Browser dev without Tauri context |
| Embeddings | sqlite-vec (in-SQLite) | No separate vector DB; keeps everything in one file |
| Local embeddings | ONNX (offline) | No API key required; privacy |
| Memory search | Hybrid vector+FTS5 | Semantic recall + keyword precision via RRF fusion |
| Pipeline | Sequential queue | Prevents concurrent workspace conflicts |
| Pipeline state | File-persisted | Survives restarts / crashes |
| Secrets | AES-256-GCM | Industry standard; PBKDF2 key derivation |

---

## Application Data Layout

Everything the app writes at runtime lives under `~/.<slug>/`:

```
~/.<slug>/                  (e.g., ~/.neuma/)
├── database.db             SQLite (all tables)
├── logs/<slug>.log         File-based log
├── mcp.json                App-specific MCP servers
├── linear.enc.json         AES-256-GCM encrypted Linear config
├── pipeline-state.json     Pipeline queue state (fault tolerance)
├── models/speech/          Sherpa-ONNX offline speech models
├── cache/embeddings/       ONNX embedding model cache
└── sessions/
    └── {sessionId}/
        ├── attachments/    User-uploaded files
        └── output/         Agent-generated artifacts

~/.claude/                  (Shared with Claude Code CLI)
├── settings.json           MCP server configuration
└── skills/                 Installed skills
```

---

## Monorepo Structure

The project uses pnpm workspaces:

```
package.json              Workspace root (scripts, dev tooling)
src/                      Workspace: frontend
src-api/                  Workspace: API server
src-tauri/                Tauri project (Rust, Cargo.toml)
```

All three packages share TypeScript tooling and ESLint/Prettier configuration defined at the root.

---

## Further Reading

- [[Frontend]] — React app structure, routing, state patterns
- [[Backend]] — Hono server, services, middleware
- [[Desktop Shell]] — Tauri configuration, SQLite migrations, sidecar
- [[Agent System]] — Two-phase execution, plugin registry
- [[Database Schema]] — All SQLite tables and indexes
