# Video Mode native execution and durable plans

Status: research complete, plan verified against the codebase, ready for review
Session studied: `24d71ea5-5fef-409a-a433-8c820e0e8b0c`
Date: 2026-08-25 (revised 2026-08-25 after a source audit)

## Outcome

Video Mode should run host-native by default. Its approved media tools should be able to read linked footage from mounted volumes and invoke native programs such as FFmpeg without an OS sandbox blocking them. This policy must not disable the existing tool allowlist, external-media validation, SSRF protection, or human approval for destructive and costly actions.

Every approved build should also produce two durable project artifacts:

```text
<video-project-dir>/          # getVideoProjectDirForRoot(root, projectId)
  project.json
  agent/
    plan.md
    execution-log.jsonl
```

`plan.md` is the approved implementation contract. `execution-log.jsonl` is an append-only account of every attempted step. Together with the existing project journal, they make interrupted work resumable and reversible.

The ChongQing failure is not solved by adding one external drive to a sandbox allowlist. The immediate failure came from validating a successful attachment result with the generic project-root path validator, after the mutation had already committed. Three further defects — a decorative sandbox setting, a missing bulk storyboard tool, and an error flag dropped on persistence — turned one bad validator call into an unrecoverable 48-scene build.

## Session evidence

The live browser runtime was unavailable during this investigation. The screenshot, persisted project, SQLite history, and source code provided enough evidence to reconstruct the failure.

### Persisted state

The project is stored at:

```text
/Users/yongwang/.neumar/videos/24d71ea5-5fef-409a-a433-8c820e0e8b0c/project.json
```

The persisted project contains:

- 47 external assets, including 43 videos and 4 photos
- 48 storyboard scenes with a total duration of 187.5 seconds
- one timeline track and an idle render
- 49 entries in `project.agentJournal`, all from `addScene`
- 32 KB of saved conversation history in `video_agent_history`
- no row in `video_intent_log` for this project

All source assets point into `/Volumes/Fanxiang2TB/video/ProcessFootages/ChongQing/`. They were registered as external assets and were not copied into the project.

### User-approved plan

The conversation contains a prose plan titled "Chongqing drone highlights (16:9, ~3 min, $0)." It specifies chronological coverage across four flights, a photo section, a dusk ending, blur padding for portrait clips 0042 and 0060, a title card, and music. The user approved the build.

That plan exists only in chat history. No Markdown plan was written to the video project and no structured intent-log record was created. The implementation therefore had no durable, versioned contract to resume from.

### Partial-success failure

The agent created 48 scenes one at a time, then began attaching source assets. Each of the first 12 attachment action cards reported an allowed-path failure. The persisted project shows that those 12 scene attachments actually succeeded.

The failure happened after mutation, in `narrowAttachResult()` at `src-api/src/shared/mcp/video-edit-server.ts:982`. It validates the returned asset path with the generic FFmpeg validator:

```ts
filePath:
  payload.asset.path && !referenced
    ? validatePath(
        payload.asset.path,
        getVideoProjectRoot(payload.project.id),
        'read',
      )
    : undefined,
```

`referenced` here is `isReferencedProjectAsset()` (`src-api/src/shared/video/catalog-assets.ts:57`), which is true only for the `catalog:` dataless placeholder scheme. An asset with `origin: 'external'` and a real absolute path on a mounted volume is **not** referenced, so it falls through to `validatePath`. `getVideoProjectRoot()` (`store.ts:285`) returns the *video workspace root* — `~/.neumar` — not a media trust root, so any path under `/Volumes/` is rejected.

Video Mode already has the correct resolver in `src-api/src/shared/video/asset-files.ts:19`. `resolveProjectAssetPath()` branches on `asset.origin` and delegates external assets to `assertSafeExternalMediaFile()`, which permits trusted user, workspace, and mounted-volume media while rejecting sensitive credential paths and unsafe symlink targets. `narrowAttachResult()` simply does not use it.

`attachVideoAsset()` (`video-edit-server.ts:2282`) has already called `writeProject(next)` by the time the serializer throws. The result:

1. Retrying can duplicate a mutation that already succeeded.
2. The agent cannot infer the real cursor from its tool results.
3. The operator sees a completed status and a failure message at the same time.

The remaining scenes still contain placeholders. Some placeholders reference the same final asset and a 1 ms source range, so a recovery routine must compare planned intent with persisted state. It must not blindly restart the attachment loop.

## Root causes

Each row below was confirmed against the source at the cited location.

