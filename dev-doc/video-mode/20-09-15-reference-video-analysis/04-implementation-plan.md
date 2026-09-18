# Implementation plan

Eight checkpoints. Each states its goal, the files it likely touches, an
observable result a reviewer can check without reading the diff, its tests, its
verification commands, and its rollback boundary.

Every checkpoint ends with:

```bash
pnpm exec oxfmt <changed src/ files>
pnpm --filter neumar-api exec oxfmt <changed src-api/ files>
pnpm validate
```

`pnpm validate` does **not** run API lint, API test typechecking, or the shared
IR suite. Add them when the checkpoint touches those surfaces:

```bash
pnpm --filter neumar-api lint
pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit
pnpm --filter @neumar/video-ir build && pnpm --filter @neumar/video-ir test
```

Fixtures live in `src-api/test/fixtures/video/reference/` and are produced by
Phase 0. No checkpoint may depend on a network fetch in its tests.

---

## Phase 0 — Spikes and fixtures

**Goal.** Replace four assumptions with measurements before any of them is
built on. Produce the fixtures every later phase tests against.

### Spikes

| # | Question | Method | Decides |
| --- | --- | --- | --- |
| S1 | Does ffmpeg `scdet`/`select='gt(scene,t)'` produce usable boundary scores on real short-form video, and at what sample rate and cost? | Run against 6 fixture clips of different genres; compare candidates against hand-marked cuts; record precision/recall at thresholds 0.2/0.3/0.4 and rates 2/4/8 samples/s | Phase 2 detector, its defaults, and whether a second method is needed |
| S2 | Which link sources does the pinned yt-dlp actually reach from this machine, and what does each failure look like? | Attempt fetch against YouTube, TikTok, Instagram, Bilibili, X, Vimeo, a direct `.mp4`, and one geo/auth-gated link. Record extractor key, success, and the classified error | Phase 1's supported-source list and the error taxonomy shown to users |
| S3 | What grid density does a VLM need to produce a usable timeline section, and what does it cost? | For one 40 s reference, build grids at 0.25/0.5/1.0 s intervals and cell widths 320/480; have the agent produce a timeline section from each; score against a hand-written section | Phase 2 defaults and Phase 3's cost estimate |
| S4 | Does `transcribeSourceMedia()` hold up on non-English short-form with music under speech? | Run against zh, es, and en fixtures; record WER-ish spot checks and the `degraded` signal | Whether Phase 4 needs a language-confidence gate |

### Files

- `src-api/test/fixtures/video/reference/` — 6 clips, ≤30 s each, with
  `LICENSE.md` naming each clip's source and licence. Prefer CC0 / own capture.
  **No copyrighted reference bytes enter the repository.**
- `dev-doc/video-mode/20-09-15-reference-video-analysis/evidence/` — spike
  results: `s1-boundaries.md`, `s2-sources.md`, `s3-grid-density.md`,
  `s4-transcription.md`, each with the exact commands run.

### Observable result

Four evidence files with numbers in them, and a fixture directory that
`pnpm vitest run --config src-api/vitest.config.ts` can reach offline.

### Verification

```bash
pnpm --filter @neumar/video-ir build
pnpm vitest run --config src-api/vitest.config.ts test/unit/video/proxy.test.ts
pnpm validate
```

### Rollback

Documentation and fixtures only. Nothing to revert in product code.

---

## Phase 1 — Reference acquisition

**Goal.** A video file or a link becomes a `VideoReference` with a probed
archive, a rights record, and no presence in the asset list.

### Files

