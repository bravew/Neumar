---
summary: "Core React hooks — useAgent (agent lifecycle, SSE, cross-client observation), useRuntimeContext (device/env context), useProviders, and utility libraries"
read_when:
  - Working with agent execution flow
  - Understanding SSE stream processing in the frontend
  - Adding new custom hooks or utilities
title: "Hooks & Utilities"
---

# Hooks & Utilities

## `useAgent` — Core Agent Execution Hook

The most critical hook in the application (~2800 lines). Manages:

- **Agent lifecycle:** task creation → planning → approval → execution → completion
- **SSE stream processing:** parses streaming `AgentMessage` events from the API
- **Message display:** renders messages from the SSE stream (backend handles persistence)
- **Per-task workspace:** supports an optional per-task `workDir` (set via folder picker), persisted to the database and restored when reloading a task. Priority: per-task workDir > global settings.workDir > sessionFolder > appDataDir
- **Session folder resolution:** session folders are computed under the user-configured `workDir` (from settings) with fallback to `appDataDir`. Both task creation and task restoration paths honour this preference.
- **Cross-client observation:** subscribes to `GET /agent/subscribe/:taskId` to observe tasks running in another client via the TaskEventBus
- **Background tasks:** tracks tasks that continue running when the user navigates away
- **Notifications:** sends native OS notifications (Tauri plugin or Web Notifications API) when a task completes while the app is not focused
- **Cost/usage persistence:** restores per-message cost, usage (input/output/cache tokens), and model from database columns when reloading tasks
- **Mid-run replies:** users can send follow-up messages to a running agent via `POST /agent/reply/:taskId`; the `ActiveQueryStore` tracks running queries and delivers replies via `streamInput()` and `PreToolUse` hooks
- **Abort handling:** supports cancellation of in-progress tasks

## AG-UI V2 Hooks

The V2 task view introduces several hooks that work with the AG-UI protocol and CopilotKit runtime.

### `useThreadSync` — Direct SSE Subscription

Connects to `/ag-ui/subscribe/:taskId` for live SSE reconnection whenever a task ID exists:

- Parses SSE format: `data: {JSON}` events
- Handles `MESSAGES_SNAPSHOT`, `STATE_SNAPSHOT`, and `STATE_DELTA` for full state/file reset (late-joiner)
- Deduplicates by `seq` (monotonic counter) via `lastSeqRef`
- Sends `Last-Event-ID` on reconnect so the backend can replay only events after the last applied sequence
- Updates Zustand thread store with live events
- Emits `agui-run-error` custom event on `RUN_ERROR`
- Auto-disconnects when terminal event received or component unmounts

### `useNeumaAGUIEvents` — Custom Event Extraction

Reads assistant-ui thread messages and extracts AG-UI `CUSTOM` events:

- Detects plan/interrupt events in message metadata
- Dispatches to `onPlan`/`onInterrupt` handlers
- Guards against React StrictMode double-mount

### `usePlanInterrupt` — Plan Approval Workflow

Full plan approval lifecycle for AG-UI V2:

- Polls `/ag-ui/pending-plan/:taskId` every 3 seconds
- Shows `PlanInterruptCard` when plan appears
- `handleApprovePlan()` → calls `agent.runAgent({ forwardedProps: { command: { resume: { approved: true } } } })`
- `handleRejectPlan()` → calls `/ag-ui/reject-plan/:taskId`
- Auto-execute: if `planMode === 'auto'`, approves after 800ms delay
- Tracks plan progress: maps tool calls → step completion percentages

### `useRunError` — Error Handling Watchdog

Monitors AG-UI runs for stalled or errored states:

- Listens for `agui-run-error` custom event (from `useThreadSync`)
- Polls `/ag-ui/history/:taskId` every 2 seconds to detect stalled runs
- Detects: `isRunning=false` with error message or no real content
- Calls `agent.abortRun()` to unblock UI spinner

### `usePostRunEffects` — Post-Run Side Effects

Executes side effects after AG-UI run completion:

- Auto-generates task title on first run (`autoGenerateTitle()`)
- Sends task completion notification
- Dispatches `task-files-updated` event
- Checks for pending plan post-run

### `useAgentSync` — Reactive Agent State Sync

Thin wrapper that syncs CopilotKit `useAgent()` state for reactive rendering in V2 components.

### `useTaskModelSelector` — Per-Task Model Override