| # | Area | Evidence | Consequence | Required correction |
| --- | --- | --- | --- | --- |
| 1 | Attachment result path | `narrowAttachResult()` — `video-edit-server.ts:1013` uses generic `validatePath()` against the workspace root; `isReferencedProjectAsset()` only short-circuits `catalog:` placeholders | Valid external masters produce false failures **after** commit | Use `resolveProjectAssetPath()` (origin-aware), and resolve before the mutation, not in the serializer |
| 2 | No journal for attach | `attachVideoAsset()` calls `writeProject()` directly (`video-edit-server.ts:2336`); `attachAsset` is absent from `videoAgentToolCallSchema` in `agent-tools.ts` | Attachment has no journal entry, no inverse diff, and no undo; the SQLite `video_projects` row is also not refreshed because `updateProjectDocument()` is bypassed | Route attach through the journaled tool path (or a journal wrapper) and through `updateProjectDocument()` |
| 3 | Missing bulk storyboard tool | The system prompt tells the agent to call `set_storyboard` (`system-prompt.ts:118`, `:296`), but no such tool exists — `video-edit-server.ts` has `video_add_scene` and `video_approve_storyboard`; the only bulk path, `plan_storyboard` (`mcp/video-server/tools/index.ts:169`), auto-generates a draft and takes no agent-authored storyboard | The agent has no way to apply a 48-scene plan atomically and falls back to 48 sequential `video_add_scene` calls | Add a real `video_set_storyboard` (validated, single journal boundary) and correct the prompt |
| 4 | SDK sandbox setting is decorative | `buildSdkSandboxSettings()` (`claude/index.ts:1820`) hardcodes `enabled: true` and is applied unconditionally at both call sites (`:2967`, `:5156`) | Video Mode's `sandbox: { enabled: false }` is a **different type** (`SandboxConfig`, the `sandbox_run_script` tooling) and never reaches the SDK's `sandbox` option — so the OS sandbox is always on for Claude runs regardless of caller intent | Introduce an explicit execution policy on `ExecuteOptions`, and omit SDK sandbox config when the policy is `host-native` |
| 5 | Workspace prompt lies | `getWorkspaceInstruction()` (`base.ts:817`) always emits "enforced at the OS level" and "will be BLOCKED by the sandbox". Its `sandbox?: SandboxOptions` parameter is the script-runner config, unrelated to the OS sandbox | The model receives a false description of an unsandboxed Video run and refuses to look at legitimate paths | Take the effective execution policy as a distinct parameter and generate the isolation paragraph from it |
| 6 | Error flag lost on reload | `useAgent.ts:751` rebuilds `tool_result` messages from SQLite without `isError`, and the `messages` table has no `is_error` column (`001_init.ts:88-91`). `agentToolMapping.ts:206` then falls back to `'completed'` because `errorResult()` (`video-edit-server.ts:560`) returns plain `Error: …` text that `parseJsonValue` cannot turn into a record | A restored session shows every failed action as completed with failure text inside it | Persist the flag (`messages.is_error`), restore it in `useAgent.ts`, and make `errorResult()` emit a structured JSON body |
| 7 | Plan persistence | The approved plan exists only in `video_agent_history` | Restart and resume depend on replaying prose | Persist an approved structured plan and render `agent/plan.md` |
| 8 | Execution accounting | Direct service mutations are not consistently linked to `agentJournal` or `video_intent_log` | Partial success cannot be reconciled reliably | Add a write-ahead execution log and link each mutation to intent and inverse diffs |
| 9 | No project revision | `VideoProject` (`types.ts:190`) has `schemaVersion`, `createdAt`, `updatedAt` — but no monotonic revision | Optimistic concurrency and "project revision at approval" have nothing to compare against | Add `revision: number`, bumped in `updateProjectDocument()` and `writeProject()` |

Rows 3, 6, and 9 were not in the previous draft and are prerequisites, not nice-to-haves.

## Execution policy

### Default policy for Video Mode

Introduce one effective policy named `host-native`. It should be the default for Video Mode in development and packaged desktop builds.

`host-native` means:

- Claude Agent SDK OS sandboxing is disabled for the Video agent.
- Video MCP handlers execute on the host and may invoke approved native media programs.
- Registered external media can remain on local and mounted volumes.
- Video Mode does not gain unrestricted `Bash`, `Write`, `Edit`, or notebook tools — the existing `allowedTools` / `disallowedTools` set in `extensions/agent/video/index.ts` is unchanged.
- Media reads still pass `assertSafeExternalMediaFile()` or the managed-project validator, according to asset origin.
- Network operations still pass existing provider-egress and SSRF checks.
- Destructive, publishing, paid-generation, and high-cost render operations retain approval gates.
- General chat and other agents keep their own sandbox policy.

