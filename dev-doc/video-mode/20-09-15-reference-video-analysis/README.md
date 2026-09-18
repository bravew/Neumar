# Analyze Video: reference understanding → framework → template → apply

Date: 2026-09-15
Status: proposed implementation plan
Baseline: Neumar `b459bbf` (2026-09-13)
Primary reference: `_sample/hypit` (Hypit skill + `@hypit/video-cli` media toolset)

## The request

Give Video Mode a first-class **Analyze Video** capability. The user supplies a
video file, a YouTube link, or another social video link. Neumar then:

1. downloads (or attaches) the video and analyzes it;
2. reports the detailed steps and progress of that analysis as it happens;
3. produces a **framework** — a source-agnostic structural model of how the
   reference video is built;
4. turns that framework into a reusable **template**;
5. applies the template to any subsequent Video Mode editing task.

Those five outcomes map one-to-one onto Phases 1–2, 3, 5, 6 and 7 below.

## Why this plan, and why now

Two documents already point at this feature and neither delivered it:

- [`06-14-media-anaylyze/README.md`](../06-14-media-anaylyze/README.md) §"Video
  Architecture And Template Extraction" specified a `videoArchitecture`
  blueprint and a structure-only template flow. A repository-wide grep for
  `videoArchitecture` / `VideoArchitecture` across `src/`, `src-api/src/` and
  `packages/` returns nothing, so that section never landed. What *did* land
  from that plan is the deterministic tier: `analysis/transcript.ts`,
  `analysis/pack-transcript.ts`, `analysis/auto-cut.ts`,
  `analysis/frame-index.ts`, `analysis/source-range-evidence.ts`,
  `analysis/beats.ts`, `analysis/clip-grade.ts`.
- [`19-09-08-reference-upgrades/`](../19-09-08-reference-upgrades/) committed
  seven phases of foundation work (timebase, output range, timeline scale,
  recovery, multicamera). It deliberately did not touch reference-video
  understanding.

Meanwhile `_sample/hypit` contains a complete, coherent design for exactly this
workflow — a documented reading method, a local evidence toolset, a separation
between "reference truth" and "target truth", and a handoff into new direction.
Neumar already owns most of the primitives hypit's toolset is built from
(ffmpeg service, yt-dlp, transcription, filmstrips, durable agent plans,
templates, timeline ops). The gap is the **workflow and its artifacts**, not
the media plumbing.

This plan therefore imports hypit's *method* onto Neumar's existing
infrastructure rather than porting its packages.

## Scope

In scope:

- A `VideoReference` entity distinct from a project asset, with its own archive
  directory, rights record, and artifact chain.
- Real shot-boundary detection (today's is a stub — see
  [`02-current-state-and-gaps.md`](02-current-state-and-gaps.md)).
- Time-labeled frame grids with transcript word context, paginated, as agent
  evidence.
- A durable, resumable analysis run with a step ledger and streamed progress.
- Agent-authored `ReferenceAnalysis` (whole-piece) and `ReferenceTimeline`
  (time-locatable) artifacts, each carrying evidence paths and source times.
- A `VideoFramework` artifact: source-agnostic sections, roles, systems,
  pacing, and slots, with per-section confidence and provenance.
- Materialization of a framework into the existing `VideoTemplate` custom
  template format, so the whole template gallery, form mapper, and expansion
  path work unchanged.
- Slot binding and a proposed `TimelineOp[]` batch that applies a framework to
  the user's own assets, behind the existing approval boundary.

Out of scope for this cycle:

- Copying the reference's pixels into the output. The framework is structure
  only; see [`05-open-questions-and-rollout.md`](05-open-questions-and-rollout.md)
  §Rights.
- Multicamera interaction. The two artifact chains stay independent.
- A cloud reference library or cross-project framework sharing.
- Replacing `SourceMedia`/`SourceMediaAnalysis`, which stay the model for the
  user's *own* footage and cut planning.

## Phases

