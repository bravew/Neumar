# Open questions and rollout

## Rights

This is the decision that shapes the data model, so it is stated first and the
model follows it rather than the other way round.

**Position taken by this plan.** Studying a video is not publishing it.
Neumar downloads a reference in order to read it, keeps it in a project-local
archive that is not a publishable asset, and extracts a *structure* — section
roles, proportional timing, system lifecycles, pacing — that is deliberately
separable from the reference's expression. Nothing the user renders contains the
reference's frames, audio, or script unless they take a separate, explicit
action.

Mechanisms that enforce it:

| Mechanism | Phase | What it prevents |
| --- | --- | --- |
| A reference is not a `MediaItem` and is absent from `video_list_assets` | 1 | Accidentally cutting reference footage into an export |
| `rights.studyAcknowledged` required before any fetch | 1 | Silent bulk downloading |
| `rights.reuseAcknowledged` false by default, set only by explicit promotion | 1 | Reuse by default |
| `framework-lint.ts` fails on reference paths, hashes, data URIs, and verbatim transcript runs | 5 | A framework smuggling content out as structure |
| Materialization re-lints the produced template | 6 | A clean framework producing a dirty template |
| Structural thumbnail, never a reference frame | 6 | Redistributing a frame through the template gallery |
| Slot binding draws only from `project.assets` | 7 | Binding an unpromoted reference into a timeline |

Carried verbatim from [`06-14-media-anaylyze/README.md`](../06-14-media-anaylyze/README.md):

> The blueprint describes structure, not the original frames. Do not store or
> re-emit the source video's pixels as part of a template.
>
> Template reuse stays within the project's own assets and licensed/stock
> sources. Reproducing a layout is allowed; copying another creator's footage is
> not — keep this a structure-only transformation.

**Open question R1.** Does `studyAcknowledged` need to be per-reference, or once
per project, or a global setting? Per-reference is the assumption in Phase 1.
Recommended default: per-reference, with a project-level "don't ask again"
that still records the acknowledgement on each reference.

**Open question R2.** Should a framework's `provenance.referenceUrl` survive
into a shared template? It aids attribution and it leaks what the user studied.
Recommended default: keep it, and let the user clear it at materialization.

**Open question R3 (needs a decision, not a default).** Is there a class of
link Neumar should refuse to fetch outright — paywalled, DRM-protected, or a
platform whose terms forbid downloading? The yt-dlp layer will attempt whatever
its extractors support. Phase 0's S2 spike produces the actual list; the policy
decision belongs to the product owner before Phase 1 ships.

## Cost

Deterministic steps (fetch, probe, transcribe, boundaries, sample) are local and
cheap. The semantic steps are not.

| Step | Driver | Rough shape |
| --- | --- | --- |
| Reading (Phase 4) | Grid images × VLM input tokens, plus reasoning | Dominates. A 40 s reference at 1 s sampling with 480px cells is on the order of 40 images; at 0.25 s it is 160 |
| Framework extraction (Phase 5) | The reading as text, not images | Small relative to the reading |
| Slot binding (Phase 7) | Asset analysis, possibly frame search | Moderate, and already metered |

Controls:

- Phase 0's S3 spike sets the default sampling density from measured quality,
  not from a guess.
- The run ledger records a per-step cost estimate and the semantic steps route
  through the existing `cost-approval.ts` / `cost-estimator.ts` path, so a long
  reference asks before it spends.
- Evidence is fingerprint-cached, so re-reading a reference after a prompt tweak
  does not re-render grids.
- A duration ceiling on references (recommended default: 10 minutes) with an
  explicit override. Longer references are read in passages, which the artifact
  model already supports through overlapping timeline sections.

**Open question C1.** Should the reading run at a coarse density first and
refine only where the agent asks? That matches hypit's method — *"Continuously
adjust the viewed range, sampling interval and cell size to the question"* — and
would cut cost substantially, at the price of more round trips. Recommended
default: yes, coarse-then-refine, with the agent requesting refinements through
`video_reference_build_evidence`. Phase 3's ledger must then allow the sample
step to run more than once.

## Feature flags

Two new flags in `src-api/src/shared/video/flags.ts`. Both go in the union, the
`VIDEO_FEATURE_FLAG_DEFAULTS` object, **and** `snapshotVideoFeatureFlags()` —
the `satisfies` clause catches an omission in the defaults object but not in the
snapshot function.

| Flag | Default | Gates |
| --- | --- | --- |
| `video.referenceAnalysis` | `false` | The whole feature: references, evidence, run, reading, framework, materialization, apply |
| `video.referenceSemanticReading` | `false` | Only the cost-bearing semantic steps (Phases 4–5). Lets the deterministic evidence toolset ship and be exercised before any spend |

