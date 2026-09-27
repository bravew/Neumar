# Post-Upgrade SDK Feature Adoption Plan - 2026-09-27

## Context

PR [#61](https://github.com/bravew/Neumar/pull/61) (G2–G14) and
[#47](https://github.com/bravew/Neumar/pull/47) (G1) upgraded most of the
workspace. This plan adopts the new features and fixes those upgrades made
available, with most of the effort on the two agent SDKs.

Resolved versions, from `pnpm-lock.yaml` before (`60aa518`) and after (`51fcf59`):

| Package | Before | After | Notes |
|---|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | 0.3.239 | **0.3.239 (pinned)** | 0.3.283 is latest; held back, see WS0 |
| `@openai/codex-sdk` / `@openai/codex` | 0.149.0 | 0.157.1 | CLI 0.150–0.157 features |
| `@anthropic-ai/sdk` | 0.120.0 | 0.128.0 | Direct Messages API callers |
| `@copilotkit/*`, `@ag-ui/*` | 1.69 / 0.0.58 | 1.74 / 0.0.59 | Frontend AG-UI provider |
| `react`, `react-dom` | 19.2.8 | 19.3.0 | Stable `<ViewTransition>`, Fragment refs |
| `@tauri-apps/*`, Cargo `tauri` | 2.11 | 2.12 | Desktop shell/plugins |

**Most Claude agent SDK features need an upgrade that has not happened yet.**
#61 pinned the Claude agent SDK at `0.3.239`. The caret range resolved to
0.3.283, whose `createSdkMcpServer` makes MCP `tools/list` fail with `-32603
Cannot read properties of undefined (reading 'push')` for the Video Mode
`video-edit` server (reproduced by
`src-api/test/integration/video-codex-bridge.test.ts`). Nearly everything in
the Claude track below depends on 0.3.240–0.3.283. Unblocking that upgrade is
the one blocking step (WS0). The Codex and app-library tracks do not wait for it.

Decisions confirmed with the user on 2026-09-27:

1. WS0 comes first: find and fix the root cause, then bump to 0.3.283.
   The Claude feature issues depend on WS0.
2. Scope: the agent SDKs (Claude, Codex, Anthropic) are the core. A smaller
   track covers key app libraries (React 19.3, CopilotKit/AG-UI, Tauri 2.12).
   Remotion, HyperFrames, and react-pdf are out of scope.
3. The GitHub issues are created only after the user approves this plan.

## Sources

- Claude agent SDK changelog (0.3.240–0.3.283):
  https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md
- Agent SDK permissions (evaluation order, `permissionPrompts`, shadowed
  `canUseTool` warning): https://code.claude.com/docs/en/agent-sdk/permissions
- Agent SDK sessions (resume, fork, `getSessionMessages`):
  https://code.claude.com/docs/en/agent-sdk/sessions
- Agent SDK cost tracking: https://code.claude.com/docs/en/agent-sdk/cost-tracking
- Agent SDK hosting: https://platform.claude.com/docs/en/agent-sdk/hosting
- Codex CLI releases 0.150.0–0.157.1: https://github.com/openai/codex/releases
- Codex TypeScript SDK: https://github.com/openai/codex/tree/main/sdk/typescript
  (the `.d.ts` diff from 0.149.0 to 0.157.1 adds only `ModelReasoningEffort
  "persistent"` and `ThreadOptions.threadSource`)
- Anthropic TS SDK changelog 0.121–0.128:
  https://github.com/anthropics/anthropic-sdk-typescript/blob/main/CHANGELOG.md
- React 19.3: https://react.dev/blog/2026/09/09/react-19-3
- CopilotKit releases: https://github.com/CopilotKit/CopilotKit/releases

## Current-state findings (verified in this checkout)

These findings are the basis for the issues. Each one is a verified gap, not a guess.

| # | Finding | Location |
|---|---|---|
| F1 | `canUseTool` auto-approves when there is no `taskId` ("we can't show UI"). Headless runs, such as channels and schedules, approve every `ask` decision. | `src-api/src/extensions/agent/claude/index.ts:647-651` |
| F2 | `DEFAULT_ALLOWED_TOOLS` passes bare `Edit`/`Write`/`WebFetch`… as `allowedTools`. The SDK auto-approves these before `canUseTool` runs, so the permission registry never sees them. The SDK now emits the `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` process warning for this pattern. | `src-api/src/core/agent/permission-rules.ts:42`, `claude/index.ts:2993` |
| F3 | `getContextUsage()` is called for logging only. With the default `detail: 'full'`, each call makes per-category token-count API requests. | `claude/index.ts:1880` |
| F4 | The Codex adapter handles only `item.completed`. It ignores `item.started`/`item.updated`, so there is no live command output or reasoning progress, and `todo_list` items are dropped. | `src-api/src/extensions/agent/codex/index.ts:332-515` |
| F5 | The Codex adapter never passes `outputSchema`, although `AgentOptions.outputFormat` exists and the Claude adapter honors it. | `codex/index.ts` vs `src-api/src/core/agent/types.ts:595` |
| F6 | The main Codex agent drops user images. Only the media-generation adapter uses `local_image`. | `codex/index.ts`, `shared/services/media-generation/adapters/codex.ts:480` |
| F7 | Codex usage ignores `cache_write_input_tokens`. | `codex/index.ts:730,821,975` |
| F8 | The Codex fallback model list and `clampCodexReasoning` stop at gpt-5.5. The CLI now ships GPT-6 Sol/Luna/Astra and a `persistent` effort level. | `src-api/src/shared/agent-runtimes/registry.ts:466`, `models.ts:207` |
| F9 | None of the new Claude SDK stream fields are consumed: `system/informational`, `api_retry`, `startup_failure_reason`, `plugin_errors`, `resourceLinks`, `costBasis`, `result_index`, `queued_turn_count`, `session_state_changed`, or `conversation_reset`. | `claude/index.ts` message handling (~6290–6600) |
| F10 | No use of `forkSession`, `verbatimPrompts`, `perTaskStopAffordance`, `permissionPrompts`, `prewarm`, `omitClaudeMd`, per-server MCP `timeout`, or the `/core` entry point. | repo-wide `rg` |

Upgrade behavior changes that WS0 must check, because they can change
behavior without breaking typecheck:

- **0.3.268:** TaskCreate/TodoWrite are default tools only on older models. On
  Opus 5.5 / Sonnet 5 they must appear in `tools`/`allowedTools`. `TodoWrite`
  is in `DEFAULT_ALLOWED_TOOLS`. Verify video and other custom allowlists.
- **0.3.265:** a `cd` made by the agent now persists across turns. Previously,
  each user message reset the shell to `cwd`.
- **0.3.267:** `systemPrompt` recording is on by default for appends, so a
  mid-session change applies at the next compaction. Neumar rebuilds the
  append per turn (`buildSystemPromptAppend`). Decide whether it needs
  `snapshot: false`.
- **0.3.243:** Read tool PDF content now arrives inside `tool_result`.
  Check the tool-result renderers.
- **0.3.283:** omitting `max_thinking_tokens` in `set_max_thinking_tokens` no
  longer resets the budget; to reset it, send `null`.
- **0.3.281:** the `Settings.attribution` type is `boolean | {...}`.

## Throughput checkpoint

1. **Blocking first steps:** only WS0 (Claude SDK 0.3.283). It blocks every
   `C*` issue. `X*`, `A*`, and `R*` start immediately.
2. **Independent workstreams:** Codex (`extensions/agent/codex/`,
   `agent-runtimes/`), Anthropic direct callers (`shared/services/*`), and the
   frontend app libraries (`src/`) share no files with the Claude track.
3. **Shared mutable state:** `src-api/src/extensions/agent/claude/index.ts`
   (6,676 lines) is the hotspot, and every Claude issue touches it. Two rules
   apply:
   - New logic goes into a **new sibling module** (for example,
     `claude/stream-notices.ts`). `index.ts` changes are limited to wiring:
     imports, one call site, and one option spread.
   - All new stream-message handling is consolidated in one issue (C2), so
     only one agent edits the message `switch`.
   - Locale files (`src/config/locale/messages/*/`) are edited by several
     frontend issues. Each issue adds keys under its own namespace. The
     second PR to merge rebases; conflicts there are append-only.
   - `codex/index.ts` is shared by X1–X4. X1 owns the event loop; X2, X3,
     and X4 touch only `buildThreadOptions`, the prompt/input builder, or the
     usage mapper. Merge X1 first.
4. **Smallest safe decomposition:** the seven checkpoints below, with 16
   issues. Each issue is one PR with its own regression test.

## Checkpoints

Each checkpoint lists the issues it contains, the surface touched, the
observable result, and the verification needed before moving on. Issues
within a checkpoint run in parallel.

### CP1 — Unblock Claude agent SDK 0.3.283 (blocking, serial)

**WS0 · `fix(deps): upgrade claude-agent-sdk to 0.3.283 with Zod-safe MCP tool schemas`**

- **Why:** everything in CP4–CP5 needs it. The #61 PR body describes the break:
  0.3.283's `createSdkMcpServer` walks `Object.values(inputSchema)` as a raw
  Zod shape and writes descriptions into the `zod/v4` `globalRegistry`.
- **Root-cause work (do this before changing any code):**
  - Reproduce with the pin raised, using
    `pnpm test:api test/integration/video-codex-bridge.test.ts`.
  - Find the tool whose schema breaks. `video-edit-server.ts` mixes raw shapes
    with schemas imported from `@neumar/video-ir` (`ContentGraphSchema`,
    `TimelineOpSchema`, …). Candidate causes: a `z.object` passed where a
    shape is expected, `.optional()`/`.describe()` wrappers around imported
    objects, or a second Zod instance. The lockfile carries `zod@3.25.76`
    alongside 4.6.5; check `pnpm why zod`.
  - Check whether 0.3.282's `@anthropic-ai/claude-agent-sdk/core` entry
    ("uses your installed zod and MCP SDK") changes the picture.
- **Fix:** correct the schemas at the source; do not add a cast or wrapper
  that hides the problem. Add a regression test that runs `tools/list`
  against **every** `createSdkMcpServer` factory (42 call sites under
  `src-api/src/shared/mcp/`), so the next SDK bump fails in CI rather than at
  runtime. If an upstream bug is confirmed, file it with a minimal repro and
  link it here.
- **Then:** set `"@anthropic-ai/claude-agent-sdk": "0.3.283"` (keep it exact,
  per the runbook's pre-1.0 pin policy), and work through the upgrade
  behavior-change list above. Each item is either handled in code or noted as
  "no change needed" in the PR.
- **Verify:** `pnpm test:api`, `pnpm test:fast`, `pnpm test:gate`,
  `pnpm validate`, `pnpm --filter neumar-api lint`,
  `pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit`. Then do a
  manual smoke test: a Claude chat turn, a Video Mode turn listing
  `video-edit` tools, and a Codex-on-Video turn over the bridge.

### CP2 — Codex track (parallel with CP1)

**X1 · `feat(codex): stream item.started/item.updated and render todo_list`** (F4)
- Handle `item.started` and `item.updated` for `command_execution` (live
  aggregated output), `reasoning`, `mcp_tool_call`, and `web_search`. Map
  `todo_list` onto the same AG-UI shape the Claude `TodoWrite` path renders,
  so the frontend needs no new renderer. Preserve partial agent text when
  `turn.failed` arrives, matching CLI 0.156's behavior.
- Files: `codex/index.ts` (event loop, owned by this issue), plus a possible
  new `codex/stream-mapper.ts`.
- Verify: unit tests feeding recorded `ThreadEvent` sequences through the
  mapper, including interrupted and failed turns;
  `pnpm test:api test/unit/agent/`.

**X2 · `feat(codex): honor outputFormat via TurnOptions.outputSchema`** (F5)
- Pass `options.outputFormat.schema` as `outputSchema` on `runStreamed`.
  Where callers hold Zod schemas, derive JSON Schema with Zod 4's
  `z.toJSONSchema()`. Do not add `zod-to-json-schema`.
- Verify: a unit test asserting that `outputSchema` reaches the turn options,
  and a structured-output caller test that parses the final agent message.

**X3 · `feat(codex): forward user images as local_image input`** (F6)
- Reuse the Claude adapter's `saveImagesToDisk` session-dir flow and build
  `UserInput[]` (`text` + `local_image`). Keep path validation through
  `path-validator.ts`.
- Verify: a unit test for the input builder; a manual smoke test attaching an
  image to a Codex task.

**X4 · `feat(agent-runtimes): Codex GPT-6 models, persistent effort, cache-write usage`** (F7, F8)
- Add GPT-6 Sol/Luna/Astra to `fallbackModels`. Make sure
  `parseCodexModelCatalog` handles their entries from `codex debug models`.
  Extend `reasoningOptions` and `clampCodexReasoning` for `max`/`ultra`/
  `persistent`, using the per-model supported efforts from the catalog if it
  exposes them. Map `cache_write_input_tokens` to `cacheWriteTokens`.
  Evaluate `threadSource` and `additionalDirectories` (worktree parity with
  Claude), and adopt them only if the semantics are confirmed.
- Files: `agent-runtimes/registry.ts`, `agent-runtimes/models.ts`, the
  `codex/index.ts` usage mapper, and the model picker locales if labels change.
- Verify: `pnpm test:api test/unit/agent-runtimes/`.

**X5 · `feat(codex): per-tool output limits for bridged MCP servers`**
- The CLI (0.152) supports a per-tool `output_token_limit`, and (0.151) an
  optional-MCP discovery grace period. Set limits for the heavy
  `video-edit`/`assets` bridge tools in the subprocess-bridge `codexConfig`.
  Before writing config, confirm the exact config keys against the CLI docs
  or source.
- Files: `src-api/src/shared/mcp/subprocess-bridge/`.
- Verify: a unit test on the generated `codexConfig`, and a
  video-codex-bridge integration test.

### CP3 — Anthropic direct-API and app libraries (parallel with CP1)

**A1 · `chore(api): adopt @anthropic-ai/sdk 0.128 for direct Messages callers`**
- Callers: `title-generator`, `auto-classifier`, `skill-extractor`,
  `dispatch-summary`, `video/image-analysis`, `automation/engine`, and `ptc`.
  Audit model IDs against the provider registry, including `claude-opus-5-5`.
  Pass `signal` so aborts cancel retry waits (a 0.126 fix). Where the code
  loops manually over tools (`ptc.ts`), assess whether the tool runner's
  `compactBeforeNextTurn()` (0.127) applies. Keep the change behavior-neutral
  unless a caller has a concrete bug.
- Verify: the existing unit tests for each caller, plus `pnpm test:api`.

**R1 · `feat(ui): use React 19.3 <ViewTransition> for route and panel transitions`**
- `<ViewTransition>` and `addTransitionType` are now stable. Apply them to
  route changes and the task/right-sidebar panel swaps, and respect
  `prefers-reduced-motion`. No `unstable_` imports exist today, so nothing
  needs migrating. Use the `trove-react-view-transitions` skill.
- Verify: `pnpm test` for the touched components, `pnpm validate`
  (component-size check), and a manual pass in `pnpm dev:both-web`.

**R2 · `spike: CopilotKit 1.74 / AG-UI 0.0.59 and Tauri 2.12 adoption review`**
- Timeboxed, research only. Read the CopilotKit 1.70–1.74 notes against
  `src/shared/providers/agui-provider.tsx`. 1.74's "stop per-message state
  cloning and the virtual-scroll tug of war" may let us remove local
  workarounds. Do the same for the Tauri 2.12 plugin notes against
  `src-tauri/`. Output: follow-up issues, or "nothing to adopt", with
  reasons. No code changes.

### CP4 — Claude: safety and permissions (after CP1; C1 and C3 in parallel)

**C1 · `fix(agent): stop headless auto-approval and shadowed canUseTool`** (F1, F2)
- **Needs a product decision in the issue before coding:** what a run with no
  approver should do. Recommended default: pass
  `permissionPrompts: 'none'` (0.3.259) for runs without a `taskId`, so
  `ask` decisions are denied. Explicit allow rules from
  `permission-rules.ts` and the channel/schedule config keep working
  intended tools. This replaces the silent auto-approve.
- For F2: replace bare `Edit`/`Write` allow entries with path-scoped rules,
  or move them behind `canUseTool`, so the permission registry actually
  decides. Add a `process.on('warning')` assertion in tests so
  `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` fails CI.
- Use the new `canUseTool` options: `mcpServer.source` (trust `sdk` servers
  differently from user-configured ones; 0.3.274), and `defaultToNo` /
  `suppressAlwaysAllowRule` (0.3.268), forwarded to the permission UI in
  `usePermissionRequests.ts` and the permission dialog, with strings in all
  six locales.
- Files: new `claude/permissions.ts` (extract `buildCanUseTool` there),
  `core/agent/permission-rules.ts`, and the frontend permission hook and
  dialog.
- Verify: unit tests for headless deny, scoped allow, and shadow-warning
  absence; `pnpm test src/__tests__/…permission…`; `pnpm validate`.

**C3 · `feat(channels): send channel and automation prompts verbatim`**
- Set `verbatimPrompts: true` (0.3.280) for prompts that come from channels
  (Slack, Discord, Telegram, Lark, and the gateway channels) and from
  schedules. This stops remote users from triggering `@path` file expansion
  or slash commands through message text. First trace which entry points
  reach the Claude adapter (see "Channels" in AGENTS.md).
- Files: adapter option wiring, plus a flag on `AgentOptions` set by the
  channel and schedule callers.
- Verify: a unit test asserting the option is set per source, and a
  regression test showing an `@~/.ssh/...` message is not expanded.

### CP5 — Claude: streaming, sessions, runtime (after CP1; C2, C4, C5, C6 in parallel)

**C2 · `feat(agent): surface new Claude SDK stream signals`** (F9; the only issue that edits the message switch)
- User-visible: `system/informational` warnings → notice rows. `api_retry`
  and `rate_limit_event` `rejected`/`resetsAt` → `useRateLimit` /
  `RateLimitIndicator`. `startup_failure_reason` → an actionable error.
  `plugin_errors` from `system/init` → plugin settings health. Also
  `conversation_reset` and `session_state_changed` (via
  `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`) for the task status.
- Telemetry: `modelUsage[*].thinkingTokens` and `costBasis`,
  `result_index`/`queued_turn_count` (to know whether another result follows),
  and cost continuity after resume (a 0.3.277 fix). Deduplicate usage by
  message ID, as the cost-tracking docs recommend.
- MCP `tool_use_result.resourceLinks` (0.3.257) → render returned files as
  artifacts, without parsing result text.
- Files: new `claude/stream-signals.ts`, one dispatch call in `index.ts`,
  `src/shared/hooks/agent-types.ts`, and the rate-limit and notice UI, with
  locales.
- Verify: mapper unit tests using recorded SDK messages for each signal;
  frontend tests for the notice and rate-limit rendering.

**C4 · `feat(chat): fork a conversation from a message`**
- Use `forkSession` / `forkSession({ upToMessageId })` and
  `getSessionMessages()` (fixed in 0.3.275 and 0.3.283) to offer "branch from
  here". Check whether `src/shared/lib/message-tree.ts` branching already
  models this before adding UI. Pair it with the existing `rewindFiles` for
  file state, since a fork does not branch the filesystem (see the sessions
  docs).
- Needs a UX confirmation in the issue: where the entry point lives, and how
  a fork appears in the thread list.
- Verify: an API test forking a recorded session, and frontend tests for the
  thread tree.

**C5 · `perf(agent): measure and cut Claude first-turn latency`**
- Measure first with `CLAUDE_CODE_EMIT_STARTUP_TIMING=1` (0.3.274, the
  per-phase `startup_timing`). Then evaluate, in order:
  `CLAUDE_CODE_MCP_STARTUP_WAIT_MS` for first-turn MCP waits; the in-process
  MCP handshake (0.3.281, automatic); `prewarm()` / `SpareProcess.claim()`
  (alpha, 0.3.282) for the next task in the same folder; and the
  `@anthropic-ai/claude-agent-sdk/core` entry point to shrink the sidecar
  bundle (`src-api/scripts/build.mjs`). Adopt only changes that show a
  measured improvement over the baseline. Use the `trove-perf` skill.
- Also fix F3: call `getContextUsage({ detail: 'summary' })` for logging.
- Verify: before/after timing numbers in the PR, and `pnpm build:api` size
  delta.

**C6 · `feat(mcp): per-server timeouts and interrupt semantics`**
- Set `createSdkMcpServer({ timeout })` (0.3.248) for long-running in-process
  servers (`video-edit`, `ffmpeg`, `media`, `speech`) instead of relying on
  the global `MCP_TOOL_TIMEOUT`.
- Evaluate `perTaskStopAffordance` (0.3.246): Stop aborts the current turn but
  keeps background agents running. Decide with the user whether that matches
  the Stop button's meaning. Filter `ambient` tasks out of activity
  indicators (0.3.247).
- Add `omitClaudeMd` (0.3.271) to agent-profile sub-agents that should not
  inherit the user's CLAUDE.md.
- Files: `src-api/src/shared/mcp/*-server.ts` factories, and the agent-profile
  → `AgentDefinition` mapping (`claude/index.ts:~3698`).
- Verify: unit tests on the server factory options and agent definitions.

### CP6 — Claude: MCP Apps spike (after CP1, optional)

**C7 · `spike: render MCP Apps ui:// resources in generative UI`**
- Explore whether 0.3.280 `mcpServerStatus()` tool `_meta` and alpha
  `readMcpResource()` can feed the existing generative-UI/artifact surface.
  This is research only; it produces a go/no-go and a follow-up issue.

### CP7 — Close-out

- Update `dev-doc/plan/_module-lib-upgrade.md`: remove the Claude SDK hold
  note, and record the "`tools/list` on every SDK MCP server" gate as a
  standing G9 check.
- Update `doc/backend/agent-system.md` and `wiki/Agent-System.md` where
  adapter behavior changed (permissions, Codex streaming).
- Run the full gate once on `main` after the last merge: `pnpm validate`,
  `pnpm test:fast`, `pnpm test:gate`, API lint and API tsc.

## Dependency graph

```text
WS0 ──┬── C1 ─┐
      ├── C3  │
      ├── C2  ├── CP7
      ├── C4  │
      ├── C5  │
      ├── C6  │
      └── C7 ─┘
X1 ──┬── X2 (rebase after X1)
     ├── X3 (rebase after X1)
     └── X4 (rebase after X1)
X5, A1, R1, R2 — independent
```

Wave 1, which can start now: WS0, X1, X5, A1, R1, R2 (six agents).
Wave 2: X2, X3, X4 after X1 merges; C1–C7 after WS0 merges.

## Parallel agent execution protocol

- One issue → one agent → one git worktree (`isolation: "worktree"`) → one
  branch off current `main` (`feat/<issue#>-<slug>`) → one PR that closes the
  issue.
- Each agent reads `AGENTS.md` and any nested `AGENTS.md` first, follows the
  working agreement (smallest correct change, regression test, format edited
  files only, `pnpm validate`), and reports failing commands verbatim.
- Hotspot rules from the throughput checkpoint are binding. An agent that
  needs more than wiring in `claude/index.ts` or `codex/index.ts` outside its
  ownership stops and comments on the issue instead of widening scope.
- Issues marked **needs decision** (C1 headless policy, C4 UX, C6 Stop
  semantics) get the decision recorded on the issue before an agent starts.
- No agent bumps dependencies except WS0. Lockfile changes outside WS0 are a
  review failure.
- Before a PR is opened, the coordinator reviews the diff. Merge order within
  a file hotspot follows the dependency graph.

## GitHub issue layout (created after approval)

- One tracking epic: "Adopt features from the 2026-09 dependency upgrade",
  with a task list linking every issue and the dependency graph above.
- 16 issues: WS0, X1–X5, A1, R1, R2, and C1–C7. Each body contains Why (with
  the changelog version), Scope, Files, Acceptance criteria, Verification
  commands, Depends on, and Parallel-safety notes, copied from this plan.
- Labels: existing `enhancement` / `bug` / `documentation`, plus new labels
  `area:claude-sdk`, `area:codex`, `area:frontend`, `blocked`, and
  `needs-decision` (to be created with the issues).

## Out of scope

- Remotion, HyperFrames, react-pdf, and Playwright feature adoption.
- Held majors from #61 (Vitest 5, mermaid 12, `@ag-ui` 1.0,
  `@hono/node-server` 2, undici 8, better-sqlite3 13, TypeScript 7,
  `@types/node` 26, pnpm 12). These belong to the next upgrade sweep.
- Managed Agents, and `@anthropic-ai/sdk` beta features without a current
  caller.

## Risks

| Risk | Mitigation |
|---|---|
| The WS0 root cause is upstream and has no local fix | File upstream with a repro. Reshape the offending schemas to raw shapes. If still blocked, the C track waits and the X/A/R tracks proceed. |
| C1 denies tools that headless flows depend on today | Before switching, log which tools headless runs currently auto-approve (one release of telemetry, or a trace of the schedule/channel callers). Then add explicit allow rules. |
| Alpha APIs (`prewarm`, `readMcpResource`) change | Kept behind C5 measurement and the C7 spike. No production dependency without a measured win. |
| Parallel PRs conflict in `claude/index.ts` | Sibling-module rule and single ownership of the message switch (C2). |
