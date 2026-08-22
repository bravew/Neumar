# Implementation plan

Sequenced so each phase is independently shippable and independently revertible.
Nothing here is scheduled yet. This is the plan to approve or cut, not a
commitment.

Revised after a codebase and published-API review on 2026-08-22. The revision
keeps legacy rendering byte-for-byte compatible at the data boundary, adds the
missing IR and engine-contract work, and removes proposals already present in
the tree.

Conventions carried from `12-video-mode-4`: every IR op gets an inverse and a
test; every user-visible string lands in all six locales; every phase records its
verification commands in a progress table.

---

## Phase A — clip effect stack (P0-1)

Two steps, deliberately separated. **A1 is the risky one; do not merge A2 into
it.**

### A1 — route clip media through `@remotion/media`

`@remotion/effects` only applies to canvas-based components, so this is a
prerequisite, not an optimisation.

- Add `@remotion/media@4.0.515` (exact) to root + `src-api`.
- Migrate video elements one surface at a time:
  1. `remotion-composition.ts` — the render path's three `OffthreadVideo` call
     sites
  2. `RemotionTimelineComposition.tsx` — the preview path's `Html5Video`
  3. `RemotionBlurPad.tsx` — `BlurPadVideo` only
- Do not migrate image or iframe surfaces in A1. Core `Img` already supports the
  `effects` prop in Remotion 4.0.515. `RemotionKenBurnsImage.tsx` and
  `BlurPadImage` should keep using it. `RemotionVividOverlay.tsx` renders an HTML
  iframe and is outside the canvas-effect path.
- Converging these is a goal in its own right: preview and render currently use
  *different* media components, so any behavioural difference between
  `Html5Video` and `OffthreadVideo` is a latent preview/render mismatch.
- Preserve the current trim, reverse playback, speed, pitch-correction, mute,
  crop, transition-tail, and blur-pad behaviour. Move `objectFit` and crop values
  to the `@remotion/media` component props where its canvas API requires that.
- Define fallback behaviour explicitly. A clip with GPU effects must either stay
  on the canvas path or fail with a typed unsupported-media error. It must not
  silently fall back to `OffthreadVideo` and lose its effects. Clips without GPU
  effects may use Remotion's normal fallback.
- Keep core's video tags behind a temporary feature flag for one release. Record
  each fallback event in render diagnostics so the flag can be removed with
  evidence.
- If Neuma ingests ProRes anywhere, enable ProRes decoding explicitly; it is off
  by default in `@remotion/media`.

**Acceptance:** a golden-frame comparison across a representative project
(video clip + Ken Burns still + caption + vivid overlay + transition) shows no
visual regression at 5 sampled timestamps. `video_inspect_timeline_frames` only
exercises the server render composition, so add Player screenshot coverage for
the frontend preview too. The fixture matrix includes reverse playback, speed
changes, blur-pad, alpha video, a fallback codec, and a CORS failure. Record
render wall-clock and peak RSS on a long timeline before and after.

**Risk:** this touches the preview *and* render path at once. If A1 shows
regressions that aren't quickly fixable, stop — Phase A's value does not justify
destabilising the core composition.

### A2 — the effect stack

- Add `@remotion/effects@4.0.515` (exact) to root + `src-api`.
- `packages/video-ir`: introduce a versioned, discriminated `ClipEffect` union
  and `ClipEffectStack`. Each supported effect has a closed parameter schema,
  stable `crypto.randomUUID()` id, and optional `disabled` state. Start with the
  grading and blur effects needed by the inspector. Add the rest in bounded
  catalog increments.
- Add `clip.setEffects` with an inverse. Keep `clip.setFilters` and the seven
  legacy CSS fields unchanged. Shader effects are not pixel-equivalent to CSS
  filters, and the proposed mapping omitted `sepia`; silently adapting saved
  projects would violate the compatibility acceptance criterion. An explicit
  migration can follow only after a pixel-parity suite defines acceptable
  mappings.
- Reuse `Keyframe` and the existing interpolation helpers, but add an effect
  parameter target to the data model. The current `KeyframeableProperty` union is
  closed over transform, audio, and text properties. It cannot represent
  `effectId + parameter`. Add validated effect-parameter tracks and inverse ops
  such as `effectKeyframe.upsert`, `effectKeyframe.remove`, and
  `effectKeyframe.setTrack` rather than encoding paths in strings.
