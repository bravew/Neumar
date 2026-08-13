# Agent System

The agent system is the core execution engine. It uses a **registry + plugin architecture** with a **two-phase execution model** (plan → approval → execute) to give users full visibility and control before any tools run.

---

## Registry & Plugin Pattern

At startup, agent plugins self-register with a central registry:

```
AgentRegistry
├── ClaudeAgent     (claude-agent-sdk)
├── CodexAgent      (Codex CLI)
└── DeepAgentsAgent (DeepAgents API)
```

The active agent is selected in Settings → Providers. Switching takes effect immediately for new tasks.

### BaseAgent

All agents extend `BaseAgent`, which provides:

| Feature | Description |
|---|---|
| Session management | Create/resume sessions with isolated contexts |
| Stale cleanup | Auto-cancel sessions idle for too long |
| Plan storage | Persist the plan between Phase 1 and Phase 2 |
| Workspace isolation | Confines all file operations to `task.work_dir` |
| Cancellation | Abort streams mid-execution cleanly |
| Runtime context | Inject date/time, locale, platform, geolocation |

### Plugin Interface

Each plugin must implement:

```typescript
interface AgentPlugin {
  readonly id: string;
  readonly displayName: string;

  plan(context: AgentContext): AsyncGenerator<AgentMessage>;
  execute(context: AgentContext, plan: Plan): AsyncGenerator<AgentMessage>;
  cancel(sessionId: string): Promise<void>;
}
```

---

## Two-Phase Execution

### Phase 1: Planning

```
POST /agent/plan
  { taskId, prompt, attachments, locale, platform, geolocation }
```

The agent generates a structured task plan and streams it back as SSE events. The plan describes what it intends to do — which tools, which files, which steps — **without performing any actions**.

```
SSE events during planning:
├── { type: "session" }       Session started
├── { type: "text" }          Plan narrative
├── { type: "plan" }          Structured plan object
└── { type: "done" }          Planning complete
```

The plan is stored in the database associated with the task.

### Phase 2: Execution

```
POST /agent/execute
  { taskId, approved: true }
```

The user must explicitly approve the plan. Once approved, the agent runs tool calls, file operations, and MCP requests.

```
SSE events during execution:
├── { type: "text" }           Narration
├── { type: "tool_use" }       Tool call started
├── { type: "tool_result" }    Tool call result
├── { type: "result" }         Final answer
├── { type: "error" }          Error (task failed)
└── { type: "done" }           Execution complete
```

If the user **rejects** the plan, the task is cancelled. If they **edit** it, Phase 1 re-runs with the modified prompt.

---

## Message Types

| Type | Sent during | Description |
|---|---|---|
| `session` | Planning | Session created / resumed |
| `text` | Both | Narrative text from the agent |
| `tool_use` | Execution | Tool call initiated |
| `tool_result` | Execution | Tool call result |
| `plan` | Planning | Structured plan object |
| `direct_answer` | Both | Answer requiring no tools |
| `result` | Execution | Final result summary |
| `error` | Both | Unrecoverable error |
| `done` | Both | Stream closed |

Each message is persisted to the `messages` table immediately when received. Cost and token usage are tracked per message.

---

## Runtime Context Injection

Before every execution the agent receives injected context:

```
System prompt additions:
├── Current date/time        (ISO 8601)
├── User locale              (en / zh / es / fr)
├── Platform                 (macOS / Linux / Windows)
└── Geolocation              (lat/lon rounded to 2 decimal places for privacy)
```

This eliminates the need for agents to call separate date/location tools.

---

## Claude Agent Implementation

`ClaudeAgent` is the primary implementation and uses `@anthropic-ai/claude-agent-sdk`.

### Auto-detection

The Claude Code CLI is resolved in order:
1. User-configured path in Settings
2. `$PATH` (`which claude`)
3. Bundled sidecar binary (optional, via `--with-cli` build flag)

### MCP Server Injection

All active MCP servers (built-in + user-configured) are injected into the agent context before execution. The agent can call any MCP tool transparently.

### Memory Hooks

The memory system integrates with the Claude agent at three points:

| Hook | Timing | Action |
|---|---|---|
| **Auto-recall** | Before Phase 1 | Prepend relevant memories to system prompt |
| **Auto-capture** | After Phase 2 | Extract and store new memories |
| **LLM capture** | Configurable interval | Use Claude Haiku to extract structured facts |
| **Memory flush** | Shutdown | Drain the memory write queue |

Auto-recall uses hybrid search (vector + FTS5) to find the most relevant memories and injects them as XML-tagged context:

```xml
<memory>
  <item category="preference">User prefers TypeScript strict mode</item>
  <item category="fact">Project uses pnpm workspaces</item>
</memory>
```

### Image Attachments

Users can attach images to tasks. The Claude agent encodes them as base64 and includes them in the messages API request. Supported formats: PNG, JPEG, GIF, WebP.

### Cost Tracking

Every assistant message that includes `usage` data from the API is persisted with:
- `usage_input` — input tokens
- `usage_output` — output tokens
- `usage_cache_read` — cache read tokens
- `usage_cache_creation` — cache creation tokens
- `cost` — computed USD cost

The frontend displays cumulative cost per task and per message.

---

## Cross-Client Task Observation

Any number of clients can observe a running task in real time:

```
GET /agent/subscribe/:taskId
```

The `TaskEventBus` fans out events to all active SSE subscriptions for the same task ID. This enables:
- Viewing a running task from a second device
- Monitoring automation pipeline tasks from the main UI
- Future: multiplayer / collaborative sessions

---

## Cancellation

```
POST /agent/stop
  { taskId }
```

Signals the active agent to abort. The agent cleans up tool processes and closes the SSE stream with a `{ type: "error", message: "Cancelled" }` event.

---

## Further Reading

- [[Backend]] — Agent plugin registration, server startup
- [[MCP Integration]] — Tools available to agents
- [[Memory System]] — Auto-recall and auto-capture details
- [[API Reference]] — `/agent/*` endpoints