Do not set `permissionMode: 'bypassPermissions'`. Anthropic treats sandboxing and permission decisions as separate controls. Disabling one is not a reason to disable the other.

### Naming: three things currently called "sandbox"

The previous draft conflated them and any implementation that does the same will fail review. They are:

| Name | Type | Where | Meaning |
| --- | --- | --- | --- |
| `AgentOptions.sandbox` / `ExecuteOptions.sandbox` | `SandboxConfig` (`@/core/sandbox/types`) | `core/agent/types.ts:456`, `:670` | Whether the `sandbox_run_script` tool surface is mounted. This is what Video Mode sets to `{ enabled: false }`. |
| `SandboxOptions` | `{ enabled, image?, apiEndpoint? }` | `core/agent/base.ts:699` | The same concept, narrowed for prompt generation in `getWorkspaceInstruction()`. |
| `Options.sandbox` | Agent SDK type | passed at `claude/index.ts:2967`, `:5156` | Seatbelt / Bubblewrap OS filesystem isolation. Never wired to either of the above. |

The new policy is a **fourth, explicit** field. Add to `ExecuteOptions` and `AgentOptions`:

```ts
/** How the run executes on the host. Adapters that can enforce OS-level
 *  isolation consult this; `host-native` means do not enable it. */
executionPolicy?: 'isolated' | 'host-native';
```

Default `'isolated'` so every existing caller keeps today's behavior. Video Mode sets `executionPolicy: 'host-native'` alongside its existing `sandbox: { enabled: false }`. `buildSdkSandboxSettings()` returns `undefined` for `host-native`, and both call sites spread the result rather than assigning unconditionally:

```ts
const sdkSandbox = buildSdkSandboxSettings(
  sessionCwd, userWsDir, allowWsWrite, options?.additionalUserDirs,
  options?.executionPolicy ?? 'isolated',
);
// ...
...(sdkSandbox ? {
  sandbox: sdkSandbox.sandbox,
  additionalDirectories: sdkSandbox.additionalDirectories,
} : {}),
```

`getWorkspaceInstruction()` gains an `executionPolicy` parameter and emits the OS-isolation paragraph only under `'isolated'`. Under `'host-native'` it states the real boundary: writes go to the project directory, reads of user media go through approved Video tools, and there is no general shell.

Gate the default behind a kill switch using the existing pattern in `src-api/src/shared/video/flags.ts` — add `'video.hostNative'` to `VideoFeatureFlag` with a default of `true`, so a bad rollout is one setting away from reverting.

An optional `isolated` Video policy remains available for untrusted marketplace plugins or experimental render code. It should be explicit and should declare the additional readable directories it needs. It is not the default desktop editing path.

### Native capability boundary

The desired native behavior is scoped host access through typed Video MCP operations. It does not require a general shell. This preserves a clear boundary:

```text
Video agent
  -> approved Video MCP operation
    -> origin-aware media validator (resolveProjectAssetPath)
      -> host FFmpeg, probe, filesystem, renderer, or provider
```

## Durable plan design

### Canonical model

Add a structured `agentPlan` to the canonical video project. Keep `project.json` as the source of truth, consistent with the current storage design. Render `agent/plan.md` deterministically from that model with a temporary file and atomic rename — reuse the `${filePath}.${randomUUID()}.tmp` + `fs.rename` idiom already in `writeProject()` (`store.ts:1972`).

`agentPlan` is an optional additive field, so `VIDEO_PROJECT_SCHEMA_VERSION` stays at `2`. Only `revision` needs a load-time default (see below).

```ts
interface VideoAgentPlan {
  schemaVersion: 1;
  id: string;
  revision: number;
  status: 'draft' | 'approved' | 'executing' | 'paused' | 'completed' | 'superseded';
  title: string;
  request: string;
  assumptions: string[];
  projectRevisionAtApproval: number;
  approvedAt?: string;
  approvedBy?: 'user';
  steps: VideoAgentPlanStep[];
}

interface VideoAgentPlanStep {
  id: string;
  title: string;
  intent: string;
  dependsOn: string[];
  operation: string;
  inputs: Record<string, unknown>;
  verification: string[];
  rollback: string;
}
```

