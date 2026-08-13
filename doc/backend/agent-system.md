---
summary: "Agent registry + plugin architecture, BaseAgent abstract class, message types, two-phase execution, and Claude Agent SDK implementation"
read_when:
  - Adding a new agent provider
  - Understanding the agent execution lifecycle
  - Working with agent message types or streaming
  - Debugging agent behavior
title: "Agent System"
---

# Agent System

The agent system uses a **registry + plugin** architecture for extensible agent support.

## Architecture Layers

```
┌─────────────────────────────────────────────┐
│                API Route Layer               │
│           (src/app/api/agent.ts)             │
└───────────────────┬─────────────────────────┘
                    │
┌───────────────────▼─────────────────────────┐
│              Agent Service                   │
│         (src/shared/services/agent.ts)       │
│                                              │
│  ┌──────────────────┐  ┌────────────────┐   │
│  │ SessionBudgetGuard│  │ DelegationSvc  │   │
│  │ (cost cap, loop  │  │ (parent→child  │   │
│  │  detection)       │  │  task routing) │   │
│  └──────────────────┘  └────────────────┘   │
└───────────────────┬─────────────────────────┘
                    │
┌───────────────────▼─────────────────────────┐
│             Agent Registry                   │
│       (src/core/agent/registry.ts)           │
│                                              │
│  ┌─────────┐ ┌─────────┐ ┌────────────┐    │
│  │ Claude  │ │ Codex   │ │ Open Agent │    │
│  │ Plugin  │ │ Plugin  │ │ SDK Plugin │    │
│  └────┬────┘ └────┬────┘ └─────┬──────┘    │
│  ┌────┴────┐ ┌────┴─────┐ ┌───┴────────┐  │
│  │ A2A    │ │ Gemini   │ │ HTTP/CLI   │  │
│  │ Plugin │ │ Local    │ │ Plugins    │  │
│  └────┬───┘ └────┬─────┘ └───┬────────┘  │
└───────┼──────────┼────────────┼─────────────┘
        │          │            │
┌───────▼──────────▼────────────▼─────────────┐
│             BaseAgent (Abstract)             │
│         (src/core/agent/base.ts)             │
│                                              │
│  • Session management + stale cleanup        │
│  • Plan storage & parsing                    │
│  • Abort controller                          │
│  • Multilingual intent detection             │
│  • Planning instruction templates            │
│  • Workspace isolation rules                 │
└─────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────┐
│             MCP Shim Layer                   │
│      (src/core/agent/mcp-shim.ts)           │
│                                              │
│  Bridges MCP tools when provider metadata   │
│  declares shim support                      │
└─────────────────────────────────────────────┘
```

## `BaseAgent` Abstract Class

All agent providers extend `BaseAgent`, which provides:

- **Session management** — create, retrieve, and update session state
- **Stale session cleanup** — periodic cleanup (every 5 min) removes idle sessions older than 1 hour to prevent memory leaks
- **Plan lifecycle** — store, retrieve, delete plans; parse JSON plan responses
- **Planning instructions** — built-in prompt template that guides the agent to:
  - Detect intent (simple question → direct answer, complex task → multi-step plan)
  - Propose steps with file targets and tool requirements
  - Format output as structured JSON
- **Multilingual conversational intent detection** — `isConversationalPrompt()` classifies user input as conversational (greeting, identity question, knowledge Q&A, declarative statement) vs. task-oriented, skipping the plan-approve-execute flow for non-task messages. See [Multilingual Intent Detection](#multilingual-intent-detection) below.
- **Workspace instructions** — enforce output directory, backup-before-overwrite, read-before-write
- **Mid-run replies** — `ActiveQueryStore` tracks running queries; users can send follow-up messages via `POST /agent/reply/:taskId`, delivered to the running agent through `streamInput()` and `PreToolUse` hooks
- **Heartbeat** — during thinking phases, periodic heartbeats detect stuck runs
- **Cancellation** — per-session AbortController for clean task termination
- **Graceful shutdown** — clears cleanup interval, aborts all active sessions

## Agent Message Types

Messages streamed from agents follow a typed protocol:

| Type            | Description                                                                     |
| --------------- | ------------------------------------------------------------------------------- |
| `session`       | Session metadata (ID, workspace)                                                |
| `text`          | Incremental text content                                                        |
| `tool_use`      | Tool invocation (name, input)                                                   |
| `tool_result`   | Tool execution result                                                           |
| `plan`          | Proposed task plan (JSON)                                                       |
| `thinking`      | Planning progress indicator (transient — replaced by `plan` or `direct_answer`) |
| `planning_status` | Transient progress/status message; `isProgress: true` messages are not persisted as chat history |
| `direct_answer` | Simple response (no plan needed)                                                |
| `result`        | Final execution result with cost/duration/usage                                 |
| `error`         | Error with special markers for UI handling                                      |
| `done`          | Stream completion signal                                                        |

The `thinking` message is ephemeral: `useAgent` keeps only the most recent instance and removes it once a `plan`, `direct_answer`, or text response arrives. Its sole purpose is to let `RunningIndicator` show "Planning…" instead of the generic "Thinking…".

## AskUserQuestion Bridge

Clarifying questions use one frontend path regardless of runtime: a `tool_use` named
`AskUserQuestion` with a `questions` payload. Claude can call the native Claude Agent SDK
tool during execution. Runtimes without that tool, such as Codex CLI, OpenCode, HTTP agents,
Cursor-compatible HTTP agents, and planning phases where `tools: []` is required, use the
shared text bridge in `src-api/src/core/agent/ask-user-question/`.

The bridge prepends `ASK_USER_QUESTION_INSTRUCTION`, asks the model to emit exactly one
fenced ````neuma:ask_user_question` JSON block, validates the payload, and re-emits it as the
same synthetic `AskUserQuestion` tool event the frontend already understands.

| Helper                             | Role                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `validateAskUserQuestionPayload()` | Validates 1-4 questions, 2-4 options each, required labels/descriptions, and `multiSelect` |
| `tryExtractAskUserQuestion()`      | Batch parser for complete assistant text, used by Codex-style adapters                     |
| `AskUserQuestionStreamFilter`      | Streaming parser for CLI/stdout/SSE adapters                                               |
| `buildAskUserQuestionToolUse()`    | Builds the synthetic `AgentMessage` tool event                                             |

Resume semantics intentionally differ by runtime. Claude's native tool keeps the same turn
alive and receives a tool result from the SDK. Text-bridge adapters end the turn after
emitting the fenced block; when the user answers, `useAgentActions.handleSendMessage()` starts
a fresh turn only if the adapter is no longer running.

### Question Policy (`AskUserQuestionPolicy`)

Each question in a payload carries a `policy` field (`ask-user-question/schema.ts`), shared
identically by the backend text bridge and the frontend normalizer
(`src/shared/questions/question-policy.ts`):

| Policy                                         | Behavior                                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ behavior: 'manual', gate? }`                 | Requires an explicit user answer — no auto-continue. `gate` optionally names why: `approval`, `cost`, `rights`, `upload`, or `destructive_edit`.      |
| `{ behavior: 'optional', defaultOptionLabel }`  | Has a safe default; the UI can auto-continue with that default after a countdown if the user doesn't respond (see DesignMode's Questions tab).        |

`clarification-policy.ts` supplies per-mode (task/design/video) guidance strings that push
agents toward asking fewer, more targeted questions — beginning work immediately when intent
is clear — while treating gated questions (approval, cost, rights, upload, destructive edits)
as always mandatory, never auto-skippable. Rollout is controlled by
`NEUMA_ON_DEMAND_CLARIFICATION_ENABLED` (default on) in
`src-api/src/shared/rollout/multi-mode-reliability.ts`; disabling it restores mandatory
upfront discovery questions on a fresh Design artifact. `NEUMA_SUPPLEMENTAL_SKILLS_ENABLED`
(also default on, same file) gates whether supplemental skill selections apply across modes.

## Two-Phase Execution

```
Phase 1: Planning                    Phase 2: Execution
┌──────────┐    ┌──────────┐        ┌──────────┐    ┌──────────┐
│  User    │───▶│  Agent   │        │  User    │───▶│  Agent   │
│  Prompt  │    │  Plans   │        │ Approves │    │ Executes │
└──────────┘    └────┬─────┘        └──────────┘    └────┬─────┘
                     │                                    │
                     ▼                                    ▼
               ┌──────────┐                         ┌──────────┐
               │TaskPlan  │                         │Tool calls│
               │{steps[]} │                         │File I/O  │
               │execution │                         │Commands  │
               │  Mode    │                         │(or PTC)  │
               └──────────┘                         └──────────┘
```

### TaskPlan

```typescript
interface TaskPlan {
  goal: string;
  steps: PlanStep[];
  notes?: string;
  executionMode?: "standard" | "batch"; // default: 'standard'
  createdAt: Date;
}
```