- MCP:
  - `video_list_effect_presets` — catalog + per-parameter ranges and defaults,
    returned from Neuma's runtime catalog. TypeScript declarations are erased at
    runtime and do not provide a stable metadata API. Keep the catalog, Zod
    schemas, UI controls, and effect factory in one module and test that every
    catalog entry resolves to an installed effect export.
  - `video_set_clip_effects`
  - `video_analyze_clip_grade` — measure and propose a *bounded* correction,
    mirroring `media-treatment --analyze`. Proposes; does not apply.
- Frontend: Effects section in `clipInspector/` + `TimelineClipInspector.tsx`;
  all strings in en/zh/es/fr/hi/pt.
- Respect the 350-line component limit — this will want sub-components.

**Acceptance:** `pnpm --filter @neumar/video-ir test`, `pnpm test:fast`, and
`pnpm validate` pass. A project saved before A2 opens and renders identically
after because its legacy filters remain on the legacy path. Invalid effect ids,
unknown params, out-of-range values, duplicate ids, and keyframes targeting
missing effects fail at the schema boundary. An agent-driven "make this clip
warmer and less contrasty" produces a reviewable, invertible op batch.

---

## Phase B — HyperFrames render engine (P0-2)

- Lift the spawn/timeout/progress-streaming helper out of
  `design-mode/hyperframes-renderer.ts` into a shared module; both callers use it.
  (Keep its existing behaviour: absolute output path, `cwd` = composition dir —
  that is what makes Neuma immune to the relative-output-path bug OpenMontage hit
  in `24617af`.)
- Evolve the shared engine contract before adding the adapter:
  - use the IR's rational `FrameRate` shape in `EngineRenderConfig` and engine
    capabilities instead of `number` / `number[]` alone;
  - model alpha output explicitly. HyperFrames `--format webm` is transparent,
    while the current contract already distinguishes `webm` and `webm-alpha`;
  - add typed strictness and source-frame-format options rather than reading
    HyperFrames-specific values from free-form environment variables;
  - replace the boolean-only availability result with a typed probe result that
    can report `not-found`, `version-too-old`, `browser-missing`, and the detected
    version. Keep `installed` in `video_list_engines` for compatibility.
- Add `engines/hyperframes-adapter.ts` registering `EngineId 'hyperframes'`:
  - the availability probe spawns `--version`, parses it, and compares it against
    a required floor;
  - capabilities include rational fps and the actual MP4 and transparent WebM
    output modes;
  - flags: `--fps` (rational-aware), `--video-frame-format` (default `auto`,
    `png` when the composition is flagged as a UI/screen capture),
    `--frames-cache-dir` pointed at a dedicated
    `<project-cache>/hyperframes-extract/` directory under the workspace,
    `--experimental-fast-capture` left at its default (auto-engages, auto-falls
    back), `--vp9-cpu-used` for WebM, `--no-best-effort` when the caller wants
    strictness.
  - use line progress for a single render. HyperFrames only emits final JSON when
    `--batch <rows.json> --json` is supplied, so batch rendering belongs in a
    separate helper and is not the progress protocol for `render()`.
- Keep `html` (Playwright) registered as the fallback. `video_list_engines` must
  report both with honest capability differences. HyperFrames has deterministic
  frame seeking; byte-identical encoding is only an acceptance target for its
  explicit `--docker` reproducible mode, not for the default host render.
- Decide the packaged-runtime policy before implementation. Either ship the CLI
  as a Tauri resource with a browser bootstrap flow, or require it on `PATH` and
  provide a `doctor`-style first-run check. Include CLI and browser version data
  in every render diagnostic.

**Acceptance:** three default HyperFrames renders produce identical sampled frame
hashes and matching ffprobe metadata. When Docker reproducible mode is selected,
three renders produce identical output hashes. Do not assert that `html` outputs
must differ; that would be a flaky negative test. A packaged build reports a
typed unavailable reason before render when the CLI or browser is missing.

---

## Phase C — Studio bridge and beat grid (P1-1, P1-2)