Use `crypto.randomUUID()` for the plan ID. Step IDs should be stable within a plan revision. A user edit creates a new revision rather than rewriting the approved revision in place.

### Project revision

`VideoProject` has no revision counter today, so add one before anything else depends on it:

- `revision: number` on `VideoProject` (`types.ts:190`), defaulting to `0` on load for documents written before this change.
- `updateProjectDocument()` (`store.ts:1989`) bumps it inside the update callback, so every document write advances it exactly once.
- `writeProject()` is called directly in several places (`attachVideoAsset` among them). Those call sites move to `updateProjectDocument()` as part of Checkpoint 1; any that legitimately cannot must bump `revision` explicitly. Add a unit test asserting no `writeProject()` call in `video-edit-server.ts` leaves `revision` unchanged.

Note the lock scope: `withProjectLock()` (`project-lock.ts:3`) and the `projectDocumentUpdateLocks` chain in `updateProjectDocument()` are **in-process promise chains**, not file locks. They serialize the API process only. That is sufficient today because the API runs as a single sidecar, but the plan runner must not assume mutual exclusion against an external editor touching `project.json`. The revision check is what catches that case — treat it as the real concurrency control and the lock as a fast path.

### `plan.md` contract

The generated Markdown should contain:

- plan ID, revision, status, approval time, and project revision
- the original request and explicit assumptions
- asset selections by stable asset ID, with human-readable names
- scene order, source ranges, fit decisions, duration, transitions, captions, narration, music, and output target
- numbered steps with stable step IDs and dependencies
- verification and rollback expectations per step
- a final render and human-review gate

The implementation loop must load the approved `agentPlan`, verify the `plan.md` digest, and reference the current step ID on every operation. If a person edits the Markdown directly, execution pauses and asks to import the edit as a new plan revision. Silent drift between the project model and file is not allowed.

Do not write absolute external media paths into `plan.md`. Reference assets by ID and display name; the path already lives in `project.json` and the file is more likely to be shared or pasted.

### Plan lifecycle

```text
draft plan
  -> render plan.md
  -> user approval
  -> freeze plan revision and project revision
  -> execute steps
  -> verify each step
  -> complete or pause with resumable cursor
```

The PLAN GATE in `system-prompt.ts:109-120` should call a plan persistence operation before asking for approval. Approval should update the same record and create the corresponding `video_intent_log` entry.

`video_intent_log` (`migrations/032_video_conversation_mode.ts:114`) has no plan columns. Add a migration with `plan_id TEXT` and `plan_revision INTEGER` rather than smuggling them into `plan_json` — reconciliation queries by plan. Follow the `addColumnIfMissing` pattern from `migrations/039_video_intent_plugin_snapshot.ts`. Note that this table lives in the app database, not the project folder, and has an `ON DELETE CASCADE` FK to `video_projects`: a project folder copied to another machine loses its intent log, which is exactly why `agent/plan.md` and `agent/execution-log.jsonl` live in the project directory.

`VideoAgent.plan()` (`extensions/agent/video/index.ts:438`) currently yields a hardcoded three-step placeholder, and `buildVideoExecutionPlan()` (`:567`) wraps the raw prompt in a one-step `TaskPlan`. Both should be replaced by the persisted plan rather than left to emit unrelated ephemeral plans.

## Append-only execution log

Write `agent/execution-log.jsonl` before and after every implementation operation. The log covers reads, analysis, mutations, verification, no-ops, failures, retries, and rollback. It complements the mutation journal rather than replacing it.

```ts
interface VideoExecutionLogRecord {
  schemaVersion: 1;
  sequence: number;
  timestamp: string;
  runId: string;
  planId: string;
  planRevision: number;
  stepId: string;
  attempt: number;
  phase: 'started' | 'succeeded' | 'failed' | 'skipped' | 'rolled-back';
  operation: string;
  idempotencyKey: string;
  inputDigest: string;
  projectRevisionBefore: number;
  projectRevisionAfter?: number;
  intentLogId?: string;
  journalEntryIds?: string[];
  result?: Record<string, unknown>;
  error?: { code: string; message: string; committed: boolean };
  verification?: Record<string, unknown>;
}
```

Avoid copying absolute external paths and raw prompts into every row. Log stable asset IDs and redacted summaries. The local project already retains the registered path and conversation where required.

Append with `fs.appendFile` (`flag: 'a'`) plus an explicit `fsync` on the terminal record; a single `writeFile` of the whole log would defeat the point. Cap the file and roll to `execution-log.<n>.jsonl` past a size threshold, keeping the active file small enough to replay cheaply.

