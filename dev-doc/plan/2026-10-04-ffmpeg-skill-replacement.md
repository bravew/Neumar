# FFmpeg skill replacement development plan

## State and decision

| Field | Value |
| --- | --- |
| Date | 2026-10-04 |
| Status | Development plan. Implementation has not started. |
| Neumar baseline | `90554dc0`, version `26.10.1` |
| Replacement source | `_sample/ffmpeg-skill`, upstream `kajisho5/ffmpeg-skill` |
| Investigated upstream revision | `a991599bfe3f072bac3835083f8bbb30efcd9a99`, package version `2.4.2` |
| Upstream contract | `contract_version: "1.0"`, 42 public tools |
| Existing identity to preserve | `ffmpeg`, installed from `skills/ffmpeg/` |
| Target surfaces | Task, chat, Design Mode, Video Mode |
| Runtime decision | User selected installed host tools for the first release. Resolve Python 3.9+ and FFmpeg/ffprobe on the API host. Do not bundle or download them. |
| Current verification | Source inspection, generated static contract, official documentation, repository validation through source typechecks. Media execution and upstream tests remain unverified. |

**Recommendation:** replace the contents of `skills/ffmpeg` with a pinned, attributed adaptation of the sample, preserve `name: ffmpeg`, and expose its operations through a Neumar-owned execution service. Reuse the existing skill loader, agent tool transports, filesystem policy, process supervision, and asset publication. Keep the existing native FFmpeg executor and Video Mode project/rendering contracts.

A directory copy alone cannot satisfy the requested mode coverage. Skill discovery, provider prompt injection, Video Mode permissions, executable resources, and artifact attribution all need explicit migration tests.

## Scope and acceptance criteria

The replacement provides local media inspection, cuts, joins, captions, reframing, overlays, audio work, colour transforms, delivery exports, and verification. Creative decisions remain with the user or calling mode agent. A scene score is evidence for a candidate, not proof of an interesting highlight. A contact sheet is an image to inspect, not automated visual approval.

The first release is accepted when:

1. Existing saved selections of `ffmpeg` resolve to the replacement. Exactly one bundled skill appears in applicable catalogs.
2. Task, chat, design, and video agents can discover the skill, receive its instructions when selected, and invoke a permitted operation through their existing provider transports.
3. A packaged app can locate the complete payload without the repository, `_sample/`, or an installation in an agent's global home directory.
4. The execution boundary validates every readable and writable path, including paths inside projects, recipes, brand files, plans, and sidecar options. Direct or nested network access is prevented for skill operations.
5. User cancellation stops the entire operation and descendants. No child continues writing after the run is terminal. Failed or partial files are not published as successful assets.
6. Completed outputs are probed and attributed to the originating task/session/project/mode. Delivery checks and visual inspection state remain separate from file creation success.
7. Synthetic runtime tests prove media properties and source preservation. Cross-mode tests prove loading, tool availability, permissions, and output delivery.
8. Missing Python, FFmpeg, a required filter, a font, or optional transcription produces an actionable failure without installing anything or claiming success.

Keep the first release inside this scope:

- Preserve native `mcp__ffmpeg__*` tools and the native `runFFmpeg` consumers. The skill replacement does not replace all FFmpeg uses in the app.
- Keep Neumar Video IR and project files authoritative. Upstream `render.py` JSON is an operation recipe, not an alternative persisted Video Mode model.
- Keep Remotion and HyperFrames composition/rendering responsibilities. FFmpeg file processing can prepare inputs or post-process outputs.
- Do not introduce a new media job database, dependency manager, global skill installer, provider SDK migration, or general skill registry rewrite.
- Do not silently enable arbitrary shell tools in Video Mode.
- Do not promise GPU encoding, live streaming, screen capture, or every raw FFmpeg feature. The sample's scripted surface does not preserve those parts of the old guide.
- Do not migrate existing native workflows to the Python tools just to remove duplicated low-level implementations.

## Investigation findings

### Existing skill quality

[`skills/ffmpeg/SKILL.md`](../../skills/ffmpeg/SKILL.md) is a 360-line guide with no executable payload. It contains several issues that should disappear with replacement:

| Evidence | Finding | Migration consequence |
| --- | --- | --- |
| Lines 119–125 | Describes output-seek stream copy as accurate trimming. Packet/keyframe limitations still matter. | Use the sample's measured cut mode, tolerance, precision, and duration error. Require `--accurate` for frame/sample precision. |
| Lines 327–332 | Says to increase CRF for better quality while also saying lower numbers are better. | Remove the contradictory guide. Preserve validated quality options and report the selected encoder. |
| Lines 314–315 | Includes malformed `ffmpeg -i1.mkv -i2.mp4` input syntax. | Use structured script arguments rather than copying this command. |
| Lines 272–275 and 335–338 | Gives broad legacy sync advice with `-vsync` and `-async 1`. | Route through measured media operations and current FFmpeg documentation. |
| Whole file | No enforced overwrite, timeout, cancellation, output probe, or visual-check policy. | Preserve these requirements in executable code and regression tests. |

