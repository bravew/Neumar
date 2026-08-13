# Backend

The backend is a Hono 4 HTTP server running on Node.js. In development it listens on port **5126**; in production it runs as a compiled sidecar binary on port **2620**.

---

## Directory Structure

```
src-api/
├── src/
│   ├── app/
│   │   ├── api/              HTTP route handlers
│   │   │   ├── agent.ts      Plan/execute/subscribe SSE
│   │   │   ├── sandbox.ts    Sandboxed code execution
│   │   │   ├── providers.ts  Provider management
│   │   │   ├── mcp.ts        MCP server config
│   │   │   ├── memory.ts     Memory CRUD + search
│   │   │   ├── linear.ts     Linear webhook + pipeline
│   │   │   ├── slack.ts      Slack config + gateway
│   │   │   ├── speech.ts     TTS/STT REST + WebSocket
│   │   │   ├── preview.ts    Vite preview server
│   │   │   ├── files.ts      File serving
│   │   │   ├── health.ts     Health check
│   │   │   └── auth.ts       OAuth PKCE flow
│   │   └── middleware/
│   │       └── cors.ts       Origin allowlist
│   │
│   ├── config/
│   │   ├── constants.ts      Ports, paths, default values
│   │   └── loader.ts         Config loading + file watch
│   │
│   ├── core/
│   │   ├── agent/            BaseAgent + registry
│   │   └── sandbox/          Sandbox types + registry + pool
│   │
│   ├── extensions/
│   │   ├── agent/
│   │   │   ├── claude/       Claude Agent SDK integration
│   │   │   ├── codex/        Codex integration
│   │   │   └── deepagents/   DeepAgents integration
│   │   ├── sandbox/          Native / Claude / Codex sandbox
│   │   └── mcp/              Sandbox MCP server
│   │
│   └── shared/
│       ├── db/               SQLite singleton + operations
│       ├── mcp/              Built-in MCP servers (Linear, Media, Memory, …)
│       ├── provider/         Provider manager + registry
│       ├── services/         Business logic (agent, memory, speech, pipeline, …)
│       ├── skills/           SKILL.md loader
│       ├── auth/             OAuth client + token manager
│       ├── automation/       Cron / webhook / heartbeat triggers
│       ├── integrations/     Google, Slack, Notion API clients
│       └── utils/            Logger, path validator, paths
│
└── test/
    ├── integration/api/      Hono app.request() tests
    └── e2e/                  Real server spawn tests
```

---

## Server Startup Sequence

```
index.ts
  ├── Init SQLite (migrations)
  ├── Init provider manager
  ├── Init MCP servers
  ├── Register agent plugins
  ├── Register sandbox plugins
  ├── Start automation engine
  ├── Mount Hono routes
  └── serve() on PORT
```

On shutdown (SIGTERM/SIGINT):
1. Persist pipeline state to `~/.<slug>/pipeline-state.json`
2. Kill sandbox processes
3. Flush memory write queue
4. Close SQLite connection

---

## Middleware Stack

All routes go through:

1. **CORS** — Origin allowlist: `localhost:3420`, `localhost:5126`, `tauri://localhost`
2. **Body limit** — 10 MB max
3. **Zod validation** — Per-route request schema

---

## Logging

All server-side code uses the project logger — never `console.*`:

```typescript
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('MyService');
logger.info('Starting…');
logger.error('Failed', { error });
```

Logs write to `~/.<slug>/logs/<slug>.log`.

---

## Workspace Root

**Never use `process.cwd()`** in the API — it points to the wrong directory in the Tauri sidecar:

```typescript
import { getSetting } from '@/shared/db/operations';
const workspaceRoot = getSetting('workDir') ?? process.cwd();
```

---

## Hono HTTP Status Types

Use `ContentfulStatusCode` from `hono/utils/http-status` when passing dynamic status codes to `c.json()`:

```typescript
import type { ContentfulStatusCode } from 'hono/utils/http-status';
return c.json({ error: 'Upstream error' }, status as ContentfulStatusCode);
```