Both are opt-in, matching the treatment of the other cost-bearing flags
(`video.frameSearch`, `video.multicamAudioSync`). Flip to on-by-default only
after the release gates below are met.

The Phase 2 fix to `buildDeterministicAnalysis()` is **not** flagged. It corrects
a mislabeled signal on the existing `SourceMedia` path and must apply
unconditionally; it ships as its own commit.

## Locales

Every user-visible string lands in all six of
`src/config/locale/messages/{en,zh,es,fr,hi,pt}/video.ts`. The new surfaces:

- reference intake: source kinds, rights acknowledgement, supported-link help,
  the classified yt-dlp failure messages;
- run progress: seven step names, five statuses, elapsed, cancel/resume, the
  per-step note format;
- reading view: section phase labels, coverage, open questions, confidence;
- framework review: ten section roles, slot kinds, five fallback kinds,
  constraint labels;
- apply: slot binding, gap list, fallback cost, approve/reject.

`pnpm check:locale-parity` is in `pnpm validate` and will fail the checkpoint
otherwise. Section role names are user-visible and translated; role *ids* stay
English and stable, because they are data.

## Telemetry

Record per run, without any reference content:

- reference duration, whether it came from a link or a file, extractor key;
- per-step durations and failures by classified reason;
- evidence: grid count, total cells, total bytes, cache hit rate;
- reading: coverage fraction, thin-range share, section count, system count,
  mean confidence, number of validation rejections before acceptance;
- framework: section count, slot count, share of sections below the confidence
  floor, lint failures by class;
- apply: slots bound automatically, gaps, fallbacks used, batches approved
  versus rejected.

The validation-rejection and lint-failure counts are the two that matter most:
they say whether the reading method and the structure-only rule are actually
holding, or whether the agent is routinely working around them.

## Release gates

Before `video.referenceAnalysis` defaults on:

1. Phase 0's four spike documents exist with numbers, and the fixture set is
   reachable offline.
2. Boundary detection meets a stated precision/recall floor on the fixtures, or
   the feature ships with boundaries advisory-only and says so in the UI.
3. Ten real references across at least four platforms complete a full run end
   to end, with per-run cost recorded.
4. On those ten, mean reading coverage is above the extraction threshold and
   framework lint fails zero times.
5. A deliberately-poisoned framework (transcript pasted into a template field,
   reference path in a slot) fails lint with a named field, in a test.
6. Cancel-and-resume is proven on a killed API process without re-downloading,
   re-probing, or re-transcribing.
7. `pnpm validate`, `pnpm test:fast`, `pnpm --filter neumar-api lint`,
   `pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit`, and
   `pnpm --filter @neumar/video-ir test` all pass.
8. The Video Mode runbook (`dev-doc/runbooks/video-mode.md`) documents the
   reference workflow, the archive layout, and the rights posture.

## Remaining open questions

| # | Question | Recommended default |
| --- | --- | --- |
| Q1 | Should a reference be shareable across projects, or stay project-local? | Project-local. The *framework* and the *template* travel; the archive does not |
| Q2 | Can one framework be extracted from several references? | Not this cycle. One reference → one framework. Merging frameworks is a natural follow-up and the schema does not preclude it |
| Q3 | Should the reading support a user-supplied brief ("I care about the hook and the captions") that focuses the sampling? | Yes, and it is cheap: `video_record_research_brief` already exists. Fold it into Phase 3's run input |
| Q4 | Does the framework need to express audio structure beyond `bedCharacter` and ducking — stingers, risers, silence beats? | Not in the first increment. Add when a real reference needs it, rather than guessing the vocabulary |
| Q5 | Should framework-derived templates be publishable to the community gallery? | Not this cycle. `provenance-lint.ts` would need to prove structure-only across a template it did not extract |
| Q6 | How does this interact with the durable agent plan (`agent-plan.ts`)? Two ledgers now exist | Keep them separate: the run ledger is a system pipeline, the agent plan is the agent's intent. Link them by id and surface both. Revisit if users find the split confusing |
| Q7 | Should `SourceMedia` analysis adopt the Phase 2 labeled grids and boundaries? | Yes, and the modules are written to allow it, but as a separate follow-up so this cycle's blast radius stays bounded |
| Q8 | What happens to a reference when its project is deleted or exported? | Deleted with the project. Excluded from export by default, with an explicit opt-in — exporting a project should not redistribute someone else's video |

## Readiness

Phases 0–3 are concrete enough to execute as written. Phases 4–7 depend on
Phase 0's S3 result for their sampling defaults and on R3 for the acquisition
policy; both should be settled before Phase 1 ships rather than before Phase 4
begins, because the acquisition policy shapes the intake UI.

The riskiest single change is Phase 3's generalization of `job-events.ts`, which
touches the live render stream. It is isolated into its own commit with the
existing render-stream tests unchanged as the acceptance condition.