Manages per-task model selection that feeds into CopilotKit runtime configuration.

### `useLiveArtifacts` — Streaming Artifact State Hook

Folds streaming `artifact.*` events into a live `ArtifactMap` snapshot for `LiveArtifactPanel`.

**Source:** `src/shared/hooks/useLiveArtifacts.ts`

**Behavior:**

1. Reads the `artifactsV2` feature flag from settings; returns `EMPTY_ARTIFACT_MAP` (and does not subscribe) when disabled.
2. Resets the map to `EMPTY_ARTIFACT_MAP` whenever `taskId` changes — prevents stale events from a prior task polluting the new task's panel.
3. Subscribes via `useTaskEventSource(taskId, isRunning, onMessage)` and applies each incoming event through `applyArtifactEvent(prev, event)` using the functional updater form (`setState(prev => ...)`).

**Return:** `ArtifactMap` — a `ReadonlyMap<string, ArtifactSnapshot>` keyed by artifact id.

### `useMermaidTheme` — Mermaid Theme Synchronisation Hook

Lazily initialises `mermaid@11` with the app's resolved light/dark theme so that diagrams rendered via the `@streamdown/mermaid` plugin (which has no theme prop) match the page colour scheme. Idempotent — re-runs only when the resolved theme flips.

**Source:** `src/shared/hooks/useMermaidTheme.ts`

**Behavior:**