---

## Error Handling Conventions

- **Forward meaningful HTTP status codes** — don't swallow upstream 401/403/502 to 200
- **Log at source** — attach context (task ID, provider) to log calls
- **Zod parse errors** → 422 with validation details
- **Agent errors** → streamed as SSE `error` events then connection closed

---

## Services Layer

Business logic lives in `src/shared/services/`. Key services:

| Service | File | Purpose |
|---|---|---|
| `agent` | `agent.ts` | Orchestrates agent execution with session context |
| `pipeline` | `pipeline.ts` | Linear → PR autonomous pipeline |
| `TaskEventBus` | `task-event-bus.ts` | SSE fan-out for cross-client observation |
| `memory` | `memory/` | Long-term memory CRUD + hybrid search |
| `speech` | `speech/` | TTS/STT with provider adapters |
| `media-generation` | `media-generation/` | Image/video generation (DALL-E, Sora, Gemini) |
| `linear` | `linear.ts` | Linear SDK client + pipeline processing |
| `slack` | `slack.ts` | Slack notification sender |
| `slack-gateway` | `slack-gateway.ts` | Slack Socket Mode gateway |
| `linear-config` | `linear-config.ts` | AES-256-GCM config read/write |

All services follow the **functional pattern**: module-level state with exported functions (no classes). This simplifies testing and avoids `this` binding issues.

---

## Provider System

The provider manager (`src/shared/provider/`) manages active AI providers:

```
ProviderManager
├── Registry    (available providers)
├── Loader      (config from settings.json / DB)
└── Lifecycle   (activate / deactivate / switch)
```

Providers include Claude (multiple models), Codex, and others. The active provider is stored in the `settings` DB table and respected across restarts.

---

## Agent Plugins

Three agent implementations are registered at startup:

| Plugin | Class | Backend |
|---|---|---|
| `claude` | `ClaudeAgent` | `@anthropic-ai/claude-agent-sdk` |
| `codex` | `CodexAgent` | OpenAI Codex CLI |
| `deepagents` | `DeepAgentsAgent` | DeepAgents API |

All extend `BaseAgent` and implement the two-phase execution interface. See [[Agent System]] for details.

---

## Sandbox Plugins

Sandboxes provide isolated code execution:

| Plugin | Description |
|---|---|
| `native` | Direct process spawn (workspace-scoped) |
| `claude` | `srt` CLI execution |
| `codex` | Codex sandbox execution |

---

## MCP Integration

Built-in MCP servers are started at API init:

| Server | Tools | Purpose |
|---|---|---|
| Sandbox | 2 | Run shell commands |
| Linear | 18 | Issue/project/comment CRUD |
| Media | 4 | Image/video generation |
| Memory | 4 | Long-term memory access |
| Google | 79 | Gmail, Drive, Calendar, etc. |
| Speech | 4 | TTS/STT from agent tools |

Plus all user-configured servers from `~/.claude/settings.json` and `~/.<slug>/mcp.json`. See [[MCP Integration]].

---

## Testing

The API has two test suites:

### Integration tests (`test/integration/`)
Use `app.request()` — no real HTTP, fast feedback:
```typescript
const res = await app.request('/health');
expect(res.status).toBe(200);
```

### E2E tests (`test/e2e/`)
Spawn a real server with `spawnApiInstance()`:
```typescript
const { url, kill } = await spawnApiInstance();
const res = await fetch(`${url}/health`);
await kill();
```

Coverage thresholds: **70%** lines/functions/statements, **55%** branches.

---

## Further Reading

- [[Architecture]] — How the API fits in the overall system
- [[Agent System]] — BaseAgent, plugins, two-phase execution
- [[MCP Integration]] — Built-in and user MCP servers
- [[Memory System]] — Hybrid search implementation
- [[Linear Pipeline]] — Autonomous pipeline orchestration
- [[API Reference]] — All HTTP endpoints
- [[Security]] — SSRF, workspace isolation, encryption
