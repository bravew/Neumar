# Video Mode Runbook

Video Mode builds an approved storyboard into generated assets and rendered outputs. The implementation is intentionally staged:

1. Source import / auto-cut (phase 1A) creates `SourceMedia`, deterministic analyses, draft `SourceCutPlan`s, and reversible `CutTimeMap`s.
2. The storyboard agent (phase 2) reads project prompt, script, assets, template, and brand kit, then writes `Storyboard`.
3. Approval (phase 3) validates asset plans, duration, and budget before queueing spend-capable jobs.
4. Generation (phase 4) routes image/video plans through `src-api/src/shared/services/media-generation/` via the Video provider facade.
5. Render (phase 5) resolves approved scenes to materialized assets and calls the shared FFmpeg executor. Captions are applied after scene assembly.
6. Audio and captions (phase 6) use the shared `Subtitle[]` model. Local TTS/STT fallbacks are deterministic; paid providers must log usage.
7. B-roll, music, and reframe (phase 7) write provenance and license metadata to `MediaItem.provenance`.
8. MCP (phase 8) exposes the same project verbs through `neuma mcp video-server`.
9. Evaluation and usage (phase 9) report VBench-like scores, scene fit, WER, source-cut recall, and `usage_logs` rollups.

## Architecture

`src-api/src/shared/video/types.ts` is the IR boundary. `MediaItem`, `Scene`, `Clip`, `Subtitle`, and `Transform` intentionally mirror the OpenCut/OpenReel sample vocabulary. Deviations are documented in code comments when the MVP narrows scope, for example the current `BlendMode` union.

User-visible project files live under `<workDir>/videos/<projectId>/`; regenerable render, proxy, transcript, and analysis artifacts live under `<workDir>/.cache/videos/<projectId>/`. Backend reads use `validateInputFile` / `validatePath`; server-side URL imports use the URL validator and the `yt-dlp` wrapper with `--ignore-config`.

The product-facing workflow language is derived in
`src/shared/creative-workflow/`. Video steps stay persisted as
`brief -> board -> plan -> generate -> preview`, while shared UI surfaces map
them to `intent -> assets -> plan -> generate -> review -> export`. Do not add a
second persisted Video step enum just to support the shared workbench display.

## Shared Workbench Rollout

Design and Video share the creative intent entry, workflow header, asset
browser, AI media generation workspace, and project flow viewer. These shared
components are UI shells only; project state still lives in the owning Design or
Video models.

Rollout diagnostics are local-only counters in
`src/shared/creative-workflow/debug-counters.ts`. They record event names,
counts, and last timestamps for entry intent selection, asset search, generation
panel opens, generation submits, flow viewer opens, recovery actions, agent
suggestions, and prompt library usage. Do not add prompts, file paths, project
IDs, asset IDs, or other payloads to these counters. The counters stay in
`localStorage` under the active brand slug and are not sent to the backend.

Animated status indicators and prompt-library video hover previews must respect
`prefers-reduced-motion`. Use the shared reduced-motion hook before adding
autoplay previews or graph/ledger animation.

## Agent Dock Chat Panel

The Video Agent Dock uses the shared chat-panel foundation in
`src/components/shared/chat-panel/`. The shared layer owns normalized message
types, AG-UI accumulation, legacy SSE fallback mapping, generic bubbles,
collapsible tool activity, and `AskUserQuestion` form rendering.

Video-specific behavior stays in `src/components/video/`: `AgentDock` wires the
panel slots, `useAgentDock` owns project history and legacy stream handling,
and `useAgentDockSubmit` adapts composer submissions into video project
context. AG-UI `event: agui` frames go through the shared reducer, then completed
video-mutating tools are promoted to `AgentActionCard` records through
`toolCallToAgentAction`.

Agent-run replay, diagnostics, support export, and compatibility rollback are
documented in `dev-doc/runbooks/multi-mode-reliability.md`. Keep render-job
attempts separate from agent recovery lineage.

The composer is the shared `ChatInput`. Video passes an image/video/audio
attachment policy, preserves the staged `File` objects so they can be uploaded
as project assets, and renders selected project assets through the composer
`beforeInput` slot. Asset context is submitted as `projectAssetIds`, not as file
attachments. The dock model selector sends a per-turn model override through the
Video agent route; keep the selector wired to models the backend honors.