### Atomicity and reconciliation

Before a mutation:

1. Validate the complete input **and construct the serializable result shape** — including any path resolution the serializer will need.
2. Append and flush a `started` record.
3. Apply the project mutation under `withProjectLock` + `updateProjectDocument`.
4. Write the project journal entry with its inverse diff.
5. Append and flush `succeeded` with the resulting project revision and journal IDs.
6. Return the already-validated result.

Step 1 is the direct fix for the ChongQing failure: a result serializer must never be the first place that validates an input path after commit. If a terminal log write fails after the project commit, startup reconciliation inspects the project revision and journal ID before any retry.

Use an idempotency key derived from the plan ID, plan revision, step ID, operation, and normalized input digest. A repeated call returns the recorded success when the corresponding project fact still holds. It must not apply the mutation twice.

### Resume algorithm

On resume:

1. Load the approved plan and verify its revision and Markdown digest.
2. Replay the execution log for the active plan revision.
3. Reconcile any `started` record without a terminal record against `project.json` and `agentJournal`.
4. Confirm that the current project revision matches `projectRevisionAtApproval` plus the revisions this plan itself produced. Pause on unrelated manual edits.
5. Verify completed step postconditions.
6. Continue from the first incomplete dependency-ready step.
7. Retry only an idempotent operation. Ask the user before replaying an uncertain paid, destructive, or externally publishing operation.

Rollback uses the existing inverse diffs where available — which is why root cause 2 (attach produces no inverse diff) must be fixed for rollback to mean anything. A rollback operation receives its own log records and never deletes history.

## ChongQing recovery strategy

Add an internal reconciliation service and a dry-run Video operation. It should compare an approved plan against scenes, timeline clips, registered assets, source ranges, and journal records.

For this session, the dry run should:

- recognize the 12 attachments that persisted despite reported failures
- identify the remaining placeholder scenes
- flag repeated placeholder asset IDs and 1 ms source ranges as inconsistent
- preserve correct title, ordering, and duration work
- propose only the missing or corrective operations
- show the proposal before mutating the project

The 12 committed attachments have no journal entries (root cause 2), so reconciliation for this project must infer them from `scenes[].clips[].mediaId` and `storyboard.scenes[].assetPlan` rather than from `agentJournal`. Projects built after Checkpoint 1 will have journal entries; the reconciler needs both paths.

Do not hardcode this session or `/Volumes/Fanxiang2TB`. Turn its state into a regression fixture with temporary external and managed media roots.

## Implementation checkpoints

Every verification command below was run against this repo. Note that the root `vitest.config.ts` includes only `src/**/*.test.{ts,tsx}`, so `pnpm vitest run src-api/test/...` finds **no tests and exits 1**. API tests must go through `--config src-api/vitest.config.ts` with a path relative to `src-api/`.

### Checkpoint 1. Correct native execution and attachment semantics

Files:

- `src-api/src/shared/mcp/video-edit-server.ts` — `narrowAttachResult()`, `attachVideoAsset()`, `errorResult()`
- `src-api/src/shared/video/asset-files.ts` — `resolveProjectAssetPath()` (no change expected; it is the correct resolver)
- `src-api/src/shared/video/types.ts` — add `revision`
- `src-api/src/shared/video/store.ts` — bump `revision` in `updateProjectDocument()`
- `src-api/src/extensions/agent/video/index.ts` — set `executionPolicy: 'host-native'`
- `src-api/src/extensions/agent/claude/index.ts` — `buildSdkSandboxSettings()` and both call sites
- `src-api/src/core/agent/types.ts` — add `executionPolicy` to `AgentOptions` / `ExecuteOptions`
- `src-api/src/core/agent/base.ts` — `getWorkspaceInstruction()`
- `src-api/src/shared/video/flags.ts` — `'video.hostNative'`
- `src-api/test/unit/video/video-edit-server.test.ts`, plus a new Claude adapter sandbox test

Work:

- Resolve attachment result paths with `resolveProjectAssetPath()`, by asset origin.
- Move that resolution ahead of `writeProject()` inside `attachVideoAsset()` so an unsafe path fails before commit.
- Route `attachVideoAsset()` through `updateProjectDocument()` and emit a journal entry with an inverse diff.
- Make `errorResult()` return a structured JSON body (`{ error, code, committed }`) so the UI can classify it without relying on the transport flag.
- Add `executionPolicy`; return `undefined` from `buildSdkSandboxSettings()` under `host-native` and spread conditionally at both call sites.
- Make `getWorkspaceInstruction()` describe the effective policy.
- Add `revision` and bump it on every document write.
- Keep all path trust, tool, egress, and approval boundaries.

