# Phase 5 acceptance evidence

Multicamera foundation. Captured on 2026-09-08 on the same Apple M4 Pro host as
Phases 0 through 4.

## Results

| Fixture assertion | Result | Evidence |
| --- | --- | --- |
| Offset error at or below one project frame | Passed | `multicam-analysis.json` — `{cam-wide: 0, cam-ana: 6, cam-ben: -4}`, all within one frame of the manifest offsets |
| Reference camera is zero by definition | Passed | Same report — `cam-wide` offset 0, method `reference` |
| Silence falls back to wide | Passed | First shot is `cam-wide` with reason `silence` |
| Overlap follows the selected policy | Passed | The 18–20s crosstalk holds the wide with reason `overlap-wide` |
| No shot shorter than policy unless it carries a reason | Passed | Every shot is at or above `minShotMs`, or labelled `min-shot` |
| Jump-cut prohibition holds | Passed | `shot-plan.test.ts` — a same-participant angle change holds the previous angle |
| Artifact fingerprint invalidates after a source changes | Passed | `drift.test.ts` — swapping an asset behind the same camera id changes the fingerprint; a label change does not |
| Analysis is deterministic | Passed | The chain runs twice per acceptance run and the artifacts are byte-identical |
| Read-only with respect to the timeline | Passed | `video-multicam-analysis-routes.test.ts` — the timeline is unchanged after reading every artifact |

## Commands

```bash
pnpm -C packages/video-ir test
pnpm --filter @neumar/video-ir build
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/multicam/ \
  test/integration/video-multicam-analysis-routes.test.ts
node scripts/video-acceptance.mjs --fixture multicam-analysis --json
```

47 multicamera unit tests and 12 route tests pass, plus 15 acceptance checks.

## What the plan asked to avoid, and what was done instead

The plan is explicit that this is not a port of OpenReel's manifest handling.
Two differences carry real weight:

**Errors are Zod issues, not an accumulated `errors: string[]`.** A caller gets
a path — `['cameras', 1, 'participantId']` — instead of a prose list it has to
re-parse to find out which camera is wrong. The tests assert the paths, not the
messages.

**The manifest has no `fps`.** A camera group inherits the project timebase
locked in Phase 2. A per-manifest rate is exactly how a sync artifact and the
timeline come to disagree about what a frame is, and `manifest.test.ts` asserts
that neither `fps` nor `frameRate` appears on a parsed manifest.

## Manual-only groups are a readiness state, not an error

A two-camera interview with no isolated microphones is a legitimate manifest —
it can be cut by hand. It is not automatic-ready, so `manifestReadiness()`
returns blockers naming what is missing, and the schema still accepts it. The
routes surface readiness alongside every manifest so the UI can offer manual
mode rather than refusing the group.

## Drift is fitted, not assumed

One observation can only ever be a fixed offset. Assuming that for a long
recording is the classic multicamera failure: two cameras start in sync, their
clocks differ by a few parts per million, and by the end of an hour the cut
lands a frame or two late. `fitDrift()` returns a least-squares line through
every observation, so the slope is recovered when the data supports it — and
`drift.test.ts` asserts it does not invent a slope from a single sample, or from
several samples taken at the same instant.

## Bleed correction is gated on calibration confidence

Leakage is measured only from windows where exactly one participant is clearly
speaking: whatever the other microphones register in those windows is bleed by
definition. When a recording has no such windows — everyone always talks at once
— confidence comes back at zero and correction is skipped rather than guessed
at. Subtracting a guess from a real signal is how a quiet speaker gets cut out
of their own shot.

Raw probabilities survive on every frame regardless of whether correction ran,
so the decision stays auditable and reversible.

## Determinism, and why it matters here

The planner has no clock and no randomness, and every overlap tie breaks by
participant id rather than input order — `shot-plan.test.ts` runs the same
ranges forwards and reversed and asserts identical output. That is what makes
the artifacts fingerprintable, which in turn is what lets a cancelled run resume
from the artifacts that are still valid instead of starting over.

A stale artifact is labelled, not deleted. The plan route returns
`stale: true` and still serves the shots, because a reviewer should be able to
see what the last run concluded.

## Sequencing note

`buildShotPlan()` returns shots. It does not build a `TimelineOpBatch` and it
does not touch a timeline — the plan's item 9 says to store the plan without
applying it, and applying a reviewed plan is Phase 6's job through the ordinary
timeline op path with its own permission gate. The acceptance report asserts
`timelineTouched: false`, and a route test compares the timeline before and
after reading every artifact.

## Not in this phase

- **VAD and audio extraction are not wired to real media.** The activity
  contract, bleed calibration, hysteresis, and speech-range derivation are
  implemented and tested against deterministic probability windows. Extracting
  mono analysis audio through the FFmpeg executor and running a real detector as
  a cancellable, resumable Video job is the remaining half of the plan's item 5;
  the artifact chain it would write into is in place.
- **Timecode and audio-correlation sync are contracts, not implementations.**
  `buildSyncMap()` accepts observations from either and fits them; nothing yet
  produces those observations from media. Manual offsets, which the plan says to
  implement first, work end to end. `video.multicamAudioSync` is off by default
  as the plan requires.
- **Participant-scoped transcript ranges** are not wired to the existing local
  transcription path.

`video.multicam` is off by default. With it off every route returns a typed
`feature-disabled` reason rather than a bare 404, so a client can tell "not
enabled" from "not found".

## Known baseline debt

Unchanged: `test/integration/api/agent.test.ts` fails on an incomplete
`getAgentRun` mock, `pipeline.ts` has two pre-existing `typecheck` errors, and
two `analysis/*.ts` files have pre-existing unused-import lint errors. None are
in the multicamera path.