## Templates

Add a template by extending `TemplateId` in backend/frontend video types, adding labels in all six `src/config/locale/messages/*/video.ts` files, and updating the storyboard agent template brief in `src-api/src/extensions/agent/video/tools.ts`.

## Providers

T2V/I2V and image providers go through `src-api/src/shared/video/providers/facade.ts`, which delegates to the existing media-generation router. Do not add a second BytePlus, Gemini, OpenAI-compatible, or Codex media stack. New provider-specific code is only for surfaces the router does not already cover.

TTS, B-roll, and music providers must record provenance, license/commercial-use metadata, and paid calls in `usage_logs`.

## Captions

Caption truth is `Subtitle[]` with optional source anchors. Rendering prefers a prebuilt `src-video`/Remotion artifact when present; otherwise the FFmpeg ASS fallback is acceptable. The render pipeline keeps captions last.

## Timeline Editing

Timeline edits are frame-first. Agent tools and UI commits should convert
playheads, transcript selections, and drag handles into project frames with the
timeline fps before building ops. Avoid ad hoc millisecond math for split,
range-delete, duplicate, move, trim, speed, reverse, rotate, or flip behavior.

Use the named edit builders in `@neumar/video-ir` through the Video MCP tools
or the frontend timeline store. Related changes should apply as one
`timeline.batch` so undo/redo restores the exact previous timeline. Linked A/V
clips default to linked edits; use `primary-only` only for an explicit
single-clip operation supported by the builder.

For visual edits, inspect composited frames before claiming the current state,
apply the edit, then inspect the affected frames again. Speed and reverse edits
must preserve typed `clip.playback` state through preview, Remotion, and FFmpeg.
Rotate and flip edits must preserve existing transform fields unless the caller
explicitly requests a replacement transform.

The persisted schema remains `neuma.video.timeline.v1`. Do not introduce a
`timeline.v2` write path without compatibility tests that prove every existing
project load path migrates or still accepts v1 timelines.

### Clip and track refs

Every clip-taking Video MCP tool resolves refs in its `clipId`, `clipIds`, and
`trackId` fields (including nested ones such as `moves[]`), not just
`video_apply_timeline_ops`:

| Ref | Resolves to |
|---|---|
| `$selection` | The one clip the user has selected or open in the inspector. Ambiguous selections fail rather than guess. |
| `$transcript_selection` | The clip the transcript selection points at. |
| `clipIndex:<n>` | The nth clip (0-based; negatives count from the end) on the resolved track. |
| `trackIndex:<n>:clipIndex:<m>` | Same, naming the track explicitly. |
| `atSec:<seconds>` | The clip covering that project time. |
| `trackIndex:<n>` | Track fields only. |

A bare `clipIndex:` / `atSec:` resolves against an explicit sibling `trackId`,
then the first video track. Resolution runs in the MCP dispatcher and reads the
project **only** when a ref is actually present, so literal-id calls cost
nothing extra. Unresolvable refs return a typed error naming the tool and the
ref — they never fall through to a wrong clip.

`video_apply_timeline_ops` additionally accepts a symbolic `key` on a
clip-creating op: Neuma mints the clip id, later ops in the same batch address
it as `$key:<name>`, and the result appends the key → id map. That is how
multi-clip construction stays one call instead of one round-trip per id.

## Source Auto-Cut Workflow

Auto-cut source editing is transcript-first:

1. Import or attach source footage, creating `SourceMedia` and a project asset.
2. Analyze the source. Word-timestamp ASR writes `SourceMediaAnalysis.transcript`
   plus packed transcript artifacts under
   `<workDir>/.cache/videos/<projectId>/analysis/<contentHash>/`.
3. Inspect decision ranges with `inspect_source_range` when timing, retakes, or
   visual context are ambiguous.
4. Use the first-party `talking-head-auto-cut` plugin to propose a strategy and
   request confirmation before applying destructive timeline edits.
5. Compile approved `CutCandidate`s into reversible `TimelineOp[]`; apply them
   as one project history action and persist the matched proposed action batch.
6. Run `run_bounded_qa` for preview/final checks and review any residual
   structured findings before handoff or export.

Hard media invariants:

- Destructive cuts require word timestamps. Providers that only return
  phrase/text output are marked degraded and can only produce review-only
  candidates.