Observable result:

A registered external video on a mounted volume attaches and returns success without copying the master. A path under a credentials directory is rejected **before** mutation. Video Mode reports host-native execution, while other agents retain their configured sandbox.

Verification:

```bash
pnpm vitest run --config src-api/vitest.config.ts test/unit/video/video-edit-server.test.ts
pnpm vitest run --config src-api/vitest.config.ts test/unit/video/linked-sources.test.ts
pnpm test:api -- -t 'sandbox|executionPolicy'
pnpm typecheck:all
```

### Checkpoint 2. Persist and approve the plan

Files:

- `src-api/src/shared/video/types.ts` — `VideoAgentPlan`, `VideoAgentPlanStep`, `VideoProject.agentPlan`
- a new `src-api/src/shared/video/agent-plan.ts` — draft / approve / supersede / read + `plan.md` renderer
- `src-api/src/shared/video/store.ts` — plan reads and writes through `updateProjectDocument()`
- `src-api/src/shared/mcp/video-edit-server.ts` — `video_draft_plan`, `video_approve_plan`, `video_get_plan`
- `src-api/src/extensions/agent/video/index.ts`, `system-prompt.ts` — wire the PLAN GATE to persistence
- `src-api/src/shared/video/recipes.ts` + a new migration — `plan_id` / `plan_revision` on `video_intent_log`
- `src-api/test/unit/video/` — new `agent-plan.test.ts`

Work:

- Add the versioned `agentPlan` model as an optional field (no schema-version bump).
- Add plan draft, approve, supersede, and read operations.
- Generate `agent/plan.md` atomically (tmp + rename) from the canonical plan, with a stored digest.
- Connect the PLAN GATE to plan persistence so approval is a recorded event, not a chat turn.
- Record approval in `video_intent_log` with the new plan columns.
- Replace `buildVideoExecutionPlan()` and the stub `VideoAgent.plan()`.

Observable result:

Asking for a plan creates a readable Markdown file inside the video project. Approval freezes a plan revision and the project revision it was approved against. Restarting the API or UI preserves both.

Verification:

```bash
pnpm vitest run --config src-api/vitest.config.ts test/unit/video/agent-plan.test.ts
pnpm vitest run --config src-api/vitest.config.ts test/unit/video/recipes.test.ts
pnpm vitest run --config src-api/vitest.config.ts test/unit/video/session-prompt.test.ts
pnpm vitest run --config src-api/vitest.config.ts test/unit/video/storage-root.test.ts
```

### Checkpoint 3. Add the write-ahead execution log

Files:

- a new `src-api/src/shared/video/execution-log.ts`
- `src-api/src/shared/video/project-lock.ts`, `store.ts`
- `src-api/src/shared/mcp/video-edit-server.ts` — wrap `lockedServiceCall` / service mutations
- `src-api/src/shared/video/agent-tools.ts` — link journal entry IDs into log records
- `src-api/test/unit/video/` — new `execution-log.test.ts`, crash and malformed-tail cases

Work:

- Append and flush JSONL records around every implementation operation.
- Link mutation records to intent-log IDs and inverse-diff journal entry IDs.
- Recover from a truncated final JSONL line without losing prior records.
- Emit explicit success, failure, partial-success, skipped, and rollback states.
- Redact absolute paths and roll the log past a size threshold.

Observable result:

Killing the process after `started`, or after project commit but before the terminal record, leaves enough evidence to determine what happened.

Verification:

```bash
pnpm vitest run --config src-api/vitest.config.ts test/unit/video/execution-log.test.ts
pnpm vitest run --config src-api/vitest.config.ts test/unit/video/project-lock.test.ts
pnpm vitest run --config src-api/vitest.config.ts test/unit/video/agent-actions.test.ts
```

### Checkpoint 4. Make execution idempotent and reduce round trips

Files:

- `src-api/src/shared/video/agent-tools.ts` — add a `setStoryboard` journaled tool call
- `src-api/src/shared/mcp/video-edit-server.ts` — add `video_set_storyboard`
- `src-api/src/extensions/agent/video/system-prompt.ts` — the prompt already says `set_storyboard`; make the tool real and the name match
- `src-api/src/shared/video/agent-sdk.ts`
- a new plan runner and reconciliation service under `src-api/src/shared/video/`
- `src-api/test/unit/video/agent-sdk.test.ts`, `agent-tools.test.ts`, `timeline.test.ts`