| File | Change |
| --- | --- |
| `src-api/src/shared/video/types.ts` | Add `VideoReference`, `ReferenceArtifactKind`, `ReferenceArtifactEnvelope`, `ReferenceProbe`; add `references?: VideoReference[]` to `VideoProject` |
| `src-api/src/shared/video/reference/store.ts` | **new** — archive paths, envelope read/write, atomic staging + rename, `assertSafeReferenceId()`. Modeled on `multicam/store.ts` |
| `src-api/src/shared/video/reference/acquire.ts` | **new** — `acquireReference()` for link / upload / workspace-path; probe; content hash; `info.json` capture |
| `src-api/src/shared/video/source/ytdlp.ts` | Generalize: extract the arg builder so a reference fetch can target the reference archive instead of `sources/<id>/`; surface `extractor` from `info.json`; keep `validateYtDlpUrl` on the path |
| `src-api/src/shared/video/store.ts` | `getVideoReferenceDir(projectId, referenceId)` beside `getVideoSourcesDir` |
| `src-api/src/shared/video/flags.ts` | Add `video.referenceAnalysis` to the union, `VIDEO_FEATURE_FLAG_DEFAULTS` (**false**), and `snapshotVideoFeatureFlags()` |
| `src-api/src/app/api/video.ts` | `POST /projects/:id/references` (link or file), `GET /projects/:id/references`, `GET /projects/:id/references/:refId`, `DELETE …`, `POST …/promote` |
| `src-api/src/shared/mcp/video-edit-server.ts` | `video_add_reference`, `video_list_references`, `video_get_reference` |
| `src-api/src/extensions/agent/video/permissions.ts` | `video_add_reference` → destructive (network + disk); the two reads → read |
| `src/config/locale/messages/{en,zh,es,fr,hi,pt}/video.ts` | Reference intake strings, all six locales |

### Decisions fixed here

- A reference fetch requires `rights.studyAcknowledged`. The API rejects
  without it; the UI collects it at intake.
- `rights.reuseAcknowledged` defaults false and is only set by the explicit
  promote action, which is the *only* path that creates a `MediaItem`.
- The reference is written under `references/<referenceId>/media/` and never
  into `assets/` or `sources/`.
- Format selection copies the shape already in `buildYtDlpArgs()`: video+audio
  muxed, `--no-playlist`, resolution/codec as a *sort preference* not a filter.
- yt-dlp stderr is never surfaced raw. Reuse `YtDlpErrorClassification`.

### Observable result

Paste a TikTok or YouTube link into a project; a reference appears in the
project with duration, dimensions, frame rate, audio presence, and its
extractor. `video_list_assets` and the asset browser show nothing new.
Deleting the reference removes its archive directory and nothing else.

### Tests

- `src-api/test/unit/video/reference-store.test.ts` — path validation rejects
  `../`, absolute paths, and unsafe ids; staging directory is removed on a
  write failure; an envelope round-trips.
- `src-api/test/unit/video/reference-acquire.test.ts` — with the downloader
  stubbed: link/upload/workspace-path all produce a probed reference; a fetch
  without `studyAcknowledged` throws; a classified yt-dlp failure never leaks
  stderr.
- `src-api/test/integration/video-reference-routes.test.ts` — CRUD, flag-off
  returns 404/403, promote creates exactly one `MediaItem` and sets
  `reuseAcknowledged`.
- `src-api/test/unit/video/flags.test.ts` — extend for the new flag.

### Verification

```bash
pnpm --filter @neumar/video-ir build
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/reference-store.test.ts \
  test/unit/video/reference-acquire.test.ts \
  test/unit/video/flags.test.ts \
  test/integration/video-reference-routes.test.ts
pnpm --filter neumar-api lint
pnpm validate
```

### Rollback

Flag off hides the routes, tools, and UI. The `references[]` field is optional
and ignored by every existing reader.

---

## Phase 2 — Evidence toolset

**Goal.** Turn a reference into time-labeled, word-labeled, cacheable evidence,
and replace the scene-detection stub with a real, honestly-labeled signal.

### Files

