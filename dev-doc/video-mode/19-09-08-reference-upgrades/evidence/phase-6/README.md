# Phase 6 acceptance evidence

Multicamera review, agent control, and interchange. Captured on 2026-09-08 on
the same Apple M4 Pro host as Phases 0 through 5.

## Results

| Activity | Result | Evidence |
| --- | --- | --- |
| Accept, reject, nudge, set camera, annotate | Passed | `review.test.ts` — each action bumps the review revision; a nudge takes time from the neighbour and is refused when it would collapse a shot |
| Applied as one named batch with inverse history | Passed | `multicam-edit.json` — `applies-as-one-batch`, six ops for six accepted shots |
| Camera-group and source-range provenance on created clips | Passed | Same report — `provenance-on-every-clip`, `source-times-offset-by-sync` |
| Repeating a plan id and review revision returns the prior result | Passed | Same report — `repeat-apply-returns-prior-result`, `batch-id-derived-not-random` |
| Nine tools, all classified | Passed | `tools.test.ts` — every name resolves permission and cost metadata; the lookup throws for an unclassified tool, so one would fail at runtime rather than ship open |
| Domain withheld with no camera group | Passed | Same suite — `shouldRegisterMulticamTools` is false for a project with no group, and false again with the flag off |
| Handoff carries angle, source time, sync, and plan provenance | Passed | `model-conformance.test.ts` — the fields reach the model and OTIO clip metadata |
| Review never touches the timeline | Passed | `video-multicam-analysis-routes.test.ts` — the timeline is byte-identical after accepting every shot |

## Commands

```bash
pnpm --filter @neumar/video-ir build
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/multicam/ \
  test/unit/video/editor-handoff/ \
  test/integration/video-multicam-analysis-routes.test.ts \
  test/integration/video-timeline-route.test.ts
node scripts/video-acceptance.mjs --fixture multicam-edit --engines all --json
pnpm test:fast
pnpm validate
```

23 acceptance checks pass on the `multicam-edit` fixture, 79 multicamera unit
tests, and 16 route tests.

## Why the batch id is derived rather than generated

The plan's requirement is that reapplying the same plan id and review revision
returns the prior result instead of duplicating clips. A generated UUID cannot
satisfy that — two applies would produce two ids and two sets of clips, and
nothing downstream could tell them apart.

The id is a hash of the manifest id, the plan fingerprint, and the review
revision. The same review applied twice produces the same id, which is what
makes a repeat recognisable. Making a further decision bumps the revision, so it
is a different batch: a repeat is a repeat, and an edit is an edit.

## One batch, not one op per shot

Undo has to take the whole cut back in a single step. Forty `clip.insert` ops
would mean forty presses of undo for a user who dislikes the result, which is
not an undo anyone would use.

## Provenance travels on the clip

Each created clip carries its camera group, angle, participant, plan batch id,
review revision, the planner's reason, the source time, and the sync offset and
drift that produced it. That is what lets a reviewer opening the project cold —
or an editor opening the OTIO export — say which angle a clip is and why it was
chosen, rather than seeing an anonymous run of cuts.

`buildApplyBatch` also offsets each clip's source time by its camera's sync, so
a shot at 2000ms of reference time reads from 2500ms of a camera that started
500ms late. Without that, every non-reference angle would play the wrong frames.

## Tool gating

The nine tools are withheld from a project with no camera group rather than
registered and answering "not applicable". `video-edit-server.ts` already names
121 `video_*` tools; nine more in every turn's context is a real cost for a
capability most projects never use.

Each handler still checks the flag independently, because a camera group can
exist while the feature is switched off, and the honest answer then is a typed
unavailable reason.

`video_multicam_preview_frame` is read-only but metered: rendering from a source
angle costs real decode work, and the agent should not loop on it for free.
Applying a plan is classified with the other timeline writes.

`video_multicam_get_transcript` reports `no-analysis` rather than returning an
empty list, because an empty list reads as "nobody said anything" — a different
and wrong claim.

## A test invariant that had to change, and why

`video-edit-server.test.ts` asserted that the set of classified tools equals the
set of always-registered tools. Conditional registration breaks that equality
without weakening what it protects. The assertion now compares against the
always-on list plus the multicamera domain, so both directions still hold:
nothing is classified that is not a real tool, and nothing is registered
unclassified.

## Not in this phase

- **The setup panel and the visual review surface are not built.** Every
  contract they need is in place and covered — manifest with readiness, sync
  offsets per camera, activity with raw probabilities, the plan with reasons and
  confidence, the review artifact with its revision, and preview-frame angle
  resolution — and the routes serve all of it. The React panels under
  `src/components/video/multicam/` are the remaining work, along with their
  locale strings and keyboard-only acceptance.
- **Social-range candidates and face-reaction cuts** are untouched. The plan
  puts them behind `video.multicamReactions` and after the primary cut review is
  reliable; that flag does not exist yet.
- **`video_multicam_set_policy` records a requested policy and says planning
  must re-run.** It does not silently re-plan underneath a reviewer, which would
  discard decisions they had already made.
- **The e2e spec** `src-api/test/e2e/video-multicam.e2e.test.ts` named in the
  plan's verification block is not written; the integration and acceptance
  coverage above stands in for it.

## Known baseline debt

Unchanged: `test/integration/api/agent.test.ts` fails on an incomplete
`getAgentRun` mock, `pipeline.ts` has two pre-existing `typecheck` errors, two
`analysis/*.ts` files have pre-existing unused-import lint errors, and the
untracked `VideoProjectFilePreview` work fails its own test. None are in the
multicamera path. The API suite is otherwise green at 528 files.
