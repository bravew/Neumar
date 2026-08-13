# API Reference

The Hono 4 API server exposes HTTP endpoints and SSE streams. All endpoints are under `http://localhost:5126` in development and `http://localhost:2620` in production.

All request bodies are JSON unless noted. All responses are JSON unless noted.

---

## Agent (`/agent`)

### `POST /agent/plan`

Start the planning phase for a new task. Returns an SSE stream.

**Request:**
```json
{
  "taskId": "string",
  "prompt": "string",
  "attachments": ["string"],
  "locale": "en | zh | es | fr",
  "platform": "string",
  "geolocation": { "lat": 0.0, "lon": 0.0 }
}
```

**Response:** `text/event-stream`
```
data: {"type":"session","sessionId":"..."}
data: {"type":"text","content":"..."}
data: {"type":"plan","plan":{...}}
data: {"type":"done"}
```

---

### `POST /agent/execute`

Execute an approved plan. Returns an SSE stream.

**Request:**
```json
{
  "taskId": "string",
  "approved": true
}
```

**Response:** `text/event-stream`
```
data: {"type":"text","content":"..."}
data: {"type":"tool_use","toolName":"...","toolInput":{...},"toolUseId":"..."}
data: {"type":"tool_result","toolUseId":"...","output":"..."}
data: {"type":"result","content":"..."}
data: {"type":"done"}
```

---

### `GET /agent/subscribe/:taskId`

Subscribe to events for a running task (cross-client observation). Returns an SSE stream.

**Response:** `text/event-stream` — same event format as `/agent/execute`

---

### `POST /agent/stop`

Cancel a running task.

**Request:**
```json
{ "taskId": "string" }
```

---

### `GET /agent/session/:taskId`

Get session state for a task (for resume).

**Response:**
```json
{
  "sessionId": "string",
  "status": "pending | running | done | error | cancelled"
}
```

---

### `GET /agent/plan/:taskId`

Retrieve the stored plan for a task.

**Response:**
```json
{
  "plan": { "steps": [...], "summary": "string" }
}
```

---

## Providers (`/providers`)

### `GET /providers/sandbox`

List available sandbox providers.

### `GET /providers/agents`

List available agent providers with capabilities.

### `GET /providers/settings`

Get current provider configuration.

### `PUT /providers/settings`

Update provider configuration.

**Request:**
```json
{
  "activeProvider": "claude | codex | deepagents",
  "claudeCodePath": "/path/to/claude"
}
```

---

## MCP (`/mcp`)

### `GET /mcp/config`

Get current MCP server configuration.

**Response:**
```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["..."],
      "env": {}
    }
  }
}
```

### `POST /mcp/config`

Update MCP server configuration. Triggers a reload.

---

## Memory (`/memory`)

### `GET /memory`

List memories with optional filters.

**Query params:** `page`, `limit`, `category`, `search`

### `POST /memory`

Create a memory manually.

**Request:**
```json
{
  "content": "string",
  "category": "preference | fact | decision | entity | other",
  "importance": 0.8
}
```

### `PUT /memory/:id`

Update a memory.

### `DELETE /memory/:id`

Delete a memory.

### `GET /memory/stats`

Get memory storage statistics.

**Response:**
```json
{
  "total": 0,
  "byCategory": { "preference": 0, "fact": 0 },
  "embeddingCoverage": 0.95
}
```

### `GET /memory/config`

Get memory system configuration.

### `PUT /memory/config`

Update memory configuration.

**Request:**
```json
{
  "enabled": true,
  "autoRecall": true,
  "autoCapture": true,
  "embeddingProvider": "local | openai | gemini",
  "maxMemories": 1000
}
```

### `POST /memory/search`

Hybrid search (vector + FTS5).

**Request:**
```json
{
  "query": "string",
  "limit": 10,
  "category": "preference"
}
```

### `POST /memory/reindex`

Rebuild vector and FTS5 indexes. Long-running operation.

---

## Speech (`/speech`)

### `POST /speech/synthesize`

Convert text to speech.

**Request:**
```json
{
  "text": "string",
  "voice": "alloy",
  "provider": "openai | deepgram | local"
}
```

**Response:** `audio/mpeg` or `audio/wav` binary

### `POST /speech/transcribe`

Transcribe audio to text.

**Request:** `multipart/form-data` with `audio` file field

**Response:**
```json
{ "text": "string", "confidence": 0.95 }
```