- Cut edges must not fall inside a word; the compiler rejects mid-word edges even
  if an upstream plugin proposes them.
- Linked A/V clips stay linked through source cuts, with matching split link
  groups after a middle removal.
- Captions are authored on output-timeline offsets after cuts and remain the
  final render overlay step.
- Source-range evidence and packed transcripts are cached by source content hash
  under `.cache/videos`; durable outputs stay under `videos/<projectId>/`.
- Cloud ASR requires explicit per-provider consent and cost visibility before
  upload.

The bounded QA loop is a core service/tool boundary: render, inspect cut
boundary windows, collect structured findings, optionally re-render, and stop at
the configured cap (maximum three attempts). Plugin manifest `until` text is
advisory and must not be treated as a host-enforced loop condition.

## Audio Editing

Use the named audio tools before raw timeline ops:
`video_set_audio_clip_gain`, `video_set_audio_clip_mute`,
`video_set_audio_clip_fade`, `video_set_audio_track_volume`,
`video_set_audio_track_mute`, `video_set_audio_transition`,
`video_crossfade_audio_clips`, `video_duck_audio`,
`video_set_audio_volume_keyframes`, `video_replace_audio_clip_source`,
`video_generate_audio`, and `video_transform_audio`. These tools all route
through the shared TimelineOp reducer and history path, so proposal cards,
undo/redo, Remotion preview, WebCodecs preview, FFmpeg export, and editor
handoff see the same state.

Default music under voiceover to a lower track volume and set
`duckUnderTrackId` on the music track when the user asks for spoken content to
remain clear. Clip-local gain/fades and volume keyframes are previewed and
rendered through the shared audio envelope helper; do not hand-roll alternate
gain math in UI code, Remotion, or FFmpeg.

Generated music, SFX, ambience, voiceover, and transformed replacements must
write `MediaItem.provenance` with provider/model/prompt, cost when known,
license/commercial-use fields when known, `generatedFor`, and `variantOf` for
source replacement. Editor handoff packages include that provenance on media
refs and clip metadata, and conformance warns when external interchange targets
may require manual verification of audio edits.

Direct rubber-band volume editing in the pro timeline remains an escape-hatch
UI only until pointer affordances, snap behavior, op logging, and undo parity
are verified against the same named tool path. Do not expose a separate
non-TimelineOp write path for volume automation.

## Transitions

Visual transition support is registry-driven from
`VIDEO_TRANSITION_REGISTRY` in both frontend and backend video types. Tier 1
transitions render natively in both Remotion and FFmpeg. Tier 1.5 transitions
include effects such as `dissolve`, `cover`, and `reveal` that now have native
Remotion and FFmpeg paths. Tier 2 transitions are quality-rendered through
Remotion (`flip`, `clock-wipe`, `cube`, `zoom-blur`, `zoom-in-out`) and FFmpeg
exports must record `render.transitions.degraded[]` plus a structured
`video.render.transition_fallback_applied` warning when substituting the
fallback. Timeline audio crossfades are explicit audio gain envelopes in
Remotion and `acrossfade` in FFmpeg; do not depend on visual opacity to imply
audio volume.

Final renderer selection lives in `selectFinalRenderer()`: explicit render
options win, `NEUMA_VIDEO_FINAL_RENDERER` is a local override, and timelines
with Tier 2 or FFmpeg-degraded transitions default to Remotion. Backend Remotion
renders serve only the selected local media through a short-lived localhost
server with range support; do not pass `file://` URLs to Remotion media tags or
open a broad filesystem static server.

Timeline transition editing is rolled out behind `video.timelineTransitions`
(default off). When enabled, the side rail exposes the transition preset
library and timeline seams can be edited via drag/drop, seam badges, the clip
inspector, or the agent MCP seam tools. Keep timeline transitions on the
shared `clip.setTransition` TimelineOp path: `video_get_transition_seams`
returns stable seam IDs and constraints, while
`video_set_timeline_transition`, `video_update_timeline_transition`, and
`video_remove_timeline_transition` resolve those IDs and then emit the same op
shape used by `video_apply_timeline_op(s)`. The storyboard-scoped
`video_set_transition` remains a separate scene transition surface.

