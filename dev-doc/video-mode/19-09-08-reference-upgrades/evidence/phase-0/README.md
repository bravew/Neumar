# Phase 0 acceptance evidence

Captured on 2026-09-08 from an Apple M4 Pro Mac mini with 64 GB memory, macOS
26.6.2, Node 26.8.1, FFmpeg 9.0.1, Chrome 152.0.7977.82, Remotion 4.0.515, and
HyperFrames 0.8.7.

## Results

| Activity | Result | Evidence |
| --- | --- | --- |
| HTML versus HyperFrames | Passed | 15 seconds at 1920 by 1080 and 30 fps; sampled-frame SSIM 0.976688; both outputs passed FFprobe duration checks |
| Studio click to agent context | Passed | Automated Studio layer click returned `stableTarget: parity-card`, sourced from `data-hf-id` |
| Remotion long render | Passed | 180.053 seconds, 5,400 frames, 12 visual clips across video and image sources, one audio clip, `@remotion/media` enabled, probed 5.1 video source and stereo output, 53.968 seconds wall clock, 708,558,848 bytes peak RSS |
| Timeline fixture | Passed with scoped baseline | Deterministic 12-track, 1,000-clip fixture and linear model-window query recorded; production DOM and pointer measurements remain the Phase 3 gate |
| Multi-tab asset picker | Passed | Playwright opened three editor tabs, observed zero idle `/assets/events` requests, completed intercepted file/folder picker cancellations, and verified both controls re-enabled |

The JSON reports next to this file use schema version 1 and carry fixture
digests, commands, host metadata, render metadata, and sampled frame hashes.
Large generated media and PNG samples stay under `.video-acceptance/`.

## Commands

```bash
node scripts/video-acceptance.mjs --fixture parity --json
node scripts/video-acceptance.mjs --fixture long-render --json
node scripts/video-timeline-benchmark.mjs --clips 1000 --tracks 12 --json
pnpm exec playwright test tests/e2e/specs/video-mode.spec.ts --grep 'idle video tabs'
```

`pnpm video:baseline` runs the same sequence.

## Known baseline debt

`pnpm --filter neumar-api typecheck` currently fails in the baseline tree at
`src-api/src/shared/video/pipeline.ts:2228` and `:2264` because two possibly
undefined media items are passed to functions that require a media item. Phase
0 does not alter that production path. The failure is recorded here so later
phases do not attribute it to the dependency upgrade.

`pnpm test:fast` is also blocked by unrelated workspace state that predates this
phase:

- the frontend run has 1,372 passing tests and one failure in the untracked
  `src/__tests__/video/VideoProjectFilePreview.test.tsx`, which expects an Edit
  button from other untracked preview work;
- the API run has 3,201 passing and 37 failing tests. Most failures share a
  pre-existing incomplete `@/shared/db/operations` mock (`getAgentRun` is
  missing); two existing Remotion input assertions expect 144 frames while the
  current implementation returns 84.

The tracked frontend suite passes when that untracked test is excluded:
`pnpm vitest run --config vitest.config.ts --exclude
src/__tests__/video/VideoProjectFilePreview.test.tsx`. The standalone acceptance
commands and the multi-tab Playwright acceptance pass.
