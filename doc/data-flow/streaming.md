---
summary: "SSE streaming architecture, cross-client task observation via TaskEventBus, and background task management"
read_when:
  - Working with SSE streaming
  - Understanding cross-client task observation
  - Debugging real-time update issues
  - Working on background task tracking
title: "Streaming & Observation"
---

# Streaming Architecture

All agent operations use **Server-Sent Events (SSE)** for real-time updates:

```
Frontend (useAgent)              API Server              Agent (Claude SDK)
     │                               │                        │
     │── POST /agent/plan ──────────▶│                        │
     │                               │── agent.plan() ──────▶│
     │                               │                        │
     │◀── SSE: {type:"session"} ─────│◀── yield session ─────│
     │◀── SSE: {type:"text"} ────────│◀── yield text ────────│
     │◀── SSE: {type:"text"} ────────│◀── yield text ────────│
     │◀── SSE: {type:"plan"} ────────│◀── yield plan ────────│
     │◀── SSE: {type:"done"} ────────│◀── return ────────────│
     │                               │                        │
     │   (user approves)             │                        │
     │                               │                        │
     │── POST /agent/execute ───────▶│                        │
     │                               │── agent.execute() ───▶│
     │◀── SSE: {type:"tool_use"} ────│◀── yield tool_use ────│
     │◀── SSE: {type:"tool_result"} ─│◀── yield tool_result ─│
     │◀── SSE: {type:"text"} ────────│◀── yield text ────────│
     │◀── SSE: {type:"result"} ──────│◀── yield result ──────│
     │◀── SSE: {type:"done"} ────────│◀── return ────────────│
```

**Backend pattern:** Agents implement async generators (`AsyncGenerator<AgentMessage>`)
that yield messages as they become available. The API layer converts these into SSE events
via `createSSEStream(generator, taskId, model)`, which also:

1. **Persists** each message to the SQLite database with per-message cost, usage (input/output/cache tokens), and model (backend is the single source of truth)
2. **Publishes** each message to the `TaskEventBus` for cross-client observation
3. **Generates deterministic message IDs** for idempotent persistence (prevents duplicates on retries)

**Frontend pattern:** The `useAgent` hook processes the SSE stream, updating React state
for display. It no longer writes agent messages to the database — the backend handles all
persistence.

## Cross-Client Task Observation (TaskEventBus)

The `TaskEventBus` (`src-api/src/shared/services/task-event-bus.ts`) enables multiple clients
to observe the same running task in real-time. It is an in-process `EventEmitter`-based
singleton with per-task ring buffers:

```
Agent Generator → createSSEStream() → SSE to initiating client
                                    → taskEventBus.publish(taskId, msg)
                                          ↓
                           GET /agent/subscribe/:taskId → observer clients
```

| Feature      | Detail                                                                          |
| ------------ | ------------------------------------------------------------------------------- |
| **Buffer**   | Per-task ring buffer (max 5,000 messages), oldest dropped on overflow           |
| **Replay**   | New subscribers receive all buffered messages before live events                |
| **Cleanup**  | Buffer retained 60 seconds after task completion for late joiners, then evicted |
| **Capacity** | Max 50 concurrent task buffers; completed tasks evicted first when at capacity  |

**Observer flow:** When a client loads a task that is running in another client, `useAgent`
detects `task.status === 'running'` without a local abort controller and subscribes to
`GET /agent/subscribe/:taskId`. The endpoint replays buffered messages, then streams live
events. On disconnect or task completion, the subscription is cleaned up automatically.

## Background Task Management

When a user navigates away from an active task:

```
┌──────────────┐         ┌──────────────┐
│  TaskDetail  │ ──nav──▶│    Home      │
│  (active)    │         │              │
└──────┬───────┘         └──────────────┘
       │
       │  Task continues in background
       ▼
┌──────────────────────────────┐
│  BackgroundTaskManager       │
│                              │
│  tasks: Map<taskId, status>  │
│  listeners: Set<callback>    │
│                              │
│  • Tracks running tasks      │
│  • Notifies on completion    │
│  • Supports multiple tasks   │
└──────────────────────────────┘
```

The background task manager uses a global `Map` with a listener pattern so any component
can subscribe to task completion events.

## Task Queue Events

When per-profile concurrency limits are enforced (via `QueueManager`), the `TaskEventBus`
carries queue lifecycle events:

| Event                         | Payload                                   | When                                         |
| ----------------------------- | ----------------------------------------- | -------------------------------------------- |
| `QUEUE_EVENTS.TASK_DEQUEUED`  | `{ taskId, profileId, prompt, work_dir }` | Slot opens and next queued task is picked up |
| `QUEUE_EVENTS.TASK_COMPLETED` | `{ taskId, profileId }`                   | Running task completes successfully          |
| `QUEUE_EVENTS.TASK_FAILED`    | `{ taskId, profileId }`                   | Running task fails                           |