- Reads `resolvedTheme` from `useTheme()`; maps to `'dark'` or `'default'` (mermaid's name for light).
- Compares against `lastInitializedTheme` (module-level ref) to skip redundant `mermaid.initialize()` calls.
- Dynamically imports `mermaid` and calls `mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: 'system-ui, sans-serif' })`.
- Uses a cancellation flag to guard against async races when the component unmounts before the import resolves.

**Note:** `MermaidView` (the dedicated artifact renderer) bypasses this hook and controls its own `mermaid.initialize()` per render so it can pin a theme via prop. This hook is the implicit path for the Streamdown mermaid plugin.

### `useV2Artifacts` — V2 Artifact Extraction

Loads file artifacts from the thread store / database for the V2 workspace sidebar.

**Source:** `src/shared/hooks/useV2Artifacts.ts`

**Behavior:**

1. Uses the thread store file index populated by `/ag-ui/history`, `STATE_SNAPSHOT`, and `STATE_DELTA` when available.
2. Falls back to `getFilesByTaskId(taskId)` from the local DB when no live file index exists.
3. Converts each file through `libraryFileToTaskFile()` / artifact mapping helpers, preserving `runId`, `sourceToolCallId`, and `isSourceAttachment`.
4. Groups generated outputs with promoted source attachments from `output/<runId>/inputs/`.
5. Listens for `task-files-updated` window events to re-fetch when files are added/updated during a session.

**Return:** `Artifact[]`

### `useV2TaskLoader` — V2 Task Hydration

Loads task data from DB and hydrates the Zustand thread store for V2 task pages.

## `useBranchActions` — Conversation Branching Hook

Orchestrates conversation branching, message editing, regeneration, and fork navigation for the V2 task view.

**Source:** `src/shared/hooks/useBranchActions.ts`

**Actions:**

- **`handleEditMessage(messageId, newText)`** — Stops the running agent, creates a new branch with the edited message via `POST /tasks/:taskId/branches/edit`, updates Zustand branch state, replaces the message in CopilotKit agent state, and re-runs the agent on the new branch
- **`handleRegenerate(afterMessageId)`** — Stops the agent, deletes the assistant "tail" after the chosen message via `POST /tasks/:taskId/branches/regenerate`, truncates visible messages, and re-runs the agent on the current branch
- **`handleForkFromHere(fromMessageId)`** — Creates a new branch from a specific message via `POST /tasks/:taskId/branches`, updates branch store (no agent re-run — user can continue manually)
- **`handleBranchNavigate(forkPointId, direction)`** — Navigates between branches at a fork point. Loads full message history from DB, maps branch selections through `uuidToNumericId`, flattens via `flattenMessageTree`, converts to AG-UI messages via `dbMessagesToAGUI`, and updates agent state

**Supporting utilities:**

- **`buildForwardedProps()`** — Adds `branchId` to `forwardedProps` when a non-main branch is active (also includes `workDir`, `additionalWorkDirs`, `modelConfig` from refs)
- **`busyRef`** — Prevents double submission during branch operations

**Integration:** Used internally by `TaskV2Thread`. Reads from `useBranchStore` for active branch state.

### `message-tree.ts` — Branch Projection

**Source:** `src/shared/lib/message-tree.ts`

- **`flattenMessageTree(messages, selections)`** — Projects a branched message tree into a single timeline. Groups messages by `branch_id`, walks `main` in `id` order. At each fork point, if a non-main branch is selected, switches to that branch and stops walking `main`. Result: one linear path through the tree.
- **`findForkPoints(messages)`** — Scans for messages with `parent_message_id` set and `branch_id !== 'main'`. Returns `{ messageId, branches: string[] }` for each fork point.
- **`dbMessagesToAGUI(messages)`** — Converts DB rows to `AGUIMessage[]`: maps user, text, tool_use, tool_result, and result messages. Merges adjacent assistant text. Deduplicates user content by string.

## `usePermissionRequests` — Tool Permission Approval Hook

Subscribes to permission requests via the task SSE event bus and surfaces them as interactive dialogs.

- **State:** `permissionRequests: PermissionRequestState[]` — each entry includes `id`, `tool`, `command`, `description`, `risk_level`, `resolved?`, `decision?`
- **Action:** `respond(id, decision)` — POST to `/agent/permission` with `{ permissionId, approved, alwaysAllow }`
- Subscribes to `GET /agent/subscribe/:taskId` while `isRunning=true`
- Listens for `permission_request` messages and appends to state
- Auto-denies unresolved permissions when the agent run ends
- Renders via `PermissionDialog` component (one dialog per request)

## `useSubAgents` — Sub-Agent Lifecycle Tracking Hook

Tracks sub-agent lifecycle from SSE `step_started` / `step_finished` events.

- **Return:** `SubAgentState[]` — each entry: `{ id, name, status, startedAt, completedAt?, durationMs?, totalTokens?, parentToolUseId? }`
- `status`: `'running' | 'completed' | 'failed' | 'cancelled'`
- Subscribes to task event bus SSE while `isRunning=true`
- `step_started` creates a running entry; `step_finished` marks completed/failed with duration + tokens
- Remaining running agents marked completed when parent run ends
- Renders via `SubAgentPanel` component

## `useAgentActions` — Agent Action Dispatch Hook

Extracted action handlers for `TaskV2Thread` — stop, send message, cancel sub-agent, and cancel tool call. All callbacks read from refs (not state) to avoid stale closures.

- **Source:** `src/shared/hooks/useAgentActions.ts`
- **Actions:** `handleStop()`, `handleSendMessage(text)`, `handleCancelSubAgent(agentId)`, `handleCancelTool(toolUseId)`
- Used internally by `TaskV2Thread`

## `useAgentProfiles` — Agent Profile Management Hook

Manages CRUD operations for agent profiles:

- **State:** `profiles[]`, `loading`, `error`
- **Actions:** `createProfile(input)`, `updateProfile(id, updates)`, `deleteProfile(id)`, `refreshProfiles()`
- Fetches profiles from `/db/agent-profiles` API endpoints
- Used by the AgentProfiles page and the Home page profile selector

## `useAuth` — Authentication & Integration Hook

Manages both primary site authentication and OAuth integration connections (Google, Slack, Notion).

- **State:** `loading`, `authenticated`, `connections[]`, `availableProviders[]`, `error`
- **Site auth actions:** `siteLogin()` — opens companion website login page in system browser;
  `siteLogout()` — clears site session
- **Integration actions:** `connect(provider, additionalScopes?)` — initiates OAuth flow (opens system browser);
  `disconnect(provider)` — revokes tokens; `requestScopes(provider, scopes[])` — requests
  additional permissions; `refresh()` — force-polls `/auth/status`
- **Helpers:** `getConnection(provider)`, `isConnected(provider)`
- `authenticated` is `true` when a `site` connection is active (not based on Google)
- `OAuthProvider` union includes `'google' | 'slack' | 'notion' | 'site'`
- Polls `/auth/status` every 3 seconds while a flow is pending; falls back to 60-second
  background polling once connected

## `usePermissions` — Capability-Based Access Control

Checks whether the user has granted the scopes required for a specific integration action.

- `hasScope(provider, scope)` — returns `true` if the connection is active and includes the scope
- `requireScope(provider, scope)` — resolves when the scope is available, or triggers a
  `requestScopes()` prompt if not
- Designed for gating UI actions (e.g. showing "Add to Calendar" only when Calendar scope is granted)

## `useRuntimeContext` — Device & Environment Context

Collects runtime environment data (timezone, locale, platform, geolocation) and sends it
alongside agent requests so the AI has accurate situational awareness.

- **State:** `context: RuntimeContext` — `{ timezone, locale, platform, geolocation }`
- **Actions:** `refreshGeolocation()` — re-fetches location (manual trigger)
- **Timezone** — `Intl.DateTimeFormat().resolvedOptions().timeZone`
- **Locale** — `navigator.language`
- **Platform** — parsed from `navigator.userAgent` (OS, version, architecture)
- **Geolocation** — fetched via Tauri `get_location` command (macOS CoreLocation) or
  browser `navigator.geolocation` API (non-Tauri environments)

**Caching:** Location results are cached for 10 minutes at the module level to avoid repeated
permission prompts and unnecessary system calls.

**Type definition:** `RuntimeContext` is defined in `src/shared/types/runtime-context.ts`.

## `useProviders` — Provider Management

Manages sandbox and agent provider selection:

- Fetches available providers from the API
- Handles provider switching
- Tracks capabilities and configuration

## `useSpeech` — TTS + STT Orchestration Hook

Orchestrates the full voice I/O cycle for chat mode:

- **STT (push-to-talk):** Opens a WebSocket to `/speech/stt/stream`. Captures microphone audio via an AudioWorklet (`pcm-capture-processor.js`, PCM Int16 @ 16 kHz) and streams binary chunks over the socket. Partial and final transcripts are delivered via `onPartialTranscript` / `onTranscript` callbacks.
- **TTS (batch):** POSTs full message text to `/speech/synthesize`, queues the returned PCM response in `AudioPlaybackEngine` for gapless playback.
- **TTS (streaming):** Buffers incoming LLM tokens (`feedTokens`), splits on sentence boundaries, POSTs each complete sentence for synthesis, and queues audio as it arrives. Call `flushTokens()` at stream end to synthesize the remaining fragment.

```typescript
interface UseSpeechReturn {
  // STT
  startListening(): Promise<void>;
  stopListening(): void;
  isListening: boolean;
  listeningDuration: number; // seconds, updated every 1s
  partialTranscript: string;

  // TTS (batch)
  speak(text: string): Promise<void>;
  stopSpeaking(): void;
  isSpeaking: boolean;

  // TTS (streaming, sentence-by-sentence)
  feedTokens(tokens: string): void;
  flushTokens(): void;

  isAvailable: boolean; // false if no speech provider configured
}
```

## `useVoiceRecorder` — Low-Level Microphone Recording

Lower-level hook for capturing microphone audio via the Web Audio API + AudioWorklet. Used internally by `useSpeech`. Exposes raw PCM data suitable for sending to the WebSocket STT endpoint.

## `useDispatch` — Background Task Dispatch Hook

Enables fire-and-forget agent runs from the Home page without navigating to the task.

**Source:** `src/shared/hooks/useDispatch.ts`

**Behavior:**

1. Creates a session and task in the local DB (`generateSessionId`, `createSession`, `createTask`)
2. Merges profile default MCP servers / skills with user-selected mentions and pinned skills
3. Registers the task in the in-memory background manager via `addBackgroundTask` (abort controller, prompt, `isRunning: true`)
4. Sends a fire-and-forget `fetch` to `POST /ag-ui/run` with `autoApprove: true` in `forwardedProps` — this flag tells the backend to skip plan approval and permission prompts for background tasks
5. Does **not** read the response stream — completion is tracked by `monitorTaskCompletion()`, which opens an `EventSource` to `/ag-ui/subscribe/:taskId` and listens for `RUN_FINISHED` / `RUN_ERROR` events to update the background task status

**UI integration:**

- On the Home page, a **rocket button** in `ChatInput` triggers dispatch (visible only in the home variant, hidden while running)
- `BackgroundTasksSection` lists active and completed background tasks with prompt snippet, elapsed time, open/stop/dismiss actions
- `LeftSidebar` shows `runningTaskIds` for visual hints

**`dispatch-summary.ts` (backend):** `generateDispatchSummary` calls Claude Haiku with the original prompt, tools used, and tail of assistant output to produce a 2–3 sentence summary. Currently implemented but not wired into the ag-ui run completion path.

## `useQueueStatus` — Queue State Hook

Provides per-profile or global task queue state from the backend.

**Source:** `src/shared/hooks/useQueueStatus.ts`

### `useQueueStatus(profileId?)`

- Polls `GET /agent/queue/status?profileId=...` every 5s
- Returns `state` (running count, max, queued count, runningTaskIds), `loading`, `canAccept` (`running < maxConcurrent`, default true if no data), `refresh`

### `useGlobalQueueStats()`

- Same endpoint without query param → `stats` (`totalRunning`, `totalQueued`, `perProfile`)
- Shared polling via `usePolledFetch` (5s interval, AbortController on unmount, skips updates if JSON unchanged)

**JSON serialization deduplication:** Both hooks use the internal `usePolledFetch<T>` helper, which stores `lastJsonRef = useRef<string>('')` and compares `JSON.stringify(json.data)` against the previous value on each poll. If the serialized JSON is unchanged, `setData` is skipped entirely, preventing unnecessary re-renders in consumers.

## `useFileDiffs` — File Diff Extraction Hook

Fetches file snapshots for a task and computes diffs for the Workspace Panel's Diff tab.

**Source:** `src/shared/hooks/useFileDiffs.ts`

- Calls `GET /files/snapshots/${taskId}`, expects `{ snapshots: FileSnapshot[] }` with
  `content_before` / `content_after` (both can be `null` — `content_before` is null for newly created files, `content_after` is null for deleted files)
- Filters rows where `content_before !== content_after`
- Maps to `DiffEntry[]` (`{ filePath, before, after }`) for `WorkspaceDiffView`, coercing null values to empty strings
- Refetches when `version` changes (e.g. `artifacts.length` in `TaskDetailV2`)
- Uses `AbortController` in `useEffect` cleanup for proper cancellation
- Returns `{ diffs: DiffEntry[], loading: boolean }`

## `useTraceStream` — Message-Derived Trace Fallback

Converts agent messages (V1 `AgentMessage[]` or V2 `AGUIMessage[]`) into a flat `TraceEntry[]` and `TraceSummary`.

This hook is now the compatibility fallback for old tasks or tasks that do not have persisted trace events. New AG-UI task views prefer `useTaskTraceEvents()` plus `persisted-adapter.ts`.

**Source:** `src/shared/hooks/useTraceStream.ts`

**`TraceEntry` fields:** `id`, `type` (`'llm' | 'tool' | 'thinking' | 'user' | 'error' | 'plan'`), `name`, `startedAt` (epoch ms), `duration?` (ms, undefined while running), `tokens?` (`{ input, output, cacheRead?, cacheCreation? }`), `cost?`, `model?`, `status` (`'running' | 'completed' | 'error'`), `parentId?`, `content?`, `toolInput?`, `toolOutput?`.

**`TraceSummary` fields:** `totalDuration`, `totalTokens` (`{ input, output, cacheRead, cacheCreation }`), `totalCost`, `operationCount`, `byType` (Record of type → count).

**Processing pipeline:**

1. For V1 `AgentMessage`: uses `buildFromAgentMessage()` with open-span tracking — `tool_use` messages register in `openSpans`, `tool_result` messages close the span and enrich the parent entry with `toolOutput` and computed duration. Skips `session`, `done`, and `direct_answer` types.
2. For V2 `AGUIMessage`: uses `buildFromAGUIMessage()` with approximate ordering. Tool role messages are skipped (handled by tool_use grouping). Assistant messages with `toolCalls` show the first tool name plus a count suffix.
3. During live runs, a 500ms interval `tick` state update forces `useMemo` recalculation so in-flight durations stay current.
4. Summary is computed in a single pass over all entries, aggregating duration, tokens, cost, and per-type counts.

## `useTaskTraceEvents` — Persisted Trace Hook

Loads persisted backend trace events for a task and subscribes to live trace updates while the task is running.

**Source:** `src/shared/hooks/useTaskTraceEvents.ts`

**API routes:**

- Initial load: `GET /observability/tasks/:taskId/trace`
- Live stream: `GET /observability/tasks/:taskId/trace/subscribe`

**Returned state:**

- `events: PersistedTraceEvent[]`
- `loading: boolean`
- `error: string | null`
- `source: 'persisted' | 'empty'`
- `live: boolean`

**Behavior:**

1. Clears local state whenever `taskId` changes.
2. Fetches persisted rows with `AbortController` cleanup.
3. Opens an `EventSource` only while `enabled && taskId && isRunning`.
4. Listens for `trace.event` events.
5. De-duplicates rows by `id`.
6. Sorts by `started_at`, then `created_at`, then `id`, matching backend cursor order.
7. Closes the stream when the task stops running or the component unmounts.

`components/task/trace/persisted-adapter.ts` maps `PersistedTraceEvent` rows into the existing `TraceEntry` / `TraceSummary` render shape. Money values are treated as USD (`cost_usd`), not cents.

## `useMigrateWorkspace` — Workspace Migration Hook

Handles workspace directory changes with optional session migration via SSE streaming.

**Source:** `src/components/settings/tabs/useMigrateWorkspace.ts`

**Two-phase flow:**

1. Apply new `workDir` immediately (settings saved + backend synced)
2. Optionally migrate existing sessions from old → new workspace via SSE streaming endpoint (`POST /files/migrate-sessions-stream`)

**Return:**

- `migrating: boolean` — whether a migration is in progress
- `status: string | null` — result message (success or error)
- `progress: MigrationProgress | null` — live progress with `percent`, `copied`, `total`, `currentFile`, `phase` (`scan` | `copy` | `db` | `done` | `error`)
- `getSessionStats(oldWorkDir, signal?)` — fetch session count and total size from `GET /files/session-stats?workDir=...` before prompting migration
- `migrateSessions(oldWorkDir, newWorkDir)` — start the streaming migration
- `abort()` — cancel an in-progress migration via AbortController

**SSE stream parser:** Uses a reusable `consumeSSE(response, handler)` function that reads the response body as a `ReadableStream`, buffers partial chunks, splits on newlines, and dispatches `(event, data)` pairs to the handler. The SSE protocol events are:

| Event      | Data                                                | Action                                          |
| ---------- | --------------------------------------------------- | ----------------------------------------------- |
| `scan`     | `{ totalFiles }`                                    | Sets `total` count, transitions phase to `copy` |
| `progress` | `{ percent, copied, total, folder }`                | Updates progress bar                            |
| `db`       | —                                                   | Sets phase to `db`, percent to 100              |
| `done`     | `{ success, copiedSessions, updatedTasks, errors }` | Sets final status message                       |

The final result is captured in a mutable container during streaming and read after `consumeSSE` resolves to set the `status` message.

## Utility Libraries

| Module                         | Purpose                                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paths.ts`                     | Cross-platform path handling (`~/.<slug>/`), display path formatting                                                                                                                                |
| `session.ts`                   | Session ID generation (`YYYYMMDDHHmmss_slug`), prompt-to-slug conversion                                                                                                                            |
| `attachments.ts`               | File attachment save/load (filesystem-based, not database)                                                                                                                                          |
| `useCloudStorageAttachment.ts` | Chat attachment bridge for cloud media: expands selected folders, downloads selected assets from `/cloud-storage`, creates browser `File` objects, and appends stock attribution text when required |
| `background-tasks.ts`          | Global task tracker with listener pattern for multi-task support                                                                                                                                    |
| `notifications/`               | Task completion notifications — preferences-backed desktop alerts, optional synthesized success/failure sounds, and focus behavior (`notifyWhileFocused`) across Tauri native and Web Notifications |
| `utils.ts`                     | `cn()` — conditional class name merging (clsx + tailwind-merge)                                                                                                                                     |
| `keychain.ts`                  | Tauri keychain bridge for macOS Keychain / Windows Credential Store                                                                                                                                 |
| `audio-constants.ts`           | Shared audio constants: sample rates (`STT_SAMPLE_RATE=16000`, `TTS_PCM_SAMPLE_RATE`), worklet path/name, mic constraints                                                                           |
| `audio-playback.ts`            | `AudioPlaybackEngine` singleton — queues and plays PCM audio chunks with gapless playback                                                                                                           |
| `model-capabilities.ts`        | Model capability detection — identifies audio, image, video, embedding, and other capability flags from model name strings; used for UI badges and routing filters                                  |

---

_See also: [Frontend Overview](index.md) · [State Management](state-management.md) · [Auth System](../backend/auth.md) · [Streaming Architecture](../data-flow/streaming.md) · [Speech System](../backend/speech.md)_
