# Phase 2 acceptance evidence

Explicit timebase and output range. Captured on 2026-09-08 on the same Apple M4
Pro host as Phase 0 and Phase 1.

## Results

| Activity | Result | Evidence |
| --- | --- | --- |
| Fractional timebase survives derivation | Passed | `timebase-range.json` — a 29.97 project derives `30000/1001`, not a rounded 30 |
| Output range resolves and applies | Passed | `timebase-range.json` — frames 60–180 of a 10.01 s timeline render as 4004 ms, within one project frame |
| Render-local time starts at zero | Passed | `timebase-range.json` — the first surviving segment starts at 0 ms while the EDL records `projectStartMs: 2002` |
| Boundary behavior | Passed | Head-cut entrances and cut audio fades are dropped; a transition wholly inside the range survives; a transition at the out point is dropped |
| Unset range is a regression no-op | Passed | The same project with no range compiles to the full timeline with no `outputRange` on the EDL |
| Interchange carries the exact rate | Passed | `model-conformance.test.ts` — OTIO emits 29.97002997, Premiere emits `<ntsc>TRUE</ntsc>`, FCPXML emits `frameDuration="1001/30000s"` |

## Commands

```bash
pnpm -C packages/video-ir test
pnpm --filter @neumar/video-ir build
pnpm vitest run \
  src/__tests__/video/timelineMath.test.ts \
  src/__tests__/video/timelineKeyboardBindings.test.ts \
  src/__tests__/video/timelineUiStore.test.ts \
  src/__tests__/video/useTimelinePersistence.test.tsx \
  src/__tests__/video/timelineOutputRange.test.ts
pnpm vitest run --config src-api/vitest.config.ts \
  test/integration/video-timeline-route.test.ts \
  test/integration/video-output-route.test.ts \
  test/unit/video/timeline.test.ts \
  test/unit/video/timebase.test.ts \
  test/unit/video/output-range.test.ts \
  test/unit/video/render-plan.test.ts \
  test/unit/video/editor-handoff/model-conformance.test.ts
node scripts/video-acceptance.mjs --fixture timebase-range --engines all --json
```

## What the contract actually changed

`deriveTimelineFps()` returned `Math.round(firstAssetFrameRate)`. It is replaced
by `deriveProjectTimebase()`, which surveys every asset, keeps the rate rational,
and reports both the reason and the losing rates so the settings UI can say what
a lock would re-snap. The numeric `fps` survives as a derived compatibility
field: a 30000/1001 project stores 29.97 there and still cuts on exact NTSC
boundaries.

The output range is applied in `compileTimelineToEdl()`. Every engine — Remotion,
HyperFrames, and the HTML fallback — reads the EDL, so "no render engine may
ignore a set range" holds by construction rather than through three parallel
implementations that could drift. The trimmed EDL carries `outputRange` with the
project-time bounds, so QA duration, export metadata, and the handoff manifest
stay honest about which part of the project a file covers.

Both new fields are optional. A project written before this phase has no
`settings.timebase` and no `timeline.outputRange`; it is read through
`resolveTimebase()` and renders exactly as it did, and nothing rewrites its
document until a user chooses a rate.

## Baseline debt closed in this phase

Phase 0 recorded two items that were carried through Phase 1 and are now fixed:

- `remotion-render-input.test.ts` expected 144 frames where the implementation
  returned 84. The implementation was right: commit 034a0be deliberately made
  picture own the render duration ("let picture own duration"), and the test was
  left stale. The assertions now match, with the reason in a comment.
- `timelineMath.test.ts` had two type errors from spreading a `VideoTimelineTrack`
  union and then supplying `clips`, which forced the clips to satisfy every track
  kind at once. Those two fixtures are now built as typed literals.

## Known baseline debt still open

`src-api/test/integration/api/agent.test.ts` fails on an incomplete
`@/shared/db/operations` mock (`getAgentRun` is missing). It predates this work
and is unrelated to Video Mode. The API suite is otherwise green: 518 files pass,
that one fails — down from the 37 failing tests Phase 0 recorded.

`src-api/src/shared/video/pipeline.ts:2240` and `:2276` still fail `typecheck`
on two possibly-undefined media items, and
`src-api/src/shared/mcp/public-server/discover.ts` still fails `format:check`.
Both predate this phase; neither is in the timebase or output-range path.
