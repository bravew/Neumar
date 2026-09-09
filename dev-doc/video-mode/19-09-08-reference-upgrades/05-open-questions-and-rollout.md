# Open questions and rollout

## Resolved product decisions

Recorded on 2026-09-08:

- Multicamera analysis and editing for two-to-six-camera interview and podcast
  projects are committed to this cycle. Phases 5 and 6 are required scope.
- Apple Silicon Macs are the only supported performance target for this cycle.
  Intel Macs are outside the release gate.

### Q1. Is multicamera editing a committed product goal for this cycle?

Decision: yes. Complete all seven phases in this cycle.

### Q5. What hardware defines the timeline performance gate?

Decision: Apple Silicon only. Use the oldest Apple Silicon Mac in the supported
test fleet, running a production build at 1920 by 1080. Record the chip, memory,
macOS version, display scale, and power mode with every result.

If only one Apple Silicon machine is available, use it as the temporary
reference and accept a relative gate for the first pass: p95 must improve by at
least 40 percent and rendered DOM clips must be bounded by the viewport. Replace
the temporary reference with the oldest supported test-fleet machine when one
becomes available.

## Remaining product questions

These questions still change behavior or acceptance. The recommended answer is
the plan's default until the product owner chooses otherwise.

### Q2. What is the first multicamera synchronization promise?

Recommended answer: manual offsets and embedded timecode are supported at
launch. Audio cross-correlation remains beta behind a flag until fixture error
stays within the accepted threshold.

Do not promise automatic sync from arbitrary camera scratch audio in the first
release without real recordings from target users.

### Q3. Which project frame rates and timecode displays must ship?

Recommended answer:

- rates: 23.976, 24, 25, 29.97, 30, 50, 59.94, and 60 — the same eight OpenReel
  offers in `editing-frame-rate.ts`, labelled the way editors say them
- storage: exact rational numerator and denominator. The three NTSC labels map to
  `24000/1001`, `30000/1001`, and `60000/1001`; the label is display text and
  never the stored value
- display: frame number and non-drop `HH:MM:SS:FF`
- defer drop-frame `;FF` display until broadcast delivery is a stated need

If broadcast workflows are already a target, drop-frame display and EDL
verification move into Phase 2.

### Q4. How much project history should be retained?

Recommended answer: last 50 automatic revisions, all named revisions, and the
pre-restore head. Add a project-level storage usage view before increasing the
default.

Media bytes should not be copied into every revision. Snapshots reference media
by stable identity and content hash. Consolidation remains the path for making
external masters portable.

### Q6. Should HyperFrames be bundled or discovered from PATH?

Recommended answer: keep the current explicit availability policy for this
roadmap. Validate both packaged and PATH-discovered cases. Do not increase the
desktop bundle until install friction and actual usage are measured.

### Q7. Should reaction shots be automatic in multicamera v1?

Recommended answer: no. Record reaction cues as suggestions and require review.
Enable automatic insertion only after speaker-driven cuts have shipped and real
editors approve the false-positive rate.

## Technical decisions already made

- Keep `project.json` canonical.
- Store revision snapshots in the project directory, resolved from
  `getSetting('workDir')` rather than `process.cwd()`.
- Collapse `withProjectLock()` and the `projectDocumentUpdateLocks` map in
  `store.ts` into one serialization boundary in Phase 4. Project writes are
  serialized per API process, not by a file lock; that holds for the Tauri
  sidecar and `pnpm dev:api` and should be stated rather than assumed.
- Stop `projectDocumentForWrite()` silently renumbering a stale write to
  `persisted.revision + 1`. Keep that behavior only for callers that explicitly
  opt out of compare-and-swap.
- Reuse the existing `expectedProjectRevision` token from durable agent plans
  for document-level compare-and-swap; do not introduce a second name.
- Share `packages/video-ir` types across the boundary. `VideoProjectTimebase`
  and `TimelineOutputRange` are declared there and re-exported, not restated in
  `src/shared/types/video.ts`.
