# Video Mode — post-upgrade opportunity review (2026-08-22)

Date: 2026-08-22
Trigger: commit `5dafc51` — quarterly dependency sweep (#22), group G13
Status: research complete, proposals drafted, **not yet scheduled**

## What this is

Commit `5dafc51` moved the video stack forward:

| Package | Before | After | Kind of jump |
|---|---|---|---|
| `remotion` + all `@remotion/*` (root, `src-api`, `src-video`) | 4.0.507 | 4.0.515 | 8 patch releases, feature-bearing |
| `mediabunny` (root) | 1.53.0 | 1.55.2 | patch, no API surface change |
| `hyperframes` (`src-video`) | 0.6.97 | 0.8.7 | **deferred pre-1.0 jump across two minors** |

The sweep verified *"no CLI-surface breaks"*, which was correct — but "no breaks"
is not "no new surface". The HyperFrames jump in particular skipped the 0.7 line,
where the project reorganised its skill surface and added nine new commands. None
of that new capability is wired into Neuma today.

At the same time the two reference projects Video Mode tracks both moved
substantially since the last review (`12-video-mode-4`, 2026-06-13/14):

- `_sample/openreel-video` — PR #88 (7,964 files) added an After-Effects-class
  motion engine, a signed effect-package format, an effect authoring Studio, and
  a 276-tool agent registry. PR #96 added browser-side Whisper and linked-caption
  editing.
- `_sample/OpenMontage` — added a media-model gateway, a 3D world pipeline, more
  TTS/image/video providers, and formalised its Remotion-vs-HyperFrames runtime
  selection contract.

## Documents

| File | Contents |
|---|---|
| [`01-remotion-delta.md`](01-remotion-delta.md) | What 4.0.508→4.0.515 shipped, and which Remotion packages Neuma still doesn't depend on |
| [`02-hyperframes-delta.md`](02-hyperframes-delta.md) | The 0.6.97→0.8.7 delta: 9 new commands, 22 new runtime attributes, new embeddable player, restructured skills |
| [`03-sample-findings.md`](03-sample-findings.md) | What changed in OpenReel and OpenMontage since 2026-06-14, and what is worth borrowing |
| [`04-gaps-and-proposals.md`](04-gaps-and-proposals.md) | Gap analysis against Neuma's current Video Mode + ranked proposals |
| [`05-implementation-plan.md`](05-implementation-plan.md) | Sequenced work with acceptance criteria |

## Executive summary

**Six findings worth acting on**, ranked by value-to-effort:

1. **`@remotion/effects` is not installed.** Remotion now ships 72 GPU shader
   effects (`colorCorrection`, `regionBlur`, `duotone`, `halftone`,
   `chromaticAberration`, `lightLeak`, `filmGrain`-class, …) that apply to
   canvas-based components via an `effects` prop and are keyframeable. Neuma's
   entire per-clip look system is seven CSS filters in
   `src-api/src/shared/video/clip-filters.ts`. Adopting them requires routing
   clip media through `@remotion/media` first — which is worth doing anyway,
   because preview (`Html5Video`) and render (`OffthreadVideo`) currently use
   different media components. This is the single largest
   capability-per-line-of-code win available. → **P0**

2. **The `html` engine still records the browser in real time.**
   `src-api/src/shared/video/engines/html/capture.ts` uses Playwright
   `recordVideo`, which its own header comment admits is *"frame-accurate but not
   byte-deterministic across hosts"*. HyperFrames 0.8.7's renderer does
   deterministic seek-and-capture and now adds `--experimental-fast-capture`
   (~2× via Chrome `drawElementImage`), a content-addressed frame cache, rational
   fps (`30000/1001`), `--video-frame-format png` for UI captures, and
   `--vp9-cpu-used`. A `hyperframes` engine adapter slots into the existing
   registry (`EngineId` is already open: `'remotion' | 'html' | (string & {})`).
   The sidecar already targets Node 22 on every platform, so the CLI's Node ≥ 22
   floor is satisfied; the open design question is CLI *availability* in packaged
   builds. → **P0**

3. **`hyperframes preview --context --json` is an agent bridge Neuma doesn't
   use.** It returns the Studio-selected element's `data-hf-id`, selector,
   bounding box, text, computed styles, and a thumbnail — exactly the deictic
   "make *this* bigger" context Neuma's Video Agent currently has to infer.
   Pairs with the new `<hyperframes-player>` web component
   (`dist/hyperframes-player.global.js`) for in-app preview. → **P1**

4. **Beat-driven editing has no representation in Neuma.** `hyperframes beats`
   emits a Studio-compatible beat grid; OpenReel exposes `set_motion_beat_markers`
   and `apply_motion_preset_to_beats`; OpenMontage routes all music-driven work
   through it. `packages/video-ir` has `marker.upsert` but no beat concept, its
   ripple operations do not move markers, and `music.ts` only carries a
   `tempoBpm` hint. The plan now keeps beat grids anchored to their audio clip
   instead of materializing every beat as an editorial marker. → **P1**

5. **No motion-graphics composition model.** Neuma's IR is a strong *timeline*
   IR (105 `video_*` MCP tools, ripple-safe ops, caption tokens) but has no
   compositions → layers → keyframes domain. OpenReel's split — a video-editor
   timeline plus a separate Motion Creator that only lands on the timeline via an
   explicit `insert_motion_into_editor` — is the architecture to copy if Neuma
   wants agent-authored motion graphics. → **P3, large**

6. **Neuma's bundled HyperFrames skill is now two minors stale.**
   `plugins/builtin/design-skills/hyperframes/skills/hyperframes/` mirrors the
   0.6.x monolithic skill. Upstream 0.8.7 replaced it with a router plus ten
   route briefs and eight lazily-installed domain skills
   (`hyperframes-core`, `-animation`, `-keyframes`, `-creative`, `-audio`,
   `-cli`, `-registry`, `media-use`). Neuma's copy now teaches an obsolete shape.
   → **P1, cheap**

## Verified facts behind these claims

Everything above was checked against the tree, not recalled:

- Both HyperFrames versions are still in the pnpm store, so the delta was taken
  by diffing the packages and running `--help` on every command in both.
- Both Remotion versions (4.0.507, 4.0.515) are in the store; declaration diffs
  were taken per package.
- `@remotion/effects`, `@remotion/media`, `@remotion/animation-utils`,
  `@remotion/webcodecs`, `@remotion/mac-cursors` all publish 4.0.515 and are
  **not** in any Neuma `package.json`.
- Neuma's video tool surface was enumerated from
  `src-api/src/shared/mcp/video-edit-server.ts` (105 `video_*` tools) and
  OpenReel's from `packages/agent/src/registry.ts` (276 tools).