Work:

- Add `video_set_storyboard`: accepts a full agent-authored storyboard, validates every scene and asset reference up front, applies it as one diff with one inverse diff and one journal entry, and rebuilds the timeline once. This is what the 48-call build should have used.
- Add idempotency keys and postcondition checks.
- Resume from the first incomplete dependency-ready step.
- Reject execution against a project revision that does not match the plan's expectation.
- Make paid, destructive, and publishing retries require approval when the outcome is uncertain.

Observable result:

Replaying the same approved plan converges to the same project without duplicate scenes, clips, charges, or uploads. A 48-scene storyboard is one commit, not 48.

Verification:

```bash
pnpm vitest run --config src-api/vitest.config.ts test/unit/video/agent-tools.test.ts
pnpm vitest run --config src-api/vitest.config.ts test/unit/video/agent-sdk.test.ts
pnpm vitest run --config src-api/vitest.config.ts test/unit/video/timeline.test.ts
pnpm test:api -- -t 'idempotent|resume|reconcile|set_storyboard'
```

Throughput review before this checkpoint is approved:

1. The blocking first dependency is the plan and log identity contract from Checkpoints 2 and 3, plus `revision` from Checkpoint 1.
2. After that contract freezes, storyboard batching, resume logic, UI status, and the ChongQing fixture can proceed as parallel work streams.
3. Shared mutable state is limited to project types, the project lock, tool result status, and the execution-log schema. Assign one owner per contract.
4. The smallest safe decomposition is one owner for runtime and storage, one for tool idempotency and reconciliation, and one for UI and fixtures. Each stream lands tests with its contract change.

### Checkpoint 5. Expose plan, progress, resume, and rollback in the UI

Files:

- `src-api/src/shared/db/migrations/` — add `is_error` to `messages`
- `src-api/src/app/api/` — project plan and execution-log routes
- `src/shared/hooks/useAgent.ts:751` — restore `isError` when rehydrating `tool_result`
- `src/components/video/agentToolMapping.ts:206` — classify structured error bodies
- `src/components/video/` — plan and execution-log views, Resume / Retry / Roll back controls; keep every component under the 350-line limit
- `src/config/locale/messages/` — all six locales (en, zh, es, fr, hi, pt)
- `src/__tests__/video/`

Work:

- Persist and restore the tool-error flag so a reloaded session does not relabel failures as completed. This is the direct fix for the misleading action cards.
- Add Plan and Execution log views or links.
- Show step, attempt, verification, and committed state.
- Add Resume, Retry, and Roll back controls with appropriate confirmation.
- Render partial success distinctly from success and failure.
- Warn when the plan revision conflicts with manual timeline edits.

Observable result:

An operator can see the approved contract, the exact last durable step, and the proposed next action after restart. UI statuses agree with tool and project state, before and after a page reload.

Verification:

```bash
pnpm test -- -t 'video plan|execution log|partial success|agentToolMapping'
pnpm typecheck:all
npx oxfmt <each-edited-src-file>
pnpm check:component-size
```

### Checkpoint 6. Recover this failure class and complete the release gate

Files:

- a new reconciliation fixture under `src-api/test/`
- Video integration and real-server tests
- `dev-doc/runbooks/video-mode.md`
- telemetry and `createLogger` events

Work:

- Build a sanitized ChongQing fixture that reproduces mutation-before-error, including the journal-less attachments.
- Verify that reconciliation preserves 12 committed attachments and proposes only remaining repairs.
- Test external-drive unavailable, relinked, and unsafe-symlink cases.
- Test process termination before mutation, after commit, and before terminal log write.
- Document host-native policy, the `video.hostNative` flag, and recovery operations in the runbook.
- Run the full validation gate and a manual desktop smoke test against a linked external volume.

Observable result:

The original failure shape is detected without duplicate edits. The project can continue from its real durable state, and the regression suite prevents a return to mutation-after-error ambiguity.

Verification:

```bash
pnpm test:fast
pnpm test:e2e -- -t 'video plan resume'
pnpm validate
```

## Acceptance criteria

