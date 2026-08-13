---
summary: "Backend API directory structure, Hono server startup sequence, middleware stack, and error handling"
read_when:
  - Understanding the backend project layout
  - Working on server startup or middleware
  - Adding new API route groups
title: "Backend Overview"
---

# Backend API Overview (`src-api/`)

## Directory Structure

```
src-api/
├── src/
│   ├── app/
│   │   ├── api/                  # HTTP route handlers
│   │   │   ├── agent.ts          # Agent plan/execute endpoints (SSE) — V1
│   │   │   ├── ag-ui.ts          # AG-UI protocol streaming endpoint (V2)
│   │   │   ├── copilotkit.ts     # CopilotKit V2 runtime proxy
│   │   │   ├── sandbox.ts        # Sandbox command execution
│   │   │   ├── providers.ts      # Provider management endpoints
│   │   │   ├── mcp.ts            # MCP server configuration
│   │   │   ├── memory.ts         # Memory CRUD, search, config, reindex, import/export
│   │   │   ├── linear.ts         # Linear webhook receiver + pipeline API
│   │   │   ├── slack.ts          # Slack config, gateway control, channels, sessions
│   │   │   ├── speech.ts         # TTS/STT REST + WebSocket endpoints
│   │   │   ├── design.ts         # DesignMode projects, catalogs, media, import/export
│   │   │   ├── video.ts          # Video Mode projects, storyboards, timeline, render, linked sources
│   │   │   ├── cloud-storage.ts  # Cloud storage, personal media, stock catalog, LAN bridge routes
│   │   │   ├── assets.ts         # Centralized Assets Catalog (search, ingest, materialize, proxies, SSE events) — see assets-catalog.md
│   │   │   ├── preview.ts        # Vite preview server management
│   │   │   ├── files.ts          # File serving and listing
│   │   │   ├── health.ts         # Health check and dependency management
│   │   │   └── index.ts          # Route exports
│   │   └── middleware/
│   │       ├── cors.ts           # CORS middleware (origin allowlist)
│   │       └── index.ts          # Middleware exports
│   │
│   ├── config/
│   │   ├── constants.ts          # Ports, paths, default providers, model
│   │   ├── loader.ts             # Multi-source config loading with file watch
│   │   └── index.ts              # Config exports
│   │
│   ├── core/                     # Abstract core systems
│   │   ├── agent/
│   │   │   ├── base.ts           # BaseAgent abstract class
│   │   │   ├── types.ts          # Agent message types, plan types, options
│   │   │   ├── registry.ts       # Plugin registry for agent providers
│   │   │   ├── plugin.ts         # Agent plugin interface and built-in metadata
│   │   │   └── index.ts          # Agent module exports
│   │   └── sandbox/
│   │       ├── types.ts          # Sandbox types, capabilities, exec options
│   │       ├── registry.ts       # Plugin registry for sandbox providers
│   │       ├── pool.ts           # Reusable sandbox instance pool
│   │       ├── plugin.ts         # Sandbox plugin base class and metadata
│   │       └── index.ts          # Sandbox module exports
│   │
│   ├── extensions/               # Concrete implementations
│   │   ├── agent/
│   │   │   ├── claude/index.ts   # Claude Agent SDK integration
│   │   │   ├── codex/index.ts    # Codex agent integration
│   │   │   └── deepagents/index.ts # DeepAgents.js integration
│   │   ├── sandbox/
│   │   │   ├── native.ts         # Native process execution (no isolation)
│   │   │   ├── claude.ts         # Claude sandbox runtime (srt CLI)
│   │   │   ├── codex.ts          # Codex sandbox
│   │   │   └── index.ts          # Sandbox registration
│   │   └── mcp/
│   │       └── sandbox-server.ts # MCP server exposing sandbox tools
│   │
│   └── shared/                   # Cross-cutting utilities
│       ├── db/
│       │   ├── index.ts           # SQLite singleton (better-sqlite3), schema init
│       │   ├── operations.ts      # CRUD operations (tasks, messages, sessions, files)
│       │   └── types.ts           # Database entity types (Task, Message, etc.)
│       ├── mcp/
│       │   ├── loader.ts         # MCP config file reader
│       │   ├── linear-server.ts  # Built-in Linear MCP server (18 tools)
│       │   ├── media-server.ts   # Built-in Media Generation MCP server (4 tools)
│       │   ├── memory-server.ts  # Built-in Memory MCP server (4 tools)
│       │   ├── speech-server.ts  # Built-in Speech MCP server (4 tools: synthesize, transcribe, voices, capabilities)
│       │   └── slack-server.ts  # Built-in Slack MCP server
│       ├── integrations/
│       │   ├── cloud-storage/   # Cloud/personal media adapters, cache, LAN bridge, stock catalog proxies
│       │   └── google/          # Google Workspace service clients
│       ├── provider/
│       │   ├── loader.ts         # Provider configuration loading
│       │   ├── manager.ts        # Centralized provider lifecycle
│       │   ├── registry.ts       # Generic provider registry
│       │   └── types.ts          # Provider interfaces
│       ├── services/
│       │   ├── ag-ui/            # AG-UI protocol service layer
│       │   │   ├── emitter.ts    # Transforms AgentMessage generator → AG-UI BaseEvent generator
│       │   │   ├── transport.ts  # Detached pipeline runner + SSE subscriber
│       │   │   ├── persistence.ts # Stateful accumulator for streaming delta persistence
│       │   │   ├── history.ts    # DB rows → CopilotKit-compatible message converter
│       │   │   ├── custom-events.ts # Neuma-specific CUSTOM event schemas
│       │   │   └── index.ts      # Re-exports
│       │   ├── agent.ts          # Agent service orchestration
│       │   ├── linear-config.ts  # Linear config I/O with AES-256-GCM encryption
│       │   ├── linear.ts         # Linear SDK client, triage, webhook, poller, CRUD, search, org discovery
│       │   ├── media-generation/ # Media (image/video) generation service
│       │   │   ├── index.ts      # Public API re-exports
│       │   │   ├── types.ts      # Provider-agnostic interfaces (params, results, adapter)
│       │   │   ├── router.ts     # Provider discovery, adapter selection, generation dispatch
│       │   │   ├── registry.ts   # Pattern-based adapter factory registry
│       │   │   └── adapters/     # Vendor-specific implementations
│       │   │       ├── byteplus.ts  # BytePlus/Volcengine (Seedream, Seedance)
│       │   │       ├── openai.ts    # OpenAI (DALL-E, GPT-Image, Sora)
│       │   │       └── gemini.ts    # Google Gemini (Imagen, Veo)
│       │   ├── memory/           # Long-term memory system
│       │   │   ├── index.ts      # Public API + initialization (sqlite-vec, FTS5)
│       │   │   ├── types.ts      # Memory types, Zod schemas, row mapper
│       │   │   ├── config.ts     # Read/save memory config from settings table
│       │   │   ├── store.ts      # CRUD, embedding ops, cache, reindex engine
│       │   │   ├── embedder.ts   # Embedding service (local ONNX gte-multilingual-base / OpenAI / Gemini)
│       │   │   ├── retriever.ts  # Hybrid search (vec ANN + FTS5 BM25 + RRF fusion)
│       │   │   ├── capturer.ts   # Rule-based auto-capture + prompt injection guard
│       │   │   ├── llm-capturer.ts # LLM-based structured fact extraction
│       │   │   ├── recall.ts     # Auto-recall — inject memories into agent prompts
│       │   │   ├── flush.ts      # Pre-compaction memory flush
│       │   │   └── session-indexer.ts # Session transcript indexing + cross-session search
│       │   ├── speech/           # TTS / STT service
│       │   │   ├── index.ts      # Public API re-exports
│       │   │   ├── types.ts      # Provider-agnostic interfaces (SpeechAdapter, TTSParams, STTResult, etc.)
│       │   │   ├── router.ts     # Provider discovery, adapter selection, synthesis/transcription dispatch
│       │   │   ├── registry.ts   # Pattern-based adapter factory registry
│       │   │   ├── local-models.ts # Sherpa-ONNX model download, extraction, loading, status tracking
│       │   │   └── adapters/     # Vendor-specific implementations
│       │   │       ├── openai.ts      # OpenAI TTS (tts-1, gpt-4o-mini-tts) + Whisper STT
│       │   │       ├── deepgram.ts    # Deepgram streaming + batch STT (Nova-3)
│       │   │       ├── elevenlabs.ts  # ElevenLabs TTS (batch + streaming) + Scribe STT
│       │   │       └── local.ts       # Local Sherpa-ONNX offline TTS + STT
│       │   ├── design-mode/      # DesignMode project, catalog, prompt, media, lint, export services
│       │   ├── pipeline.ts       # Autonomous ticket-to-PR pipeline orchestrator
│       │   ├── pipeline-prompts.ts # Prompt templates per ticket type
│       │   ├── slack.ts          # Slack webhook notifications with retry
│       │   ├── slack-config.ts   # Slack config I/O with AES-256-GCM encryption
│       │   ├── slack-gateway.ts  # Bolt.js Socket Mode gateway (DMs, @mentions, EventEmitter)
│       │   ├── slack-cowork-handler.ts # Inbound message → agent dispatch bridge
│       │   ├── slack-format.ts   # Markdown → Slack mrkdwn converter
│       │   ├── task-event-bus.ts  # In-process pub/sub for cross-client task observation (V1 + V2)
│       │   └── preview.ts        # Vite preview server management
│       ├── channels/
│       │   └── workspace.ts      # Per-channel workspace isolation (resolveChannelWorkDir)
│       ├── skills/
│       │   ├── loader.ts         # SKILL.md file parser
│       │   └── index.ts          # Skills exports
│       ├── types/
│       │   └── agent.ts          # API-specific agent request types
│       ├── utils/
│       │   ├── logger.ts          # File-based logger (~/.<slug>/logs/)
│       │   ├── path-validator.ts  # Workspace path validation (OS-aware blocked paths, symlink resolution, permission checks)
│       │   └── paths.ts           # Path utilities
│       └── ws.ts                  # WebSocket singleton (initWebSocket / getUpgradeWebSocket / getInjectWebSocket)
│
├── package.json
└── tsconfig.json
```