C1 depends on Phase B's packaged-runtime and process-lifecycle decisions. C2 is
independent and can run in parallel.

### C1 — HyperFrames Studio context bridge

- Managed preview lifecycle in the API: allocate a loopback-only port,
  `--background --port <n> --json` on open, `--status` for health, and
  project-specific `--stop` after the final subscriber closes. Make lifecycle
  operations idempotent and reference-counted across panels. Reserve `--kill-all`
  for an explicit doctor action; normal cleanup must not terminate previews owned
  by another project or app instance.
  Handle `preview-not-running`, `ambiguous-preview-server`,
  `preview-port-mismatch`, malformed JSON, and version mismatch as typed boundary
  errors validated with Zod.
- `video_get_html_selection` wrapping
  `preview --context --json --context-fields selection`, feeding the same agent
  context slot as `$selection`. Prefer `selection.target.hfId`; fall back to
  `selector` only when no stable id exists. On `no-selection`, ask the user to
  click the element — do not infer from a screenshot.
- Add a dedicated HyperFrames preview component at the live-preview owner. The
  current `HtmlVideoPanel.tsx` contains `HtmlTemplateSection` and
  `HtmlVideoFrames`; it does not own a raw iframe to replace. Trace the selected
  frame/composition state through `HtmlVideoFrames` and mount
  `<hyperframes-player>` only where that state and lifecycle can be cleaned up.
- Serve `hyperframes-player.global.js` from the pinned packaged resource. Apply
  the existing iframe/CSP boundary, add custom-element TypeScript declarations,
  and test cleanup on React 19 StrictMode remount.
- Hand back Studio URLs in the documented form
  `http://localhost:<port>/#project/<name>`; a URL without the hash is a dead
  link.

**Acceptance:** clicking an element in Studio and saying "make this bigger" in
the Video Agent produces an edit targeting that element's `data-hf-id`.

### C2 — beat grid

- `analysis/beats.ts` produces a versioned beat-grid artifact anchored to its
  source audio clip. Store source-relative beat times, confidence, tempo, and
  optional bar/beat indices. Derive timeline positions from the clip's current
  start, trim, and playback rate.
- Do not write every detected beat through `marker.upsert`. The current marker
  schema has no `kind`, and ripple operations do not move markers. A derived
  artifact avoids hundreds of journal ops and stays correct when the music clip
  moves or is trimmed. If users can promote a beat to an editorial marker, add an
  optional marker kind with a backward-compatible default and define its ripple
  policy explicitly.
- `video_detect_beats`, `video_snap_cuts_to_beats` (proposes an op batch; does
  not apply).
- Timeline UI: beat gridlines in `timeline/` + beat snapping in
  `packages/video-ir/src/snap.ts`.

**Acceptance:** a music-driven project's cuts snap to detected beats, and the
proposed batch is reviewable before commit. Moving, trimming, or changing the
speed of the source music clip updates the derived grid without re-analysis.
Deleting the source clip invalidates the artifact cleanly.

---

## Phase D — skill resync and drift guard (P1-3)

Small enough to do at any point; do it early so the drift check exists before the
next sweep.

- Rewrite `plugins/builtin/design-skills/hyperframes/skills/hyperframes/` as a
  router mirroring upstream 0.8.7's shape. Keep Neuma-specific content (house
  style, project/asset conventions, storage-tree mapping) in its own reference
  file; do not duplicate upstream domain knowledge that
  `hyperframes skills update` will fetch.
- Adopt a non-mutating pin-currency check. Run the installed pinned CLI's
  `upgrade --project . --check --json`, report old to available version, and ask
  before changing a user's project. Do not run `npx ...@latest` or mutate and
  revert a project as an automatic pre-render step.
- **CI check** failing when the bundled skill's recorded upstream version drifts
  from `src-video/package.json`'s `hyperframes` pin. Wire into `pnpm validate`
  next to `check:component-size`.

**Acceptance:** the drift check fails on a deliberately mismatched pin.

---

## Phase E — verification surfaces and agent ergonomics (P2-*)

Pick individually; none blocks another.