Agents should call `video_list_transition_presets` instead of the retired
`video_list_transition_kinds` MCP name. `video_suggest_timeline_transitions`
uses conservative editorial grammar: keep cuts by default, prefer subtle fades
for scene or chapter shifts, and only use stylized presets such as cube or flip
when the user explicitly asks for that style. "No change" is a valid answer.

## Vivid Overlays

Vivid overlays are `effect`-kind clips (`effectType: 'vivid-overlay'`) on
`overlay` tracks — animated, transparent-background layers (HTML/CSS
animations, GIF stickers, Lottie, animated titles) in the CapCut style.
Rollout flag: `video.vividOverlays` — a kill switch (on by default; only an
explicit `false` setting disables). The manual QA checklist lives in
`dev-doc/video-mode/07-02-transitions/visual-qa-vivid-overlays-2026-07-06.md`.
Plan + decision trail: `dev-doc/video-mode/07-02-transitions/04-*`.

Engine rules (non-negotiable):

- Every overlay renders from a **self-contained HTML document** compiled by
  `@neumar/video-ir` `overlay-html.ts` (no-network CSP + seek shim injected).
  Authored documents must pass the 12-rule authoring lint — no CSS
  transitions, scroll-driven animation, `repeat:-1`, wall-clock APIs, timers,
  media elements, animated `<img>`, or network URLs; they set
  `window.__overlayReady` synchronously and animate via CSS `@keyframes`,
  WAAPI, or paused GSAP timelines registered in `window.__timelines`
  (HyperFrames-compatible). gif/lottie documents are machine-GENERATED
  (`overlay-generated-documents.ts`, lint-exempt, covered by tests).
- **Determinism rule**: a document is a pure function of time via the shim's
  `__neumaOverlaySeek(tMs)`; every new document must pass a repeat-seek
  pixel-hash gate before shipping.
- Catalog: `VIDEO_OVERLAY_REGISTRY` duplicated frontend/backend and pinned by
  `overlay-registry-parity.test.ts` — edit both together. The entry builder
  and timing math are single-sourced in video-ir (`overlay-timing.ts`).
- Preview: WebCodecs path layers same-origin iframes above the canvas
  (never per-frame DOM rasterization); Remotion preview renders
  `RemotionVividOverlayClip` in-composition BELOW captions.
- Final render: `selectFinalRenderer()` prefers Remotion when vivid overlays
  exist (native, captions stay last). Forced ffmpeg/webcodecs renders apply
  the alpha overlay pass (`overlay-pass.ts`: transparent `NeumaVividOverlayPass`
  composition → ProRes 4444 → ffmpeg `overlay` burn) and must log
  `video.render.vivid_overlays_above_captions` when captions are burned in.
  Never rely on client WebCodecs to encode alpha (Chrome discards it).
- Keep the Remotion-bundled modules (`overlays/registry.ts`,
  `overlays/render-entries.ts`, `remotion-vivid-overlay.ts`) free of node-side
  imports and `@/` runtime imports; server-only logic (plugin preset store,
  asset enrichment) lives in `overlays/server-resolve.ts` and
  `remotion-render-input.ts`.
- Plugin preset packs are DATA-ONLY (`video.overlayPresets` in the plugin
  manifest): built-in backends/documents recombined with labels/controls,
  merged only for trust tiers bundled/saved/local, namespaced
  `plugin:<id>/<preset>`. No third-party code backends. Known v1.5 remainder:
  plugin presets render in final output but are not yet listed in the
  frontend rail (needs a merged-catalog fetch endpoint).

## Capture

Production capture runs through native Tauri commands with scoped capabilities and allowlisted sidecar arguments. Browser `MediaRecorder` is a camera-only development fallback for `pnpm dev:web`; do not treat `getDisplayMedia()` audio behavior as production parity.

## Render Engines

Three engines are registered: `remotion`, `html` (Playwright), and
`hyperframes`. `GET /video/engines` returns each one with its honest
tradeoffs and, when it cannot run on this host, a typed reason
(`not-found` / `version-too-old` / `browser-missing`).

The runtime-selection contract is enforced, not advisory:

- present every available candidate with its tradeoffs before committing
  (`video_list_engines`, `video_select_engine`);
- the decision is logged with every option that was considered;
- an unavailable engine **escalates** — `materializeHtmlStoryboard` pre-flights
  its adapter once per run and throws the typed reason. Neuma never silently
  substitutes a different engine, because the output would differ from what the
  user approved.

