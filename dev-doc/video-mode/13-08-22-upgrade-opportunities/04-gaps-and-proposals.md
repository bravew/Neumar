# Gap analysis and proposals

## Where Neuma's Video Mode actually stands

Credit first, so the gaps read honestly. Neuma already has:

- **105 `video_*` MCP tools** (`src-api/src/shared/mcp/video-edit-server.ts`,
  4,800 lines) covering timeline ops, captions, audio mixing, transitions,
  overlays, templates, generation, publishing, and editor handoff.
- **A ripple-safe timeline IR** (`packages/video-ir`) with inverses:
  `clip.{move,trim,split,merge,extend,removeTimeRange,setTransition,setFilters,setPlayback,setTransform}`,
  `caption.{splitAtTime,mergeSibling,regroup,setTokenText}`,
  `keyframe.{upsert,remove,setTrack}`, `track.*`, `marker.*`, `timeline.batch`.
- **A visual verification loop** — `video_inspect_timeline_frames` renders small
  composited frames from the live Remotion composition and is explicitly
  described as *"use before claiming visual facts and after applying visual
  edits"*, plus a bounded QA loop (`qa-loop.ts`) checking black frames, audio
  clipping, silent gaps, and missing media.
- **A cost gate** (`cost-approval.ts`) with a cents-based auto-approve threshold —
  finer-grained than OpenReel's binary `expensive` flag.
- **A pluggable engine registry** (`engines/registry.ts`) where `EngineId` is
  already open: `'remotion' | 'html' | (string & {})`.
- **Editor handoff** (OTIO / FCPXML / Premiere XML / EDL + sidecars), shipped in
  `12-video-mode-4`.

The gaps below are all *additive*. None of them says the current architecture is
wrong.

---

## Gap 1 — Clip looks are seven CSS filters