| Item | Work |
|---|---|
| `video_compare_variants` | Wrap `hyperframes compare`; return an **image-bearing tool result** (`[{type:'text'},{type:'image'}]`), per OpenReel's `loop.ts::buildToolResultContent` |
| `video_compare_grades` | Wrap `grade-compare`, including `.cube` LUT candidates; pairs with Phase A2 |
| `check --json` in QA | Route into `QaReportPanel.tsx` for HTML compositions — lint + runtime + layout + motion + WCAG AA in one browser session |
| Ref resolution in the dispatcher | Lift `clipIndex` / `atSec` / `trackIndex` → `clipId` resolution out of `video_apply_timeline_ops` into the MCP dispatcher so every clip-taking tool gets it |
| Generated capability doc | Generate the system-prompt tool reference from the registry, with `read-only` / `write` / `destructive` / cost-tier flags inline, so prompt and `permissions.ts` cannot diverge |
| Symbolic-key batch ops | Allow batch ops to declare `key` / `parentKey` and return a key→id map, so multi-clip construction is one call. This also removes the `clip.removeTimeRange` caller-supplied-replacement-clip limitation noted in `12-video-mode-4` |
| Permission metadata audit | Reuse the existing `read \| write \| execute \| destructive \| network` classification and `DESTRUCTIVE_TOOLS` list. Add tests that every registered Video tool has a classification and cost class; do not add a second destructive axis. |
| Typed turn budget | Design this at the shared agent-runtime boundary, not only in Video Mode. Map provider-specific stops into `{ end_turn, max_steps, max_tool_calls, max_tokens, budget, error }` and surface the normalized reason in `AgentDock`. The current Video Agent still passes `maxTurns: 60`, but Claude, Codex, and Cursor do not share one stop protocol. |
| Runtime-selection contract | Present both engines with honest tradeoffs when both are available; log the decision with every option considered; escalate rather than substitute when the chosen engine is unavailable |

---

## Phase F — motion graphics (P3-1)

**Do not start until Phases B and C1 have shipped and the Studio bridge has real
usage.** The decision to make first is (a) native layer engine vs (b) HyperFrames
compositions as the motion-graphics runtime. The evidence in
[`03-sample-findings.md`](03-sample-findings.md) points at (b): OpenMontage
independently concluded that kinetic typography, product promos, launch reels,
and motion graphics all belong on HyperFrames, with Remotion keeping caption burn
and avatar/lip-sync. Phases B and C1 are (b)'s prerequisites, which is the main
argument for sequencing them first.

If (a) is ever chosen, copy OpenReel's separation discipline before its feature
list: a distinct Motion Creator surface, output reaching the main timeline only
through an explicit `insert_motion_into_editor`. That boundary is what keeps a
large tool surface tractable.

---

## Not proposed, and why

- **`@remotion/lambda` / `@remotion/cloudrun`.** Neuma renders locally or through
  its sidecar. Distributed render is a product decision, not an upgrade
  consequence.
- **`.fxpkg`-style signed effect packages.** Genuinely good design
  ([`03-sample-findings.md`](03-sample-findings.md) §B), but Neuma already has a
  plugin system. If effect packaging is wanted, it should extend that system —
  borrowing `.fxpkg`'s *declared requirements + per-ABI resource caps + perf
  budgets* ideas — rather than introducing a second artifact format.
- **`<HtmlInCanvas>` nesting.** Reverted upstream in 4.0.514. Don't design around
  it.
- **Browser-side Whisper.** OpenReel's `whisper-large-v3-turbo` in a worker is
  impressive, but Neuma is a desktop app with a Node sidecar and existing
  transcription; a ~760 MB browser model download is the wrong trade here. The
  transferable piece is narrower: **transcribe only the selected range**
  (`whisper-audio.ts` resamples just the selection), which is worth adopting in
  `analysis/transcript.ts` regardless of engine.
- **Linked captions.** Worth revisiting, but as a scoped follow-up: OpenReel links
  captions to clips explicitly (`captionSourceClipId`) or implicitly (shared track
  `groupId` + time overlap) so clip moves carry captions. Neuma's caption ops are
  token-level and already strong; the gap is only the *link*, and it should be
  scoped against Neuma's existing `clip.link` / `clip.setLinkGroup` ops rather
  than designed fresh.