Official FFmpeg documentation confirms that input seeking with transcoding can decode and discard the segment before the requested point, while stream copy preserves it. Moving `-ss` alone is not a general frame-accuracy guarantee. See [FFmpeg main options](https://ffmpeg.org/ffmpeg.html#Main-options).

### Replacement strengths and limitations

The generated static contract was inspected from this checkout. It reports 42 tools, Python `>=3.9`, FFmpeg and ffprobe `>=5.0`, and contract `1.0`. The skill's description is 915 characters, within the Agent Skills limit of 1024. The main file is 220 lines, but its large request table still warrants a token-budget test.

| Surface | What was verified in source | How to use it |
| --- | --- | --- |
| `scripts/_contract.py` | Public tools come from non-underscore scripts. Input schemas derive from each argparse parser. Roles, output schemas, and policy facts still come from metadata tables. | Generate a deterministic static contract from the pinned payload. Do not maintain a second handwritten set of CLI flags. Review metadata as well as schema derivation. |
| `scripts/_common/runner.py` | Uses argv lists, validates quality, refuses input/output identity and existing outputs, stages replacement writes, supports timeout and signals. | Reuse the tools, but add host policy and operation-wide supervision. These checks do not establish Neumar workspace authorization. |
| `scripts/_common/probe.py:18` | Plan fingerprints hash size and first/last 8 MiB. | Treat as change detection, not a full-file integrity or permission guarantee. Same-size middle changes in large files may go undetected. |
| `scripts/_common/probe.py:121` | Checks output existence, nonzero size, and readable streams for known media extensions. | Also apply Neumar result validation and verify the requested media properties. Unknown extensions only get a nonempty-file check upstream. |
| `scripts/_common/asr.py:116` | Optional transcription can invoke whisper.cpp, faster-whisper, or the Whisper CLI. | The contract's general claim that only Python/FFmpeg/ffprobe execute is incomplete for ASR. Use Neumar's transcription service first and pass timed cues; disable automatic upstream ASR in the managed surface initially. |
| `mcp/server.py:58` | Maps structured values into argv and also accepts raw `argv`. | Managed tools accept only validated structured input. Reject raw `argv`; schema advertisement does not enforce permission at runtime. |
| `mcp/server.py:93` and `:193` | Runs tools synchronously, captures child output, and ignores notifications without IDs. | Do not attach the upstream server directly as the managed Neumar service. It cannot process cancellation while blocked and does not stream progress notifications. |
| `scripts/_common/runner.py:731` | Outer tool timeout hard-kills the Python child. | Prove descendant cleanup. A hard kill bypasses Python signal handlers and can leave grandchildren alive. |
| `scripts/_common/runner.py:684` | Analysis uses `subprocess.run` separately from the tracked `Popen` children. | Include analysis commands in cancellation tests. Write-path cancellation tests alone do not cover them. |
| `scripts/_common/runner.py:458` | Output lock considers an age over one hour stale even if the owner may still be alive. | Use unique per-run outputs and host ownership. Do not depend on that lock to serialize long operations. |
| `scripts/render.py:498` | Whole projects execute sibling scripts sequentially. Several stages can re-encode and captured child progress is replayed after completion. | A project recipe improves repeatability; it does not imply one encode or live stage progress. Count actual commands in tests. |
| `scripts/render.py:678` | Replayed plans carry their own tool, argv, inputs, cwd, output, and verification steps. | Validate the effective plan content and cwd independently. Never treat a plan file as prior authorization. |
| `scripts/render.py:631`, `:872`, `:909`, `:945`, `:976` | Cache restoration, project writing, work directories, and cache directories have separate write paths. | Audit non-media writes and cleanup explicitly. Restrict cache/work to run-owned roots. |
| `scripts/render.py:325` and `scripts/report.py` | Pack tables and HTML reports are written outside the shared FFmpeg media-write guard. | Add common sidecar overwrite and permission checks. Do not assume every writer inherits the media-file protection. |
| `bin/install.js:30` | Installer payload contains scripts, templates, references, docs, MCP, and package metadata, but omits `LICENSE`. | Use Neumar distribution and explicitly include the MIT notice. Do not use the upstream installer for app deployment. |
| `scripts/export.py:70` and `_platforms.py` | Platform presets include editorial choices and duration caps. | Show crop, trimming, fps, HDR conversion, and loudness changes before applying them. Treat platform values as versioned presets, not current universal upload rules. |

The sample README claims broader tests and real-device results. Those claims are upstream evidence, not tests run in this Neumar checkout.

### Dry-run semantics need a host policy

`--dry-run` does not mean zero computation or zero filesystem activity for every path:

- Probe may run ffprobe. Analysis tools such as scenes, silence, sync, loudness, cropdetect, multicam, stabilize, report, and check may decode or measure media.
- `verify.py` does not support dry-run despite accepting the common flag. Its steps execute.
- `--plan`, `--init`, and `--write-project` deliberately create documents. Work/cache setup also has filesystem effects.
- A dry run has no verified output. Stub dimensions, fps, and duration must not be presented as measurements.

Managed preview operations therefore permit bounded measurement and temporary run-owned files, but create no deliverable or user-file replacement. Reject `verify` and write-producing variants on the preview surface. Keep explicit plan/document creation as separately authorized operations. Test these rules from actual filesystem snapshots.

### Local-only execution needs enforcement

Source inspection found no `protocol_whitelist` or `protocol_blacklist` in the sample execution path. The existence check before ffprobe rejects a direct URL in many tools, but a local media manifest can reference other local paths or network sources. FFmpeg supports nested protocols. Argv execution prevents shell interpretation; it does not constrain FFmpeg's own I/O.

Use protocol restrictions on every FFmpeg and ffprobe input path, including measurement, generated concat lists, ASR preparation if later enabled, and version-dependent variants. Reject user manifests or demuxers with external references unless the host can enumerate, authorize, and rewrite every dependency into a private staging directory. Protocol restrictions alone cannot enforce workspace roots for referenced local files. Never allow `ALL` as a shortcut. Preserve only the internal pipes and generated local resources needed by a tested operation.

Remote inputs should first pass through Neumar's existing asset materializer and network policy. The Python operation receives an authorized local path. See [FFmpeg protocol options](https://ffmpeg.org/ffmpeg-protocols.html#Protocol-Options) and [Neumar network policy](../../src-api/src/shared/network-policy/fetch.ts).

## Current Neumar integration and required boundaries

### Distribution and discovery

[`scripts/sync-builtin-skills.mjs`](../../scripts/sync-builtin-skills.mjs) copies bare skill directories to `homedir()/branding.slug/skills`. It uses size plus mtime to skip files, does not honor `NEUMAR_APP_DATA_DIR`, and does not remove stale owned files. Equal-size content changes can remain stale. The comment names video-editing even though the script copies every skill.

The runtime plugin loader expects recognized manifests for normal plugin roots. Bare legacy skills have a separate loading path. The app-data skill catalog and the runtime loader therefore need an end-to-end consistency test. Do not solve this by creating a generic `manifest.json`; it is not one of the recognized plugin manifests. A manifested root would also acquire a namespaced identity such as `ffmpeg:ffmpeg`.

Preserve literal `ffmpeg` by adding the missing bare bundled/app-data tier using the existing bare-skill parsing helpers. Define precedence and deduplication against user-installed and workspace skills. An explicit workspace/user override must not be silently overwritten by a bundled update. Check existing precedence before setting the rule.

Distribution should use content hashes and an ownership inventory for the bundled payload, stage upgrades before switching them into place, preserve user-owned files, and remove only stale files recorded as bundled-owned. Centralize app-dir resolution so development sync and the daemon agree on the override. Reuse current Tauri skill resources for packaged delivery.

### Mode and provider contracts

| Mode | Required behavior | Existing constraint to preserve |
| --- | --- | --- |
| Task | Manual skill selection and media-relevant routing load the same skill. Inputs come from the task/session workspace or authorized attachments. Outputs become task-associated files/assets. | Task run context, existing tool permissions, and provider adapters. |
| Chat | File questions can use probe without rendering. Edits use the active chat session's authorized inputs and output location. Reports include retrievable links. | Chat is a session use case; do not invent a new persisted `chat` mode identifier if the registry represents it as task. |
| Design | Skill can prepare, resize, cut, convert, or inspect media used by a design project. Published files enter the project's existing asset/provenance flow. | Design-generated compositions remain under the design renderer; user project branding is separate from application branding. |
| Video | Skill operations prepare assets or deliver processed media through typed tools. New output is ingested before any timeline change. | Video Mode currently restricts Bash/Write/Edit and mounts native FFmpeg tools. Preserve those restrictions and require explicit timeline application. |

The current bare skill has no mode declaration. Video skill validation requires Video eligibility. Add the application's supported metadata, with `modes: [task, design, video]`, after verifying parsing and registry conventions. This is a Neumar extension to standard skill metadata; it must be covered by the app loader tests.

Two frontend handoffs currently discard utility selections. `src/shared/hooks/useDesignChat.ts:401` and `src/components/video/useAgentDock.ts:506` send `runContext.supplementalSkillIds: []`. Populate that nested array from the mode's bounded supplemental selector. Adding only a top-level field will not work when the nested empty array takes precedence. Keep the existing maximum of three selections and mode filtering.

The Settings file catalog also differs from runtime discovery. `src-api/src/app/api/files.ts:525` lists app-data and Claude-home skills directly, while `loadAllSkills` omits bare app-data/bundled skills. Profile defaults in `core/agent/context-resolver.ts:285` validate only Claude-home paths. Repair these consumers together so catalog visibility, profile defaults, manual selection, and runtime resolution agree. An existing Claude-home installation of the old guide needs an explicit update path; installation currently rejects an existing directory with HTTP 409. Detect known bundled copies by recorded ownership/content, and preserve edited user copies as overrides.

Provider support must be explicit. Generic pinned skill handling is not uniform across adapters; the special Video path cannot prove task/design coverage. Reuse skill lookup and render selected skill content into the existing `systemContext` contract for adapters that do not consume pinned skills themselves. Include the installed skill resource root or managed-tool invocation instructions so relative resource links work. Avoid injecting the same content twice where native skill loading is already active.

Use a separate managed namespace, provisionally `ffmpeg_skill`, alongside existing `ffmpeg`. Register it with current in-process factories and the existing subprocess bridge where supported. Advertise actual per-provider reachability; never claim that a tool omitted from `tools/list` is callable by an adapter that only registers listed tools. Provide a contract-derived allowlisted dispatcher or on-demand catalog so all supported operations remain reachable without injecting 42 large schemas into every conversation.

### Provider support matrix

The first release must cover all requested modes on providers whose host-tool transports are supported. The user did not request integration with every registered provider. Use an explicit capability gate for other adapters, and preserve their existing operation.

| Provider/path | Current evidence | First-release work |
| --- | --- | --- |
| Claude run and execute | Accepts in-process MCP factories; consumes pinned skill bodies, with no guaranteed base-directory hint. | Attach a fresh factory with session context and avoid duplicate instruction injection. |
| Codex execute | Accepts per-run subprocess-bridge factories. Generic pins are ignored. | Inject managed instructions and attach the factory. |
| Codex direct run | `extensions/agent/codex/index.ts:576` omits per-run factories and policy-server flags that execute forwards at `:866`. | Fix that handoff before claiming task/chat/direct-design support. |
| Cursor run | Existing per-run bridge at `extensions/agent/cursor-agent/index.ts:186`. Generic pins are ignored. | Reuse the bridge and supply context explicitly. |
| Kimi, feature gated | Existing bridge at `extensions/agent/kimi/index.ts:189`. | Exercise when enabled; do not make it a prerequisite for normal installations. |
| Video wrapper | Selects Claude, Codex, or Cursor; has its own factories, prompt loading, PTC definitions, and permissions. | Add the group beside native FFmpeg and test all three actual paths. |
| Pi, Open Agent SDK, Gemini, Copilot, Qwen, OpenCode, AtomCode | No arbitrary host-factory attachment found in the inspected adapters. Some also ignore generic system context. | Report managed FFmpeg unavailable until adapter transport and prompt conformance are implemented. Capability metadata alone is insufficient. |
| OpenAI-compatible | Own agentic tool loop; ignores generic skill pins/context. | Requires explicit tool definitions/handlers and context integration in a later adapter change. |
| HTTP and A2A | Remote execution owns tool locality. | Require an explicit remote host-tool protocol before advertising local media execution. |
| Process agent | Runs a configured process, without general LLM skill selection. | Keep outside the interactive skill-provider promise. |

Mount task/chat factories at the shared agent service, Design factories at `runDesignChat`, and Video factories at the wrapper. `disableUserMcp` must still suppress user integrations without removing this explicitly attached first-party service. The bridge already carries session context, per-run authentication, result callbacks, and teardown. Reuse it rather than creating another server lifecycle.

Claude's Video deny list does not prove Codex or Cursor deny their native shell tools. Enforce file and operation policy in the managed handler for every provider. Classify probe/status as reads and processing/overwrite as writes under existing permission rules; blanket MCP default allowance is not a sufficient authorization check.

### Execution service

Create a small subsystem under `src-api/src/shared/services/ffmpeg-skill/` and a transport under the existing MCP services. Likely modules are runtime resolution, static contract loading/validation, input policy, runner, and artifact handling. Keep transport code thin. Reuse existing helpers before creating equivalents.

The request should carry a contract tool name, validated structured arguments, and the existing session/run/project context. The context is host-owned; callers cannot supply an unrestricted workspace, arbitrary executable, alternate script path, or trusted-root list. Distinguish preview from execution. Reject unknown keys, raw argv, unbounded timeout, background watch loops, and unsupported variants with a reason.

Resolve tools on the API host, not in the browser. Preserve existing FFmpeg/ffprobe override behavior and GUI PATH handling. Python discovery must validate the version and interpreter launch semantics. On Windows, handle `python3`, `python`, and `py -3` candidates and avoid treating a Store alias as a working interpreter. Cache capability checks by resolved binary/build and payload version, with invalidation. Detect only capabilities relevant to the chosen operation; an unavailable caption filter must not disable probe or plain cuts.

Spawn one process per operation using argv and an explicit resolved cwd. Reuse shared streaming-command/process supervision where correct, strengthening descendant termination and output bounds as needed. All skill FFmpeg work must participate in the existing resource budget so Python renders and native jobs cannot bypass concurrency limits. An operation-wide deadline bounds the entire chain; upstream per-command timeouts remain a second limit.

Use a private per-run staging root for recipes, intermediate files, sheets, caches, and final candidates. Set temporary-file placement deliberately. Validate secondary file inputs such as subtitle tracks with language suffixes, fonts, LUTs, emoji assets, logos, replacement audio, numbered image sequences, list files, recipe references, and brand resources. Absolute paths and symlinks require the same checks as relative paths. System fonts are trusted read-only resources resolved by the host; caller-supplied font paths still require authorization.

Do not introduce start/status/cancel tools or a new durable queue by default. The shared runner's cancellation and existing mode events can supervise a bounded tool invocation. If a provider's actual call lifetime cannot support long processing, reuse the existing job infrastructure with an explicit processing kind, controller ownership, latest-state persistence, restart interruption, and mode-specific status delivery. That variant must update the backend/frontend kind unions and consumers and recheck terminal cancellation immediately before publication. Never label source processing as a final render or emit its events into the project render stream. Select this branch from measured transport behavior during checkpoint 3.

For recipes, inspect nested content and resolve it according to its actual base directory before execution. Initially reject upstream saved-plan replay and raw batch recipes that the policy cannot fully parse. Do not present an unsupported variant as implemented. Use a generated sanitized recipe for supported chains. Update the adapted skill instructions so they list only variants that the managed boundary exposes.

Host supervision must drain both streams, cap retained output, normalize carriage-return progress, and prevent stdout logs from corrupting JSON. Do not parse an arbitrary stderr percentage as verified completion. Whole-recipe stage progress needs a small maintained vendor patch or dispatcher because upstream `run_tool()` buffers child output. Start with honest indeterminate/stage progress where exact progress is unavailable.

Cancellation and timeout terminate the full process tree, allow a short graceful cleanup interval, then escalate using the existing platform process primitives. Wait for descendant termination before marking the job terminal or publishing files. Protect terminal error/cancelled state from a late success callback. Do not retry deterministic failures automatically.

### Result and artifact contract

Keep upstream output documents available as bounded diagnostic data. Normalize only the common result envelope at the host boundary; retain tool-specific facts under a validated details field. Probe is an analysis document and does not use the same success shape as every writer. Look can return an image path rather than a JSON media result.

Represent the following facts separately:

- Process exit and operation status.
- Whether a valid artifact was created.
- Whether requested properties were verified.
- Delivery PASS/WARN/FAIL rows.
- Visual inspection state: required, inspected, unavailable, or not applicable.
- Files completed before a later stage failed.

`status: completed` with `verified: false` is not an approved deliverable. A failed check can leave a valid output on disk. Keep it as a diagnostic or explicitly unverified result and show the reason. Preview output is always unverified. No contact sheet existence check can substitute for pixel inspection.

Publish only validated files from the run-owned output root through existing asset/session/project services. Preserve the source asset, record lineage, and return the existing authorized file/asset reference instead of an inaccessible machine path. In Video Mode, ingest the new file through the normal asset path and use existing edit/apply tools for timeline mutations. In Design Mode, copy/publish under the project's asset policy and record provenance. In task/chat, associate output with the originating session/task.

The adapted skill should report factual output properties, checks, visual evidence, warnings, and decisions in the user's language. Keep upstream labels where useful, but do not impose a standalone five-line report over a richer mode-specific response or claim visual inspection when the provider cannot view images.

## Payload and maintenance strategy

Keep one canonical runtime payload at `skills/ffmpeg/`:

| Include | Purpose |
| --- | --- |
| Adapted `SKILL.md` | `name: ffmpeg`, concise description, mode metadata, managed invocation, correct capability and verification rules. |
| `scripts/` including `_common/`, `_contract.py`, `_platforms.py` | Public operations, shared implementation, schema derivation, platform presets. |
| `templates/` | Required by render templates. |
| Focused `references/` and `docs/contract.md` | On-demand instruction and contract details. |
| Upstream `package.json` version data | Contract/render cache version resolution depends on this file. Do not rewrite upstream IDs to match the app alias. |
| `LICENSE` | MIT copyright and permission notice. |
| Provenance/patch metadata | Repository URL, full revision, release, contract version, file hashes, and local patch explanations. |

Keep upstream engine IDs such as `ffmpeg-skill/cut` unchanged and map them to the app alias `ffmpeg`. No duplicate `ffmpeg-skill` catalog entry is needed. Exclude demos, social images, result archives, upstream agent config, generated `__pycache__`, and installers from the app payload. Store retained upstream tests/fixtures in a dedicated test location or explicitly exclude them from runtime resources.

The upstream contract/test machinery also reads docs and installer files. Preserve those in a development test fixture when needed; do not blindly prune them and expect every upstream conformance test to pass. Keep the original test suite reproducible against the exact pinned snapshot, then run focused conformance tests against the adapted installed payload. Host policies are separately tested because upstream tests do not know Neumar permissions.

Add a deterministic drift check modeled on the existing HyperFrames skill check. It should compare the pin, payload inventory/hashes, generated contract, public tool count, required runtime files, and patch inventory. It must run without `_sample/` in release checkouts and must not fetch latest upstream. Import updates deliberately from a pinned revision and review contract diffs before accepting them.

Preserve MIT attribution in copied and packaged resources. FFmpeg binary distribution licensing remains outside this first release because the user chose installed tools.

## Throughput and sequencing

1. **Blocking first steps:** pin the payload and settle the alias/contract boundary before tool wiring. Prove discovery before relying on prompt tests. Prove policy and cancellation before enabling writes in any mode.
2. **Independent workstreams:** after the pin, distribution/discovery work and the execution-service work can proceed separately. After the managed contract lands, task/chat and design/video integration tests can proceed in parallel if different files are assigned.
3. **Shared mutable state:** `skills/ffmpeg/SKILL.md`, plugin/skill loader, agent run-context resolution, MCP factory/group lists, and package scripts are shared. Give each one owner per checkpoint. Serialize final prompt and tool catalog updates; do not let mode branches invent different contracts.
4. **Smallest safe decomposition:** six checkpoints below. Cross-platform runtime verification follows tool wiring. No separate redesign of native rendering or the general plugin system is required.

## Implementation checkpoints

### 1. Vendor and adapt the skill

**Likely files:** `skills/ffmpeg/**`; new provenance and drift-check files; test-only upstream snapshot/fixtures; the root script entry for the check if needed.

**Work:** import the pinned runtime payload with license; preserve app name `ffmpeg` and upstream engine IDs; replace obsolete raw-command guidance; add supported modes and runtime requirements; document managed operations and explicitly gated variants; generate a static contract; retain progressive disclosure. Record each local Python patch.

**Observable result:** the replacement has every runtime resource it references, a deterministic 42-tool upstream inventory, valid app metadata, and a reviewable list of managed capabilities. No runtime dependency points at `_sample/` or an agent's home directory.

**Verification:** run the proposed `node scripts/check-ffmpeg-skill-drift.mjs`; validate frontmatter, description length, local links, and payload hashes; generate static contract from a temporary copy of the vendored payload and compare schemas/IDs to the pin; inspect a representative tool's `--help`. Run executable sample checks only with authorization in the host environment. Document any intentionally adapted upstream test assertions.

### 2. Make distribution and skill discovery agree

**Likely files:** `scripts/sync-builtin-skills.mjs`; `src-api/src/shared/plugins/loader.ts`; `src-api/src/shared/skills/loader.ts`; `src-api/src/app/api/files.ts`; `src-api/src/core/agent/context-resolver.ts`; app-dir/resource resolution as necessary; existing skill/plugin tests and a new sync/distribution regression test.

**Work:** add the missing bare bundled/app-data discovery tier using current helpers; define precedence and deduplicate by stable identity; make sync honor the same app-dir setting as the daemon; replace size/mtime shortcuts with content comparison; stage an owned-payload upgrade and prune only obsolete owned files. Verify first-run and packaged-resource extraction. Do not install into global provider skill directories.

**Observable result:** repository development sync, the Settings catalog, runtime pin lookup, and a packaged resource copy all resolve `ffmpeg` to the same complete skill. Equal-size changes update. User overrides and unrelated skills survive.

**Verification:** `pnpm test:api test/unit/plugins/loader.test.ts test/unit/plugins/builtins.test.ts test/integration/skill-manifest.test.ts`; run the new sync test in a temporary `NEUMAR_APP_DATA_DIR`; load/probe the installed copy rather than only the repository source. Test repeated sync, interruption, stale file cleanup, custom branding, override precedence, and saved bare pins.

### 3. Add the managed execution service

**Likely files:** new `src-api/src/shared/services/ffmpeg-skill/` and MCP adapter; current MCP factories; `src-api/src/shared/process/run-streaming-command.ts` only for required supervision improvements; shared process/resource helpers; narrowly maintained vendor patches; new runner/policy/contract tests.

**Work:** resolve installed runtime tools; consume generated schemas; allowlist tool names and supported structured variants; validate inputs/outputs and nested dependencies; constrain FFmpeg protocols; stage outputs; enforce operation deadline, output bounds, cancellation, and shared resource budget; disable unmanaged ASR/watch/raw argv/saved-plan replay until fully supported; normalize results without erasing tool facts. Keep write publication separate from process success.

**Observable result:** one managed operation can preview and execute a cut or audio operation with real JSON, preserve the source, expose progress, fail clearly, and stop all children on cancellation. A denied path produces no side effects. Native FFmpeg jobs still use their existing executor.

**Verification:** proposed `pnpm test:api test/unit/services/ffmpeg-skill-runner.test.ts test/unit/services/ffmpeg-skill-policy.test.ts test/unit/mcp/ffmpeg-skill-server.test.ts`; existing `pnpm test:api test/unit/process/run-streaming-command.test.ts test/unit/services/ffmpeg-executor.test.ts`. Use fake children for bounded output, silent hangs, process trees, error propagation, and late-result races. Use tiny synthetic real media for probe/cut/check. Include malicious/invalid recipe paths, symlink escapes, local manifests with external references, unauthorized overwrite, and preview filesystem snapshots.

### 4. Wire task, chat, design, and video

**Likely files:** current task/chat dispatch, core run-context and base adapter context, Design `runDesignChat`, `src/shared/hooks/useDesignChat.ts`, `src/components/video/useAgentDock.ts`, `src-api/src/extensions/agent/codex/index.ts`, `src-api/src/extensions/agent/video/index.ts`, `system-prompt.ts`, tool group/factory/bridge catalogs, Video skill context; mode-specific asset handoffs and tests.

**Work:** register the same managed service for supported provider transports; inject selected skill knowledge once per run; add media-relevant routing without enabling it on every design/video mention; update Video prompt/tool policy to permit managed FFmpeg skill operations while keeping broad shell blocked; publish/ingest results under each mode's existing ownership. Keep native tool names distinct. Capability gating must explain unsupported provider transports accurately.

**Observable result:** equivalent file-edit requests in all four use cases receive the replacement instructions and can call the same bounded operation. Results remain associated with the originating session/project. Native Video Mode editing still works.

**Verification:** existing `pnpm test:api test/unit/core/agent/run-context.test.ts test/unit/plugins/task-apply.test.ts test/unit/plugins/design-apply.test.ts test/unit/video/agent-tools.test.ts test/unit/video/agent-sdk.test.ts test/unit/video/video-mcp-server-tools.test.ts test/integration/video-codex-bridge.test.ts test/integration/video-agent-run-context-routes.test.ts`; add focused task/chat/design invocation tests. Test each supported adapter's actual tool transport with fake providers, not only a shared config object. Assert no duplicate prompts, bare-pin compatibility, no Bash permission expansion, correct project root, and artifact attribution.

### 5. Prove media correctness and cross-mode behavior

**Likely files:** dedicated synthetic FFmpeg skill tests/fixtures, contract tests, cross-mode integration/eval cases, existing assets materializer/registry and Video ingest tests as needed. Add all six locales only if application UI text changes.

**Work:** run the original pinned conformance suite in an isolated test copy; run adapted installed-payload tests; prove source hashes unchanged, actual durations/frames, audio preservation and levels, VFR/HDR handling, multilingual captions, safe zones, recipe ordering, partial results, and cache isolation. Test substantive agent behavior with a compact prompt set including refusals and non-media negative cases.

**Observable result:** media files meet measured requests, visible changes have actual contact-sheet evidence, and unsupported/failed operations never report success. One mode's artifacts cannot escape into another mode's project or session.

**Verification:** the imported test commands equivalent to `python3 tests/test_contract.py` and `python3 tests/test_all.py`, with output redirected to temporary fixture directories; the new API integration/eval targets; `pnpm test:api test/unit/assets/materializer.test.ts test/unit/assets/registry.test.ts test/unit/video/asset-ingest-hook.test.ts test/integration/api/assets-mode-attribution.test.ts`. Inspect representative rasterized frames. Do not download the upstream real-device corpus or run paid agent evals as an incidental test. Report capability-based skips with the missing feature.

### 6. Verify packaged delivery and finish documentation

**Likely files:** Tauri/resource and sidecar checks if existing packaging omits any payload resource; setup/runbook docs; script/CI wiring only where the new tests require it. No runtime binaries are added.

**Work:** verify the runtime payload from an installed-resource layout on macOS, Linux, and Windows; test GUI launch PATH and explicit FFmpeg overrides; missing/old Python; absent filters/fonts; read-only source locations; non-ASCII paths; cancellation of nested jobs; source protection; deployment without `_sample/`. Document supported operations, troubleshooting, pin updates, and explicit gaps.

**Observable result:** packaged app resources can serve the skill on machines with supported installed tools, and missing tools yield clear guidance. Release documentation states verified platforms and unsupported variants.

**Verification:** format edited source files with their owning workspace formatter; run targeted tests, API lint and API test-inclusive typecheck where API files change; `pnpm validate`; `git diff --check`; inspect the staged diff; smoke-test all four modes using the installed payload. Run `pnpm test:fast` when shared adapter/process changes warrant it. Run Cargo checks only if Rust changes. Build/install checks must use isolated outputs and inspect generated-file diffs afterward.

## Required test matrix

| Area | Cases | Evidence required |
| --- | --- | --- |
| Selection/routing | Manual `ffmpeg` pin in task/chat/design/video; media request; unrelated request; missing skill; user override. | Exactly one resolved skill, correct body/resource root, appropriate tools and explicit unsupported state. |
| Providers | Each supported adapter in its actual mode path; in-process and bridge transports. | Selected knowledge plus callable registered tools. Config assertions alone are insufficient. |
| Runtime | Python missing/old; Windows interpreter candidates; FFmpeg override; ffprobe absent; caption filter missing; unknown capability listing. | Correct available/missing/unknown state and actionable response. No hidden install. |
| Cut/probe | Keyframe copy, frame-accurate video, sample-accurate WAV, VFR, rotated phone clip, audio-only file. | Real duration/precision, rotation/aspect, stream facts, source hash. |
| Picture | Crop/pad/blur, CJK and Hindi captions, emoji asset, HDR-to-SDR, LUT, transition. | Probed properties plus actual sheet/frame inspection. No guessed image verdict. |
| Audio | Extraction, replacement, two-pass loudness, true-peak remeasure, silent ambience, no-audio input. | Correct channel/sample rate and measured target/tolerance, or explicit failure/warning. |
| Recipes | Three-stage edit, unsupported project field, nested font/LUT/logo/cue paths, cache reuse after parameter change, partial export pack. | Validated effective inputs/outputs, correct order, no mistaken single-encode claim, stage results preserved. |
| Filesystem/network | Traversal, symlink, forbidden nested path, overwrite, hidden sidecar, local manifest referring to network or unauthorized file. | Rejection before access; no network request or user-file mutation. |
| Lifetime | Silent hung child, analysis subprocess, nested render, concurrent batch, cancel at publish boundary, timeout, oversized output. | Descendants exit, bounded buffers, terminal state retained, partials not published. |
| Assets | Task/chat result, design project asset, video import, cancellation with partial file. | Correct asset/session/project attribution and authorized retrievable result link. |
| Packaging | Complete resource copy, app-dir override, repeat upgrade, stale bundled file, user override, no `_sample/`, spaces/non-ASCII paths. | Installed-copy contract and media smoke, ownership/hash inventory, preserved user files. |

The [FFmpeg loudnorm documentation](https://ffmpeg.org/ffmpeg-filters.html#loudnorm) specifies the measured parameters required for linear two-pass normalization and the conditions that cause dynamic fallback. Test the written file's integrated loudness and true peak; correct pass-two arguments alone do not prove the result.

## Questions resolved and defaults

The user confirmed installed host tools for the first release. Runtime bundling and managed optional downloads are deferred.

Use the following reversible planning defaults unless implementation evidence requires a revision:

- Preserve `ffmpeg` as the public skill identity and upstream IDs as provenance.
- Keep bare skill distribution, repairing discovery rather than converting this one skill to a differently named plugin.
- Use a host-owned tool namespace and existing transport bridges. Do not expose the raw upstream MCP server as the app's policy boundary.
- Activate on media-file work or explicit selection. A generic request to design a page or author a Remotion composition does not automatically need FFmpeg.
- Use Neumar transcripts when available and accept supplied cue/word files. Optional upstream ASR stays disabled in the managed surface until local model and subprocess behavior are proven.
- Preserve user intent before applying template crop/trim/loudness choices. The agent can choose routine details but must surface changes that lose material.
- Gate unsupported variants with specific errors and adapted instructions. Full batch/watch/plan compatibility is not a prerequisite for correct file operations in every mode.

No further product question blocks writing this plan. Before implementation, confirm the managed operation catalog against the acceptance criteria and revise any unsupported variant that would invalidate a promised use case.

## Verification performed for this plan

- Read the existing skill, sample skill/README/contract/license/package, execution helpers, MCP transport, render/plan/cache paths, installer, ASR bridge, and representative test coverage.
- Confirmed the sample revision and clean sample status. Generated and parsed the static contract, including the 42 tools and real dry-run exceptions.
- Traced skill distribution, mode/provider routing, native FFmpeg consumers, process supervision, and asset boundaries. CodeGraph was unavailable because this checkout has no initialized index; targeted source searches were used.
- Consulted official Agent Skills, FFmpeg, and MCP cancellation documentation. MCP cancellation is optional at protocol level, but stopping media jobs is an application requirement for this integration. Use the app's installed SDK/protocol rather than copying a newer protocol baseline from a document.
- Ran `pnpm validate` before writing the plan. Branding, lint, consistency checks, and frontend/API source typechecks passed. Root formatting failed on five existing untracked files: `.pi/agent/auth.json`, `.pi/agent/models-store.json`, `.pi/agent/settings.json`, `dev-doc/upgrades/2026-09-27/audit-rust.json`, and `inventory-rust.json`. API formatting and component-size checks were not reached. Existing lint warnings and a HyperFrames update notice were also printed. No unrelated files were changed to clear this gate.
- Runtime `doctor` execution was rejected by automatic approval review because it executes external sample code without explicit approval. Runtime capability detection, upstream test execution, actual media edits, provider sessions, and packaged-app behavior were not verified. These remain implementation checks, not claims of completed behavior.

## Sources and handoff

Local source links are relative to this plan. `_sample/` is an investigation input and must not become a runtime or CI dependency.

- [Current FFmpeg skill](../../skills/ffmpeg/SKILL.md)
- [Development skill sync](../../scripts/sync-builtin-skills.mjs)
- [Skill loader](../../src-api/src/shared/skills/loader.ts) and [plugin loader](../../src-api/src/shared/plugins/loader.ts)
- [Video agent](../../src-api/src/extensions/agent/video/index.ts) and [Video system prompt](../../src-api/src/extensions/agent/video/system-prompt.ts)
- [Native FFmpeg executor](../../src-api/src/shared/services/ffmpeg/executor.ts)
- [Streaming command helper](../../src-api/src/shared/process/run-streaming-command.ts)
- [Application directory policy](../../src-api/src/config/app-dir.ts) and [filesystem policy](../../src-api/src/shared/utils/path-validator.ts)
- [Tauri resources](../../src-tauri/tauri.conf.json)
- [Upstream sample skill](../../_sample/ffmpeg-skill/SKILL.md), [contract](../../_sample/ffmpeg-skill/docs/contract.md), [runner](../../_sample/ffmpeg-skill/scripts/_common/runner.py), and [MCP transport](../../_sample/ffmpeg-skill/mcp/server.py)
- [Pinned upstream repository](https://github.com/kajisho5/ffmpeg-skill/tree/a991599bfe3f072bac3835083f8bbb30efcd9a99)
- [Agent Skills specification](https://agentskills.io/specification)
- [FFmpeg command documentation](https://ffmpeg.org/ffmpeg.html), [protocols](https://ffmpeg.org/ffmpeg-protocols.html), and [filters](https://ffmpeg.org/ffmpeg-filters.html)
- [MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)

The requested deliverable is this plan. Execute checkpoint 1 only after implementation is requested. Review the catalog, checkpoint evidence, and any changed assumptions at that handoff; then proceed through the checkpoints using `trove-workflow:trove-execute-plan`.