The `pendingExecutors` map in `agent.ts` stores closures for queued tasks. When
`TASK_DEQUEUED` fires, the corresponding executor runs `runAgent` + `createSSEStream` +
`drainStream` in the background. If the executor is missing (e.g. after server restart),
the task is marked failed via `onTaskComplete(taskId, profileId, false)`.

## Dispatch Summary Generation

When an AG-UI run finishes (`RUN_FINISHED` event), `AGUIEventPersister` calls
`generateAndStoreDispatchSummary()`:

1. Calls Claude Haiku with the original prompt, tools used, and tail of assistant output
2. Produces a 2–3 sentence plain-text summary
3. Inserts a `result` / `dispatch_summary` message into the DB
4. Sets the task title from the summary when the title was empty

## AG-UI Protocol Streaming (V2)

The V2 streaming architecture uses the AG-UI protocol with a **detached pipeline pattern** that decouples the agent generator from the SSE connection:

```
Frontend (CopilotKit)           API Server                    Agent (Claude SDK)
     │                               │                              │
     │── POST /ag-ui/run ───────────▶│                              │
     │                               │── runDetachedPipeline() ────▶│
     │                               │   (fire-and-forget async)    │
     │                               │                              │
     │                               │   AGUIEmitter transforms     │
     │                               │   AgentMessage → BaseEvent   │
     │                               │         │                    │
     │                               │   ┌─────▼──────────────┐     │
     │                               │   │ taskEventBus.pub() │     │
     │                               │   │ AGUIEventPersister  │     │
     │                               │   └─────┬──────────────┘     │
     │                               │         │                    │
     │◀── SSE: subscribeSSEToBus ────│◀────────┘                    │
     │◀── SSE: RUN_STARTED ─────────│                              │
     │◀── SSE: STATE_SNAPSHOT ──────│  (workspace/task/usage ctx)  │
     │◀── SSE: TEXT_MESSAGE_* ──────│◀── yield text ───────────────│
     │◀── SSE: TOOL_CALL_* ────────│◀── yield tool_use ───────────│
     │◀── SSE: STEP_STARTED ───────│  (planning/execution step)   │
     │◀── SSE: CUSTOM(plan) ───────│◀── yield plan ───────────────│
     │◀── SSE: RUN_FINISHED ───────│◀── return ───────────────────│
     │                               │                              │
     │   (late joiner)               │                              │
     │── GET /ag-ui/subscribe ──────▶│                              │
     │◀── MESSAGES_SNAPSHOT ────────│  (full history from DB)      │
     │◀── buffered events ──────────│  (ring buffer replay)        │
     │◀── live events ──────────────│                              │
```

**Key differences from V1:**

| Aspect           | V1 (`/agent/*`)                | V2 (`/ag-ui/*`)                                                  |
| ---------------- | ------------------------------ | ---------------------------------------------------------------- |
| Protocol         | Custom SSE format              | AG-UI standard events                                            |
| Connection       | Tied to agent lifecycle        | Detached — client disconnect ≠ run abort                         |
| Late joiner      | Buffer replay only             | `/ag-ui/history` hydration + `MESSAGES_SNAPSHOT` + buffer replay |
| State sync       | None                           | `STATE_SNAPSHOT` / `STATE_DELTA` for task state and task files   |
| Dedup            | `message_id` in DB             | `seq` monotonic counter per event + indexed frontend reducers    |
| Plan interrupt   | Separate `/agent/execute` call | CopilotKit `useInterrupt` + `forwardedProps.command.resume`      |
| Frontend runtime | `useAgent` hook (custom)       | CopilotKit `useAgent()` + `AgUiProvider`                         |

### AG-UI Service Layer

