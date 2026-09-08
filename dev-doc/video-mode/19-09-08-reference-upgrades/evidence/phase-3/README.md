# Phase 3 acceptance evidence

Bounding timeline cost. Captured on 2026-09-08 on the same Apple M4 Pro host as
Phases 0 through 2.

## Results

| Activity | Result | Evidence |
| --- | --- | --- |
| DOM clip count tracks the viewport | Passed | `timeline-1000.json` — 26.9 mounted clips against 1,000 total, across a 2,000-window scroll sweep of a 12-track fixture |
| Indexed query matches the linear one | Passed | `timeline-1000.json` — `indexedMatchesLinear: true`; the two queries returned identical clip counts on every window |
| Window query cost | Passed | p50 0.0010 ms, p95 0.0080 ms, max 0.060 ms for all twelve tracks per window; index build 0.12 ms for 1,000 clips |
| Component-level windowing | Passed | `timelineRenderingPerformance.test.tsx` — a 1,000-clip track mounts 10 clips for a 10-second window and 5 for a 5-second one |
| Pinned clips stay mounted | Passed | Same suite — selection, link-group partners, and the active drop target survive outside the window |

## Commands

```bash
pnpm vitest run \
  src/__tests__/video/Timeline.test.tsx \
  src/__tests__/video/timelineMath.test.ts \
  src/__tests__/video/timelinePlacement.test.ts \
  src/__tests__/video/timelineClipWindow.test.ts \
  src/__tests__/video/timelineRenderingPerformance.test.tsx
node scripts/video-timeline-benchmark.mjs \
  --clips 1000 --tracks 12 --production --compare phase-0 --json
pnpm validate
```

## What changed

`TimelineTrackRows` already virtualized rows through `@tanstack/react-virtual`;
the remaining fan-out was the single `clips.map(...)` in `TimelineTrack`, which
mounted every clip on every track regardless of the viewport. That map now reads
`queryClipWindow()`, and the mounted count follows the visible window plus
overscan.

Window semantics are shared, not re-derived. `clipIntersectsWindow()` is the
same half-open predicate as `intersects()` in
`src-api/src/shared/video/timeline-window.ts`, so a clip that ends exactly when
the window starts is outside it on both sides of the app. A second, subtly
different definition on the frontend is the drift the plan warned about.

The interval index carries a running maximum end time alongside the
sorted-by-start clips. That is what makes the query cheap: the backward walk
stops as soon as no earlier clip can still reach into the window, so a long clip
near the timeline start does not force a full scan on every pointer move.

Pinning splits by what each level knows. The shared hook pins the selection, the
keyboard-focused clip, and anything being dragged. `TimelineTrack` adds
link-group partners and — while a drag is over it — the whole drop-target track,
because the drop indicator measures against its neighbours.

Overscan is in pixels, not milliseconds, so the same setting keeps roughly the
same on-screen margin at every zoom. A fixed millisecond margin would be enormous
at frame-level zoom and a sliver at fit zoom.

## Benchmark comparison against Phase 0

The Phase 0 report measured the linear model query and said in its own
`limitations` that Phase 3 had to add the mounted-DOM measurement. That is what
`mountedDomClips` now is: `null` in the baseline, 26.9 here.

The p95 comparison reads +31%, and that number should not be trusted as a
regression. The two reports measure different things — Phase 0 timed a linear
scan in the harness process, this one times the shipped indexed query in a `tsx`
subprocess — and both sit under ten microseconds, where process startup and JIT
warmup dominate. The apples-to-apples number is in the same report: run
in-process against the same windows, the indexed query's p95 is 0.0080 ms against
the linear query's 0.0130 ms.

## Not measured here

The plan's performance budget also names p50/p95 interaction time, pointer-to-
drag-preview latency, and dropped frames on a production build at 1920×1080.
Those need a real browser harness driving a production bundle; this phase does
not add one, and the benchmark's `limitations` field says so rather than implying
the numbers exist. Reproduce the gap with:

```bash
node scripts/video-timeline-benchmark.mjs --clips 1000 --tracks 12 --production --json
# result.limitations names what the harness does not yet measure
```

The structural claim the exit gate rests on — rendered inactive clip DOM bounded
by visible clips plus overscan — is measured and passing.

## Known baseline debt

Unchanged from Phase 2: the untracked `VideoProjectFilePreview` work fails its
own test and `typecheck`, `src-api/.../pipeline.ts` has two pre-existing
`typecheck` errors, and `src-api/test/integration/api/agent.test.ts` fails on an
incomplete `getAgentRun` mock. None are in the timeline path.
