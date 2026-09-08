# Implementation plan

This plan has seven checkpoints. Do not merge a checkpoint until its focused
tests and observable acceptance pass. Keep each checkpoint in its own PR or
small sequence of atomic commits.

## Command conventions used in every verification block

- `src-api` tests resolve `@neumar/video-ir` through the package's built `lib/`
  output, not its source. Any checkpoint that edits `packages/video-ir/` must run
  `pnpm --filter @neumar/video-ir build` before the API subset, or it tests the
  previous build. `pnpm test:api` does this via `pretest:api`; a subset run does
  not. Every block below that needs it says so.
- Run API subsets from the repository root as
  `pnpm vitest run --config src-api/vitest.config.ts <paths relative to src-api>`.
  Verified working: that form runs `test/unit/video/proxy.test.ts` against the
  `src-api` root, setup files, and `@/*` alias.
- After editing any file under `src/`, run `npx oxfmt <file>` before
  `pnpm validate`, or `format:check` fails on formatting alone.
- Do not run `pnpm test:all` for a checkpoint gate. It spawns Playwright and
  real-server E2E. `pnpm test:fast` is the per-checkpoint default; `test:all`
  belongs to the release gates in
  [`05-open-questions-and-rollout.md`](05-open-questions-and-rollout.md).
- New React components must stay at or below 350 lines
  (`pnpm check:component-size`), and every new user-visible string must land in
  all six `src/config/locale/messages/<lang>/video.ts` files
  (`pnpm check:locale-parity`). Both run inside `pnpm validate`.

## Phase 0: close evidence debt and create reusable fixtures

### Likely files and subsystems

- new `src-api/test/fixtures/video/performance/` or an equivalent
  generated-fixture builder shared by the acceptance scripts
- new `scripts/video-acceptance.mjs`
- new `scripts/video-timeline-benchmark.mjs`
- `dev-doc/runbooks/video-mode.md`
- prior evidence ledgers in `13-08-22-upgrade-opportunities/`
- no production behavior unless a testability seam is required

### Work

1. Create deterministic fixture builders for:
   - a 15-second transform, caption, effect, and playback-rate parity project
   - a 3-minute mixed-media render project
   - a 12-track, 1,000-clip timeline
   - an external-master project with one offline source
   - a two-tab stale-revision scenario
2. Finish the three open acceptance rows from the August plan:
   - Remotion golden frames plus wall-clock and peak RSS
   - HTML versus HyperFrames sampled-frame and `ffprobe` comparison
   - live Studio element click through `data-hf-id` to agent context
3. Finish the multi-tab asset picker acceptance from the August 26 fix.
4. Record machine, OS, browser, Node, FFmpeg, Remotion, HyperFrames, fixture
   digest, and command with every benchmark.
5. Add a benchmark output schema so later phases can compare deltas without
   parsing prose.

### Observable result

One command reproduces the Video Mode correctness and performance baseline. The
four previously open acceptance activities have attached evidence or a named
failure with reproduction steps.

### Verification

```bash
node scripts/video-acceptance.mjs --fixture parity --json
node scripts/video-acceptance.mjs --fixture long-render --json
node scripts/video-timeline-benchmark.mjs --clips 1000 --tracks 12 --json
pnpm test:fast
```

Manual checks:

- click a HyperFrames Studio element and inspect the returned `data-hf-id`
- open three Video tabs, cancel and reopen the native picker, and confirm idle
  tabs do not hold asset SSE connections

### Exit gate

Baseline artifacts are committed or linked from the ledger. A dependency bump
must not start without them.

### Rollback boundary

This phase should add fixtures and evidence only. Revert the harness without
touching project data or user behavior.

## Phase 1: update Remotion and HyperFrames safely

### Likely files and subsystems