**Today:** `ClipFilters` = `{ brightness, contrast, saturation, hueRotateDeg,
blurPx, grayscale, sepia }`, emitted as a CSS `filter` string by
`buildClipCssFilter`. `auto-color.ts` handles HDR→SDR tone mapping and one
`CONSERVATIVE_AUTO_COLOR_FILTER` ffmpeg `eq=` string. There is **no LUT support**
anywhere in `src-api/src/shared/video/` (the only `.cube` hits are the *cube
transition* preset's i18n keys).

**Available:** `@remotion/effects@4.0.515` — 72 GPU shader effects, keyframeable
from `useCurrentFrame()`, composing in array order. `colorCorrection()` alone is
an eleven-parameter primary grade. HyperFrames 0.8.7 independently added
`data-color-grading`, `data-fx-chain`, a `media-treatment` CLI with
`--capabilities` / `--analyze`, and `grade-compare` with `.cube` LUT support.

**Proposal P0-1 — clip effect stack.**

- Add `@remotion/effects@4.0.515` (exact, version-aligned) to root + `src-api`.
- Add a versioned, discriminated `ClipEffect` union and ordered
  `ClipEffectStack`, with a closed Zod schema per supported effect. Start with a
  bounded grading and blur catalog rather than exposing 72 untyped parameter
  bags at once.
- Add `clip.setEffects` with an inverse. Keep `clip.setFilters` and the legacy
  CSS renderer unchanged. Shader effects are not pixel-equivalent to CSS
  filters, and the old proposal did not map `sepia`; silently adapting saved
  projects would break the no-regression requirement.
- Reuse the existing `Keyframe` interpolation helpers, but add a typed
  `effectId + parameter` target and inverse effect-keyframe ops. The current
  `KeyframeableProperty` union cannot represent effect parameters.
- New MCP tools: `video_list_effect_presets` (returns Neuma's runtime catalog,
  including parameter ranges and defaults), `video_set_clip_effects`, and
  `video_analyze_clip_grade` (measures and suggests a bounded correction,
  mirroring `media-treatment --analyze`). TypeScript declarations are not a
  runtime metadata API, so the catalog, schemas, UI controls, and effect factory
  must share one owned definition.
- Frontend: an Effects section in `TimelineClipInspector` / `clipInspector/`.
- **Blocker to resolve first:** video clips must route through
  `@remotion/media`'s `<Video>`. The affected surfaces are the `Html5Video` and
  `BlurPadVideo` preview paths plus the three render-side `OffthreadVideo` call
  sites. Core `Img` already supports effects, and the vivid-overlay iframe is
  outside this path. Define fallback behaviour so a codec fallback cannot
  silently drop an effect stack.

**Effort:** M for the effect stack, M for the `@remotion/media` migration.
**Value:** the single largest capability-per-line win in this document.

---

## Gap 2 — The `html` engine records the browser in real time

**Today:** `engines/html/capture.ts` opens a Playwright context with
`recordVideo`, plays the page, then transmuxes the webm to mp4. The adapter's own
capability block says so:

```ts
weaknesses: [
  'Real-time capture is frame-accurate but not byte-deterministic across hosts',
]
```

Real-time capture means frame timing depends on host load. It cannot hit
`30000/1001`. It cannot produce alpha WebM reliably. It has no frame cache, so
re-renders pay full cost.

**Available:** HyperFrames 0.8.7's renderer does deterministic seek-and-capture
and now adds `--experimental-fast-capture` (Chrome `drawElementImage`, ~2× on
macOS + hardware GPU, with automatic fallback), a content-addressed
`--frames-cache-dir`, rational fps, `--video-frame-format png` for
colour-sensitive UI captures, `--vp9-cpu-used`, `--best-effort` /
`--no-best-effort`, and `--batch --json`. The CLI is already a `src-video`
devDependency at 0.8.7, and `resolveHyperframesCommand()` already resolves the
workspace binary.

**Proposal P0-2 — a `hyperframes` engine adapter.**

- Evolve the engine contract first. It currently stores `fps` as `number` and
  capabilities as `number[]`, has a distinct `webm-alpha` format, and reports
  availability as a boolean. Reuse the IR's rational `FrameRate`, model
  transparent WebM explicitly, and return typed unavailable reasons.
- Add `src-api/src/shared/video/engines/hyperframes-adapter.ts` registering
  `EngineId 'hyperframes'` against that revised contract.
- Reuse `resolveHyperframesCommand()` and the process-spawn/progress-streaming
  shape already proven in `design-mode/hyperframes-renderer.ts`; lift that
  spawn helper into a shared module rather than copying it.
- Keep `html` (Playwright) registered when the CLI is absent, and surface both in
  `video_list_engines` with honest capability differences. `EnginePicker.tsx` is
  still a read-only chip, so an interactive picker is separate UI work.
- Wire `--frames-cache-dir` to a dedicated
  `<project-cache>/hyperframes-extract/` directory. `render-cache.ts` manages
  Neuma's encoded scene, clip, and frame entries; it is not a reusable extracted
  source-frame directory.

**Packaging constraint (checked, not blocking, but must be designed for).**

- HyperFrames 0.8.7 requires **Node ≥ 22**. Every `src-api` sidecar target is
  already `PKG_NODE_RANGE=22` / `node22-*` (macOS arm64 + x64, Linux x64,
  Windows x64), so the runtime floor is satisfied.
- The real problem is **availability**: `hyperframes` is a `src-video`
  *devDependency*, and `src-api`'s `pkg.scripts` bundles only
  `@remotion/{bundler,renderer,transitions}` and `remotion`.
  `resolveHyperframesCommand()` walks up from `import.meta.url` to
  `src-video/node_modules/.bin`, which exists in a dev checkout and **will not**
  in a packaged app; it then falls back to bare `'hyperframes'` on `PATH`, with
  `NEUMA_HYPERFRAMES_BIN` as an override.
- So the adapter must implement a real `isInstalled()` that *probes* the binary
  (spawn `--version`, compare against a required floor) rather than assuming it,
  and `video_list_engines` must report it as unavailable rather than failing at
  render time. Shipping the CLI as a Tauri resource is a separate decision — cost
  is a ~11 MB `dist/cli.js` plus a Chrome download at first use
  (`hyperframes browser ensure`), which is why `doctor` / `browser ensure` need a
  first-run path in the desktop app if this becomes a shipped capability.

**Effort:** M. **Value:** frame-addressed HTML renders + ~2× on the fast path.

---

## Gap 3 — No deictic ("this element") editing for HTML compositions

**Today:** Neuma's Video Agent gets transcript selection and clip selection
context (`useVideoEditorSelectionContext.ts`, `$selection`,
`$transcript_selection`). For HTML compositions it has nothing equivalent —
"make this card bigger" has to be inferred from a screenshot or the source.

**Available:** `hyperframes preview --context --json --context-fields selection`
returns the Studio-selected element's `data-hf-id`, CSS selector, bounding box,
text content, composition path, timeline time, and a thumbnail URL, with
documented failure codes. `--context-detail full` adds computed and inline styles.
The skill is explicit: *"Do not infer the target from a screenshot when the CLI
can give a stable element target."*

Separately, `dist/hyperframes-player.global.js` (59 KB) is an embeddable
`<hyperframes-player>` web component with a `playback-rate` attribute clamped to
`[0.1, 5]`.

**Proposal P1-1 — HyperFrames Studio bridge.**

- Managed preview lifecycle behind the API:
  `preview --background --port <n> --json` on open, `--status` for health,
  `--stop` on close. Handle `preview-not-running`,
  `ambiguous-preview-server`, `preview-port-mismatch` explicitly.
- New read tool `video_get_html_selection` wrapping
  `preview --context --json --context-fields selection`, feeding the same agent
  context slot as `$selection`. Prefer `selection.target.hfId`; fall back to
  `selector` only when no stable id exists.
- Add `<hyperframes-player>` at the actual live-preview owner. `HtmlVideoPanel`
  currently owns the template and frame sections, not a raw iframe, so the
  implementation must first trace selected composition state through
  `HtmlVideoFrames`.

**Effort:** M. **Value:** unblocks conversational editing of HTML compositions,
which is the whole premise of html-video mode.

---

## Gap 4 — No beat grid

**Today:** `music.ts` carries a `tempoBpm` *hint* passed to generation. The IR has
`marker.upsert` but no beat concept. `analysis/` has `auto-cut.ts`,
`frame-index.ts`, `pack-transcript.ts`, `transcript.ts` — nothing rhythmic.

**Available:** `hyperframes beats` writes `beats/<audio>.json` from headless
Chrome analysis (plus `dist/beat-analyzer.global.js` for in-browser use).
OpenReel exposes `set_motion_beat_markers` and `apply_motion_preset_to_beats`.
OpenMontage routes every music-driven brief through the beat grid.

**Proposal P1-2 — beat markers as a first-class analysis artifact.**

- Add `analysis/beats.ts` producing a beat grid alongside the existing analysis
  artifacts, so it flows through the same preview-before-apply path
  `12-video-mode-4` established for cut plans.
- Store a versioned beat-grid artifact anchored to the source audio clip and
  derive timeline beat positions from its start, trim, and playback rate. The
  current marker schema has no `kind`, and ripple operations do not move markers.
  Promote individual beats to editorial markers only as an explicit user action.
- New tools: `video_detect_beats`, `video_snap_cuts_to_beats` (proposes an op
  batch, does not apply it).
- Timeline UI: beat gridlines in `SceneSequencer` / `timeline/`, and beat snapping
  in the existing snap logic (`packages/video-ir/src/snap.ts`).

**Effort:** M. **Value:** unlocks the entire music-driven category, which Neuma
currently cannot serve.

---

## Gap 5 — Bundled HyperFrames skill is two minors stale

**Today:** `plugins/builtin/design-skills/hyperframes/skills/hyperframes/`
mirrors the 0.6.x monolith (`SKILL.md`, `house-style.md`, and references for
dynamic-techniques / captions / transcript-guide / tts / transitions). Upstream
replaced that with a router + ten route briefs + eight lazily-installed domain
skills. Nothing in Neuma's copy mentions `check`, `beats`, `keyframes`,
`media-treatment`, `normalize-audio`, `grade-compare`, `compare`, `present`, the
`preview --context` bridge, or any of the 22 new `data-*` attributes.

**Proposal P1-3 — resync the bundled skill.**

- Rewrite Neuma's skill as a **router** matching upstream's shape, keeping
  Neuma-specific content (house style, Neuma project/asset conventions, how
  compositions map to Neuma's storage tree) as its own reference file rather than
  duplicating upstream domain knowledge.
- Adopt upstream's **pin-currency protocol**: probe with
  `npx hyperframes@latest upgrade --project . --check` before the first
  render-affecting command, apply, verify with `check`, revert on failure, and
  always name old→new version in the summary.
- Add a CI check that fails when the bundled skill's recorded upstream version
  drifts from `src-video/package.json`'s `hyperframes` pin — this is what let a
  two-minor gap go unnoticed.

**Effort:** S. **Value:** cheap, and prevents the same drift recurring.

---

## Gap 6 — Verification is single-frame; no comparison surface

**Today:** `video_inspect_timeline_frames` renders individual frames. The QA loop
checks black frames, clipping, silent gaps, missing media. There is no
side-by-side, no before/after, no motion-path diagnostic.

**Available:** `hyperframes compare` (2–16 variants at one timestamp into a
labeled contact sheet), `grade-compare` (candidate grades / `.cube` LUTs onto a
reference frame), `keyframes --shot` (onion-skin of the real element across the
timeline, with orbit angles and `--ghost` canvas compositing), `snapshot --zoom`
(high-density crop at identical layout) and `snapshot --describe` (Gemini vision
frame analysis), and `check --json` (lint + runtime + layout + motion + WCAG AA
contrast in one browser session).

**Proposal P2-1 — comparison and diagnostic surfaces.**

- `video_compare_variants` — render N timeline variants or N candidate edits at a
  shared timestamp into one contact sheet, returned as an image tool result.
- `video_compare_grades` — wrap `grade-compare` for the effect stack from Gap 1.
- Route `check --json` into `QaReportPanel.tsx` for HTML compositions.
- Adopt the **image-bearing tool result** pattern from OpenReel's
  `loop.ts::buildToolResultContent` so comparison sheets come back as
  `[{type:'text'}, {type:'image'}]` rather than a file path the model can't see.

**Effort:** M. **Value:** turns "I rendered a frame" into "I compared two and
picked."

---

## Gap 7 — Agent ergonomics the samples have and Neuma doesn't

Four specific, independently adoptable items:

| Item | OpenReel | Neuma today | Proposal |
|---|---|---|---|
| **Ref resolution in the dispatcher** | `executor.ts::resolveRefs` turns `clipIndex` / `atSec` / `trackIndex` into a canonical `clipId` before *any* tool runs — "so the model never has to juggle UUIDs" | `$selection` / `$transcript_selection` resolved inside `video_apply_timeline_ops` only | **P2-2:** lift resolution into the MCP dispatcher so every clip-taking tool accepts `clipIndex` / `atSec` |
| **Capability doc in the prompt** | `toCapabilityDoc()` renders the whole registry by domain with `(read-only, destructive, expensive)` flags, plus enum/id catalogs under `get_capabilities` | `session-prompt.ts` + `extensions/agent/video/system-prompt.ts` describe tools in prose; read/write split lives in `permissions.ts` | **P2-3:** generate the capability doc from the registry so prompt and gate cannot diverge |
| **Bulk creation with symbolic keys** | `add_motion_layers` takes an array with `key` / `parentKey`, returns `layerIds` keyed by caller keys — "40-layer page in a handful of calls, not 40" | `video_apply_timeline_ops` batches ops but callers must pre-generate ids (the `12-video-mode-4` note about `clip.removeTimeRange` needing caller-supplied replacement clips is the same limitation) | **P2-4:** symbolic-key allocation in batch ops, returning a key→id map |
| **Typed turn budget** | `limits: { maxSteps, maxToolCalls, maxTokens }` → `StopReason` of `end_turn \| max_steps \| max_tool_calls \| budget \| error`; `maxTokens` documented as a soft ceiling checked *between* steps | `maxTurns: 60` in `extensions/agent/video/index.ts`; cost gate is separate and per-operation | **P2-5:** normalize provider-specific stops at the shared agent-runtime boundary, then surface the reason in `AgentDock` |

Neuma already has a `destructive` classification and a Video-specific
`DESTRUCTIVE_TOOLS` list. The remaining gap is coverage: add a test that every
registered Video tool has permission and cost metadata so the registry cannot
drift.

---

## Gap 8 — No explicit runtime-selection contract

**Today:** `video_list_engines` exposes engines, while `EnginePicker.tsx` is still
a read-only `html` chip. There is no rule about how the agent picks, no
interactive picker, and no recorded decision.

**Available:** OpenMontage's contract — `renderer_family` (creative grammar)
separate from `render_runtime` (technical engine); both locked at proposal; a
**hard rule** that when both runtimes are available the agent must present both
with an honest tradeoff and wait for approval; a logged
`render_runtime_selection` decision naming every option considered; and
**escalate, never silently substitute** when the chosen runtime is unavailable.

**Proposal P2-6 — adopt the contract.** Cheap and mostly prompt + a decision-log
entry, but it converts a silent implicit choice into a reviewable one — and it
matters more once `hyperframes` joins `remotion` and `html` as a third engine
(P0-2), because that's exactly when silent substitution becomes tempting.

---

## Gap 9 — No motion-graphics composition model

**Today:** Neuma's IR is a timeline IR. There is no compositions → layers →
keyframes domain, no masks, no track mattes, no text animators, no expressions,
no precomps, no camera/lights.

**Available:** OpenReel's `packages/core/src/motion/` (134 files, each
test-paired) and the architectural discipline that makes it usable — a separate
Motion Creator surface, with output reaching the main timeline only via an
explicit `insert_motion_into_editor`.

**Proposal P3-1 — deferred, and deliberately.** This is the largest item in this
document and the one most likely to be wrong to build. Before scoping it, decide
whether Neuma's motion-graphics answer is:

- **(a)** a native layer engine (OpenReel's path — very large), or
- **(b)** HyperFrames compositions as the motion-graphics runtime, edited
  conversationally through the Gap 3 bridge (much smaller, and it is what
  OpenMontage concluded: kinetic typography, product promos, launch reels, and
  motion graphics all route to HyperFrames, while Remotion keeps caption burn and
  avatar/lip-sync).

**(b) is the recommendation.** P0-2 and P1-1 are its prerequisites, which means
the first three proposals in this document are also the cheapest path to closing
the largest gap. Revisit P3-1 only after they ship and the bridge has been used
in anger.

---

## Ranked summary

| ID | Proposal | Effort | Value | Blocked on |
|---|---|---|---|---|
| P0-1 | Clip effect stack via `@remotion/effects` (+ `@remotion/media` migration) | M+M | Very high | — |
| P0-2 | `hyperframes` render engine adapter | M | High | CLI availability in packaged builds (design, not blocker) |
| P1-1 | HyperFrames Studio context bridge + embedded player | M | High | P0-2 |
| P1-2 | Beat grid analysis + snapping | M | High | — |
| P1-3 | Resync bundled HyperFrames skill + drift CI check | S | Medium | — |
| P2-1 | Comparison / diagnostic surfaces (`compare`, `grade-compare`, onion-skin) | M | Medium | P0-1, P0-2 |
| P2-2..5 | Agent ergonomics (ref resolution, capability doc, symbolic keys, turn budget) | S each | Medium | — |
| P2-6 | Runtime-selection contract | S | Medium | P0-2 |
| P3-1 | Motion-graphics composition model — **decide (a) vs (b) first** | XL | High | P0-2, P1-1 |
