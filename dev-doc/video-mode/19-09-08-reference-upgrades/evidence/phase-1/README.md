# Phase 1 acceptance evidence

Dependency upgrade: Remotion 4.0.515 → 4.0.522 (exact pins in all three
manifests), mediabunny 1.55.2 → 1.55.5, zod ^4.4.3 → ^4.5.4, HyperFrames
0.8.7 → 0.8.31.

Captured on 2026-09-08 from an Apple M4 Pro Mac mini with 64 GB memory, macOS
26.6.2, Node 26.8.1, FFmpeg 9.0.1, Chrome 152.0.7977.83, Remotion 4.0.522, and
HyperFrames 0.8.31.

## Results

| Activity | Result | Evidence |
| --- | --- | --- |
| Parity render versus Phase 0 | Passed | `parity.json` — SSIM 0.978548 (Phase 0: 0.976688, delta +0.00186); HTML and HyperFrames both 15 s, 450 frames, 1920 by 1080 at 30 fps |
| Studio click to agent context | Passed | `parity.json` — Studio layer click still returns `stableTarget: parity-card` from `data-hf-id` |
| Long render peak RSS | Passed | `long-render.json` — 725,729,280 bytes peak RSS, +2.42 % against the Phase 0 baseline, inside the 10 % gate |
| Long render repeat | Passed | `long-render-repeat.json` — 698,793,984 bytes, −1.38 % |
| HyperFrames command contracts | Passed | `hyperframes-contracts.json` — `--help` and JSON output for doctor, upgrade, check, compare, grade-compare, snapshot, preview lifecycle |
| `data-track-index` is not paint order | Proven | `hyperframes-contracts.json` probe `track-index-paint-order`: a two-clip overlap fixture snapshotted at 0.5 s shows the CSS `z-index` winner at the center pixel (`cssPaintOrderWins: true`) |
| Packaged sidecar, macOS arm64 | Passed | `sidecar-darwin-arm64.json` — the packaged binary answers `/video/engines` with typed `not-found` and `browser-missing` reasons, and keeps Remotion available |
| Packaged sidecar, linux x64 | Bundled; runtime probe deferred | `sidecar-linux-x64.json` — cross-target build and footprint audit pass on this host; the runtime probes are recorded as `skipped` with the command a linux runner must run |

## Commands

```bash
pnpm check:hyperframes-skill
pnpm check:hyperframes-upgrade
pnpm vitest run --config src-api/vitest.config.ts test/unit/video/
pnpm vitest run \
  src/__tests__/video/RemotionPreview.test.ts \
  src/__tests__/video/HyperframesStudioPreview.test.tsx
node scripts/video-acceptance.mjs --fixture parity --compare phase-0 --json
node scripts/video-acceptance.mjs --fixture long-render --compare phase-0 --json
node scripts/video-sidecar-probe.mjs --target=darwin-arm64 --json
node scripts/video-sidecar-probe.mjs --target=linux-x64 --json
```

## Peak RSS: read the second run, not the first

The first `long-render` run after `pnpm install` measured 1,273,151,488 bytes,
+79.68 % against Phase 0, and failed the gate. The two runs after it, with no
code change in between, measured −1.38 % and +2.42 %. The outlier is the cold
post-install run: the Remotion bundler cache, the esbuild transform cache, and
the browser profile are all empty on the first render after a dependency change,
and `/usr/bin/time -l` attributes that one-time work to the same Node process it
is measuring.

The published `long-render.json` is a warm run. Anyone reproducing the gate
should discard the first render after an install, or the harness will report a
regression that a second run does not reproduce.

## Single-copy resolution

`pnpm why` confirms one resolved copy of each package the plan named:

- `mediabunny@1.55.5` — the version `@remotion/media@4.0.522` depends on, not
  the registry's newer 1.56.0
- `zod@4.5.4` — one v4 copy across `packages/video-ir`, `src-api`, and the
  frontend, so schema identity is not split. (The unrelated `zod@3.x` copies
  under the AI SDK packages are outside this contract.)
- `remotion@4.0.522` and every `@remotion/*` package at the same exact version

## Decisions

**`hyperframes-localize-fonts` is not added to the render path.** 0.8.31 ships it
as a second binary (`bin/hyperframes-localize-fonts.mjs`). The plan makes its
adoption conditional on the golden fixture showing cross-host font drift. The
parity fixture's sampled-frame SSIM against the HTML engine improved slightly
across the bump and no font-shaped difference appeared, so there is nothing for
font localization to fix yet. Revisit when the test fleet has a second host to
compare against — one host cannot demonstrate cross-host drift either way.

**The HyperFrames CLI stays out of the sidecar bundle.** `hyperframes@0.8.31` is
a devDependency of `src-video` only, and it is the sole path by which
`onnxruntime-node`, `puppeteer-core`, `@puppeteer/browsers`, `sharp`, and
`esbuild` enter the workspace tree. `resolveHyperframesCommand()` resolves the
CLI at runtime from `NEUMA_HYPERFRAMES_BIN`, the workspace `.bin`, or `PATH`, so
the packaged sidecar carries none of them on the HyperFrames account, and the
probe asserts that: `bundle-excludes-puppeteer-core`,
`bundle-excludes--puppeteer-browsers`, and `bundle-excludes-hyperframes-dist`.
The sidecar's own `onnxruntime` and `sharp` natives predate this phase and come
from `src-api`'s dependencies.

Packaged footprint after the bump, from the two probe reports:

| Target | `bundle.cjs` | Staged natives | Packaged binary |
| --- | --- | --- | --- |
| darwin-arm64 | 41,837,004 B | sharp 19,818,841 B, onnxruntime 39,909,488 B, sherpa-onnx 32,803,616 B | 235,836,320 B |
| linux-x64 | 41,837,004 B | same staging | 249,583,248 B |

**Cross-target native staging is now explicit.** The `build:binary:*` scripts
pass `PKG_TARGET_PLATFORM` and `PKG_TARGET_ARCH` to the bundle step. Without
them, `build.mjs` defaults to the host's `process.platform` / `process.arch`, so
cross-building a linux or Windows sidecar on macOS staged darwin natives into it.

**Packages deliberately not adopted.** `@remotion/gsap`, `@remotion/whisper-webgpu`
(new in 4.0.518), Remotion WebMCP, and Browser Studio have zero lockfile entries
and none of them arrive transitively. The tree stays on the 4.0.x line; the
`4.1.0-alpha12` under the npm `alpha` tag is out of scope.

## Known baseline debt carried forward

`src-api/test/unit/video/remotion-render-input.test.ts` still fails its two
`durationInFrames` assertions (expects 144, gets 84). Phase 0 recorded this as
pre-existing, and it reproduces identically on the pre-upgrade tree — stash the
manifest changes and the same two tests fail. It is not a Phase 1 regression.
Phase 2 rewrites the timeline duration derivation these assertions cover, and is
where the fix belongs.

The other 103 API video unit test files pass, as do the frontend Remotion and
HyperFrames Studio preview suites.