- `package.json`
- `src-api/package.json`
- `src-video/package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `src-api/src/shared/video/remotion-*.ts`
- `src-api/src/shared/video/engines/hyperframes-adapter.ts`
- `src-api/src/shared/video/hyperframes-{inspect,studio}.ts`
- `plugins/builtin/design-skills/hyperframes/skills/hyperframes/`
- `scripts/check-hyperframes-{skill-drift,upgrade}.mjs`
- packaged sidecar/resource configuration

### Work

1. Pin every Remotion package to exact `4.0.522` in one change across all three
   manifests. `src-video/package.json` currently uses caret ranges on ten
   `@remotion/*` entries; convert them to exact pins so render fixtures are
   reproducible.
2. Move the root `mediabunny` pin from `1.55.2` to `1.55.5` — the version
   `@remotion/media@4.0.522` depends on. Do not take the registry's `1.56.0`;
   the goal is one resolved copy, not the newest. After the bump, confirm the
   lockfile resolves a single `mediabunny` and a single `zod`
   (`@remotion/media@4.0.522` wants `zod@4.5.4`; the repo's `^4.4.3` ranges
   admit it, but a duplicate would split schema identity across
   `packages/video-ir`, `src-api`, and the frontend).
3. Run the existing renderer, Player, caption, effects, playback-rate, 5.1
   audio, and Windows-path unit suites before changing behavior. The 5.1 downmix
   fix is in 4.0.519 and the Windows stall fix in 4.0.521, so both suites are
   load-bearing for this bump.
4. Pin HyperFrames to `0.8.31` in `src-video/package.json`. Capture the complete
   `--help` and JSON output contracts for commands Neumar calls. Use the CLI's
   own `hyperframes upgrade --project . --check --json` — already wrapped by
   `scripts/check-hyperframes-upgrade.mjs`, which reads `_meta.version`,
   `_meta.latestVersion`, and `_meta.updateAvailable` — rather than a new probe.
5. Update parsers only for observed contract changes. Reject unknown output
   versions with an actionable error.
6. Update the bundled HyperFrames skill and drift guard in the same commit.
   `scripts/check-hyperframes-skill-drift.mjs` fails `pnpm validate` unless the
   `SKILL.md` `upstream-version:` frontmatter matches the new pin exactly. Two
   body corrections are required and already identified:
   - `SKILL.md:297` documents `data-volume` as `0-1 (default 1)`. The 0.8.31
     runtime clamps gain to `3.981071705534972` (10^(12/20), +12 dB); the 0-1
     clamp survives only on the `set-media-volume` command path. Document both.
   - Publish visibility: a fresh publish is private and requires authentication,
     `--public` is explicit, re-publishing without `--public` never demotes a
     public project, `--yes` skips only the prompt, and a signed-out publish
     returns a claim URL rather than a playback URL.
7. Audit generated compositions for assumptions about `data-track-index` and
   use CSS stacking for visual order. Treat "`data-track-index` is a Studio lane
   and not paint order" as an assumption to prove with a two-clip overlap
   fixture — the shipped 0.8.31 docs state only that lint flags overlapping
   tracks sharing an index, not that the index is visually inert.
8. Check the new native and browser-fetching transitive dependencies against the
   packaged sidecar before shipping: 0.8.31 pulls `onnxruntime-node`, `sharp`,
   `puppeteer-core`, `@puppeteer/browsers`, and `esbuild`. Confirm the bundle
   footprint and that a missing browser still produces a typed unavailable
   reason rather than a crash.
9. Decide whether `hyperframes-localize-fonts` belongs in the reproducible
   render path. It is a new second binary in 0.8.31
   (`bin/hyperframes-localize-fonts.mjs`, backed by `dist/fontLocalizeCli.js`).
   Add it only if the golden fixture shows cross-host font drift.
10. Probe a packaged sidecar on macOS arm64 and one non-macOS CI target. The app
    must report a typed unavailable reason when the CLI or browser is missing.
11. Keep `@remotion/gsap`, Remotion WebMCP, Browser Studio, and
    Whisper-WebGPU out of the dependency set. Note that 4.0.518 launched
    `@remotion/whisper-webgpu` as a package; not adding it is the decision, and
    it does not arrive transitively.
12. Stay on the 4.0.x line. A `4.1.0-alpha12` exists under the npm `alpha` tag
    and is out of scope for this cycle.

### Observable result

Existing projects preview and render with the new exact pins. HyperFrames
selection, context, check, compare, grade-compare, preview lifecycle, and render
still produce typed results. No publish operation becomes public without an
explicit public choice.

### Verification

```bash
pnpm check:hyperframes-skill
pnpm check:hyperframes-upgrade
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/remotion-renderer.test.ts \
  test/unit/video/remotion-render-input.test.ts \
  test/unit/video/remotion-clip-effects.test.ts \
  test/unit/video/hyperframes-inspect.test.ts \
  test/unit/video/hyperframes-studio.test.ts \
  test/unit/video-hyperframes-adapter.test.ts
pnpm vitest run \
  src/__tests__/video/RemotionPreview.test.ts \
  src/__tests__/video/HyperframesStudioPreview.test.tsx
node scripts/video-acceptance.mjs --fixture parity --compare phase-0 --json
pnpm validate
```

### Exit gate

Golden-frame drift is reviewed. Long-render peak RSS does not regress by more
than 10 percent without an accepted explanation. Every wrapped HyperFrames
command passes once against the real pinned CLI.

### Rollback boundary

Revert package pins, lockfile, wrapper adjustments, and bundled skill together.
Do not leave the CLI pin and skill version out of sync.

## Phase 2: make timebase and output range explicit

### Likely files and subsystems

- `packages/video-ir/src/{timebase,timeline-types,timeline-schema,edit-builders}.ts`
- `packages/video-ir/test/`
- `src-api/src/shared/video/{types,timeline,store,render-plan,pipeline,cost-estimator}.ts`
- `src-api/src/shared/video/engines/`
- `src-api/src/shared/video/editor-handoff/`
- `src-api/src/shared/mcp/video-edit-server.ts`
- `src/shared/types/video.ts`
- `src/components/video/timeline/`
- `src/components/video/preview/RenderSettingsForm.tsx`
- all six Video locale files

### Data contract

Add optional fields first:

```ts
interface VideoProjectSettings {
  timebase?: {
    rate: FrameRate;
    source: 'user' | 'derived';
    locked: boolean;
  };
}

interface VideoTimeline {
  outputRange?: {
    inFrame: number;
    outFrameExclusive: number;
  };
}
```

Old projects keep their current numeric `fps`. On load, derive a rational rate
without rewriting the document. Persist the new field only after a user chooses
a rate or a normal project write occurs after migration policy is approved.

### Work

1. Add preset parsing and formatting for integer and NTSC fractional rates. Map
   each user-facing label to exact `{num, den}` — `24000/1001`, `30000/1001`,
   `60000/1001` for the NTSC entries — and route every construction through
   `normalizeFrameRate()` so the stored pair is always reduced.
2. Replace `deriveTimelineFps()` (`src-api/src/shared/video/timeline.ts:663`).
   It currently returns `Math.round(firstAssetFrameRate)`, which turns 23.976
   into 24 and 29.97 into 30 with no record. The replacement must survey all
   assets rather than the first one with a value, return a `FrameRate`, and
   report the reason and the conflicting sources. Show the proposed rate and
   reason before locking it. Keep the rounded numeric `fps` as a derived
   compatibility field, never as the source of truth.
3. Add a project setting control. Changing a locked timebase must show how many
   timeline boundaries will be re-snapped and require confirmation.
4. Add named IR operations to set and clear the output range. Store half-open
   frame bounds and make the operation undoable.
5. Add `I` and `O` commands, toolbar controls, ruler handles, dimmed excluded
   regions, clear action, keyboard labels, and collision tests.
6. Apply the range in every render engine. Shift render-local time to zero while
   preserving project-time provenance in QA and export metadata.
7. Use range duration in render estimates, cost approval, progress, QA duration,
   and output naming.
8. Add `video_set_timebase`, `video_set_output_range`, and
   `video_clear_output_range` with permission and cost metadata.
9. Extend OTIO, EDL, FCPXML, Premiere XML, caption sidecars, and render manifests
   so rate and range remain explicit.
   `src-api/src/shared/video/editor-handoff/rational-time.ts` already emits
   rational time; the fix is feeding it a rate that was never rounded, not
   adding a new interchange path. `editor-handoff/conformance.ts` and its
   `model-conformance.test.ts` are the guard for this.

### Observable result

A user can lock a fractional project timebase, set In/Out points, reload the
project, undo the range, and export the same sub-range through Remotion,
HyperFrames, and HTML fallback. Unset projects render exactly as before.

### Verification

```bash
pnpm -C packages/video-ir test
# Required: src-api resolves @neumar/video-ir through lib/, and this phase
# changes the IR.
pnpm --filter @neumar/video-ir build
pnpm vitest run \
  src/__tests__/video/timelineMath.test.ts \
  src/__tests__/video/timelineKeyboardBindings.test.ts \
  src/__tests__/video/timelineUiStore.test.ts \
  src/__tests__/video/useTimelinePersistence.test.tsx
pnpm vitest run --config src-api/vitest.config.ts \
  test/integration/video-timeline-route.test.ts \
  test/integration/video-output-route.test.ts \
  test/unit/video/timeline.test.ts \
  test/unit/video/render-plan.test.ts \
  test/unit/video/editor-handoff/model-conformance.test.ts
node scripts/video-acceptance.mjs --fixture timebase-range --engines all --json
```

Acceptance matrix:

- all eight supported rates
- range at start, middle, and one-frame tail
- captions, effects, transitions, audio fades, and playback-rate clips crossing
  each range boundary
- output duration within one project frame
- unset range regression fixture

### Exit gate

No render engine may ignore a set range. An unavailable engine must fail during
preflight, not after paid work or encoding starts.

### Rollback boundary

The new fields are optional. Older builds ignore them and continue rendering the
full timeline. Do not delete the numeric `fps` compatibility field in this phase.

## Phase 3: bound timeline cost and prove render-path parity

### Likely files and subsystems

- `src/components/video/timeline/{Timeline,TimelineCanvas,TimelineTrackRows,TimelineTrack,TimelineClip}.tsx`
- new `src/components/video/timeline/rendering/`
- `src/components/video/preview/`
- `src/shared/video/`
- new timeline performance tests and browser harness

### Work

1. Instrument commit duration, rendered clip count, thumbnail work, waveform
   work, pointer latency, and dropped frames in development builds.
2. Add horizontal visible-time calculation with overscan. Render only clips that
   intersect the window. The clip fan-out to fix is the single
   `clips.map(...)` at `src/components/video/timeline/TimelineTrack.tsx:266`;
   `TimelineTrackRows.tsx` already virtualizes rows through
   `@tanstack/react-virtual`, so this is the second axis, not a rewrite.
   `src-api/src/shared/video/timeline-window.ts` already defines a time-window
   clip query for the agent tools — share its window semantics rather than
   writing a second, subtly different definition on the frontend.
3. Pin clips that are selected, keyboard-focused, dragged, resized, trimmed,
   drop-targeted, link-highlighted, or referenced by an open menu. Pinned clips
   stay interactive outside the normal window until the interaction ends.
4. Build interval indexes per track so visible-clip lookup does not scan every
   clip on each pointer move.
5. Cache thumbnail slots and waveform reductions by source hash, trim,
   playback rate, zoom bucket, and visible range.
6. Re-run the 1,000-clip benchmark. If production p95 interaction time still
   exceeds 33 ms, introduce canvas painting for inactive clips one track kind at
   a time. Keep active clips as DOM overlays.
7. Add parity fixtures across paused WebCodecs, playing WebCodecs, hover preview,
   Remotion Player fallback, Remotion final render, and HyperFrames where
   applicable.
8. Test transforms, crops, effect stacks, keyframes, captions, transitions,
   audio, playback rate, and fractional rates in every active path.

### Observable result

With 12 tracks and 1,000 clips, DOM clip count scales with the viewport rather
than total timeline size. Selection, lasso, drag, trim, context menus, undo,
hover preview, thumbnails, waveforms, transitions, and agent highlight remain
functional.

### Performance budget

Measure a production build on the oldest Apple Silicon Mac in the supported
test fleet, at 1920 by 1080. Record its chip, memory, macOS version, display
scale, and power mode with the result:

- zoom and horizontal-scroll storm p50 at or below 16.7 ms
- p95 at or below 33 ms
- no interaction frame above 50 ms in the scripted sample after warmup
- pointer-to-drag-preview latency below 50 ms
- rendered inactive clip DOM bounded by visible clips plus overscan

If that reference machine cannot meet the first budget before this work, Phase
0 must record an accepted relative target. If the test fleet contains only one
Apple Silicon machine, use it as the reference until an older supported machine
is available. Do not substitute a faster machine after implementation.

### Verification

```bash
pnpm vitest run \
  src/__tests__/video/Timeline.test.tsx \
  src/__tests__/video/timelineMath.test.ts \
  src/__tests__/video/timelinePlacement.test.ts \
  src/__tests__/video/timelineRenderingPerformance.test.tsx
node scripts/video-timeline-benchmark.mjs \
  --clips 1000 --tracks 12 --production --compare phase-0 --json
node scripts/video-acceptance.mjs --fixture preview-parity --json
pnpm validate
```

Run the interaction matrix at minimum, fit, and frame-level zoom:

- single, additive, and lasso selection
- drag within and across tracks
- trim, razor, ripple, and transition seam edit
- context menu on visible and pinned clips
- marker, beat, In/Out, and playhead interaction
- keyboard navigation and screen-reader labels

### Exit gate

The benchmark meets the agreed absolute or relative budget. Golden parity has no
unreviewed difference above the image threshold.

### Rollback boundary

Ship visible-time windowing before canvas painting. Canvas work stays behind
`video.timelineCanvasPaint` and can fall back to windowed DOM without changing
the project model.

## Phase 4: add project recovery and media-health contracts

### Likely files and subsystems

- `src-api/src/shared/video/{store,project-lock,asset-files,proxy}.ts`
- new `src-api/src/shared/video/project-history.ts`
- `src-api/src/app/api/video.ts`
- `src/shared/hooks/useVideoProject.ts`
- `src/components/video/timeline/useTimelinePersistence.ts`
- new `src/components/video/ProjectVersionHistory.tsx`
- new `src/components/video/MediaHealthPanel.tsx`
- existing render-readiness and asset progress UI
- `src/components/video/StepBriefCanvas.tsx` and `InputsPanel.tsx`

### Work

1. Require `expectedRevision` on mutating full-document endpoints. Return 409
   with the current revision and a compact conflict summary. Reuse the
   `expectedProjectRevision` token that durable agent plans already carry — the
   conflict path and its `AgentPlanPanel` surface exist; generalize them rather
   than adding a second concept.
2. Fix `projectDocumentForWrite()` (`src-api/src/shared/video/store.ts:2015`).
   It currently returns `{ ...normalized, revision: persisted.revision + 1 }`
   whenever the incoming revision is not greater — silently renumbering a stale
   write above the state it just clobbered. It must reject a mismatch when the
   caller supplied an expected revision, and the auto-bump must survive only for
   callers that explicitly opt out (project creation, migrations).
3. Wrap `PATCH /projects/:id/timeline` (`src-api/src/app/api/video.ts:2190`) in
   `withProjectLock()`. It is currently the only timeline mutation route without
   one: `timeline/op`, `timeline/undo`, and `timeline/redo` all take the lock.
4. Collapse the two serialization boundaries into one. `withProjectLock()` keeps
   `projectLocks` in `project-lock.ts` while `updateProjectDocument()` keeps a
   separate `projectDocumentUpdateLocks` map in `store.ts`; neither sees the
   other, so a route holding one can interleave with a call holding the other.
   Make `withProjectLock()` the single public entry and run
   `updateProjectDocument()` inside it. Document that this serializes per API
   process — true for the Tauri sidecar and `pnpm dev:api`, not a file lock.
5. Change timeline persistence so a retry cannot replay a stale full timeline
   over newer agent or tab edits. Prefer queued named operations. If full
   timeline PATCH remains, stop on conflict and offer reload or save-as-copy.
6. Before replacing `project.json`, write a content-addressed project snapshot
   and append a small revision index. Record author kind, run ID when present,
   timestamp, reason, project revision, counts, duration, and digest.
   `writeProject()` already writes to `${filePath}.${randomUUID()}.tmp` and
   renames over `project.json`, so the torn-write protection exists; the
   snapshot must be durable *before* that rename, not after.
7. Add retention with protected named versions. Recommended default is the last
   50 automatic revisions plus all named versions. Prune only after the new
   snapshot and index are durable.
8. Add list, name, preview, compare-summary, and restore endpoints. Restore must
   first snapshot the current head, then create a new revision from the selected
   snapshot. Never move the head pointer backward destructively.
9. Add a version-history sheet grouped by edit sessions. Distinguish user,
   agent, system, and restore revisions. Snapshot and index paths must resolve
   under the project directory from `getSetting('workDir')`, never
   `process.cwd()` — the sidecar's cwd is wrong.
10. Add one media-health report for managed files, external masters, proxies,
    metadata, thumbnails, and render availability. Reuse it in editor badges,
    render readiness, project open, and export.
11. Complete browser-upload progress by threading the existing materialization
    session ID. Do not create a second progress store.
12. Complete the Brief ownership cleanup from the August 26 plan and run its
    integrated accessibility checks. `src/components/video/StepBriefCanvas.tsx`
    has no test file today; `src/__tests__/video/StepBriefCanvas.test.tsx` is new
    work in this checkpoint, not an existing suite to re-run.

### Observable result

Two stale tabs cannot silently overwrite each other. A user can inspect and
preview prior project versions, name important versions, restore one without
losing the current head, and resolve offline media before rendering.

### Verification

```bash
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/project-lock.test.ts \
  test/unit/video/project-history.test.ts \
  test/unit/video/local-media-import.test.ts \
  test/unit/video/proxy.test.ts \
  test/integration/video-project-history-routes.test.ts \
  test/integration/video-timeline-route.test.ts
pnpm vitest run \
  src/__tests__/video/useTimelinePersistence.test.tsx \
  src/__tests__/video/ProjectVersionHistory.test.tsx \
  src/__tests__/video/render-readiness.test.ts \
  src/__tests__/video/StepBriefCanvas.test.tsx
node scripts/video-acceptance.mjs --fixture stale-revision --json
node scripts/video-acceptance.mjs --fixture offline-media --json
```

Crash and concurrency tests:

- terminate between snapshot write and index append
- terminate between temporary `project.json` write and rename
- restore while an agent plan is paused
- retry a stale timeline save after an agent edit
- relink an external folder and rerun readiness
- a stale `PATCH /projects/:id/timeline` must return 409 rather than being
  renumbered to `persisted.revision + 1`; write this test so it fails on the
  current tree first
- an in-flight `PATCH .../timeline` interleaved with an
  `updateProjectDocument()` caller (for example a catalog asset attach) must
  serialize, proving the two lock maps were actually collapsed

### Exit gate

Every conflict produces a recoverable user choice. Restore is append-only and
idempotent. Render readiness and the asset rail report the same media-health
state.

### Rollback boundary

Snapshot creation is additive. The current `project.json` remains canonical.
The UI and endpoints may be disabled while preserving snapshots for manual
recovery.

## Phase 5: build the multicamera foundation

### Likely files and subsystems

- new `packages/video-ir/src/multicam-*.ts` only for timeline-facing contracts
- new `src-api/src/shared/video/multicam/`
- `src-api/src/shared/video/types.ts`
- `src-api/src/shared/video/analysis/`
- `src-api/src/shared/video/jobs.ts` and `job-events.ts`
- `src-api/src/shared/video/store.ts`
- `src-api/src/app/api/video.ts`
- new fixtures under `src-api/test/fixtures/video/multicam/`

### Data contract

Start with separate versioned artifacts:

```text
manifest -> sync map -> activity map -> shot plan -> cut review -> timeline batch
```

The manifest includes camera identity, subject, source asset, camera type,
reference camera, isolated microphone mapping, timebase, and constraints. Store
source fingerprints on every derived artifact.

### Work

1. Add Zod 4 schemas and parsers for a Neumar multicamera manifest. Support JSON
   import and UI construction. YAML import can follow if users request it.
   Do not copy OpenReel's hand-rolled validator that accumulates into
   `errors: string[]`, and do not copy its `fps: number` field — the Neumar
   manifest stores a `FrameRate` and inherits the project timebase locked in
   Phase 2.
2. Validate at least two cameras, one reference, and one wide fallback for
   automatic mode. Manual-only groups may omit isolated microphones.
3. Implement manual offsets first. Add timecode sync second. Put audio
   cross-correlation behind a feature flag until real fixture accuracy passes.
4. Fit a drift model from multiple observations rather than assuming one fixed
   offset for long recordings.
5. Extract mono analysis audio through the existing FFmpeg executor. Run VAD as
   a cancellable, resumable Video job with bounded progress events.
6. Prefer the existing local transcription path. Store participant-scoped
   transcript ranges without copying a browser model into the app.
7. Correct microphone bleed only when calibration confidence passes a threshold.
   Keep raw activity probabilities for audit.
8. Build a deterministic speaker-driven shot planner with policies for minimum
   shot, maximum shot, cut lead, overlap, silence, jump cuts, and wide fallback.
9. Store the shot plan as an analysis artifact with a proposed timeline batch.
   Do not apply it.
10. Add read-only API routes for manifest, sync, activity, transcript, and plan.

### Observable result

Given a deterministic two-person, three-camera fixture, Neumar produces the same
fingerprinted sync, activity, and shot-plan artifacts on repeated runs. Cancelling
or restarting analysis resumes or safely recomputes without timeline mutation.

### Verification

```bash
pnpm -C packages/video-ir test
# Required whenever this checkpoint adds timeline-facing multicam contracts to
# packages/video-ir/.
pnpm --filter @neumar/video-ir build
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/multicam/manifest.test.ts \
  test/unit/video/multicam/sync.test.ts \
  test/unit/video/multicam/drift.test.ts \
  test/unit/video/multicam/activity.test.ts \
  test/unit/video/multicam/shot-plan.test.ts \
  test/integration/video-multicam-analysis-routes.test.ts
node scripts/video-acceptance.mjs --fixture multicam-analysis --json
```

Fixture assertions:

- offset error at or below one project frame for timecode/manual fixtures
- declared tolerance for audio cross-correlation before enabling its flag
- no shot shorter or longer than policy unless the result carries a reason
- silence falls back to wide
- overlap follows the selected policy
- jump-cut prohibition holds
- artifact fingerprint invalidates after a source changes

### Exit gate

Analysis is deterministic, resumable, cancellable, fingerprinted, and read-only
with respect to the timeline.

### Rollback boundary

All new fields and artifacts are additive. Disable `video.multicam` to hide the
routes and UI while retaining analysis files for diagnosis.

## Phase 6: ship multicamera review, agent control, and interchange

### Likely files and subsystems

- new `src/components/video/multicam/`
- `src/components/video/EditorLeftColumn.tsx`
- `src/components/video/EditorRightColumn.tsx`
- `src/components/video/timeline/`
- `src-api/src/shared/video/multicam/`
- `src-api/src/shared/video/agent-tools.ts`
- `src-api/src/shared/mcp/video-edit-server.ts`
- `src-api/src/extensions/agent/video/{permissions,cost-hook,system-prompt}.ts`
- `src-api/src/shared/video/editor-handoff/`
- all six Video locale files
- `dev-doc/runbooks/video-mode.md`

### Work

1. Add a multicamera setup panel for camera/participant mapping, reference
   selection, offsets, analysis status, and policy presets.
2. Add a review surface that shows source angle thumbnails, active speaker,
   proposed layout, reason, confidence, and cut status at the playhead.
3. Support accept, reject, nudge, set camera, annotate range, and preview frame.
   Each action updates the review artifact and its revision.
4. Apply accepted decisions as one named `TimelineOpBatch` with inverse history.
   Preserve camera-group and source-range provenance on created clips.
5. Reapplying the same plan ID and review revision must return the prior result
   instead of duplicating clips.
6. Add a focused tool domain:
   - `video_multicam_get_manifest`
   - `video_multicam_get_activity`
   - `video_multicam_get_transcript`
   - `video_multicam_set_policy`
   - `video_multicam_annotate_range`
   - `video_multicam_get_edit_summary`
   - `video_multicam_override_cut`
   - `video_multicam_preview_frame`
   - `video_multicam_apply_reviewed_plan`
7. Classify every tool for permissions and cost in
   `src-api/src/extensions/agent/video/permissions.ts`. This is already
   enforced: the lookup throws
   `Video tool "X" has no permission metadata.` (line 208), so an unclassified
   tool fails at runtime rather than shipping open. Preview is read-only but can
   be compute-expensive. Applying the plan is write access and requires the usual
   plan gate.
   Gate the whole domain on `video.multicam` the way OpenReel gates on
   `host.multicam`: each handler returns a typed unavailable reason, and the
   nine tools are withheld from registration entirely on projects with no camera
   group. `video-edit-server.ts` already names 121 `video_*` tools, so the
   per-turn context cost of an always-on domain is real.
8. Extend engine input and handoff manifests with camera group, angle, source
   time, sync, and plan provenance. Preserve existing OTIO/EDL/FCPXML/Premiere
   paths.
9. Add optional social-range candidates only after the primary cut review is
   reliable. Keep face-reaction cuts behind `video.multicamReactions`.
10. Run the full responsive, accessibility, performance, render, and package
    gate. Update the runbook after behavior is final.

### Observable result

A user imports a multicamera session, reviews the proposed edit, corrects cuts,
asks the agent for a bounded change, applies the reviewed plan once, renders the
result, and exports a professional-editor handoff with source provenance.

### Verification

```bash
pnpm --filter @neumar/video-ir build
pnpm vitest run src/__tests__/video/multicam/*.test.tsx
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/multicam/ \
  test/integration/video-multicam-routes.test.ts \
  test/integration/video-timeline-route.test.ts \
  test/unit/video/editor-handoff/
pnpm exec vitest run --config src-api/vitest.e2e.config.ts \
  src-api/test/e2e/video-multicam.e2e.test.ts
node scripts/video-acceptance.mjs --fixture multicam-edit --engines all --json
node scripts/video-timeline-benchmark.mjs \
  --fixture multicam-edit --production --compare phase-3 --json
pnpm test:fast
pnpm validate
```

Manual acceptance:

- keyboard-only setup and cut review
- wide and half-width desktop layouts
- offline camera source and relink
- cancel and resume analysis
- agent policy change followed by human correction
- repeated apply request
- undo and redo of the applied batch
- Remotion final render plus one alternate available engine
- OTIO handoff opened in one target editor when available

### Exit gate

The end-to-end fixture passes, package probing passes, no tool lacks permission
or cost metadata, and the release owner accepts the visual cut review.

### Rollback boundary

The feature remains behind `video.multicam`. Applied edits are ordinary timeline
operations and remain valid if the multicamera UI is disabled.

## Cross-phase sequencing

1. Phase 0 blocks Phase 1 and Phase 3 because both need a baseline.
2. Phase 1 and the schema-only part of Phase 2 may be prepared in parallel, but
   they share render fixtures and should merge in order.
3. Phase 2 blocks multicamera work because all sync artifacts need a locked
   timebase.
4. Phase 3 and Phase 4 can proceed in parallel after Phase 2. They touch
   different primary modules, but both touch `Timeline.tsx` and integration
   tests. Coordinate those merges.
5. Phase 4 blocks Phase 6. A multicamera apply must not land before stale-write
   conflicts and project recovery exist.
6. Phase 5 can proceed alongside Phase 3 and Phase 4 after Phase 2. Keep it in
   new backend modules and artifacts until the dependencies land.
7. Phase 6 is the only integration phase. It consumes every earlier contract.