## Server & Middleware

**Framework:** [Hono 4](https://hono.dev) — a lightweight, fast web framework with
`@hono/node-server` adapter.

**Startup sequence:**

1. Create Hono app instance
2. Initialize WebSocket support via `initWebSocket(app)` (`shared/ws.ts`) — must run before routes mount
3. Apply global middleware: CORS (origin allowlist), in-flight request tracker, JWT guard, body limit (10 MB default; 100 MB for `/agent`)
4. Mount all route handlers (synchronous at module level)
5. Register SIGTERM/SIGINT handlers for graceful shutdown
6. Load configuration via async `start()` function
7. Initialize database (better-sqlite3 singleton)
8. Initialize provider manager
9. Load Linear config and restore persisted pipeline state from disk
10. Auto-start Linear poller if previously enabled
11. Initialize memory system (load sqlite-vec, create virtual tables, FTS5 triggers)
12. Check for embedding dimension changes and trigger background reindex if needed
13. Start automation engine via `automationLifecycle.start()` — recovers missed fires, starts heartbeat timers and cron jobs
14. Bootstrap the cloud storage connection cache, including local Immich connections and site-proxied connection metadata
15. Start HTTP server on configured port (defaults to `5126` in dev, overridden via `PORT` env var)
16. Bind WebSocket to HTTP server via `getInjectWebSocket()(server)`

**Global middleware stack:**

| Middleware                 | Purpose                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `corsMiddleware`           | Origin allowlist (Vite dev, Tauri webview, production API) — rejects unknown origins       |
| `requestTrackerMiddleware` | Rejects new requests once shutdown starts and tracks active requests for graceful draining |
| `jwtMiddleware`            | Enforces WebUI JWT auth when remote/web mode is active                                     |
| `bodyLimit`                | 10 MB request body limit (100 MB for `/agent`) — returns `HTTPException` on overflow       |

**Error handling:** The global `onError` handler distinguishes Hono `HTTPException` (returns
structured JSON with the exception's status code) from unhandled errors (returns 500).

**Shutdown:** `stopAcceptingRequests()` closes the request gate, `drainRequests(5000)` waits up to 5 seconds for in-flight HTTP handlers, then the app stops token refresh/health monitors, queue manager, automation engine, Linear poller/pipelines, preview servers, memory, provider manager, channel manager, approval manager, and database before exiting cleanly.

---

_See also: [API Routes](api-routes.md) · [Agent System](agent-system.md) · [Assets Catalog](assets-catalog.md) · [Cloud Storage](cloud-storage.md) · [DesignMode Backend](design-mode.md) · [Video Mode Backend](video-mode.md) · [Configuration](configuration.md)_