| File | Change |
| --- | --- |
| `src-api/src/shared/video/analysis/boundaries.ts` | **new** — `detectBoundaries(mediaPath, { sampleRate, threshold })` → `BoundaryCandidate[]` via ffmpeg; carries the non-editorial caveat in its payload |
| `src-api/src/shared/video/analysis/labeled-frames.ts` | **new** — time labels and word labels drawn *below* the picture; cell width, columns, rows; pagination; atomic staging |
| `src-api/src/shared/video/analysis/source-range-evidence.ts` | Extend: lift `MAX_FRAME_COUNT = 8` and `FILMSTRIP_FRAME_WIDTH = 160` into caller-supplied bounds; delegate drawing to `labeled-frames.ts`; keep the existing unlabeled path working |
| `src-api/src/shared/video/analysis/phrase-range.ts` | **new** — `--around`-equivalent: resolve a spoken phrase + occurrence + padding to a time range from `TranscriptData.words` |
| `src-api/src/shared/video/reference/evidence.ts` | **new** — `buildEvidence()` orchestration, `EvidenceItem` index, content-hash cache keys |
| `src-api/src/shared/video/store.ts` | **Fix gap 1**: `buildDeterministicAnalysis()` stops emitting two fabricated scenes labeled `method: 'ffmpeg-scdet'`. Either call the real detector or emit `scenes: []`. It must not claim a method it did not run |
| `src-api/src/app/api/video.ts` | `POST /projects/:id/references/:refId/boundaries`, `…/evidence`, `GET …/evidence` |
| `src-api/src/shared/mcp/video-edit-server.ts` | `video_reference_probe`, `video_reference_transcribe`, `video_reference_boundaries`, `video_reference_build_evidence`, `video_reference_read_evidence` |
| `src-api/src/extensions/agent/video/permissions.ts` | Metadata for all five; transcribe and evidence are metered |

### Design notes

- Word labels go **below** the picture so the reference's own captions and motion
  graphics stay readable. This is not cosmetic; it is why the evidence works.
- `buildEvidence()` returns `sampledAtMs` in its result. The agent tool response
  includes it, so a reading cannot silently over-claim.
- Every evidence write stages into `mkdtemp` beside the target and `rename`s;
  any failure removes the staging directory. A destination that already exists
  is an error, not an overwrite.
- Boundary scores are returned with the verbatim caveat string. The tool
  description repeats it.
- The detector and the labeled-frame builder take a plain media path, so
  `SourceMedia` analysis can adopt them without depending on the reference
  model.

### Observable result

For a reference: a boundaries call returns scored candidates with the caveat; an
evidence call with `{ around: "the phrase", padding: 0.4, every: 0.1, columns: 4, cell: 480 }`
writes paginated grids with readable source times and words under each cell, and
returns their paths plus the sampled times. Re-running the identical call is a
cache hit and writes nothing.

`rg "method: 'ffmpeg-scdet'"` over `src-api/src/shared/video/store.ts` returns
nothing unless the detector actually ran.

### Tests

- `src-api/test/unit/video/boundaries.test.ts` — against Phase 0 fixtures:
  candidate count is monotonic in threshold; a still fixture yields none; a
  hard-cut fixture yields a candidate within 100 ms of each known cut.
- `src-api/test/unit/video/labeled-frames.test.ts` — grid geometry, pagination
  boundaries, label placement below the picture, atomic staging cleanup on
  failure, refusal to overwrite.
- `src-api/test/unit/video/phrase-range.test.ts` — occurrence selection,
  padding clamped at media bounds, a missing phrase is a typed error.
- `src-api/test/unit/video/reference-evidence.test.ts` — cache hit/miss by
  fingerprint; `sampledAtMs` present and ordered.
- `src-api/test/unit/video/auto-cut-store.test.ts` — update for the stub removal.
- `src-api/test/integration/video-reference-evidence-routes.test.ts`.

### Verification

```bash
pnpm --filter @neumar/video-ir build
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/boundaries.test.ts \
  test/unit/video/labeled-frames.test.ts \
  test/unit/video/phrase-range.test.ts \
  test/unit/video/reference-evidence.test.ts \
  test/unit/video/auto-cut-store.test.ts \
  test/integration/video-reference-evidence-routes.test.ts
pnpm --filter neumar-api lint
pnpm validate
```

### Rollback

Behind the same flag. The `store.ts` stub fix is the one change that also
affects the existing `SourceMedia` path — ship it as its own commit so it can be
reverted independently.

---

## Phase 3 — Analysis run and progress

**Goal.** Requirement 2. A durable, resumable, inspectable ledger of analysis
stages with streamed progress and a readable panel.

### Files