The agent selects `executionMode` during planning:

| Mode       | When used                                                                     | How executed                                      |
| ---------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| `standard` | Sequential reasoning, user interaction, complex decision-making between steps | One tool call per model turn (SDK `query()` loop) |
| `batch`    | Bulk operations (N > 3 similar calls), data aggregation, repetitive patterns  | Programmatic Tool Calling (PTC) — see below       |

## Multilingual Intent Detection

`isConversationalPrompt()` in `base.ts` determines whether a user prompt is a simple conversational message (greeting, identity question, general knowledge question, or declarative preference statement) that can be answered directly without the plan-approve-execute pipeline.

**Used by:** Adapters whose `plan()` method does not call an LLM for intent classification (Codex, Gemini CLI, HTTP agents). Claude and openai-compat adapters rely on `PLANNING_INSTRUCTION` + the LLM to emit `direct_answer` instead.

### Script Detection

The function uses ES2018 Unicode property escapes to detect the writing system:

| Script Regex                                                                  | Languages Covered                    |
| ----------------------------------------------------------------------------- | ------------------------------------ |
| `\p{Script=Han}\|\p{Script=Hiragana}\|\p{Script=Katakana}\|\p{Script=Hangul}` | Chinese, Japanese, Korean            |
| `\p{Script=Devanagari}`                                                       | Hindi, Marathi, Nepali               |
| _(Latin fallback)_                                                            | English, Spanish, French, Portuguese |

### Per-Script Classification

Each script branch applies a four-layer heuristic:

1. **Greeting detection** — exact-match `Set` (CJK) or regex (Latin, Devanagari) against common greetings and acknowledgments (e.g. `你好`, `hola`, `नमस्ते`, `thanks`, `好的`)
2. **Identity question** — regex for "who are you" / "what can you do" variants (e.g. `你是谁`, `quién eres`, `तुम कौन हो`)
3. **Declarative statement** — short first-person preference/fact patterns without task verbs (e.g. `I prefer...`, `我喜欢...`, `Je préfère...`, `मुझे पसंद...`). Character-length thresholds vary by script (Latin < 200, CJK <= 60, Devanagari <= 80)
4. **Question-mark heuristic** — short prompts ending in `?` / `？` / `؟` without task-action keywords are classified as knowledge Q&A

### Task Keyword Veto

Each script has a task-verb regex that vetoes the conversational classification:

- **Latin:** `write|create|build|fix|delete|run|deploy|test|...` (30+ terms)
- **CJK:** `写|创建|修复|删除|运行|部署|测试|...`
- **Devanagari:** `लिखो|बनाओ|ठीक करो|हटाओ|डाउनलोड|...`

If a prompt matches both a question pattern and a task keyword, the task keyword wins and the message goes through full planning.

### Preprocessing

Before classification, the function:

- Strips context instruction lines (lines starting with `[`)
- Removes addressee name prefixes (e.g. `"Abc, what can you do"` becomes `"what can you do"`)
- Counts code-point length (accurate for CJK characters)

All regex constants and Set lookups are defined at **module scope** to avoid recompilation on every call.

## Runtime Context

The agent service injects **runtime context** into every prompt so the AI has accurate
awareness of the user's environment. The frontend collects context via the `useRuntimeContext`
hook and sends it alongside each agent request.

| Field           | Source                                            | Example                                                           |
| --------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| **Date/time**   | Server `Intl.DateTimeFormat` with client timezone | `Wednesday, February 18, 2026, 9:45 PM PST (America/Los_Angeles)` |
| **Locale**      | `navigator.language`                              | `en-US`                                                           |
| **Platform**    | Parsed from `navigator.userAgent`                 | `macos 15.2 arm64`                                                |
| **Geolocation** | CoreLocation (macOS) or Geolocation API (browser) | `37.77, -122.42`                                                  |

**Timezone resolution** follows a three-tier fallback: client timezone → server timezone → UTC.
Invalid IANA timezone strings are detected and rejected via `Intl.DateTimeFormat` validation.

**Privacy:** Geolocation coordinates are rounded to 2 decimal places (~1 km precision) before
injection into prompts. The frontend caches location for 10 minutes to avoid repeated permission
prompts.

The formatted context is prepended to the user prompt as bracketed lines:

```
[Current date and time: Wednesday, February 18, 2026, 9:45 PM PST (America/Los_Angeles)]
[User locale: en-US]
[Platform: macos 15.2 arm64]
[Approximate location: 37.77, -122.42]
```

### Per-Turn Session Context (`AsyncLocalStorage`)

`src-api/src/shared/services/session-context.ts` propagates a `SessionContext`
(`{ workDir, sessionId }`) through the async call graph for the lifetime of
a single agent turn. In-process MCP tools (e.g. the media-generation server)
run in the parent Node process, so `process.cwd()` is the API server's cwd —
not the channel workspace the agent is operating in. Tools call
`getSessionWorkDir()` to resolve the per-turn workDir so generated files land
where the channel-manager's post-run file scan can find them.

| Helper                            | Purpose                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `getSessionContext()`             | Active `SessionContext` or `undefined` outside a turn                                                     |
| `getSessionWorkDir()`             | Shorthand for `getSessionContext()?.workDir`                                                              |
| `withSessionContext(ctx, source)` | Async-iterable wrapper that re-enters `storage.run(ctx, …)` on every `iter.next()` / `iter.return()` call |

`AsyncLocalStorage.run` only covers the initial synchronous call — each
generator step a consumer pulls runs on a fresh promise chain and loses the
store. `withSessionContext` solves this by rebinding the context on every
yield boundary, so MCP tool handlers invoked by the SDK mid-stream always see
the right workDir. Channel pipelines (`channel-manager.ts`) wrap the agent
stream with `withSessionContext` and also gate post-run file scans by
turn-start timestamp so stale outputs from earlier turns are excluded.

## Native Session Resume Identity

`POST /agent/resume` can reuse a provider-native session id only when the id
still belongs to the same runtime identity that created it. The route guard is
implemented in `src-api/src/app/api/agent.ts` with persistence helpers in
`src-api/src/shared/db/agent-resume-identity.ts`.

Every SSE stream that can update `tasks.agent_session_id` (`/agent/plan`,
`/agent/execute`, `/agent`, and `/agent/resume`) passes a `resumeIdentity` object
into `createSSEStream()`. When a `session` message carries `sessionId` or
`resumeSessionId`, the stream updates the task row and upserts one
`agent_resume_identities` record with:

| Field             | Purpose                                             |
| ----------------- | --------------------------------------------------- |
| `task_id`         | Task whose durable provider session id is recorded  |
| `provider_id`     | Agent provider that minted the native session id    |
| `model_id`        | Model used by the run, when known                   |
| `workspace_root`  | Resolved work directory, when known                 |
| `native_session_id` | Durable provider/runtime session id               |

On `/agent/resume`, `resumeIdentityMismatch()` compares the stored identity with
the requested provider, native session id, model, and workspace. Provider and
native-session mismatches always block native replay. Model and workspace
mismatches block replay only when both sides are known, so requests that inherit
those values from environment defaults stay compatible.

When a mismatch is found, the API logs the reason and calls `runAgent()` for a
fresh run instead of handing the stale session id to the wrong SDK. Tasks
without an identity record remain permissive, matching the pre-guard behavior;
identity persistence failures are non-fatal for the same reason.

## Run Context & Recovery

Task, Design, and Video runs share one reliability envelope
(`src-api/src/core/agent/run-context.ts`) so a dropped connection, transient provider error,
or mid-run reconnect behaves the same way in all three modes without silently duplicating or
losing an execution. Full operational detail lives in
`dev-doc/runbooks/multi-mode-reliability.md`.

**Mode-owned run context** — every run is reserved against `mode` (`task` / `design` /
`video`) + `owner_key` before execution, keyed by idempotency (`client_request_id`,
`request_message_id`) and recovery lineage (`execution_id`, `initial_run_id`,
`source_run_id`, `run_index`). Unique DB indexes
(`idx_agent_runs_request_identity`, `idx_agent_runs_message_identity`,
`idx_agent_runs_active_execution` — migration 049) enforce that a retried or duplicated
request converges on the existing run instead of forking a new one. Do not conflate
`source_run_id` (a recovery attempt of the same execution) with `parent_run_id`
(a sub-agent spawned by `Task`).

**Durable event journal** — the `agent_run_events` table (migration 049) journals AG-UI
events per run/seq before live publication (`src-api/src/shared/services/ag-ui/journal.ts`,
`reattach.ts`, `detached-run.ts`), so a late joiner or a reconnecting client can replay from
the last event id instead of losing history.