- Video Mode selects `host-native` explicitly via `executionPolicy`, and no Claude execution path applies SDK sandbox settings under that policy.
- General chat and unrelated agents keep their current sandbox behavior (`executionPolicy` defaults to `'isolated'`).
- A registered external asset on a mounted volume can be probed, attached, and rendered in place.
- Private credentials, sensitive system paths, unsafe symlinks, and unapproved network targets remain blocked, and are rejected *before* any mutation commits.
- A plan request creates `agent/plan.md` inside the video project before implementation begins.
- Implementation can only run an approved plan revision, checked against `project.revision`.
- Every attempted step produces a durable log record with a plan and step ID.
- Every reversible mutation — including `video_attach_asset` — links to an inverse-diff journal entry.
- A 48-scene storyboard is applied as one journaled operation.
- Terminating and restarting after any step does not duplicate scenes, clips, paid requests, or uploads.
- Result serialization cannot turn a committed success into an ordinary failure.
- The UI never labels a failed or partial-success operation as completed, including after a page reload.
- A ChongQing recovery dry run identifies the 12 committed attachments and proposes only the missing or corrective work.
- Rollback is itself logged and preserves the original history.

## Decision gate

Implementation is ready to start when these decisions are accepted:

1. `host-native` is the default Video Mode policy, expressed as a new `executionPolicy` field rather than by overloading either existing `sandbox` option, and gated by `video.hostNative`.
2. `VideoProject.revision` is added and is the concurrency control; the in-process project lock is a fast path, not a guarantee.
3. `project.agentPlan` is canonical and `agent/plan.md` is its deterministic human-readable projection.
4. `agent/execution-log.jsonl` is append-only and complements, rather than replaces, `agentJournal` and `video_intent_log`.
5. `video_set_storyboard` becomes a real tool and bulk storyboard application is one validated, journaled operation.
6. Tool error state is persisted (`messages.is_error`) so a restored session classifies failures correctly.
7. The current ChongQing project is repaired only after a dry-run reconciliation report is reviewed.

## Practices adopted from current agent systems

Anthropic's Agent SDK documents that sandboxing is disabled by default, that additional readable directories are a sandbox configuration, and that permission handling remains a separate layer. This supports an explicit unsandboxed Video policy without using permission bypass. See the [Claude Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript).

OpenAI's Agents SDK serializes pending run state so approval and execution can resume in another process. Its tracing model groups agent turns and tool spans under durable identifiers. The plan ID, run ID, step ID, and serializable cursor proposed here apply those ideas to the existing Neumar storage model. See [human-in-the-loop state](https://openai.github.io/openai-agents-python/human_in_the_loop/), [durable agent execution](https://openai.github.io/openai-agents-python/running_agents/), and [Agents SDK tracing](https://openai.github.io/openai-agents-js/guides/tracing/).

Temporal describes durable execution as resuming after crashes or outages from persisted state. Neumar does not need to adopt a workflow platform for this fix. The useful practice is to make each operation idempotent and persist the cursor before advancing. See [Temporal durable execution](https://docs.temporal.io/).

Remotion publishes modular agent skills for composition, media, captions, Studio preview, and rendering. That separation supports explicit plan phases and verification boundaries instead of one opaque "make video" action. See the [official Remotion skills](https://github.com/remotion-dev/remotion/blob/main/packages/skills/README.md).

The open-source `mcp-video-editing` project uses an inspect, edit, verify, and human-release-review workflow with preflight checks and structured outputs. The proposed plan gate and final review gate follow the same operator-control pattern. See [mcp-video-editing](https://github.com/mfortne/mcp-video-editing).

The open-source `video-alchemy` project models edits such as cuts, captions, and B-roll as data passed through a deterministic pipeline. The proposed versioned plan and idempotent runner adopt that "edit is data" principle while retaining Neumar's richer project model. See [video-alchemy](https://github.com/kingbootoshi/video-alchemy).

## Explicit non-goals

- Do not hardcode `/Volumes/Fanxiang2TB` or add every mounted volume to a global allowlist.
- Do not copy multi-gigabyte source masters into a session merely to satisfy a generic validator.
- Do not grant general shell or arbitrary file-write access to Video Mode.
- Do not use conversation history as the canonical execution cursor.
- Do not bump `VIDEO_PROJECT_SCHEMA_VERSION` for additive optional fields.
- Do not replace `withProjectLock` with a cross-process file lock in this work; `revision` checks cover the external-editor case.
- Do not add Temporal, LangGraph, or another workflow runtime before the existing file, SQLite, lock, and journal mechanisms have been exhausted.
- Do not auto-repair the live ChongQing project until the reconciliation dry run is reviewed.