| # | Phase | Delivers | Depends on |
| --- | --- | --- | --- |
| 0 | [Spikes and fixtures](04-implementation-plan.md#phase-0--spikes-and-fixtures) | Measured answers on boundary detection, multi-site fetch, and grid cost; reusable fixtures | — |
| 1 | [Reference acquisition](04-implementation-plan.md#phase-1--reference-acquisition) | `VideoReference`, link/file intake, probe, rights record, archive layout | 0 |
| 2 | [Evidence toolset](04-implementation-plan.md#phase-2--evidence-toolset) | boundaries, tiles, cut, frames, transcript — cached artifacts + agent tools | 1 |
| 3 | [Analysis run and progress](04-implementation-plan.md#phase-3--analysis-run-and-progress) | Durable step ledger, SSE progress, Reference panel | 1, 2 |
| 4 | [Structured reading](04-implementation-plan.md#phase-4--structured-reading) | `ReferenceAnalysis` + `ReferenceTimeline` artifacts and their review UI | 2, 3 |
| 5 | [Framework extraction](04-implementation-plan.md#phase-5--framework-extraction) | `VideoFramework` artifact, source-agnostic, slotted, confidence-scored | 4 |
| 6 | [Template materialization](04-implementation-plan.md#phase-6--template-materialization) | Framework → `VideoTemplate` custom template + gallery entry | 5 |
| 7 | [Apply to an editing task](04-implementation-plan.md#phase-7--apply-to-an-editing-task) | Slot binding, proposed `TimelineOp[]` batch, preview, approval | 6 |

Phases 2 and 3 can proceed in parallel once Phase 1's data model lands.
Phases 5–7 are strictly sequential.

## Documents

| File | Purpose |
| --- | --- |
| [`01-reference-findings.md`](01-reference-findings.md) | What hypit does, file by file, and what is worth importing |
| [`02-current-state-and-gaps.md`](02-current-state-and-gaps.md) | Audited Neumar baseline: what exists, what is a stub, what is missing |
| [`03-data-model.md`](03-data-model.md) | Artifact chain, types, storage layout, cache invalidation |
| [`04-implementation-plan.md`](04-implementation-plan.md) | Eight checkpoints with files, observable results, tests, rollback |
| [`05-open-questions-and-rollout.md`](05-open-questions-and-rollout.md) | Rights, cost, flags, locales, telemetry, release gates, open questions |

## Product decisions assumed by this plan

These are the defaults the phases are written against. Revise them before the
affected phase begins rather than mid-phase.

- **A reference is not an asset.** Downloading a reference does not put it on
  the timeline and does not register it in `project.assets`. Promoting a
  reference to an asset is a separate, explicit, rights-gated action.
- **The framework is structure only.** It records section roles, durations,
  systems, pacing and slots. It never carries the reference's frames, audio, or
  verbatim script copy into a materialized template.
- **Deterministic evidence first, semantic reading second.** Probe, boundaries,
  transcript and grids are produced locally by ffmpeg and the existing
  transcription path. The semantic reading is the agent's, over that evidence.
- **The agent writes the reading; the system owns the evidence.** `ANALYSIS`
  and `TIMELINE` artifacts are agent-authored prose plus structured anchors.
  Neumar validates their anchors against real source times and evidence paths,
  and does not attempt to generate the prose deterministically.
- **Reuse the existing template format.** A framework materializes into
  `VideoTemplate` (`src-api/src/shared/video/templates/types.ts`) with
  `source: 'custom'`, so `gallery-loader.ts`, `form-mapper.ts`,
  `validator.ts`, `search.ts` and `agent-bridge.ts` need extension, not
  replacement.
- **Apply proposes, never mutates.** Phase 7 emits a `proposedActionBatch` of
  `TimelineOp`s through the existing approval boundary, matching
  `video_propose_timeline_ops` and the `video.agentApply` flag contract.
- **Ship behind one new flag** (`video.referenceAnalysis`, default off) with a
  second cost-bearing sub-flag for semantic passes. See
  [`05-open-questions-and-rollout.md`](05-open-questions-and-rollout.md).

## Repository conventions this plan must obey

Repeated from [`19-09-08-reference-upgrades/README.md`](../19-09-08-reference-upgrades/README.md)
because several phases add UI and agent tools that would otherwise trip them.

| Rule | Enforcement |
| --- | --- |
| React components stay at or below 350 lines | `pnpm check:component-size` inside `pnpm validate` |
| Run `pnpm exec oxfmt <file>` after editing any `src/` file; `pnpm --filter neumar-api exec oxfmt <file>` for API files | `pnpm format:check` inside `pnpm validate` |
| Every user-visible string lands in all six locales | `pnpm check:locale-parity`; Video strings live in `src/config/locale/messages/<lang>/video.ts` |
| Backend logging uses `createLogger()`, never `console.*` | oxlint config in `src-api/.oxlintrc.json` |
| Backend workspace root comes from `getSetting('workDir')`, never `process.cwd()` | convention; applies to every reference archive path |
| Every Video agent tool carries permission and cost metadata | `src-api/src/extensions/agent/video/permissions.ts` throws `Video tool "X" has no permission metadata.` |
| New feature flags go in both the `VideoFeatureFlag` union and `VIDEO_FEATURE_FLAG_DEFAULTS` **and** `snapshotVideoFeatureFlags()` | `src-api/src/shared/video/flags.ts`; the `satisfies Record<VideoFeatureFlag, boolean>` makes an omission a type error, but the snapshot function does not — check it by hand |
| Every filesystem path is validated | `validatePath()` from `@/shared/services/ffmpeg`, as `templates/custom-loader.ts` and `multicam/store.ts` already do |
| Every user-supplied URL is validated before fetch | `validateBaseUrlForFetch` / `safeFetch`, as `source/ytdlp.ts:14` and `source/ingest.ts` already do |

The Reference panel (Phase 3) and the framework review panel (Phase 5) are the
most likely to exceed the component-size cap. Plan their sub-component split
before writing them.

## Baseline verification

Run before Phase 0 and record the result in the phase's evidence directory.
`src-api` resolves `@neumar/video-ir` through its built `lib/`, so the package
must be rebuilt before any API subset run that follows a video-ir change.

```bash
pnpm --filter @neumar/video-ir build

pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/proxy.test.ts \
  test/integration/video-timeline-route.test.ts

pnpm --filter @neumar/video-ir test

pnpm validate
```

`graphify-out/` is not present in this working tree, so this audit used source
reads, `rg`, and Git history rather than the knowledge graph.