| File | Change |
| --- | --- |
| `src-api/src/shared/video/reference/run.ts` | **new** — `ReferenceRun` with ordered `ReferenceRunStep[]`: `fetch → probe → transcribe → boundaries → sample → read → extract`. Each step: `status`, `startedAt`, `endedAt`, `producedArtifactIds`, `costEstimate`, `error`, `note` |
| `src-api/src/shared/video/jobs.ts` | Add a third job kind, `reference-analysis`, alongside render and editor-handoff; participate in `recoverInterruptedJobs()` and `drainVideoJobs()` |
| `src-api/src/shared/video/job-events.ts` | Generalize the stream: keep `RenderStreamEvent` and its route intact, extract the sequence/replay/buffer mechanism so a reference run can publish on its own channel |
| `src-api/src/shared/video/reference/progress-markdown.ts` | **new** — render the ledger to `PROGRESS.md` in the archive, modeled on `renderVideoAgentPlanMarkdown()` |
| `src-api/src/app/api/video.ts` | `POST /projects/:id/references/:refId/analyze`, `GET …/run`, `GET …/run/stream` (SSE), `POST …/run/cancel`, `POST …/run/resume` |
| `src/components/video/reference/ReferenceRunProgress.tsx` | **new** — step list with status, elapsed, produced artifact, and per-step error |
| `src/components/video/reference/ReferencePanel.tsx` | **new** — intake, reference list, run progress, artifact links. Split into sub-components from the start; the 350-line cap is easy to breach here |
| `src/app/pages/VideoMode/VideoProjectView.tsx` | Mount the panel behind the flag |
| `src/config/locale/messages/{en,zh,es,fr,hi,pt}/video.ts` | Step names, statuses, error copy |

### Design notes

- A step is either deterministic (system-owned, resumable, idempotent) or
  semantic (agent-owned, metered, may need approval). The ledger records which,
  and the cost approval path reuses `cost-approval.ts` / `cost-estimator.ts`.
- Resume restarts at the first non-`done` step, reusing every completed
  artifact. A cancelled run keeps what it finished — the same discipline
  `multicam/store.ts` documents.
- Progress narration is specific: not "analyzing", but "sampling 0–12 s at 1 s
  into a 4×3 grid (page 1 of 2)". The step's `note` carries it and the panel
  shows it. This is the user-visible half of requirement 2.
- `PROGRESS.md` is rewritten, not appended. It is a photograph of now.

### Observable result

Start an analysis on a 40 s reference. The panel lists seven steps; each turns
running then done with elapsed time and a link to what it produced; the picture
updates without a refresh. Kill the API mid-run and restart: the run resumes at
the first unfinished step and does not re-download, re-probe, or re-transcribe.
Cancel mid-run: finished artifacts remain and the panel says which step stopped.

### Tests

- `src-api/test/unit/video/reference-run.test.ts` — step ordering, resume from
  each step, cancel semantics, idempotent re-entry, error capture.
- `src-api/test/unit/video/reference-progress-markdown.test.ts` — snapshot.
- `src-api/test/integration/video-reference-run-routes.test.ts` — SSE emits in
  order with usable sequence bounds; replay after reconnect; cancel and resume.
- `src/__tests__/video/ReferenceRunProgress.test.tsx` — renders each status,
  shows a step error without collapsing the list.
- Extend `src-api/test/unit/video/jobs*.test.ts` for the third job kind.

### Verification

```bash
pnpm --filter @neumar/video-ir build
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/reference-run.test.ts \
  test/unit/video/reference-progress-markdown.test.ts \
  test/integration/video-reference-run-routes.test.ts
pnpm vitest run src/__tests__/video/ReferenceRunProgress.test.tsx
pnpm check:locale-parity
pnpm check:component-size
pnpm validate
```

### Rollback

The `job-events.ts` generalization is the risky part: it touches the live render
stream. Ship it as a separate commit that keeps `RenderStreamEvent` and its route
byte-identical, with the existing render-stream tests unchanged and passing.

---

## Phase 4 — Structured reading

**Goal.** The agent produces a whole-piece model and a time-locatable
realization account over the Phase 2 evidence, and the system validates both
against real times and real evidence.

### Files