### `GET /speech/voices`

List available TTS voices for the active provider.

### `GET /speech/capabilities`

Get current provider capabilities.

**Response:**
```json
{
  "tts": true,
  "stt": true,
  "streaming": true,
  "localAvailable": false,
  "localDownloaded": false
}
```

### `WS /speech/ws`

WebSocket endpoint for streaming STT.

---

## Files (`/files`)

### `GET /files/readdir`

List files in a directory.

**Query:** `path=<directory>`

### `GET /files/stat`

Get file metadata.

**Query:** `path=<file>`

### `GET /files/read`

Read file content.

**Query:** `path=<file>`

### `GET /files/skills-catalog`

Browse the skill marketplace.

**Query:** `page`, `limit`, `search`

### `POST /files/skills-catalog/install`

Install a skill from the marketplace.

**Request:**
```json
{ "slug": "canvas-design" }
```

---

## Linear (`/linear`)

### `POST /linear/webhook`

Receive Linear issue webhooks (HMAC-verified).

### `GET /linear/status`

Get pipeline queue state and active ticket.

### `GET /linear/config`

Get pipeline configuration (secrets redacted).

### `POST /linear/config`

Save pipeline configuration (encrypted).

### `GET /linear/issues`

List processable issues from Linear.

### `POST /linear/pipeline/start`

Manually trigger pipeline for a specific issue.

### `POST /linear/pipeline/stop`

Abort the currently running pipeline task.

---

## Auth (`/auth`)

### `GET /auth/status`

Get connection status for all OAuth providers.

**Response:**
```json
{
  "google": { "connected": true, "scopes": [...], "expiresAt": "..." },
  "slack": { "connected": false },
  "notion": { "connected": false }
}
```

### `GET /auth/health`

Background service health (refresh + monitor).

### `POST /auth/:provider/connect`

Start OAuth flow.

**Response:**
```json
{ "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?..." }
```

### `POST /auth/:provider/disconnect`

Revoke and delete tokens.

### `GET /auth/:provider/scopes`

List currently granted scopes.

---

## Slack (`/slack`)

### `GET /slack/config`

Get Slack integration configuration.

### `POST /slack/config`

Update Slack configuration.

### `GET /slack/gateway`

Get Socket Mode gateway status.

### `POST /slack/gateway/start`

Start the Slack Socket Mode gateway.

### `GET /slack/channels`

List Slack channels (requires OAuth connection).

---

## Sandbox (`/sandbox`)

### `GET /sandbox/available`

List available sandbox providers.

### `GET /sandbox/images`

List available sandbox container images.

### `POST /sandbox/exec`

Execute a command in the sandbox.

### `POST /sandbox/run`

Run a script in the sandbox.

---

## Preview (`/preview`)

### `GET /preview/status`

Get Vite preview server status for a task.

**Query:** `taskId=<id>`

---

## Health (`/health`)

### `GET /health`

Basic health check.

**Response:**
```json
{
  "status": "ok",
  "version": "26.2.21",
  "uptime": 12345
}
```

---

## SSE Event Format

All SSE streams use this envelope:

```
data: <JSON string>\n\n
```

Common event types:

| Type | Fields | Description |
|---|---|---|
| `session` | `sessionId` | Session created |
| `text` | `content` | Narrative text |
| `tool_use` | `toolName`, `toolInput`, `toolUseId` | Tool call started |
| `tool_result` | `toolUseId`, `output` | Tool call result |
| `plan` | `plan` | Structured task plan |
| `result` | `content` | Final answer |
| `error` | `message` | Error (stream closes after) |
| `done` | — | Stream closing |

---

## Error Responses

| Status | Meaning |
|---|---|
| `400` | Bad request |
| `401` | Unauthorized (missing/invalid API key) |
| `403` | Forbidden |
| `404` | Not found |
| `422` | Validation error (Zod) |
| `502` | Upstream API error |
| `500` | Internal server error |

Validation errors include details:
```json
{
  "error": "Validation failed",
  "issues": [
    { "path": ["prompt"], "message": "Required" }
  ]
}
```

---

## Further Reading

- [[Agent System]] — SSE event semantics
- [[Memory System]] — Memory API details
- [[Voice Interface]] — Speech API and WebSocket
- [[Linear Pipeline]] — Pipeline API
- [[OAuth and Integrations]] — Auth API