**Compatibility flags** (`src-api/src/shared/rollout/multi-mode-reliability.ts`, all default
on): `NEUMA_ON_DEMAND_CLARIFICATION_ENABLED=0` restores mandatory upfront Design discovery;
`NEUMA_SUPPLEMENTAL_SKILLS_ENABLED=0` ignores supplemental skill selections in every mode;
`VITE_NEUMA_DIAGNOSTICS_UI_ENABLED=0` (frontend build time) hides the execution diagnostics
UI without changing persistence; `NEUMA_DESIGN_RAW_STREAM_ROLLBACK=1` and
`NEUMA_VIDEO_AGENTIC_RUNTIME=0` restore each mode's legacy stream adapter while journal
writes stay available. Journal and run-row writes should stay enabled during any rollback so
idempotency and replay evidence remain additive and old/new rows stay readable.

## Execution Diagnostics & Support Bundles

Every run exposes an execution diagnostics view (frontend: `ExecutionDiagnosticsPanel.tsx`,
gated by `EXECUTION_DIAGNOSTICS_UI_ENABLED` / `VITE_NEUMA_DIAGNOSTICS_UI_ENABLED`, default
on) covering timing, tools, runtime, usage, delivery, attempts, continuations, recovery
lineage, and produced files — backed by `execution-diagnostics.ts`
(`src-api/src/shared/observability/`).

From that panel, **Export support bundle** (`use-support-bundle-export.ts` on the frontend,
`support-bundle.ts` on the backend) downloads a redacted ZIP containing:

- bounded, complete-line tails from the current and newest earlier `app`, `gateway`,
  `integrations`, and `system` dated logs, when present
- allowlisted `agent_run_events` envelopes and trace projections as JSONL
- redacted execution diagnostics, safe artifact manifests, terminal run metadata, and
  version/platform data
- an `omissions.json` entry when an optional source is unavailable or a size limit removes
  data

The bundle **never** includes prompts, assistant text, reasoning, tool arguments/results,
environment variables, credentials, raw session handles, or filesystem paths. Oversized
records become omission objects rather than truncated/invalid JSON; archives enforce
per-line, per-record, per-entry, total-uncompressed, and final-ZIP size limits. Export is an
explicit local action, available for Task, Design, and Video runs, and the export route stays
behind the global JWT middleware when `WEBUI_AUTH=true`.

## Context Resolver

`resolveAgentContext()` in `context-resolver.ts` is the **single source of truth** for assembling the system context passed to every agent run. It is called once per request in the service layer — never inside adapters. Adapters receive a pre-resolved string via `AgentOptions.systemContext`.

### Context Layers

| Layer | Content                                                                                   | Tier           |
| ----- | ----------------------------------------------------------------------------------------- | -------------- |
| 1     | **Runtime** — date/time, locale, platform, geolocation, channel context                   | minimal + full |
| 2     | **Workspace** — working directory path                                                    | minimal + full |
| 3     | **Language** — response language preference (maps locale codes to language names)         | minimal + full |
| 4-5   | **Agent profile** — soul (6-pillar XML) or legacy role + system_prompt                    | full only      |
| 6     | **User preferences** — global user settings instruction                                   | full only      |
| 7     | **Auto-recalled memories** — semantic search on user prompt with optional scope isolation | full only      |
| 8     | **Search hint** — available web search providers (only when mode is not `auto`)           | full only      |

### Output Tiers

The resolver returns two context tiers:

- **`full`** — all 8 layers; used by main agents
- **`minimal`** — layers 1-3 only; used by sub-agents and A2A delegates

### Prompt Caching Split

To optimize Anthropic prompt caching, the resolved context is split into:

- **`staticContext`** — workspace, language, profile, preferences, search hint (stable between turns, cacheable)
- **`dynamicContext`** — runtime timestamp, auto-recalled memories (changes every turn)

### Channel Memory Scoping