| File | Change |
| --- | --- |
| `src-api/src/shared/video/types.ts` | `ReferenceAnalysis`, `ReferenceSystem`, `ReferenceTimelineSection`, `ReferenceTimelineArtifact` |
| `src-api/src/shared/video/reference/reading-schema.ts` | **new** — zod schemas, modeled on `templates/validator.ts` |
| `src-api/src/shared/video/reference/reading-validate.ts` | **new** — anchor validation: times in range, evidence resolves and overlaps the claim, system ids resolve, coverage/`thinRanges` consistent, confidence present. Typed errors naming the offending anchor |
| `src-api/src/shared/video/reference/reading-prompt.ts` | **new** — the reading method as a versioned system prompt. Carries hypit's operative rules: whole ↔ close, the seven-field section shape, entry/behavior/persistence/exit, observed vs inferred, samples bound claims, viewing chrome is not content |
| `src-api/src/shared/video/reference/markdown.ts` | **new** — render `ANALYSIS.md` and `TIMELINE.md` from the JSON |
| `src-api/src/shared/mcp/video-edit-server.ts` | `video_reference_write_analysis`, `video_reference_write_timeline`, `video_reference_get_reading` |
| `src-api/src/extensions/agent/video/permissions.ts` | The two writes → write; the read → read |
| `src-api/src/extensions/agent/video/system-prompt.ts` | Point the agent at the reading loop when a reference run is active |
| `src/components/video/reference/ReferenceReadingView.tsx` | **new** — sections on a time ruler, evidence thumbnails, coverage bar, open questions, confidence |

### Design notes

- The agent writes; Neumar validates. A rejected write returns the failing
  anchor, and the agent fixes it — the same loop `templates/validator.ts`
  already creates for templates.
- `promptVersion` is part of the reading fingerprint. Changing the method marks
  existing readings stale rather than silently mixing two methods.
- `coverage.thinRanges` is computed from `EvidenceItem.sampledAtMs`, not
  self-reported. An agent cannot claim density it did not sample.
- Observed and inferred stay in separate arrays, per hypit's rule: *"State what
  is visible or audible separately from what you infer it means."*

### Observable result

After a run on a 40 s reference: a readable analysis naming its intent, arc,
thesis and 4–8 systems with lifecycles; a timeline of 6–12 sections each with a
phase name, an anchor, active systems, an effect on the viewer, and evidence
links; a coverage bar showing which ranges are thinly sampled; a list of open
questions with source times. Rendered `ANALYSIS.md` / `TIMELINE.md` sit beside
the JSON and read like the worked example in
[`01-reference-findings.md`](01-reference-findings.md).

### Tests

- `src-api/test/unit/video/reference-reading-validate.test.ts` — each rejection
  case: out-of-range time, evidence that does not overlap the claim, unknown
  system id, understated `thinRanges`, missing confidence.
- `src-api/test/unit/video/reference-markdown.test.ts` — snapshot against a
  fixture reading.
- `src-api/test/unit/video/reference-reading-fingerprint.test.ts` — a prompt
  version bump marks downstream stale without deleting it.
- `src/__tests__/video/ReferenceReadingView.test.tsx`.

### Verification

```bash
pnpm --filter @neumar/video-ir build
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/reference-reading-validate.test.ts \
  test/unit/video/reference-markdown.test.ts \
  test/unit/video/reference-reading-fingerprint.test.ts
pnpm vitest run src/__tests__/video/ReferenceReadingView.test.tsx
pnpm check:component-size && pnpm check:locale-parity
pnpm validate
```

### Rollback

Additive. Flag off removes the tools and the view; the artifacts are inert data.

---

## Phase 5 — Framework extraction

**Goal.** Requirement 3. Turn the reading into a `VideoFramework`: sections with
roles, relative timing, typed slots, spanning systems, pacing, and confidence —
with nothing of the reference's content in it.

### Files