- Keep timeline mutations in the existing named-op and inverse-history system.
- Keep multicamera analysis artifacts separate from applied edits.
- Use current Video jobs for cancellable analysis.
- Reuse the existing engine registry and editor handoff package.
- Keep all source paths workspace-confined or explicitly trusted external media.
- Add optional fields. Do not bump `VIDEO_PROJECT_SCHEMA_VERSION` for additive
  fields.
- Do not silently downgrade export resolution, frame rate, engine, or sync mode.

## Feature flags

Video flags live in `src-api/src/shared/video/flags.ts` as a `VideoFeatureFlag`
string union plus a `VIDEO_FEATURE_FLAG_DEFAULTS` record declared
`satisfies Record<VideoFeatureFlag, boolean>`, read through
`getVideoFeatureFlag()` over `getSetting()`. Adding a flag means editing both the
union and the record — the `satisfies` clause turns an omission into a type
error, which is the enforcement. There is no separate frontend enum; the
frontend learns flag state from the API.

The naming below matches the existing dotted-camelCase convention
(`video.webcodecsPreview`, `video.timelineTransitions`). Note the existing
distinction the current file draws in comments: most shipped flags are
on-by-default kill switches, and only cost-bearing or uncharacterized behavior
stays opt-in. Every flag in this plan is the second kind while its phase is in
development.

| Flag | Default | Removed when |
| --- | --- | --- |
| `video.projectTimebase` | off during Phase 2 development | all rate/range fixtures pass |
| `video.outputRange` | off during Phase 2 development | every render engine honors it |
| `video.timelineWindowing` | on after Phase 3 tests | stable for one release |
| `video.timelineCanvasPaint` | off | needed by measured performance and proven |
| `video.projectHistory` | off during Phase 4 development | restore crash matrix passes |
| `video.multicam` | off | Phase 6 release gate passes |
| `video.multicamAudioSync` | off | real-fixture sync error is accepted |
| `video.multicamReactions` | off | editor review validates cue quality |

Flags are rollout controls, not permanent parallel implementations. Delete old
paths after the new contract is stable.

## Telemetry and diagnostics

Use structured local logs and existing diagnostics. Do not log media contents,
transcripts, absolute external paths, or provider credentials.

Record:

- project timebase and whether it was derived or selected
- output-range duration, never content
- timeline total clips, visible clips, mounted clips, and interaction timing
- project save conflict count and chosen resolution
- revision snapshot duration, size, prune count, restore result
- media-health counts by state
- multicamera camera and participant counts
- sync method, confidence, error bucket, and duration
- analysis job resume, cancel, and failure reason
- shot-plan count by reason and human override count
- plan apply idempotency hit or new apply
- render engine, duration, wall-clock, peak RSS, and QA result

## Fixture set

### `video-parity-v1`

A 15-second edit with transforms, crops, effect keyframes, transition seams,
captions, audio fades, playback rate, and one HTML overlay.

### `video-timebase-range-v1`

The parity fixture rendered at every supported rate with full, middle, and
one-frame-tail output ranges.

### `video-timeline-1000-v1`

Twelve tracks and 1,000 clips with deterministic thumbnails and waveforms. It
must include selected and dragged clips outside the initial visible window.

### `video-recovery-v1`

Two stale clients, a paused agent plan, one offline external master, one missing
proxy, and three project revisions.

### `video-multicam-v1`

Two speakers, three cameras, two isolated microphones, a wide reference, known
offsets, a short drift segment, silence, overlap, and one deliberate microphone
bleed interval. Keep a license-safe generated fixture in the repository.

## Release train

### Train A: foundations

Phases 0 to 2. Ship dependency updates, locked timebase, and In/Out export.

Release gate:

- focused and full tests pass
- all render engines honor output range
- package-sidecar probes pass
- golden and long-render comparisons are reviewed

### Train B: scale and recovery

Phases 3 and 4. Ship timeline windowing, parity tests, conflict handling,
version history, media health, and remaining editor cleanup.

Release gate:

- 1,000-clip benchmark meets the accepted budget
- stale-tab overwrite test fails before the fix and passes after
- crash and restore matrix passes
- offline media blocks final render with a direct recovery action
- keyboard, accessibility, and responsive editor checks pass