| Module                       | Purpose                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AGUIEmitter`                | Transforms `AsyncGenerator<AgentMessage>` → `AsyncGenerator<BaseEvent>`; handles state tracking, orphan cleanup, abort safety                                |
| `AGUIEventPersister`         | Stateful accumulator — accumulates text deltas, tool args, reasoning; `INSERT OR IGNORE` keyed on `message_id`; extracts file artifacts; updates task status |
| `runDetachedPipeline()`      | Fire-and-forget async task; publishes events to `taskEventBus` + persister regardless of SSE state                                                           |
| `subscribeSSEToBus()`        | Passive consumer reads from bus, writes to SSE; supports `Last-Event-ID` / `afterSeq` replay and keep-alive pings every 15s                                  |
| `dbMessagesToFullAGUI()`     | Converts DB rows → CopilotKit-compatible messages; deduplicates, groups tool calls, marks tool lifecycle completion, omits thinking blocks                   |
| `AttachmentPromotionService` | Copies/hard-links media-generation source attachments into `output/<runId>/inputs/` and creates task-file rows for input/output grouping                     |

### Custom Events

The `CUSTOM` event type carries neuma-specific extensions:

| Event subtype      | Purpose                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `plan`             | Plan steps with status tracking                                                  |
| `direct_answer`    | Returned when agent skips planning                                               |
| `context_overflow` | Token budget warnings                                                            |
| `interrupt`        | Plan approval + external action interrupts (carries `resumeToken` + `expiresAt`) |

## AG-UI Task File and GenUI State

The frontend Zustand thread store keeps both messages and task files keyed by ID. Hydration
comes from `/ag-ui/history/:taskId`, while live updates arrive as AG-UI state events:

| Event                              | Store effect                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `MESSAGES_SNAPSHOT`                | Replaces the message timeline and rebuilds the message index                     |
| `STATE_SNAPSHOT`                   | Replaces task-level state, including the full `files` list when present          |
| `STATE_DELTA`                      | Applies JSON Patch operations to the existing task state                         |
| `TOOL_CALL_*` / `TOOL_CALL_RESULT` | Updates tool-call `toolStage` / `final` fields and appends indexed tool messages |

`useThreadSync` reconnects with the last applied `seq` value. The reducer ignores duplicate
or older events and flags sequence gaps for a fresh snapshot.

Generative UI cards are plain assistant/tool output parsed by `parseGenUIEnvelope()` in
`src/shared/types/gen-ui.ts`. The allowed envelope types are `MediaCard`, `FileCard`,
`LinkCard`, `StatusCard`, and `TableCard`; URL fields are HTTPS-only and unknown keys are
stripped by Zod before rendering.

Shared agent surfaces that render through `components/shared/chat-panel/` use a
second normalized reducer layer. `agui-adapter.ts` still accepts the core AG-UI
`EventType` values, and also accepts canonical `kind` payloads so non-CopilotKit
surfaces can stream the same concepts without first translating to the full
event enum:

| Canonical `kind`        | Normalized message effect                                                               |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `agent.message`         | Appends assistant text to a stable `text` message until `done`                          |
| `tool_call`             | Upserts a grouped `tool` message keyed by call id, with `started`/`completed`/`failed` mapped to panel stages |
| `ui.surface_requested`  | Upserts a pending `surface` message for form, choice, confirmation, or OAuth prompts    |
| `ui.surface_responded`  | Marks the matching `surface` message resolved and stores the response value             |
| `run.lifecycle`         | Emits a system `lifecycle` message and clears streaming text accumulation on terminal statuses |
| `state_update`          | Emits a system `state` message with the updated path and value                          |

`ChatPanelMessageView` renders the normalized `text`, `tool`, `question`,
`action`, `surface`, `lifecycle`, and `state` variants. Assistant text and tool
results try `GenUIRenderer` first, so the same allowlisted GenUI cards render in
Task V2, Design chat, Video agent surfaces, and shared tool activity groups.

## Artifact Event Protocol (V2)

When `artifactsV2` is enabled, the backend publishes structured artifact events alongside regular AG-UI events. These flow through the same `taskEventBus` and arrive at the client via the SSE subscription.

```
Agent (tool call / PostToolUse hook)
  └─ publishArtifactCreate(taskId, { id, kind, title, content? })
  └─ publishArtifactAppend(taskId, { id, version, chunk })    // streaming
  └─ publishArtifactReplace(taskId, { id, version, content }) // full replace
  └─ publishArtifactPatch(taskId, { id, version, patches })   // diff-match-patch
  └─ publishArtifactDelete(taskId, { id })
       │
       ▼
  taskEventBus.publish(taskId, event)  ← Zod-validated, dropped on failure
       │
       ▼  (SSE subscription)
  Client: isArtifactEvent(msg) guard
  └─ applyArtifactEvent(prev, event) → ArtifactMap  (pure reducer)
  └─ useLiveArtifacts() exposes the map
  └─ LiveArtifactPanel renders the active artifact by kind
```

### Event types (`artifact.*`)

| Event              | Key fields                                                | Versioning rule                                                       |
| ------------------ | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `artifact.create`  | `id`, `kind`, `title`, `version`, `content?`, `language?` | Accepted only if `incoming.version > existing.version`                |
| `artifact.append`  | `id`, `version`, `chunk`                                  | Requires `version === existing + 1`                                   |
| `artifact.replace` | `id`, `version`, `content`                                | Requires `version > existing`                                         |
| `artifact.patch`   | `id`, `version`, `patches: DiffPatch[]`                   | Requires `version === existing + 1`; eq/del ops must match; max 4 MiB |
| `artifact.delete`  | `id`                                                      | Removes snapshot from map                                             |

Out-of-order events are silently dropped (no buffering or replay). The reducer is pure and returns the same map reference on no-ops.

**Server source:** `src-api/src/shared/services/artifact-events.ts`  
**Client reducer:** `src/shared/artifacts/reducer.ts`  
**Client types:** `src/shared/types/artifact.ts`

---

_See also: [Task Lifecycle](task-lifecycle.md) · [Agent System](../backend/agent-system.md) · [Hooks & Utilities](../frontend/hooks.md)_