| File | Change |
| --- | --- |
| `src-api/src/shared/video/types.ts` | `VideoFramework`, `FrameworkSection`, `FrameworkSectionRole`, `FrameworkSlot`, `FrameworkSystem` |
| `src-api/src/shared/video/reference/framework-schema.ts` | **new** — zod schemas |
| `src-api/src/shared/video/reference/framework-extract.ts` | **new** — agent-driven extraction over the reading, with deterministic post-processing: normalize `timing.proportion` to sum to 1, derive `pacing` from boundaries, propagate `derivedFromSectionIds`, set framework `confidence` to the minimum section confidence |
| `src-api/src/shared/video/reference/framework-lint.ts` | **new** — structure-only enforcement. **Fails** on: any reference archive path, any reference `contentHash`, any base64/data URI, or a verbatim transcript run above the token threshold in any `purpose`/`promptTemplate`/`textTemplate` |
| `src-api/src/shared/video/templates/provenance-lint.ts` | Extend to recognize framework-derived provenance |
| `src-api/src/shared/mcp/video-edit-server.ts` | `video_extract_framework`, `video_get_framework`, `video_revise_framework` |
| `src-api/src/app/api/video.ts` | `POST /projects/:id/references/:refId/framework`, `GET …`, `PATCH …` |
| `src/components/video/reference/FrameworkReviewPanel.tsx` | **new** — section list with role, proportion bar, slots, spanning systems, per-section confidence, inline correction |

### Design notes

- Extraction refuses to run when the reading's coverage is below a configured
  threshold or when more than a configured share of sections sit below a
  confidence floor. A framework built on a thin reading is worse than none,
  because everything downstream trusts it.
- Slot `fallback` reuses the `VideoTemplateAssetPlan` vocabulary
  (`generate-image`, `generate-clip`, `broll-search`, `tts-narration`) so Phase 6
  materialization is a mapping, not a translation. `ask-user` is the fifth case
  the template type does not have.
- Timing is relative. `proportion` plus `minMs`/`maxMs` lets a 34 s reference
  drive a 60 s target. `observedMs` is kept for explanation only and is never
  used as a target duration.
- The user can correct a section role, merge two sections, split one, or change
  a slot constraint before anything is materialized. Correction is the point of
  the review panel — hypit's guardrail: *"Confidence and evidence accompany each
  section so the user can correct a mis-segmented blueprint before it drives
  edits."*

### Observable result

From the Phase 4 reading: a framework with 5–9 roled sections whose proportions
sum to 1, each with 1–4 typed slots and a stated fallback; systems that span
the sections they actually span; a pacing figure per section; and a lint pass
that a deliberately-poisoned framework (transcript text pasted into a
`textTemplate`) fails with a named field.

### Tests

- `src-api/test/unit/video/framework-extract.test.ts` — proportions normalize;
  pacing derives from boundaries; low coverage refuses; low confidence refuses.
- `src-api/test/unit/video/framework-lint.test.ts` — each failure class, plus a
  clean framework passing.
- `src-api/test/unit/video/framework-schema.test.ts` — round-trip and rejection.
- `src/__tests__/video/FrameworkReviewPanel.test.tsx` — correction flow.

### Verification

```bash
pnpm --filter @neumar/video-ir build
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/framework-extract.test.ts \
  test/unit/video/framework-lint.test.ts \
  test/unit/video/framework-schema.test.ts
pnpm vitest run src/__tests__/video/FrameworkReviewPanel.test.tsx
pnpm check:component-size && pnpm check:locale-parity
pnpm validate
```

### Rollback

Additive. The lint is the one thing that must not be weakened to get a
checkpoint green; if a real framework fails it, fix the extractor.

---

## Phase 6 — Template materialization

**Goal.** Requirement 4. A reviewed framework becomes a real `VideoTemplate`
with `source: 'custom'`, visible in the gallery, expandable through the existing
form mapper.

### Files