### Train C: multicamera beta

Phase 5. Release to an internal or opt-in cohort without timeline application.

Release gate:

- artifact fingerprinting and invalidation pass
- analysis cancel and resume pass
- manual/timecode sync accuracy passes
- output remains a proposal only

### Train D: multicamera editing

Phase 6. Add review, apply, agent tools, render, and interchange.

Release gate:

- reviewed plan applies once and is undoable
- all tools have permission and cost metadata
- handoff preserves source angle and source time
- render QA passes on the full fixture
- product owner accepts the cut-review flow

## Risk register

| Risk | Detection | Mitigation |
| --- | --- | --- |
| Fractional-rate drift | one-frame fixture comparisons and long-duration time maps | canonical rational rate and half-open frame ranges |
| HyperFrames wrapper break | command-contract snapshot and real CLI smoke | exact pin and typed parser versions |
| Timeline interaction regression | scripted pointer matrix | windowed DOM first, canvas behind a flag |
| Stale saves overwrite agent work | two-client deterministic integration test that fails on the current tree | expected revision and recoverable 409; remove the `persisted.revision + 1` auto-bump that hides the overwrite |
| Two lock maps let writes interleave | concurrent PATCH-plus-`updateProjectDocument` integration test | one serialization boundary, `withProjectLock()` as the only public entry |
| src-api tests pass against a stale `video-ir` build | CI runs `pnpm test:api`, which builds via `pretest:api` | every subset command in the plan is preceded by `pnpm --filter @neumar/video-ir build` |
| Revision history grows without bound | storage metric and prune tests | bounded automatic retention and named pins |
| External masters disappear | media-health preflight | relink, consolidate, and render block |
| VAD confuses bleed with speech | calibration fixture and raw activity view | confidence threshold and wide fallback |
| Automatic edits feel mechanical | override rate and review feedback | proposals first, explicit cut reasons, editable policy |
| Repeated plan apply duplicates clips | same-plan replay test | plan ID plus review revision idempotency key |
| Multicamera scope displaces foundation work | phase exit dates slip or foundation gates are waived | preserve phase order and do not begin Phase 6 before Phase 4 exits |

## Throughput checkpoint

1. **Blocking first steps:** Phase 0 must establish fixtures. Phase 2 must lock
   timebase before multicamera artifacts exist.
2. **Independent workstreams:** after Phase 2, timeline performance, project
   recovery, and backend multicamera analysis can proceed independently.
3. **Shared mutable state:** Phase 3 and Phase 4 both touch timeline integration.
   Phase 5 and Phase 6 both touch Video types, API routes, and tool registration.
   Merge shared contracts before parallel branches begin.
4. **Smallest safe decomposition:** seven checkpoints. Package upgrade, timing,
   performance, recovery, analysis, and multicamera application each have a
   distinct rollback boundary and runtime test.

## Definition of done

The roadmap is complete when:

- all seven phase exit gates pass
- `pnpm test:fast` and `pnpm validate` pass on the final tree, and `pnpm test:all`
  passes once before the Train D release (not per checkpoint — it spawns
  Playwright and real-server E2E)
- no new React component exceeds the 350-line cap enforced by
  `pnpm check:component-size`
- required real-render and browser acceptance evidence is attached
- every new user-visible string exists in all six locales
- every new Video tool has permission and cost metadata
- project migration, conflict, recovery, and rollback behavior is documented
- the Video Mode runbook reflects the final implementation
- no feature flag hides the only copy of user data
- deferred work remains documented with a reason and a new evidence gate

## Plan readiness gate

Context: all seven phases are committed. Each has an independent output,
verification gate, and rollback boundary.

Question: Is this plan concrete enough to execute one checkpoint at a time?

- A. Begin Phase 0 with the recorded decisions and remaining defaults.
- B. Revise the priority, scope, or acceptance budgets.
- C. Reopen the committed multicamera scope before implementation reaches Phase
  5.

Decision: A. Begin Phase 0. The Apple Silicon reference-machine details must be
captured with the baseline, but they no longer block plan approval.