Channel-originated messages use `memoryScope` (`{ profileId, projectId, sessionId }`) to isolate memory recall per user/channel, preventing cross-user information leakage. The `profileId` is derived from the qualified user ID (e.g. `slack:T04ABC:U12345`) via `deriveMemoryScope()` in `services/agent.ts`. See [Memory — Cross-Channel Memory Isolation](memory.md#cross-channel-memory-isolation) for details.

### Profile Thinking Config Resolution

When a profile has a `default_thinking_config`, the context resolver parses it with `ThinkingConfigShape.safeParse()` and returns a `profileThinkingConfig` field in `ResolvedAgentContext`. The agent service then uses `mergeThinkingConfig(profileConfig, requestConfig)` to determine the effective thinking config — request-level always takes precedence.

### Soul Resolution

When a profile has a soul configuration, the resolver calls `renderSoul()` to produce the XML system prompt, including corrections, learnings, and pinned facts. It also extracts the optional `voice.greeting` for injection as the first assistant message. Legacy profiles without a soul fall back to the `role` + `system_prompt` fields.

## Programmatic Tool Calling (PTC)

PTC is an opt-in execution mode (`ptcEnabled` in settings) that uses the Anthropic **Messages API** with a `code_execution` tool, allowing Claude to write Python code that calls tools programmatically — eliminating per-tool model round-trips for batch operations.

**Files:**

- `extensions/agent/claude/ptc.ts` — core execution loop (`executePTC` async generator)
- `extensions/agent/claude/ptc-adapter.ts` — converts Agent SDK `tool()` definitions to Messages API format
- `extensions/agent/claude/ptc-types.ts` — shared types (`PTCOptions`, `PTCToolDefinition`, `ToolHandler`)

### How it works

```
Claude (Messages API)
  └─ code_execution tool (Python container)
       └─ MCP tools (allowed_callers: ['code_execution_20260120'])
            └─ Linear / Google / Memory / etc.
```

1. **Tool adaptation** — `adaptMcpTools()` converts SDK `tool()` objects to `PTCToolDefinition[]` using Zod 4's built-in `toJSONSchema()`. Tools get `input_examples` for better accuracy on complex parameters (e.g. `linear_create_issue`, `google_calendar_create_event`).
2. **tool_search** — When > 10 tools are available, `defer_loading: true` + `type: 'tool_search_tool_bm25_20251119'` is added so only relevant tools are loaded into context. Falls back to eager loading if the API rejects `tool_search`.
3. **Streaming** — Uses `messages.stream()` to deliver `text_delta` events in real time (consistent with the codebase's async-generator streaming convention).
4. **Container reuse** — The container ID (`container` field) is captured from `message_start`/`message_delta` events and reused across turns. A heartbeat call keeps the container alive if idle > 2 minutes (container expires after ~4.5 min inactivity).
5. **Error handling** — Per-item errors are handled in code; one tool failure doesn't abort the batch.

### Activation

PTC only activates when **both** conditions are met:

1. `ptcEnabled: true` in user settings (General Settings → "Batch Mode")
2. Agent selects `executionMode: 'batch'` in its plan response

## Agent Profiles

Agent profiles define pre-configured agent personas for multi-agent delegation.

**Schema** (`agent_profiles` table):

| Column                         | Type                  | Description                                                   |
| ------------------------------ | --------------------- | ------------------------------------------------------------- |
| `id`                           | TEXT PK               | Unique profile ID                                             |
| `name`                         | TEXT                  | Display name                                                  |
| `role` / `description`         | TEXT                  | Profile purpose                                               |
| `avatar_color` / `avatar_icon` | TEXT                  | DiceBear avatar customization                                 |
| `runtime_id`                   | TEXT                  | Agent backend (`claude`, `codex`, `open-agent-sdk`, `a2a`, `gemini-local`, `http-agent`, `pi-local`, `video`, etc.) |
| `default_model`                | TEXT                  | Preferred model                                               |
| `default_mcp_servers`          | JSON                  | MCP servers to attach                                         |
| `default_skills`               | JSON                  | Skills to activate                                            |
| `system_prompt`                | TEXT                  | Custom system prompt                                          |
| `max_concurrent_tasks`         | INT                   | Concurrency limit (default: 1)                                |
| `max_delegation_depth`         | INT                   | Delegation chain limit (default: 3)                           |
| `allowed_delegates`            | JSON                  | Whitelist of profile IDs this agent can delegate to           |
| `status`                       | TEXT                  | `active`, `paused`, `archived`                                |
| `default_thinking_config`      | TEXT (JSON, nullable) | Per-profile thinking defaults (Migration 002)                 |

Profiles are selected on the Home page and their configuration merges into the session (system prompt, model, MCP servers, skills).

### Profile Skill Restrictions

The `default_skills` column supports three semantic states that control which skills are available during agent runs:

| Value                  | Meaning                        | Backend Behavior                                                                                                                                                                                                |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `null`                 | No restriction ("All Allowed") | All user and project skills are loaded via `settingSources: ['user', 'project']`; all built-in MCP servers (media, speech, etc.) are registered                                                                 |
| `[]` (empty array)     | Fully restricted               | Only `project` setting sources are loaded (no user skills directory); built-in MCP servers are **not** registered; context resolver injects a `<tool_restrictions>` block stating "no specialized skills/tools" |
| `["slug-a", "slug-b"]` | Allow-listed skills only       | Only `project` setting sources are loaded; built-in MCP servers **are** registered; context resolver injects `<tool_restrictions>` listing the allowed skill names                                              |

**Server-side validation** (`context-resolver.ts`):

- Slugs are validated against the regex `/^[a-z0-9_-]+$/i` before filesystem access
- Each slug is verified via `fs.access(…/SKILL.md)` using `Promise.allSettled` for parallel validation
- Invalid or stale slugs are silently dropped from the resolved list

**Built-in MCP gating** (`areBuiltinServersAllowed()` in Claude adapter):

- `undefined` (no profile) → built-ins allowed
- `[]` (empty restriction) → built-ins **blocked**
- Non-empty array → built-ins allowed

The `ResolvedAgentContext.profileAllowedSkills` field carries this resolved value through the agent service layer. When `undefined`, no profile-level skill filtering is applied.

### Profile Creation Wizard

New profiles are created via a 4-step wizard in `ProfileDetailPage` (`src/app/pages/ProfileDetail.tsx`). When `routeId === 'new'`, the page renders `ProfileWizard` from `src/components/profiles/wizard/`:

| Step            | Component                                  | What Happens                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Template    | `TemplateStep` (reused from `quickstart/`) | User picks a soul template or "Custom". Selection populates form defaults (name, avatar, skills) and fetches the full soul from `GET /soul/templates/:id`.                                                                   |
| 2 — Personalize | `PersonalizeStep`                          | Name, avatar, role, description, system prompt. Role combobox auto-fills system prompt from `ROLE_PRESETS`.                                                                                                                  |
| 3 — Configure   | `ConfigureStep`                            | Runtime, model, thinking config, editable soul editor (`WizardSoulEditor` — collapsible tabs reusing `SoulIdentityTab`, `SoulVoiceTab`, `SoulCognitionTab`, `SoulBoundariesTab`), MCP servers, skills, max concurrent tasks. |
| 4 — Review      | `ReviewStep`                               | Read-only summary card with all settings + soul preview. Edit pencil buttons jump back to earlier steps. "Create Profile" POSTs the profile with soul already in the payload (no separate `/apply` call needed).             |

On create, the wizard POSTs to `POST /db/agent-profiles` with the full profile payload including the soul JSON. It then navigates to `/org/{profileId}` for further editing.

### Per-Profile Thinking Configuration

Each profile can define a `default_thinking_config` that sets the default extended thinking
behavior for all agent runs using that profile.

**Schema** (`ThinkingConfigShape` in `context-resolver.ts`):

| Type       | Required Fields                                | Description                                            |
| ---------- | ---------------------------------------------- | ------------------------------------------------------ |
| `adaptive` | `effort: 'low' \| 'medium' \| 'high' \| 'max'` | SDK auto-adjusts thinking budget based on effort level |
| `enabled`  | `budgetTokens: number (1000–128000)`           | Fixed token budget allocated for thinking              |
| `disabled` | —                                              | No extended thinking                                   |

Stored as a JSON string in the `default_thinking_config` column. Parsed and validated by
`ThinkingConfigShape.safeParse()` during context resolution; invalid JSON logs a warning
and the profile loads without a thinking config.

**Merge behavior** (`mergeThinkingConfig()` in `services/agent.ts`):
Request-level thinking config **always replaces** profile-level config — there is no
field-level merging. The merge is applied in all four execution paths: `runPlanningPhase()`,
`runExecutionPhase()`, `runAgent()`, and `runAgentResume()`. If neither request nor profile
provides a thinking config, the SDK chooses its own default.

**UI**: The Profile Detail sidebar provides a "Thinking" section with:

- Type selector dropdown (Adaptive / Fixed Budget / Disabled / Default)
- Adaptive mode → effort level dropdown (Low / Medium / High / Max)
- Fixed Budget mode → token budget input (1000–128000, step 1000)

**Channel profile assignment** (Migration 005): The `channel_config` table has an `agent_profile_id`
column that links a channel to a specific agent profile, enabling per-channel personality. When a
channel has an assigned profile, conversations in that channel automatically use the profile's soul,
system prompt, model, and MCP server configuration.

## Task Queue Manager

`QueueManager` (`src/core/queue-manager.ts`) enforces per-profile concurrent task limits
using an in-memory semaphore backed by SQLite for queued state and crash recovery.

### Concurrency Model

- Each agent profile has a `max_concurrent_tasks` setting (default: **1**)
- Tasks without a profile use key `__default__`
- Running tasks are tracked in-memory via `Map<profileKey, Set<taskId>>`

### Queue Flow

```
POST /agent/ (with taskId + agentProfileId)
    │
    ▼
tryExecuteOrQueue(taskId, profileId, priority)
    │
    ├── Slot available? → trackRunning → { status: 'executing' }
    │
    └── At capacity? → enqueueTask in DB → { status: 'queued', queuePosition }
                                              │
                                              │ (202 response to client)
                                              │
    ┌─────────────────────────────────────────┘
    │ (later, when slot opens)
    ▼
onTaskComplete(taskId, profileId)
    → untrackRunning → dequeueNext()
        → pickupQueuedTask (atomic queued→picked_up)
        → emit TASK_DEQUEUED
        → pendingExecutors closure runs the agent
```

### Queue Ordering

`ORDER BY queue_priority DESC, created_at ASC` — higher priority first, then FIFO.

### Queue API Routes

| Method | Path                      | Description                                                |
| ------ | ------------------------- | ---------------------------------------------------------- |
| GET    | `/agent/queue/status`     | Queue state per profile (`?profileId=...`) or global stats |
| GET    | `/agent/queue/can-accept` | Check if profile can accept tasks (`?profileId=...`)       |

### Executor Cleanup

The `pendingExecutors` map stores deferred closures for queued tasks. Two `taskEventBus` listeners
prevent unbounded map growth when tasks complete or fail through paths other than normal dequeue
(e.g. user cancellation, zombie recovery):

- `QUEUE_EVENTS.TASK_COMPLETED` → `pendingExecutors.delete(taskId)`
- `QUEUE_EVENTS.TASK_FAILED` → `pendingExecutors.delete(taskId)`

When a dequeued task has no executor (e.g. after server restart), the task is marked as `status = 'error'`
so users see an error state rather than silent disappearance.

### Crash Recovery

- **`recoverStaleQueueEntries`**: tasks with `queue_status = 'picked_up'` and stale
  `heartbeat_at` (>10 min or null) → `queue_status = 'done'`, `status = 'error'`
- **`rebuildFromDB`**: all tasks with `status = 'running'` are `trackRunning`'d by
  `assignee_profile_id`

### Integration Scope

Queue enforcement applies to `POST /agent/` (legacy single-shot run). The AG-UI path
(`POST /ag-ui/run`) does **not** call `tryExecuteOrQueue` — the in-memory running map is
updated by `rebuildFromDB` on startup but not by every code path that sets a task to
`running`. AG-UI runs are tracked for `totalRunning` stats via startup rebuild only.

### Stream Lifecycle

`createSSEStream` calls `onTaskComplete(taskId, profileId, success)` in its `finally`
block for `/plan`, `/execute`, `/resume`, and `/` routes, freeing the slot for dequeue.

## Session Budget Guard

`SessionBudgetGuard` (`src/shared/services/session-budget.ts`) enforces per-session safety:

- **Cost cap** — configurable `maxSessionCostUsd` (default: $10), tracked in micro-dollars via `usage_logs`
- **Loop detection** — monitors tool calls per minute (`maxToolCallsPerMinute`, default: 20); emits `agent.loop_detected` when exceeded
- **Settings**: `sessionBudgetEnabled` (default: true), synced to the Safety tab in Settings → Usage

## Tool Result Loop Guard

`ToolResultLoopGuard` (`src/core/agent/tool-result-loop-guard.ts`) observes
normalized `tool_use` / `tool_result` messages after execution. It complements
Claude's pre-execution loop guard by catching loops that are only visible after
a tool returns an error, including non-Claude and bridge-backed runs.

The guard trips when either:

- the same tool, input signature, and error output repeats 3 times; or
- 5 tool results in a row are errors.

`withToolResultLoopGuard()` wraps the planning, execution, direct run, and resume
paths in `services/agent.ts`, plus DesignMode chat runs and Video agent turns.
When it trips, it logs a warning and emits a transient
`planning_status` message with subtype `tool_result_loop_warning` and
`isProgress: true`. The transient message nudges the agent to stop retrying or
change approach without creating a durable chat message.

## Delegation Service

`DelegationService` (`src/shared/services/delegation.ts`) manages agent-to-agent task routing:

- **`delegate(parentTaskId, request)`** — creates a child task linked to a parent, validates assignee profile status, enforces depth limits and allowed-delegates whitelist
- **`getDelegationDepth(taskId)`** — walks the parent chain to determine current depth
- **`resolveAgentConfig(taskConfig, profile, globalSettings)`** — priority: task override → profile defaults → global settings → system defaults
- Emits `task.delegated` activity events

## MCP Shim

The MCP Shim (`src/core/agent/mcp-shim.ts`) bridges MCP tools for providers whose
metadata declares `supportsMcp: 'shim'`. Providers that declare `native` use
their runtime's own tool surface, and providers that declare `none` do not
receive MCP tools.

- `McpShim.initialize()` — loads MCP servers and collects tool definitions
- `McpShim.getToolDefinitions()` — returns tools in a generic format
- `McpShim.executeTool(call)` — routes and executes a tool call against the originating MCP server
- Format converters: `toOpenAITools()`, `toGeminiTools()`, `fromOpenAIToolCall()`, `fromGeminiToolCall()`
- Claude, Open Agent SDK, Pi Local, and any other provider with native support
  do not use the shim.

## Agent Transport & Capability Model

Each agent plugin declares its transport and capability level:

| Field              | Values                                 | Description                |
| ------------------ | -------------------------------------- | -------------------------- |
| `transport`        | `sdk`, `cli`, `http`, `process`, `a2a` | How the agent runs         |
| `supportsMcp`      | `native`, `shim`, `none`               | MCP tool integration level |
| `supportsSkills`   | `native`, `shim`, `none`               | Skills integration         |
| `supportsPlanMode` | `native`, `orchestrated`, `none`       | Plan mode support          |
| `requiresBinary`   | `boolean`                              | Needs a local CLI binary   |
| `requiresApiKey`   | `boolean`                              | Needs an API key           |

Registry query methods: `getWithTransport(transport)`, `getWithMcp(support)`, `getWithSkills(support)`, `testEnvironment(type)`, `listModels(type)`

## Agent Runtime Detection Catalog

The agent runtime catalog (`src-api/src/shared/agent-runtimes/`) is separate from
the provider plugin registry. It is the source of truth for local CLI detection,
model fallbacks, install/update options, prompt delivery metadata, and operation
tracking used by `/agent-runtimes/*`.

Current catalog ids include `claude`, `codex`, `gemini`, `opencode`, `cursor-agent`,
`qwen`, `devin`, `kilo`, `vibe`, `deepseek`, `copilot`, `kiro`, `hermes`, `kimi`,
`trae-cli`, and `pi`. `qoder` is available only when `NEUMA_AGENT_QODER=1`; `atomcode`
is available only when `NEUMA_AGENT_ATOMCODE=1`; `kimi` (the local CLI runtime) is
available only when `NEUMA_AGENT_KIMI=1` — see the Kimi bullet below and
`dev-doc/runbooks/kimi-k3.md` for the full setup/troubleshooting runbook. Each of these
three flag-gated runtimes declares `capabilities.modes` as `experimental` for task/design
and `unsupported` for video (`shared/agent-runtimes/types.ts`'s `RuntimeCapabilities.modes`
— see [Runtime Capability Model](#runtime-capability-model) below), and their
`AgentRuntimeDef.name` embeds "(experimental)" so it renders in the picker's group header.

Each `AgentRuntimeDef` declares:

| Field                                 | Purpose                                                              |
| ------------------------------------- | -------------------------------------------------------------------- |
| `versionArgs` / `helpArgs`            | Best-effort version and capability probing                           |
| `fallbackModels` / `reasoningOptions` | UI model choices when live discovery is unavailable                  |
| `promptDelivery`                      | Whether prompts are delivered through `stdin` or command-line args   |
| `maxPromptArgBytes`                   | UTF-8 byte budget for `argv` prompt delivery                         |
| `streamFormat` / `eventParser`        | Output format and parser selection                                   |
| `install` / `update`                  | Structured commands with platform, requirement, and network metadata |
| `authProbe`                           | Optional authentication status probe                                 |

Notable runtime-specific behavior:

- Codex fallback models include GPT-5.5/GPT-5.4 families, GPT-5 Codex, GPT-5, `o3`, and
  `o4-mini`; reasoning choices are `default`, `minimal`, `low`, `medium`, and `high`.
- Pi uses `--mode rpc`, stdin prompt delivery, Pi RPC stream parsing, optional `--model`,
  optional `--thinking`, and a single `--append-system-prompt` carrying any extra absolute
  directories as a readable instruction (Pi has no `--add-dir`-style flag, and honors only
  the last `--append-system-prompt`, so multiple paths are collapsed into one prompt).
- Qoder is hidden unless `NEUMA_AGENT_QODER=1`; its install options include npm, the
  vendor install script as a copy-only command, and Homebrew cask.
- **Cursor Agent** (`cursor-agent`) installs via `curl https://cursor.com/install -fsS | bash`
  (in-app runnable, no Homebrew/npm prerequisite); models are fetched live via
  `cursor-agent models` with a fallback list (`auto`, `sonnet-4`, `sonnet-4-thinking`,
  `gpt-5`); it has a dedicated `authProbe` that treats `CURSOR_API_KEY`/`CURSOR_AUTH_TOKEN`
  env vars as pre-authenticated, else runs `cursor-agent models` and regexes the output for
  auth-required strings. `capabilities.modes` is `supported` for task, design, and video.
- **Qwen Code** (`qwen`) installs via `npm i -g @qwen-code/qwen-code@latest` (needs Node
  ≥ 20) or Homebrew; models come from `readQwenConfiguredModelIds()` plus a fallback list
  (`default`, `qwen3-coder-plus`, `qwen3-coder-flash`) — bounded read/parse failures fall
  back to the built-in list, so there is deliberately no kill switch for this discovery
  path. `capabilities.modes` is `supported` for task/design and `unsupported` for video.
- **GitHub Copilot CLI** (`copilot`) installs via `npm i -g @github/copilot` (needs Node
  ≥ 22) or the `copilot-cli` Homebrew cask; fallback models are curated (Claude Sonnet
  5/Opus 4.8/Sonnet 4.6, GPT-5.5). `capabilities.modes` is `supported` for task/design and
  `unsupported` for video.
- **Kimi Code CLI** (`kimi`, flag-gated behind `NEUMA_AGENT_KIMI=1`) installs via
  `curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash` or
  `npm i -g @moonshot-ai/kimi-code@latest` (needs Node ≥ 22), authenticates with `kimi
  login` (device-code OAuth), and is resolved from `KIMI_PATH` → PATH →
  `~/.kimi-code/bin/kimi`. It runs in ACP mode (`kimi acp` / `kimi --model <id> acp`) via
  `AcpRuntimeClient`, `supportsMcp: 'native'`. This is a separate integration path from the
  hosted "Kimi API (K3)" provider preset — see
  [Providers — Kimi API (K3)](providers.md#kimi-api-k3).
- **AtomCode** (`atomcode`, flag-gated behind `NEUMA_AGENT_ATOMCODE=1`) installs via npm or
  the `atomcode` Homebrew formula; it is a headless CLI adapter (`transport: 'cli'`,
  `promptDelivery: 'file'`) with `toolApproval: 'none'`, `mcpInjection: 'none'`, and
  `sessionContinuation: 'none'` — the weakest capability profile in the catalog.
- Connection tests normalize results to `ok`, `not_installed`, `auth_required`, or
  `unknown` so the settings UI can distinguish missing CLIs from authentication failures.

### Runtime Capability Model

Each `AgentRuntimeDef` also declares a `capabilities` object (`RuntimeCapabilities` in
`shared/agent-runtimes/types.ts`) — a separate, parallel system from the provider-plugin
transport/capability fields documented in
[Agent Transport & Capability Model](#agent-transport--capability-model) above:

| Field                 | Values                                                          | Description                                            |
| ---------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| `modes`                | `Record<'task'\|'design'\|'video', 'supported'\|'experimental'\|'unsupported'>` | Per-mode availability; absent is treated as unknown, not supported |
| `toolApproval`         | `host-mediated`, `runtime-native`, `none`                        | Who mediates tool-use approval                          |
| `mcpInjection`         | `native`, `workspace-config`, `none`                              | How MCP servers reach the runtime                        |
| `sessionContinuation`  | `by-id`, `continue-latest`, `acp-load`, `none`                    | How a session is resumed across turns                    |

`getRuntimeModeSupport()` (`shared/agent-runtimes/capabilities.ts`) reads
`capabilities.modes?.[mode] ?? null`. On the frontend,
`resolveProviderModeSupport()`/`buildRuntimeModelOptions()`
(`src/components/shared/runtime-model-catalog.ts`) gate the model picker on this value:
`unsupported` disables the row with the locale string "Not available in this mode yet"
(`modelPickerRuntimeUnavailableInMode`); `experimental` does **not** disable the row — it
renders as a fully selectable model, distinguished only by the "(experimental)" suffix in
the runtime's display name. Several older catalog entries (`gemini`, `opencode`, `devin`,
`kilo`, `vibe`, `trae-cli`, `deepseek`, `kiro`, `hermes`, `pi`) declare no `capabilities.modes`
at all.

Selected models for runtimes in `PREFIXED_RUNTIME_IDS`
(`src/shared/lib/runtime-model-ids.ts`: `cursor-agent`, `qwen`, `copilot`, `kimi`,
`atomcode`) are persisted and transmitted as `<runtimeId>:<modelId>` (e.g.
`cursor-agent:auto`), stripped at the API boundary. `codex:<model>` ids keep their own
pre-existing, separate prefix contract and are not parsed by this module.

`validatePromptDeliveryBudget()` guards adapters that still pass prompts on argv. It
checks the declared byte budget and, on Windows, the command-line limit for both direct
executables and `.cmd`/`.bat` shims. Cursor Local, Gemini Local, and OpenCode Local use
this guard to return `AGENT_PROMPT_TOO_LARGE` instead of spawning an unsafe command.

CLI binary resolution goes through the shared `resolveOnPath()` helper so runtime
detection, health checks, and agent subprocess launch use the same expanded PATH.
The search path includes common Homebrew, MacPorts, Linuxbrew, npm-global, Volta,
mise, nvm, fnm, asdf, Cargo, and Bun locations in addition to the process PATH.

## New Agent Providers

### A2A Agent (Agent-to-Agent Protocol)

**Transport**: `a2a` (JSON-RPC 2.0 over HTTP) — `src/extensions/agent/a2a/`

- **Agent card discovery** via `/.well-known/agent-card.json`
- SSE streaming for real-time task updates
- Task lifecycle: send, get, list, cancel
- Config: `baseUrl` (SSRF-validated), optional `apiKey`

### Gemini Local CLI Agent

**Transport**: `cli` (spawns local `gemini` binary) — `src/extensions/agent/gemini-local/`

- JSONL streaming output with `parseJsonlStream()`
- Session resume via `--resume` flag
- Model aliases: `auto`, `pro`, `flash`, `flash-lite`
- Plan mode: `orchestrated` (via BaseAgent)

### Pi Local Agent

**Transport**: `cli` with Pi RPC streaming — `src-api/src/extensions/agent/pi-local/`

- Runtime id: `pi-local`; catalog id: `pi`
- Starts `pi --mode rpc` and sends prompts over stdin
- Supports model and reasoning/thinking options from the runtime catalog
- Parses Pi RPC messages into the standard agent stream protocol
- Supports image inputs when passed through runtime options
- Cancels by sending the runtime abort command, then falls back to process termination
- MCP support: `native`

### Open Agent SDK

**Transport**: `sdk` (in-process) — `src-api/src/extensions/agent/open-agent-sdk/`

- Provider id: `open-agent-sdk`
- Uses `@codeany/open-agent-sdk` directly in the API process; no local CLI binary
  or PATH resolution is required
- Requires an API key from provider settings, `ANTHROPIC_API_KEY`, or
  `OPENAI_API_KEY`
- Auto-selects `anthropic-messages` for Claude model ids and
  `openai-completions` for OpenAI-compatible model families or custom base URLs
- Supports streaming and orchestrated plan mode: planning emits a single
  reviewable shell step, then execution lets the SDK run its internal
  plan/execute loop
- Maps Neuma thinking settings to the SDK thinking config and logs usage through
  `logUsage()`
- Runs the shared permission registry and dangerous Bash-command checks through
  the SDK `canUseTool` callback
- MCP support: `native`; skills support: `none`; sandbox support: `false`

### HTTP Agent (Generic REST/SSE Adapter)

**Transport**: `http` — `src/extensions/agent/http-agent/`

- Generic adapter for any HTTP-based agent endpoint
- OpenAI-style SSE parsing (delta chunks)
- Custom content field support
- Config: `baseUrl` (SSRF-validated), optional `apiKey`, optional `model`

## Shared CLI Utilities

Common utilities for CLI-based agent plugins (`src/extensions/agent/shared/cli/`):

| Module                | Purpose                                                      |
| --------------------- | ------------------------------------------------------------ |
| `command-resolver.ts` | Parse bash command syntax into args                          |
| `cwd-validator.ts`    | Validate/normalize working directory paths                   |
| `env-merger.ts`       | Merge environment variables for subprocess                   |
| `jsonl-parser.ts`     | Stream-based JSONL parsing for CLI output                    |
| `preflight.ts`        | Environment health checks (binary exists, auth, hello probe) |
| `timeout-cancel.ts`   | Wire AbortController to child process                        |

## Soul System

The soul system provides a structured personality and behavioral framework for AI agents.
A "soul" defines an agent's identity, communication style, reasoning approach, and operational
boundaries through a **6-pillar JSON configuration** that persists across conversations.

### The 6 Pillars

| #   | Pillar         | Required Fields                  | Optional Fields                                                                          |
| --- | -------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | **Identity**   | `role`, `core_values` (1+)       | `worldview`, `opinions`                                                                  |
| 2   | **Voice**      | `tone`, `style_rules` (1+)       | `greeting`, `example_phrases`, `anti_patterns`                                           |
| 3   | **Cognition**  | `reasoning_style`                | `expertise`, `operating_modes` (key-value), `approach_preferences`, `skill_bundles`      |
| 4   | **Boundaries** | `red_lines` (1+, never violated) | `escalation_rules`, `privacy_rules`, `action_limits`                                     |
| 5   | **Continuity** | _(none)_                         | `session_notes`                                                                          |
| 6   | **Evolution**  | _(none)_                         | `self_improving` (boolean), `max_corrections` (default 50), `max_learnings` (default 50) |

### Soul Templates

Predefined personality configurations for common agent roles, with multi-language support
(en-US, zh-CN, es-ES, fr-FR, hi-IN, pt-BR).

**Built-in templates:**

| Template ID           | Role                      |
| --------------------- | ------------------------- |
| `neumar-default`      | Default assistant persona |
| `fullstack-developer` | Full-stack development    |
| `code-reviewer`       | Code review specialist    |
| `qa-engineer`         | QA / testing              |
| `strategic-leader`    | Strategic leadership      |
| `creative-writer`     | Creative writing          |
| `security-auditor`    | Security auditing         |
| `research-analyst`    | Research analysis         |
| `data-analyst`        | Data analysis             |
| `ops-engineer`        | Operations / DevOps       |
| `product-manager`     | Product management        |

Templates are fetched via `GET /soul/templates?quickstart=true&language={lang}`.

### Soul Evolution

The soul system supports autonomous self-improvement through correction detection and
learning extraction:

```
┌──────────────────┐       ┌──────────────────┐
│  Conversation    │──────▶│  Correction      │
│  Messages        │       │  Detection       │
│                  │       │  (regex + LLM,   │
│                  │       │   multilingual)   │
└──────────────────┘       └────────┬─────────┘
                                    │ confidence >= 0.7
                                    ▼
                           ┌──────────────────┐
                           │  corrections_log │
                           │  (JSON array)    │
                           └────────┬─────────┘
                                    │ >= 20 corrections
                                    ▼
┌──────────────────┐       ┌──────────────────┐
│  LLM proposes    │◀──────│  Evolution       │
│  amendments to:  │       │  Trigger         │
│  • voice.        │       │  (auto or manual │
│    style_rules   │       │   via API)       │
│  • cognition.    │       └──────────────────┘
│    approach_     │
│    preferences   │       ┌──────────────────┐
│  • identity.     │       │  Learning        │
│    opinions      │──────▶│  Extraction      │
│  • boundaries.   │       │  Categories:     │
│    escalation_   │       │  • pattern       │
│    rules         │       │  • preference    │
└──────────────────┘       │  • tool_usage    │
                           │  • domain_       │
                           │    knowledge     │
                           │  • communication │
                           └──────────────────┘
```

**Immutable fields** (NEVER modified by evolution): `identity.core_values`, `boundaries.red_lines`.

### Soul Rendering

`soul-renderer.ts` converts the `AgentSoul` JSON into an XML-wrapped system prompt:

```xml
<agent_soul version="1.0">
  <!-- localized section headers (6 languages) -->
</agent_soul>
```

**Token budget allocation:**

| Section                | Budget     |
| ---------------------- | ---------- |
| Identity + Voice       | 500 tokens |
| Cognition + Boundaries | 400 tokens |
| Corrections            | 300 tokens |
| Learnings              | 200 tokens |
| Pinned facts           | 200 tokens |

**Truncation strategy (graceful degradation):**

1. `opinions` truncated first
2. `example_phrases` truncated next
3. `operating_modes` truncated last
4. `red_lines` are **never** truncated

### Soul Database Schema (Migration 004)

Added columns on the `agent_profiles` table:

| Column            | Type | Description                                               |
| ----------------- | ---- | --------------------------------------------------------- |
| `soul`            | JSON | Full 6-pillar soul configuration                          |
| `soul_version`    | INT  | Incrementing counter (bumped on every soul update)        |
| `soul_origin`     | TEXT | `'predefined'` \| `'user'` \| `'evolved'` \| `'imported'` |
| `corrections_log` | JSON | Array of detected corrections                             |
| `learnings`       | JSON | Array of extracted learnings                              |

### Soul API Routes (`soul.ts`)

| Method | Path                                      | Description                                                                 |
| ------ | ----------------------------------------- | --------------------------------------------------------------------------- |
| GET    | `/soul/agent-profiles/:id`                | Get soul configuration                                                      |
| PUT    | `/soul/agent-profiles/:id`                | Update soul configuration                                                   |
| POST   | `/soul/agent-profiles/:id/apply`          | Apply a soul template                                                       |
| GET    | `/soul/agent-profiles/:id/corrections`    | Correction history                                                          |
| GET    | `/soul/agent-profiles/:id/learnings`      | Learning history                                                            |
| POST   | `/soul/agent-profiles/:id/auto-structure` | Convert freeform text to soul JSON                                          |
| POST   | `/soul/agent-profiles/:id/evolve`         | Trigger evolution (`dry_run` mode supported)                                |
| GET    | `/soul/agent-profiles/:id/export`         | Export soul as JSON                                                         |
| POST   | `/soul/agent-profiles/:id/import`         | Import soul from JSON                                                       |
| GET    | `/soul/templates`                         | List available soul templates (supports `?quickstart=true&language={lang}`) |

## User Templates

Pre-configured assistant presets (`user_templates` table) with bundled defaults:

- Categories: `dev`, `writing`, `research`, `data`, `design`, `ops`
- Each template: name, description, system prompt, suggested model, skills, MCP servers, starter prompts
- Built-in templates: Code Review, Documentation, Research, Analytics, Design, QA, DevOps
- Accessible via the Template Gallery on the Home page

## Claude Agent Implementation

The primary agent implementation (`extensions/agent/claude/`) leverages:

- **@anthropic-ai/claude-agent-sdk** — official Claude Agent SDK
- **Auto-detection** — finds Claude Code CLI from user installation or bundled sidecar; caches the resolved path
- **Version detection** — calls `claude --version` once at startup to determine the CLI version; result is cached. The `supportsSettingSources()` helper checks whether the installed version supports the `--setting-sources` flag (requires Claude Code ≥ 2.0.0). When the CLI is older (1.x) or the version cannot be detected, `settingSources` is omitted from the query options to avoid a startup crash.
- **Model compatibility** — `DEFAULT_CLAUDE_MODEL` is `claude-sonnet-5`. Sonnet 5 requires Claude Code ≥ 2.1.197; `resolveSupportedClaudeModel()` falls back to `claude-sonnet-4-6` when the installed CLI cannot run the selected Sonnet 5 model, and runtime errors are normalized to the Sonnet 5 upgrade message.
- **Custom API support** — OpenRouter, 火山引擎 (Volcengine), and other providers via
  `baseUrl`/`apiKey` configuration
- **MCP integration** — loads user-configured MCP servers, injects sandbox MCP server,
  auto-registers the Linear MCP server (18 tools) when a Linear API key is configured,
  and auto-registers the Memory MCP server (7 tools: `memory_store`, `memory_search`,
  `memory_list`, `memory_delete`, `memory_pin`, `memory_entities`, `memory_entity_graph`)
  when memory is enabled
- **Slack search tools** — when the session originates from Slack (`channelContext.platform === 'slack'`
  and `channelContext.botToken` is set), `registerSlackSearchTools()` auto-registers an in-process
  MCP server (`slack-search`) with 5 tools: `slack_search_users`, `slack_search_messages`,
  `slack_search_channels`, `slack_send_message`, `slack_send_channel_message`. The `action_token`
  from the Slack event is passed through for `assistant.search.context` API calls. A prompt hint
  ("AVAILABLE SLACK CHANNEL TOOLS") is appended to the system context. See [Channels — Slack Search & Messaging Tools](channels.md#slack-search--messaging-tools).
- **Memory integration** — four hooks wired into the agent lifecycle:
  1. **Auto-recall** (pre-query) — runs hybrid search on the user prompt and prepends relevant
     memories as an XML `<relevant-memories>` block with safety instructions
  2. **Auto-capture** (post-execute) — rule-based extraction stores important facts from the
     user's message with deduplication (0.95 similarity threshold)
  3. **LLM capture** (optional, post-execute) — lightweight Haiku model call extracts structured
     facts at configurable intervals (every N turns) or on explicit "remember" keyword
  4. **Memory flush** (pre-compaction) — when conversation exceeds ~16K tokens (64K chars),
     re-runs capture logic on recent user messages to persist context before compaction
- **Per-message cost tracking** — captures `cost`, `usage` (input, output, cache read,
  cache creation tokens), `model`, and `duration` from the SDK result events during both
  planning and execution phases; these are persisted to the `messages` table and surfaced
  in the frontend toolbar
- **Programmatic Tool Calling** — when `ptcEnabled` is set and the plan chooses `executionMode: 'batch'`,
  the execute phase delegates to `executePTC()` instead of the SDK `query()` loop
- **Image attachments** — saves images to disk and references them in prompts
- **Conversation history** — truncated with token limits for context management

## Tool Permission Registry

`ToolPermissionRegistry` (`src/core/agent/tool-permission-registry.ts`) evaluates whether each tool call should be allowed, denied, or escalated for user approval.

### Tool Classifications

Every tool is classified by risk level:

| Classification | Tools                          | Default Behavior  |
| -------------- | ------------------------------ | ----------------- |
| `read`         | Read, Glob, Grep               | Auto-allow        |
| `write`        | Write, Edit                    | Auto-allow        |
| `execute`      | Bash, Task                     | Requires approval |
| `destructive`  | _(none built-in)_              | Requires approval |
| `network`      | WebSearch, WebFetch, MCP tools | Requires approval |

MCP tools default to `network` classification.

### Permission Rules

Users configure rules via `ToolPermissionRules`:

- `alwaysAllow[]` — bypass approval (e.g. `"Read"`, `"Bash(npm test)"`)
- `alwaysDeny[]` — block unconditionally
- `alwaysAsk[]` — always prompt the user

Rules support pattern matching: `"ToolName(pattern)"` matches tool name and input content (e.g. `"Bash(rm *)"` denies any Bash call containing `rm`).

**Evaluation order:** deny rules → ask rules → allow rules → classification default → allow.

## Dangerous Pattern Detection

`checkBashCommand()` and `checkFileOperation()` in `src/core/agent/safety/dangerous-patterns.ts` perform static analysis on tool inputs to detect risky operations.

### Pattern Categories

| Severity  | Patterns                                      | Examples                                            |
| --------- | --------------------------------------------- | --------------------------------------------------- |
| **Block** | Destructive commands, credential exfiltration | `rm -rf /`, `dd if=/dev/`, `curl -d @~/.ssh/id_rsa` |
| **Warn**  | Privilege escalation, process control         | `chmod 777`, `sudo`, `kill -9`, `chown root`        |

### Sensitive Paths (File Operations)

Write operations to these paths are flagged: `/etc/`, `/usr/`, `/sys/`, `/boot/`, `~/.ssh/`, `~/.aws/`, `~/.gnupg/`.

### Risk Assessment

`assessRiskLevel(toolName, input)` returns `'low' | 'medium' | 'high'`:

| Risk   | Tools                                 |
| ------ | ------------------------------------- |
| Low    | Read, Glob, Grep, Skill, Edit         |
| Medium | Write, Bash, Task, MCP tools          |
| High   | Bash commands matching block patterns |

Risk level is displayed in the frontend's `PermissionDialog`.

## Denial Tracker

`DenialTracker` (`src/core/agent/denial-tracker.ts`) tracks per-session tool denials to prevent agents from repeatedly requesting the same denied operation.

- Tracks denials by key: `toolName:inputSummary[0:100]`
- After 3 denials of the same tool, `shouldFallback()` returns `true`
- `getSummary()` returns a human-readable text injected into the system message to guide the agent toward alternative approaches
- `reset()` clears all denials (used on session end)

## Tool Lifecycle Hooks

`ToolLifecycleHookRunner` (`src/core/agent/tool-lifecycle-hooks.ts`) provides an event-driven hook system for intercepting tool execution.

### Hook Interface

```typescript
interface ToolLifecycleHook {
  event: "pre_tool_use" | "post_tool_use";
  matcher?: string; // regex pattern (e.g. "Write|Edit")
  handler: (input: ToolHookInput) => Promise<ToolHookOutput>;
  priority: number; // higher runs first
  async?: boolean; // fire-and-forget (post-hooks only)
}
```

### Hook Actions

Pre-tool hooks return one of:

- `{ action: 'allow' }` — proceed with execution
- `{ action: 'deny', message }` — block execution with explanation
- `{ action: 'modify', modifiedInput }` — rewrite tool input before execution

Post-tool hooks can log, audit, or trigger side effects asynchronously.

**Fail-open design:** Hook errors are logged but do not block tool execution.

**SDK integration:** `toSdkHooks()` converts hooks to Claude Agent SDK `Options.hooks` format. For non-SDK providers, `runPreToolUse()` / `runPostToolUse()` are called directly.

## Tool Result Limiter

`limitForDisplay()` in `src/core/agent/tool-result-limiter.ts` truncates tool results for frontend display and database storage. The SDK handles model-side truncation internally.

| Tool      | Display Limit |
| --------- | ------------- |
| Bash      | 50K chars     |
| Grep      | 30K chars     |
| Glob      | 20K chars     |
| Read      | 100K chars    |
| WebFetch  | 50K chars     |
| WebSearch | 30K chars     |
| Default   | 50K chars     |

Truncated results show: `[Output truncated for display. Full output available in workspace.]`

## Error Retry Strategy

`categorizeError()` / `retryWithStrategy()` in `src/core/agent/error-retry.ts` provide intelligent HTTP error handling with jittered exponential backoff.

| Status                    | Action       | Max Retries | Delay Range |
| -------------------------- | ------------ | ----------- | ----------- |
| 429 (rate limit)           | `backoff`    | 5           | 2s–60s      |
| 401 / 403 (auth/forbidden) | `fail`       | 0           | —           |
| 500/502/503/504 (server)   | `backoff`    | 3           | 1s–32s      |
| 400/404/422 (bad request)  | `fail`       | 0           | —           |
| Default                    | `backoff`    | 2           | 1s–16s      |

Auth failures (401/403) no longer retry — there is no token-refresh path wired up, so they
fail immediately rather than burn a retry budget.

Jitter applies 50–100% of the calculated delay to prevent thundering herd.

### Failure Classification & Auto-Retry Safety Gate

Beyond the HTTP-status strategy above, every failure is classified into a `FailureCause`
(`auth`, `quota`, `timeout`, `model_refusal`, `tool_error`, `missing_binary`,
`spawn_permission`, `routing_mismatch`, `network`, `invalid_request`, `server`, `cancelled`,
`unknown`) with a `RetryDisposition` of `safe_auto_retry`, `hitl_required` (human-in-the-loop),
or `do_not_retry`, plus a `FailureRecoveryAction` (a `type`, a short `label`, and a `hint`)
surfaced to the user in execution diagnostics.

`shouldAutoRetryRun(classification, context)` gates *silent* auto-retry of an entire run (as
opposed to the HTTP-level backoff above) to the narrowest safe case: `retryDisposition ===
'safe_auto_retry'`, first attempt (`attempt === 0`), and nothing has happened yet that a retry
would duplicate or discard — no visible output, no tool call, no artifact write, no live
artifact, and the run wasn't user-cancelled. Anything riskier surfaces to the user instead of
retrying silently.

## File State Cache

`FileStateCache` (`src/core/agent/file-cache.ts`) is an LRU cache for file content with mtime-based invalidation, preventing re-reads of unchanged files across agent turns.

- **Max entries:** 500 (configurable)
- **TTL:** 30 minutes
- **Invalidation:** mtime check on `get()`, prefix/suffix/substring pattern invalidation
- **Sub-agent sharing:** `clone()` creates a shallow copy for sub-agents (no state coupling)
- **Observability:** `getMetrics()` returns `{ size, hits, misses }`

## Sub-Agent Supervision

Sub-agents are spawned via the `Task` tool during execution. The system provides supervision through:

### Backend

- **Context isolation:** Sub-agents use `contextMode: 'minimal'` (runtime + workspace context only, no full profile/memory)
- **Message scoping:** `parentToolUseId` on `AgentMessage` scopes sub-agent messages to the parent tool call
- **Workspace isolation:** `isolation: 'shared' | 'worktree'` controls whether sub-agents share the workspace or use a git worktree
- **Cache sharing:** `FileStateCache.clone()` shares cached file state without coupling

### Frontend

- **SubAgentPanel** shows live sub-agent lifecycle (running/completed/failed/cancelled)
- **useSubAgents** hook tracks `step_started` / `step_finished` SSE events
- **PermissionDialog** surfaces permission requests from both main and sub-agents
- **usePermissionRequests** hook subscribes to `permission_request` messages and auto-denies unresolved requests when the run ends

### Permission Flow

```
Tool Call → ToolLifecycleHookRunner.runPreToolUse()
  ├─ ToolPermissionRegistry.evaluate() → allow/deny/ask
  ├─ DangerousPatterns.assessRiskLevel() → risk level
  └─ If 'ask': emit permission_request AgentMessage
       ├─ Frontend shows PermissionDialog (risk badge + 3 buttons)
       │   └─ User responds: Allow Once / Always Allow / Deny
       └─ DenialTracker records denials; after 3, suggests fallback
```

## CopilotKit Stale Thread Recovery

The CopilotKit runtime proxy (`copilotkit.ts`) includes a `resetStaleThread()` middleware that runs on every incoming request via the `onBeforeRequest` hook.

### Problem

CopilotKit's `InMemoryAgentRunner` uses a global `Map<threadId, ThreadStore>` (keyed by `Symbol.for('@copilotkitnext/runtime/in-memory-store')`). If a previous run did not complete normally (page refresh, client disconnect, SSE hang), the thread's `isRunning` flag remains `true`. Subsequent `run()` calls for the same `threadId` throw `"Thread already running"`.

### Recovery Mechanism

Before each request, the middleware:

1. Looks up the thread's store entry via the well-known global symbol
2. If `isRunning === true`, performs best-effort cleanup:
   - Calls `store.agent.abortRun()` to cancel any lingering agent
   - Calls `store.runSubject.complete()` to close the observable
3. Resets all state fields: `isRunning = false`, `currentRunId = null`, `agent = null`, `runSubject = null`, `stopRequested = false`, `currentEvents = null`

### CopilotKit Route Structure

The proxy registers a single `HttpAgent` pointing at the local AG-UI endpoint (`http://127.0.0.1:{port}/ag-ui/run`) as the `default` agent. `createCopilotEndpoint` generates the following sub-routes:

| Method | Path                                        | Description                  |
| ------ | ------------------------------------------- | ---------------------------- |
| `GET`  | `/copilotkit/info`                          | Agent discovery              |
| `POST` | `/copilotkit/agent/:agentId/run`            | Start agent run (SSE stream) |
| `POST` | `/copilotkit/agent/:agentId/connect`        | Long-lived connection        |
| `POST` | `/copilotkit/agent/:agentId/stop/:threadId` | Abort run                    |

## AG-UI Media File Versioning

When the AG-UI route (`ag-ui.ts`) downloads media from MCP tool output to the workspace, it implements automatic file versioning to prevent silent overwrites.

### Versioning Behavior

The `downloadMediaToWorkspace()` function:

1. Sanitizes the filename from the URL path (strips non-alphanumeric characters)
2. If a file with the same name already exists at the destination:
   - Creates a `.versions/` subdirectory in the same folder
   - Moves the existing file to `.versions/{base}.{ISO-timestamp}{ext}` (e.g. `.versions/image.2026-04-05T14-30-00.png`)
   - Records the version in the `file_snapshots` table (if a `taskId` is available) for the Diff tab
3. Downloads the new file to the original path
4. Performs SSRF validation on the URL before fetching (defense-in-depth, even though URLs come from MCP tool output)

### MCP Media Detection

The `withWorkDirSync()` generator wrapper intercepts `tool_result` messages from MCP tools. It identifies media-producing tools by tracking `tool_use` id-to-name mappings and checking if the tool name matches `mcp__*` with substrings `image`, `media`, or `generate`. Detected media URLs (matching `MEDIA_URL_RE` for common image/video/audio extensions) are downloaded and the tool output is annotated with `Saved to: {localPath}`.

---

_See also: [Plugins & Extensions](../plugins/index.md) · [Streaming Architecture](../data-flow/streaming.md) · [Memory System](memory.md)_