| File | Change |
| --- | --- |
| `src-api/src/shared/video/templates/types.ts` | Add `framework?: VideoFramework` and a `frameworkProvenance` block to `VideoTemplate`; extend `VideoTemplateSceneSeed` with an optional `slotId` and `role` |
| `src-api/src/shared/video/reference/materialize.ts` | **new** — `frameworkToTemplate()`: sections → `storyboardSeed.scenes[]`, slots → `inputs[]` and `assetPlan` fallbacks, systems → `styleDefaults` + bookends, `totalDuration` → `durationSec`, role/hook/pace/category carried over |
| `src-api/src/shared/video/templates/validator.ts` | Extend `VideoTemplateSchema` for the new optional fields |
| `src-api/src/shared/video/templates/custom-loader.ts` | Unchanged if the schema extension is clean — verify `saveCustomTemplate()` round-trips a framework-bearing template |
| `src-api/src/shared/video/templates/form-mapper.ts` | Slot-derived inputs get correct kinds, labels, and `required` |
| `src-api/src/shared/video/templates/search.ts` | Make framework-derived templates findable by role and by source reference |
| `src-api/src/shared/video/reference/thumbnail.ts` | **new** — a **structural** thumbnail: a generated section-proportion diagram, **not** a reference frame |
| `src-api/src/shared/mcp/video-edit-server.ts` | `video_materialize_framework_template` |
| `src/components/video/TemplatePicker.tsx`, `TemplateInlinePicker.tsx` | Show the framework badge and its source reference |

### Design notes

- The thumbnail must not be a frame from the reference. A structural diagram of
  section proportions and roles is both legally clean and more informative in a
  gallery of structures.
- Materialization runs `framework-lint.ts` again on the produced template, not
  only on the framework. A clean framework can still produce a dirty template if
  a template path leaks a reference asset.
- `frameworkProvenance` records `referenceId`, `referenceUrl`, `extractedAt`,
  and `extractedBy` so `provenance-lint.ts` can state where a template came
  from. A user sharing a template shares the framework, never the reference.
- A framework-derived template sits in `getVideoRoot()/templates/` like any other
  custom template, so it is available to every project. The framework and the
  reference archive stay project-local.

### Observable result

Click "Save as template" on a reviewed framework. The template appears in the
gallery with a structural thumbnail, a framework badge, and typed inputs derived
from its slots. `video_search_templates` finds it. `video_select_template` and
the existing expansion path work on it unchanged. The template JSON contains no
path, hash, frame, or verbatim transcript from the reference.

### Tests

- `src-api/test/unit/video/framework-materialize.test.ts` — sections map to
  scenes with correct durations from `proportion × target`; slots map to typed
  inputs; required slots become required inputs; fallbacks map to the right
  `VideoTemplateAssetPlan` variant; `ask-user` becomes a required input.
- `src-api/test/unit/video/template-validator.test.ts` — extend for the new
  fields, and prove an old template still validates.
- `src-api/test/unit/video/framework-lint.test.ts` — extend to the materialized
  template.
- `src/__tests__/video/TemplatePicker.test.tsx` — framework badge.

### Verification

```bash
pnpm --filter @neumar/video-ir build
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/framework-materialize.test.ts \
  test/unit/video/template-validator.test.ts \
  test/unit/video/framework-lint.test.ts
pnpm vitest run src/__tests__/video/TemplatePicker.test.tsx
pnpm check:component-size && pnpm check:locale-parity
pnpm validate
```

### Rollback

All new `VideoTemplate` fields are optional, so existing templates and the
builtin gallery are unaffected. The regression to guard is schema strictness —
keep a pre-existing builtin template in the validator test.

---

## Phase 7 — Apply to an editing task

**Goal.** Requirement 5. Bind the user's own assets into a framework's slots and
propose a timeline, behind the existing approval boundary.

### Files

| File | Change |
| --- | --- |
| `src-api/src/shared/video/reference/bind.ts` | **new** — `bindFrameworkSlots()`: for each slot, rank the project's assets against its constraints using `analyzeProjectAssets`, `searchProjectFrames` (when `video.frameSearch` is on), transcript/speech presence, duration, aspect, and motion. Return ranked candidates with a reason per candidate |
| `src-api/src/shared/video/reference/apply.ts` | **new** — `frameworkToTimelineOps()`: bound slots + target duration → a `proposedActionBatch` of `TimelineOp`s. Modeled on `multicam/apply.ts` |
| `src-api/src/shared/video/reference/gap-report.ts` | **new** — unfilled required slots, with the fallback that would fill each and its cost |
| `src-api/src/shared/mcp/video-edit-server.ts` | `video_bind_framework`, `video_preview_framework_apply`, `video_apply_framework` |
| `src-api/src/extensions/agent/video/permissions.ts` | bind/preview → read; apply → destructive, and it must respect `video.agentApply` exactly as `video_propose_timeline_ops` does |
| `src-api/src/app/api/video.ts` | `POST /projects/:id/frameworks/:fid/bind`, `…/preview`, `…/apply` |
| `src/components/video/reference/FrameworkApplyPanel.tsx` | **new** — slot → chosen asset with alternatives, gap list with fallback cost, diff preview, approve |
| `src/components/video/TimelineOpDiffPanels.tsx` | Reuse for the proposed batch |