Packaged-runtime policy: HyperFrames is required on `PATH`, not bundled (the
CLI drags its own Chrome download). `EngineSetupPrompt.tsx` turns the typed
reason into one copyable install command plus a re-check, so the user meets it
as setup guidance rather than a render failure. Install commands are
data-driven in `src/components/video/engineSetupGuidance.ts`.

## HTML Composition Diagnostics

Three HyperFrames-backed diagnostics are available once the CLI is present:

- `video_compare_variants` — N composition variants at one timestamp into a
  single labeled contact sheet, returned as an inline image plus its path.
- `video_compare_grades` — candidate color grades and/or `.cube` LUTs onto one
  reference frame. Proposes; applies nothing.
- `video_check_html_composition` / `POST /video/projects/:id/html-check` —
  lint + runtime + layout + motion + WCAG AA contrast in one browser session,
  surfaced in the QA panel. Findings are a **result**, not a failure: the CLI
  exits non-zero when it finds issues and the report is still returned.

Inline images are capped and downscaled once by
`src-api/src/shared/video/inline-image.ts`; an oversized sheet degrades to a
path-only result rather than blowing up the turn.

## Output Quality

Final exports run poster extraction, loudness normalization, QA checks, and destination presets through the render queue. SDR outputs must detect HDR inputs and tone-map to Rec.709 before QA. Share/publish flows go through the active `ChannelManager` runtime for Slack/Discord/Telegram/Lark rather than one-off upload code.

## MCP

Development registration:

```jsonc
{
  "mcpServers": {
    "neuma-video": {
      "command": "pnpm",
      "args": ["--filter", "neumar-api", "dev", "--", "mcp", "video-server"]
    }
  }
}
```

Packaged registration:

```jsonc
{
  "mcpServers": {
    "neuma-video": {
      "command": "neuma",
      "args": ["mcp", "video-server"]
    }
  }
}
```

## Turn Budget

Runs end for provider-specific reasons that do not share a protocol across
Claude, Codex, and Cursor. `src-api/src/core/agent/turn-budget.ts` normalizes
them into `end_turn`, `max_steps`, `max_tool_calls`, `max_tokens`, `budget`,
`cancelled`, `refusal`, `error`, or `unknown`, plus an `exhausted` flag.
Normalization runs in `AGUIEmitter` — the boundary every mode's messages cross,
so this is not a Video Mode feature — and ships as the `neuma.turn_budget`
CUSTOM event. `AgentDock` offers Continue only when a ceiling, not a failure,
stopped the run.

## Hard Rules

The render pipeline in `src-api/src/shared/video/pipeline.ts` keeps command arguments as arrays, validates workspace paths, writes durable outputs under `<workDir>/videos/<projectId>/` and regenerable artifacts under `<workDir>/.cache/videos/<projectId>/`, supports reproducible mode flags, and keeps captions as the last overlay step. Source-cut rules live with source analysis/caption sync so no LLM decides destructive edits during encoding.

## Release Gates

Run:

```bash
pnpm validate
pnpm test:fast
EVALS_TIER=gate VIDEO_EVAL=1 pnpm test:gate
```

For release candidates only, run `pnpm test:all`.

Smoke checks:

- Create a slideshow project with three images, generate and approve a storyboard, render `16:9`.
- Set the budget below the high estimate and confirm approval fails.
- Import a local source video, analyze, create/apply a cut plan, sync captions.
- Generate TTS and music assets and confirm usage/provenance is recorded.
- Set clip gain, fades, mute, track volume, and a music-under-voice duck; render
  preview and final export, then inspect editor handoff conformance for the
  audio metadata warning on EDL/CapCut fallback targets.
- Generate a short SFX, place it on `audio-sfx`, transform/replace a voiceover
  clip, and confirm both media refs and clip metadata carry generated provenance.
- Register the MCP server and run `plan_storyboard`, `approve_storyboard`, and `compose`.

## Known Limits

Remotion overlays depend on the packaged renderer artifact. IndexTTS is license-gated. Suno/Udio are intentionally excluded. OpenAI Sora/Videos is not offered as a launch provider while its shutdown/deprecation notice remains active. The MVP supports one active render per project.