### Design notes

- Apply **proposes**. The batch goes through the same approval path as
  `video_propose_timeline_ops`, carries `expectedProjectRevision`, and is
  rejected on conflict with the existing
  `Project revision conflict: plan expects N, current M` message that
  `AgentPlanPanel.tsx` already surfaces.
- Target duration is the user's, not the reference's. Section durations come
  from `proportion × targetMs`, clamped to `minMs`/`maxMs`, with the remainder
  distributed across the sections whose clamps left slack.
- Unfilled required slots block apply until each is bound, waived, or filled by
  its fallback. Cost-bearing fallbacks route through `cost-approval.ts`.
- Binding never reaches into the reference archive. If the framework's systems
  need a caption style or a font, they come from the framework's `style` block
  or the project's brand kit.
- A framework applies to the user's own assets and licensed stock. It is the one
  place where an accidental "use the reference's clip" would be easy; the
  binder's candidate source is `project.assets` only, and a reference that has
  not been promoted is not in it.

### Observable result

Pick a framework-derived template on a project with 30 of the user's clips. The
panel shows each slot with a chosen clip, a stated reason, and alternatives; two
required slots are unfilled with a b-roll-search fallback and its cost; approving
produces a timeline that follows the framework's section order, proportional
durations and pacing, using only the user's media. Rejecting changes nothing.

### Tests

- `src-api/test/unit/video/framework-bind.test.ts` — constraint filtering,
  ranking stability, a slot with no candidate reports a gap rather than binding
  a bad asset.
- `src-api/test/unit/video/framework-apply.test.ts` — proportional duration
  distribution including clamp remainder; ops are well-formed and invertible;
  a revision conflict rejects.
- `src-api/test/unit/video/framework-gap-report.test.ts`.
- `src-api/test/integration/video-framework-apply-routes.test.ts` — flag-off
  behavior, proposal-only mode, approval path.
- `src/__tests__/video/FrameworkApplyPanel.test.tsx`.

### Verification

```bash
pnpm --filter @neumar/video-ir build
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/framework-bind.test.ts \
  test/unit/video/framework-apply.test.ts \
  test/unit/video/framework-gap-report.test.ts \
  test/integration/video-framework-apply-routes.test.ts
pnpm vitest run src/__tests__/video/FrameworkApplyPanel.test.tsx
pnpm check:component-size && pnpm check:locale-parity
pnpm --filter neumar-api lint
pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit
pnpm test:fast
pnpm validate
```

### Rollback

Behind both `video.referenceAnalysis` and the existing `video.agentApply`
contract. No timeline mutation happens without an approved batch, so a rollback
leaves no half-applied edits.

---

## Cross-phase checklist

Before any checkpoint is handed back:

- [ ] Call path and affected consumers understood; scope matches the checkpoint.
- [ ] New flag present in all three places in `flags.ts`.
- [ ] Every new agent tool has permission **and** cost metadata, or startup throws.
- [ ] Every new filesystem path goes through `validatePath()`; ids validated
      before they touch a path.
- [ ] Every new URL goes through `validateBaseUrlForFetch` / `safeFetch`.
- [ ] No `console.*` in `src-api/`; `createLogger()` only.
- [ ] Workspace root from `getSetting('workDir')`, never `process.cwd()`.
- [ ] All six locales updated; `pnpm check:locale-parity` passes.
- [ ] No component over 350 lines; no allowlist ceiling raised.
- [ ] Edited files formatted with the owning workspace's `oxfmt`.
- [ ] `git diff --check` clean; no fixtures, caches, `graphify-out/`, or
      machine-specific paths in the diff.
- [ ] Committed locally on a branch with a Conventional Commits message.
