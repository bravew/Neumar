---
summary: "Video Mode backend architecture — staged pipeline, the video IR boundary, preview runtime, agentic editing runtime, render path, linked sources, and storage layout"
read_when:
  - Working on Video Mode API routes, services, or the video agent
  - Adding a video template, provider, transition, or MCP verb
  - Debugging storyboards, the timeline editor, render jobs, or linked-source indexing
title: "Video Mode Backend"
---

# Video Mode Backend

Video Mode turns an approved storyboard into generated assets and rendered video
outputs. It is a local-first, phase-gated pipeline: **plan → approve → generate →
render → evaluate**. An agentic editing runtime sits alongside the pipeline so
users can converse with an agent that proposes reviewable timeline edits.

The implementation reference and release gates live in
[`dev-doc/runbooks/video-mode.md`](../../dev-doc/runbooks/video-mode.md). This
document is the architecture map.

## Source Map

| Area                          | Source                                                       |
| ----------------------------- | ------------------------------------------------------------ |
| HTTP routes                   | `src-api/src/app/api/video.ts`                               |
| IR boundary (data model)      | `src-api/src/shared/video/types.ts`                          |
| Project persistence           | `src-api/src/shared/video/store.ts`                          |
| Render orchestration          | `src-api/src/shared/video/pipeline.ts`, `engines/`           |
| Timeline IR + ops             | `src-api/src/shared/video/timeline.ts`, `timeline-ops.ts`    |
| Render plan / scene cache     | `src-api/src/shared/video/render-plan.ts`, `render-cache.ts` |
| Job queue                     | `src-api/src/shared/video/jobs.ts`                           |
| Render engines                | `src-api/src/shared/video/engines/`, `remotion-*.ts`, `webcodecs-renderer.ts`, `render-asset-server.ts` |
| Preview renderer / timeline UI | `src/components/video/preview/`, `src/components/video/timeline/` |
| Timeline transition UI        | `src/components/video/transitions/`, `src/components/video/clipInspector/TransitionInspectorPanel.tsx`, `src/components/video/timeline/TimelineTrackTransitions.tsx` |
| Timeline transition seams     | `src-api/src/shared/video/transition-seams.ts`, `src/components/video/timeline/timelineTransitions.ts` |
| Vivid overlay catalog / saved presets / render | `src/shared/video/overlays/`, `src-api/src/shared/video/overlays/`, `src-api/src/shared/video/overlay-pass.ts`, `packages/video-ir/src/overlay-*` |
| Composer link previews         | `src-api/src/shared/link-preview.ts`, `src/shared/video/link-preview.ts`, `src/components/video/ExternalLinkPreviews.tsx` |
| Captions / TTS / music        | `src-api/src/shared/video/captions.ts`, `caption-generate.ts`, `caption-retime.ts`, `caption-word-render.ts`, `tts.ts`, `music.ts` |
| B-roll / reframe / auto-color | `src-api/src/shared/video/broll.ts`, `reframe/`, `auto-color.ts` |
| Provider facade               | `src-api/src/shared/video/providers/facade.ts`               |
| Linked sources                | `src-api/src/shared/video/linked-sources/`                   |
| Source analysis / auto-cut    | `src-api/src/shared/video/analysis/`, `src-api/src/shared/video/store.ts` |
| Catalog asset bridge          | `src-api/src/shared/video/catalog-assets.ts`                 |
| Asset aspect / frame search   | `src-api/src/shared/video/asset-aspect.ts`, `src-api/src/shared/video/visual-asset-fit.ts`, `analysis/frame-index.ts` |
| Video plugins                 | `src-api/src/shared/video/plugins/`, `src-api/src/app/api/video-plugins.ts` |
| QA / eval / usage             | `src-api/src/shared/video/qa.ts`, `qa-loop.ts`, `eval.ts`, `usage.ts` |
| Storage browser               | `src-api/src/shared/video/storage-tree.ts`                   |
| Agentic runtime               | `src-api/src/shared/video/agent-sdk.ts`, `agent-tools.ts`, `agent-actions.ts` |
| Agent dock history            | `src-api/src/shared/video/agent-history.ts`                  |
| Entry / workflow UI           | `src/app/pages/VideoMode/index.tsx`, `VideoEntryActions.tsx`, `src/components/video/ProjectEditor.tsx`, `src/shared/creative-workflow/` |
| Recipes / intent log          | `src-api/src/shared/video/recipes.ts`                        |
| HTML / Motion templates       | `src-api/src/shared/video/templates/`, `packages/video-ir/`  |
| Capture alignment             | `src-api/src/shared/video/capture/align.ts`                  |
| Editor handoff                | `src-api/src/shared/video/editor-handoff/`                   |
| Video agent extension         | `src-api/src/extensions/agent/video/`                        |
| MCP video servers             | `src-api/src/shared/mcp/video-server/`, `video-edit-server.ts` |
| Media generation              | `src-api/src/shared/services/media-generation/`              |
| Cloud render                  | `src-api/src/shared/services/render/`                        |
| DB migrations                 | `src-api/src/shared/db/migrations/027`–`033`                 |
| Native capture / teleprompter | `src-tauri/src/capture.rs`, `teleprompter.rs`                |

## Project Workflow UI

Video project persistence still uses the editor steps `brief`, `board`, `plan`,
`generate`, and `preview`. The product-facing workbench derives a separate read
model in `src/shared/creative-workflow/` so DesignMode and VideoMode can share
labels and status display without changing the stored Video IR.

- `VideoModeRoute` renders the entry shell with `CreativeIntentEntry`,
  `VideoProjectEntryDialogs`, rename/delete dialogs, and the inline
  `NewVideoProjectForm`.
- The entry intent picker supports design, video, image, audio, assets,
  template, and import intents. VideoMode disables `assets`; design, image, and
  audio intents route into DesignMode, while video/template/import intents open
  the video project dialog with appropriate defaults.
- `ProjectEditor` renders `CreativeWorkflowHeader` above the existing
  `ProjectStepper`. The shared header maps `intent` and `assets` to Brief,
  `plan` to Storyboard/Plan, and `review`/`export` to Preview. Selecting
  `assets` also opens the right rail on the Assets tab.
- `deriveVideoCreativeWorkflowState()` builds status from prompt/script,
  project and linked assets, storyboard/timeline approval, generated media, and
  render output. Render failure marks Review as failed and switches the primary
  action to recovery.

## Staged Pipeline

The pipeline is intentionally staged so that no paid work runs before a human
approves a cost estimate, and so destructive edits are never left to an LLM.

1. **Source import / auto-cut** — Imports create source media, deterministic
   analyses, transcript artifacts, draft cut plans, and reversible time maps.
   `analyzeSource()` runs local/cloud STT through the speech router, estimates
   ASR cost by data egress, writes `source-transcript` and `packed-transcript`
   artifacts when audio exists, and degrades cut candidates to `review-only`
   when transcription cannot produce word timing. Server-side URL ingestion for
   composer context uses safe network policy. YouTube footage imports use
   `video_import_youtube` / `importYoutubeBroll()` and store assets with
   `youtube-unverified` provenance; plugin-triggered YouTube acquisition is
   still gated by the `network:youtube` capability.
2. **Storyboard planning** — The video agent reads the project prompt, script,
   assets, template, and brand kit, then writes a `Storyboard`.
3. **Approval** — Validates asset plans, total duration, and budget before any
   spend-capable job is queued. Over-budget storyboards cannot be approved.
   `renderProject()` is gated server-side on `storyboard.status === 'approved'`,
   and any storyboard edit reverts the status to `edited`. The gate is cleared
   either from the editor UI (the Approve button → `POST
   /projects/:id/storyboard/approve`) or from chat via the video-edit MCP tool
   `video_approve_storyboard` — both call `approveStoryboard()`, so the agent can
   approve and render in one turn without a UI click.
4. **Generation** — Image/video/audio plans route through the media-generation
   service via the provider facade.
5. **Render** — Approved scenes resolve to materialized assets and render through
   the engine registry. The Remotion adapter handles native React compositions
   and HTML-frame bridge renders; the HTML adapter captures frame documents with
   Playwright. FFmpeg remains the default local path for supported timeline
   exports, while the WebCodecs renderer is selected for local final renders
   whose visual transitions need the browser/WebGL compositor to preserve
   parameters. Captions are always the last overlay step.
6. **Audio & captions** — Caption truth is shared between storyboard subtitles
   and caption timeline clips. Local TTS/STT fallbacks are deterministic; paid
   providers must log usage. Speech-to-text caption generation writes
   source-anchored caption clips, and generated cues are retimed after timeline
   edits.
7. **B-roll, music, reframe** — Write provenance and license/commercial-use
   metadata to the media item.
8. **MCP** — The same project verbs are exposed through the video MCP server.
9. **Evaluation & usage** — Reports VBench-like scores, scene fit, WER,
   source-cut recall, cut-boundary issues, duration mismatch, and `usage_logs`
   rollups.

`pipeline.ts` keeps FFmpeg command arguments as arrays, validates every
workspace path, writes only under `.neuma/video`, supports reproducible-mode
flags, and keeps captions last. Source-cut decisions live with source analysis
and caption sync so no LLM drives a destructive edit during encoding.

## Source Analysis and Auto-Cut

Imported source media is tracked separately from generated project assets:
`SourceMedia` records the source origin and rights acknowledgement, while
`SourceMediaAnalysis` stores deterministic analysis output for the current
content hash.

- `transcribeSourceMedia()` extracts PCM audio under workspace path validation,
  routes transcription through `shared/services/speech/router.ts`, records
  whether audio stayed local or went to a cloud provider, and caches transcripts
  by source content hash and provider key. Cloud transcription can be skipped
  until the project has an explicit cost approval.
- `packTranscript()` groups word-level transcript data into compact phrases for
  agent context. `getPackedTranscript()` returns matching `packed-transcript`
  artifact payloads without re-running transcription.
- `buildAutoCutCandidates()` derives non-destructive cut candidates from long
  silence gaps and filler words. Candidates carry stable ids, ASR evidence,
  confidence, and a recommendation; degraded transcripts produce review-only
  suggestions.
- `createCutPlan()` converts selected candidates into keep ranges and a time
  map. `applyCutPlan()` requires an approved plan, compiles matching timeline
  ranges through `compileSourceCutPlanTimelineOps()`, rejects mid-word cuts, and
  applies timeline ops atomically through the normal journal/history path.
- `inspectSourceRange()` writes a `source-range-evidence` artifact with a
  compact filmstrip, waveform bins, word labels, and warnings for unavailable
  evidence. The MCP tool `inspect_source_range` exposes this to plugin-backed
  review flows.

Analysis artifact kinds are centralized in `ANALYSIS_ARTIFACT_KINDS` and now
include `packed-transcript`, `source-range-evidence`, and action-batch metadata
for cut-plan application. Keep artifacts cache-backed and content-hash scoped so
stale analyses do not survive source replacement.

## Generated Captions

`video_generate_captions` is the agent-facing path for real spoken-word
captions. It calls `generateProjectCaptions()` from `caption-generate.ts`,
transcribes each target timeline video clip, and writes time-synced
`CaptionTimelineClip` cues onto the caption track.

- Uploaded or linked assets that were never imported as sources are first
  registered through `ensureSourceForAsset()`, so caption generation works for
  normal project assets as well as imported sources.
- `resolveTranscript()` reuses cached source transcripts when possible and
  falls back to `transcribeSourceMedia()` when the asset needs analysis.
- `buildClipCues()` maps source word timings through clip trim and playback
  speed into timeline cue ranges. Each generated cue carries
  `STT_CAPTION_ORIGIN`, a `sourceAnchor`, and optional word timings for animated
  caption styles.
- `replaceSttCaptionClips()` swaps only STT-origin cues and preserves manual or
  capture-origin captions, which makes generation idempotent.
- `retimeTimelineCaptions()` runs after timeline mutations, while
  `carryForwardSttCaptions()` preserves generated cues across storyboard /
  timeline rebuilds when the source speech still exists.
- `caption-word-render.ts` is shared by live preview and headless render so
  `tiktok-word`, `hormozi-bold`, and `karaoke` captions animate per word in
  both paths.

## The IR Boundary

`src-api/src/shared/video/types.ts` is the single source of truth for the video
data model. Define a new IR element once here, then use it everywhere.

- **`MediaItem`** — An asset (video, image, or audio) with `kind`, `path`,
  metadata (duration, sample rate, subtitles), and `provenance` (provider,
  model, cost, license, commercial-use).
- **`Storyboard` / `StoryboardScene`** — The plan IR. A scene carries an intent,
  duration, caption, transition, and an `assetPlan` union (`ai-image`, `ai-clip`,
  `broll-search`, `tts-narration`, `source-asset`, `linked-asset`, `lipsync`).
- **`ContentGraph`** — The HTML / Motion video IR in `packages/video-ir/`.
  Nodes represent data frames, media frames, text frames, and composition
  artifacts; graph validation enforces topological ordering and frame
  references before render.
- **`VideoTimeline` / `TimelineClip`** — The editable timeline migrated from the
  approved storyboard. Tracks are typed (`video`, `broll`, `overlay`,
  `audio-vo`, `audio-music`, `audio-sfx`, `caption`). Clips carry trims,
  transforms, visual transitions on the outgoing clip (`transitionToNext`),
  audio seams, filters, typed playback state (speed, reverse, mute), clip-local
  `KeyframeTrack[]`, and fade bookends. The timeline also carries marker
  metadata (`timeMs`, `label`, `color`, `isChapter`, `comment`) plus optional
  intro/outro fade bookends. The timeline holds an undo/redo history.
- **`Subtitle`** — Caption truth, with style and optional source anchors back to
  the original media.
- **`AnalysisArtifact`** — Analysis outputs associated with a source content
  hash or project render. Artifacts can point at cache files, range metadata,
  proposed timeline op batches, and generated-at timestamps.
- **`SourceCutPlan`** — A reviewable source-edit plan with draft / approved /
  applied / rejected status, keep ranges, cut candidates, and the
  source-to-output time map used by transcript and cut-boundary QA.
- **`Transform`** — Clip geometry (scale, position, opacity, rotation, crop),
  canvas fit (`cover`, `contain`, `fill`, `blur-pad`), and optional
  `background` color behind contain-fit media.
- **`AspectRatio`** — `16:9` | `9:16` | `1:1` | `4:5`.
- **`VIDEO_TRANSITION_REGISTRY`** — The transition catalog, shared by frontend
  and backend, organized in tiers (see below).

The timeline compiles to an Edit Decision List that the renderer consumes.
When a visual clip references an asset and has no explicit transform,
`inferDefaultVisualAssetTransform()` supplies a renderer-side default. Likely
logos use `contain` with a white background, while severe aspect-ratio
mismatches use `blur-pad` so portrait, square, and landscape assets are not
silently cropped into the wrong canvas.

## Transitions

Visual transition support is registry-driven from `VIDEO_TRANSITION_REGISTRY`,
which is shared by the frontend, MCP server, render adapters, preview badges,
and inspector controls. Preset entries include render support, fallback rules,
directions, label/description keys, group, default/min/max duration,
`webglPreview`, recommended editorial use, optional `paramDefs`, and optional
`timingDefs`. Runtime transition values are normalized through
`normalizeTransition()` and the shared `@neumar/video-ir` parameter helpers so
unknown params are dropped and supported params are clamped before preview,
render, template validation, and MCP edits consume them.

- **Tier 1** (`cut`, `fade`, `slide`, `wipe`) render natively in both Remotion
  and FFmpeg.
- **Tier 1.5** (`iris`, `dissolve`, `soft-wipe`, `pixelize`, `polygon-iris`,
  `cover`, `reveal`) have mixed renderer support. `transition-quality.ts`
  decides whether a requested transition is native, custom, degraded to a
  fallback, or unsupported for each final render path.
- **Tier 2** (`flip`, `clock-wipe`, `cube`, `zoom-blur`, `zoom-in-out`) are
  higher-motion effects. FFmpeg and Remotion exports must record
  `render.transitions.degraded[]` and emit
  `video.render.transition_fallback_applied` when substituting; WebCodecs final
  renders use the WebGL transition catalog directly and do not report those
  degradations.

Timeline transition editing is behind `video.timelineTransitions`, which
defaults on and acts as a kill switch when explicitly set to `false`.
`SideRail` exposes a Transitions tab whose searchable preset tiles drag
`video-transition` payloads onto adjacent visual-clip seams.
`TimelineTrackTransitions` draws ghost targets during drag, persists the chosen
transition to the outgoing clip's `transitionToNext`, and renders selectable
badges for existing transitions. The inspector uses the same seam id to edit
kind, duration, direction, and any transition-specific parameters, or remove the
transition back to a cut. Current parameterized presets include `clock-wipe`
(`startAngle`, `sectors`, `feather`, `center`, `edgeColor`, `sweep`),
`soft-wipe` (`angle`, `softness`, `reverse`), `pixelize` (`squaresMin`,
`steps`), and `polygon-iris` (`sides`, `rotation`, `center`, `feather`).

Local final render selection is automatic in `selectFinalRenderer()`: explicit
requests win, `NEUMA_VIDEO_FINAL_RENDERER` can override, otherwise FFmpeg is
used unless a seam prefers WebCodecs because the FFmpeg path would degrade a
transition whose WebGL preview is native. Cloud renders cannot use the browser
compositor and fall back to Remotion for a requested WebCodecs render. The
WebCodecs renderer launches the hidden `/video-render-host` route, serves
project assets through a temporary localhost asset server with range support,
streams encoded MP4 video chunks back to the API, then muxes audio and bookend
fades with FFmpeg.

The hidden render host classifies export failures with the shared
`classifyExportError()` vocabulary before returning `{ ok: false, code, error }`
to `webcodecs-renderer.ts`. The backend attaches that code to the thrown error
and logs it as `error_code` in `video.webcodecs.render_failed`, so render failures
group by stable codes instead of raw browser or encoder messages.

Seams are deterministic: `seam:${trackId}:${fromClipId}:${toClipId}`. Both the
frontend seam model and the backend MCP seam model derive seams only from
ordered visual clips that touch within one frame. Blocked seams report why they
cannot accept a transition (`gap`, `locked-track`, or `too-short`). Duration is
clamped to the smaller of the preset maximum, the global 3000ms maximum, and
half of each neighboring clip duration, with a 33ms minimum.

The timeline op reducer preserves those invariants after unrelated edits. If a
neighboring clip trim shortens the seam, `repairTransitionSeamInvariants()`
re-clamps the duration. If a move, delete, or split breaks the expected adjacent
target, it clears the transition or moves an outgoing split transition to the
piece that still touches the original target. This keeps `transitionToNext`
attached only to a valid visual seam.

Timeline audio crossfades are explicit gain envelopes in Remotion and
`acrossfade` in FFmpeg — visual opacity never implies audio volume.

## Vivid Overlays

Vivid overlays are effect clips on overlay tracks, gated by the
`video.vividOverlays` kill switch. The flag defaults on; only an explicit stored
`false` disables the layer.

The IR is additive to `timeline.v1`: overlay instances are `kind: 'effect'`
clips with `effectType: 'vivid-overlay'` and a validated `params` payload
(`presetId`, `backend`, typed controls, optional `sourceAssetId`, and loop mode).
The shared video-ir helpers enforce overlay-track placement, exclude effect
clips from transition seams, derive frame-domain render entries, and keep loop /
hold timing consistent across preview and final render.

The preset catalog is duplicated in the frontend and backend registries and
pinned by `overlay-registry-parity.test.ts`. Built-ins cover HTML callouts,
titles, social cards, badges, reactions, progress indicators, widgets, screen
effects, frames, text-motion titles, GIF stickers, and first-party Lottie
bursts. `OverlayLibraryRail` exposes the catalog in the side rail with search,
category chips, and hover/focus card previews. Cards render the real instantiated
overlay document in a sandboxed iframe, seek to a poster frame at rest, cap
concurrent animation loops, and unmount off-screen previews.
Preset entries also carry tags plus optional taste metadata (`bestFor`,
`avoidWhen`, restraint, reduced-motion fallback, and motion tokens), which the
Video agent uses to choose overlays that fit the source footage instead of only
matching category names.

Dropping a preset onto an overlay track creates an effect clip through the normal
timeline op path. `OverlayClipSection` edits loop mode plus each preset's text,
number, color, select, or toggle controls. It also exposes the motion-template
picker backed by `VIVID_OVERLAY_MOTION_TEMPLATES`; applying a template replaces
only the affected keyframe tracks and records `params.motionTemplate`
provenance. Current templates are `entrance.fade-up`, `entrance.scale-in`,
`emphasis.pulse`, `emphasis.shake`, `attention.ping`, `exit.fade-out`, and
`ambient.float`, with `subtle` / `normal` / `strong` strength multipliers.

Non-asset-backed clips can be saved in two forms from the inspector:

- **Saved presets** are data-only bookmarks over built-in presets. They persist
  `name`, `basePresetId`, control values, optional loop mode, and `createdAt` in
  `<workDir>/.neuma/video/user-overlay-presets.json`. They never introduce a new
  runtime preset id; dropped saved presets still reference the built-in preset id
  with saved controls merged over defaults.
- **Overlay styles** are reusable full looks over built-ins. They persist
  control values plus optional transform, keyframes, tags, taste metadata, and
  provenance in `<workDir>/.neuma/video/user-overlay-styles.json`. Dragging a
  style creates a built-in overlay clip with those controls, transforms, and
  keyframes pre-applied.

Asset-backed presets such as GIF stickers are intentionally not saveable because
they require a source asset. Local GIF and Lottie imports live in the workspace
overlay library instead: `saveImportedOverlayItem()` validates file type and
size, writes bytes under `<workDir>/.neuma/video/overlay-imports/`, and records
metadata in `<workDir>/.neuma/video/imported-overlays.json`. The import library
is workspace-scoped; project attachment remains separate so imports do not leak
directly into project timelines.

User-generated overlay documents are a third path, separate from built-ins and
local media imports. `saveUserOverlayDocument()` requires explicit user
confirmation, lints and compiles HTML through `compileOverlayDocument()`, stores
source/compiled HTML plus controls/tags/lint issues in
`<workDir>/.neuma/video/user-overlay-documents.json`, and rejects documents that
fail the deterministic overlay authoring contract.

The overlay API surface lives in `video.ts`:

- `GET /video/overlay-presets` lists saved presets.
- `POST /video/overlay-presets` validates the built-in base preset and control
  values, then saves a derived preset.
- `DELETE /video/overlay-presets/:id` removes a saved preset.
- `GET /video/overlay-styles`, `POST /video/overlay-styles`, and
  `DELETE /video/overlay-styles/:id` manage full saved looks.
- `GET /video/overlay-styles/export` and `POST /video/overlay-styles/import`
  round-trip the user style library with the
  `neuma.video.user-overlay-styles.v1` schema.
- `GET /video/overlay-imports`, `POST /video/overlay-imports`,
  `GET /video/overlay-imports/:id/asset`, and
  `DELETE /video/overlay-imports/:id` manage local GIF/Lottie imports.
- `GET /video/overlay-documents`, `POST /video/overlay-documents`, and
  `DELETE /video/overlay-documents/:id` manage user-generated overlay documents.

The video-edit MCP server exposes `video_list_overlay_presets` for the full
catalog, `video_save_overlay_preset` for simple saved presets,
`video_save_overlay_style_from_template` for video-to-template v2 styles,
`video_save_user_overlay_document` for explicitly approved custom documents, and
`video_apply_overlay_motion_template` for named motion recipes. The save tools
normalize CSS color names to hex before persisting, and external MCP calls
remain proposal-only unless direct apply is explicitly enabled. Agent context
summaries include editable overlay controls, numeric control keyframes, and
motion-template provenance via `vividOverlayContextSummary()`, so the agent can
modify the selected overlay in-place with `video_set_overlay_controls` and
`video_set_overlay_control_keyframes`.

Video plugins may contribute data-only overlay preset packs through
`metadata.neuma.videoManifest.overlayPresets`. Registration accepts only trusted
tiers (`bundled`, `saved`, `local`), namespaces ids as `plugin:<pluginId>/<id>`,
and rejects any preset that references a non-built-in document. Plugins can
recombine existing overlay backends/documents with their own labels and control
defaults, but cannot ship executable overlay code through this path.

Both preview renderers share the same render-entry builder. The Remotion preview
draws overlay documents in composition, while the WebCodecs preview layers
seekable iframe documents above the canvas. Headless Remotion final render draws
vivid overlays in composition below captions and is therefore preferred whenever
vivid overlays are present. Forced FFmpeg or WebCodecs final renders call
`applyVividOverlayPass()`: Remotion renders an overlay-only ProRes 4444 alpha
pass, FFmpeg burns it over the base video, and the backend logs the known
caption-ordering deviation because captions are already in the base render on
those paths.

## Preview Runtime

Preview is a frontend runtime and is not the render authority. It exists so the
editor can scrub, inspect, and play the current timeline without enqueueing a
render job.

- **Renderer selection** — `PreviewRenderer` uses `WebCodecsPreview` when the
  `video.webcodecsPreview` flag is enabled and browser capabilities are present;
  otherwise it falls back to `LazyRemotionPreview`. The flag defaults on and is
  a kill switch: only an explicit stored value of `false` disables it.
- **Capability check** — `useWebCodecsCapabilities()` requires `VideoDecoder`,
  `VideoFrame`, Canvas2D, and either `AudioDecoder` or Web Audio. Linux is
  rejected for this path. Unsupported capabilities or decode failures set a
  local failure reason and fall back to Remotion for the session.
- **WebCodecs path** — The fast preview path builds the same
  `RemotionPreviewData` as the fallback, decodes video frames through
  `VideoFrameCache`, draws visual layers with `Compositor`, plays audio through
  `WebCodecsAudioEngine`, and advances frames with `PlaybackClock`.
- **Shared timeline state** — `useTimelineUiStore` is the sync contract between
  preview and timeline (`playheadMs`, `playheadUpdateSource`, `playbackState`,
  and transient `hoverMs`). `useTimelineHoverPreview` updates `hoverMs` on
  mouse movement, snaps to frame boundaries, and clears while playback, clip
  moves, or lasso selection are active.
- **Display controls** — `PreviewStepHeader` owns aspect-ratio and playback-rate
  controls. Both preview renderers accept the same `playbackRate`, so speed
  changes do not depend on the active preview backend.

## The Video Agent

`src-api/src/extensions/agent/video/` runs a permission-scoped Claude context
for conversational editing (provider id `video`).

- **`index.ts`** — Builds the session with in-process video-edit, media, and
  FFmpeg MCP servers, pins the video-editing skill, and routes generated media
  into the project assets directory rather than the generic output folder.
  Bash/Write/Edit/Glob/Grep are disallowed; only the video, media, FFmpeg, and
  read/web tools are permitted. The run receives the UI-selected model,
  conversation history, aspect ratio, selected assets, editor selection, and any
  video plugin context (`pluginId`, inputs, approved capabilities, reviewed
  digest, and signature status).
- **`tools.ts`** — Project reads (`get_project`, `list_assets`, `get_script`,
  `get_brand_kit`, `get_template_brief`), storyboard verbs (`plan_storyboard`,
  `set_storyboard`, `estimate_cost`, `request_approval`), and linked-source verbs
  (`search_linked_assets`, `list_folder_children`, `preview_asset`,
  `attach_asset`, `sync_source`).
- **`system-prompt.ts`** — Teaches the IR, enforces one action per turn, and
  states the hard rules (captions last, audio fades at boundaries, word-safe
  cuts, no LLM-driven deletions).
- **`permissions.ts`** — Classifies tools read / write / destructive. Generation
  and render require approval; read-only verbs auto-allow so verify loops don't
  prompt.
- **`cost-hook.ts`** — Accumulates `cost_usd` from tool results per session for
  live budget tracking.
- **`asset-ingest-hook.ts`** — Parses media-tool output, validates workspace
  containment, and registers produced files as project assets with
  session-scoped deduplication.

Agent turns are journaled (`recipes.ts`, `agent-tools.ts`): each proposed and
applied operation is recorded with a diff summary, so edits are individually
undoable/redoable through the agent journal API.

The agent now has first-class visual-editing verbs:

- **Aspect analysis** — `video_analyze_assets` compares project media dimensions
  to the target canvas and recommends `cover`, `contain`, `pan`, `blur-pad`, or
  `ask` before the storyboard is built.
- **YouTube import** — `video_import_youtube` downloads a pasted YouTube URL into
  the project and returns a normal video asset that can be placed on a scene.
- **Frame grounding** — `video_inspect_timeline_frames` renders composited
  Remotion frames for a timeline range; `video_search_frames` indexes and
  searches visual frame captions through `media_frames` plus optional vector
  search. Frame search is behind `video.frameSearch` and degrades to transcript,
  metadata, and moment search when disabled.
- **Clip keyframes** — `video_set_keyframes` replaces or clears per-clip
  keyframe tracks for opacity, transforms, crop, volume, and caption animation.
- **Editor handoff** — `video_get_handoff_conformance` and
  `video_export_editor_handoff` let the agent check NLE target support before
  exporting a package.
- **Named timeline edit tools** — `video_cut_clip`, `video_cut_range`,
  `video_duplicate_clips`, `video_delete_clips`, `video_move_clips`,
  `video_set_clip_speed`, `video_reverse_clip`, rotation/flip/frame/filter
  tools, and caption tools wrap timeline ops in user-facing verbs. They
  validate project-frame inputs, preserve linked clips by default, and can
  propose edits or apply atomic batches depending on `applyMode`.
- **Timeline transition tools** — `video_list_transition_presets` returns the
  transition catalog; `video_get_transition_seams` returns editable visual seams
  with adjacent clip context, constraints, current transitions, and blocked
  reasons; `video_set_timeline_transition`, `video_update_timeline_transition`,
  and `video_remove_timeline_transition` resolve seam constraints into
  `clip.setTransition` ops; `video_suggest_timeline_transitions` proposes
  conservative changes and treats a hard cut as a valid outcome. External MCP
  calls return proposals unless direct apply is explicitly enabled.
- **Named audio edit tools** — `video_set_audio_clip_gain`,
  `video_set_audio_clip_mute`, `video_set_audio_clip_fade`,
  `video_set_audio_track_volume`, `video_set_audio_track_mute`,
  `video_set_audio_transition`, `video_crossfade_audio_clips`,
  `video_duck_audio`, `video_set_audio_volume_keyframes`, and
  `video_replace_audio_clip_source` wrap clip- and track-level mixing in named
  verbs. They route through the shared TimelineOp reducer and history path, so
  proposal cards, undo/redo, the WebCodecs and Remotion preview paths, FFmpeg
  export, and editor handoff all see the same audio state. Clip-local gain,
  fades, and volume keyframes resolve through one shared audio-envelope helper —
  do not hand-roll alternate gain math; keyframed export gain is capped to
  prevent digital clipping.
- **Generated & transformed audio** — `video_generate_audio` produces music,
  SFX, ambience, or voiceover, and `video_transform_audio` cleans up, extends,
  remixes, replaces, or re-voices an existing clip in place. Both write
  `MediaItem.provenance` (provider/model/prompt, cost when known,
  license/commercial-use, `generatedFor`, and `variantOf` for source
  replacement) that flows through to editor handoff.

The current-context contract is explicit. The UI can send selected scene,
selected clip ids, playhead time, preview frame, transcript range, aspect ratio,
and explicitly selected project asset ids with an agent turn. The agent should
call `video_get_current_context` before resolving pronouns such as "this",
"selected", or "current clip"; it can request `scene`, `selection`,
`previewFrame`, `timelineWindow`, and `assets` sections. Timeline mutations
should prefer `video_apply_timeline_ops` batches so related changes are atomic
and undo as one journal entry. Transcript-selection edits resolve through
`resolverRefs.transcriptSelection`; selected catalog-backed assets must be
hydrated with `video_attach_asset` before media tools use their file paths.

Composer source ingestion is separate from media import. When a user pastes up
to two HTTPS URLs into the Video agent composer, the frontend and API can fetch
readable article or GitHub repository text under the safe network policy and
append that text to the prompt. The MCP tool `video_fetch_source` exposes the
same safe-fetch path to the video agent.

Composer link previews are presentation-only and use `/link-preview`: pasted
links are resolved into YouTube/Vimeo video cards, direct image cards, generic
website cards, or `unsupported`. Preview fetches use `safeFetch()`, the external
API network policy, byte/time limits, and a short LRU cache; they do not grant
the agent additional file or network access.

## API Routes

`src-api/src/app/api/video.ts` mounts the route surface, grouped by capability:

- **Projects** — list/get/delete, storage tree, output, poster.
- **Storyboard** — read, approve, reject, render plan.
- **Timeline** — read, undo, redo; agent intent log and journal undo/redo.
- **Assets** — upload, delete, stream, filmstrip, audio peaks, proxy create/delete.
- **Sources & cut plans** — import (upload / path / URL), analyze, apply cut plan.
- **Captures** — list and import recorder takes.
- **Captions** — sync, patch, split, merge, and relink caption cues; generated
  STT captions are created through the video agent tool surface.
- **Agent history** — get/put the Video agent dock conversation at
  `/projects/:id/agent-history`.
- **Linked sources** — connect/remove/sync; linked-asset search, recents,
  favorites, thumbnail, preview, opened.
- **Plugins** — list/apply video plugins, import/export bundles, detect/dismiss/save
  reusable plugin candidates under `/plugins`.
- **Render** — status and cancel; render queue list and cancel.
- **Render events** — resumable render progress SSE via
  `/projects/:id/render/subscribe`, with replay by `Last-Event-ID` or `?from=`.
- **Editor handoff & reframe** — enqueue/read handoff jobs and create alternate
  aspect outputs from a 16:9 master.
- **Templates & recipes** — list/get; delete custom templates.
- **Providers & render providers** — list/test/delete; cloud render provider config.
- **Usage & eval** — per-project and global usage; eval report.
- **Messages** — agent conversation history.

## Media, TTS, Music, and Lip-sync

All visual generation routes through `providers/facade.ts` into
`src-api/src/shared/services/media-generation/` (router + adapters:
`byteplus`, `gemini`, `openai`, `openai-compatible`, `codex`, `hedra`,
`leonardo`). Do not add a second per-vendor media stack — extend the router.

- **TTS** (`tts.ts`) — Kokoro (free/local), ElevenLabs, OpenAI TTS, and others;
  IndexTTS is license-gated.
- **Music** (`music.ts`, `plugins/atoms/music-select.ts`) — ElevenLabs Music,
  Stable Audio, and MiniMax Music; Suno/Udio are intentionally excluded. Music
  writes provenance and commercial-use metadata.
- **Lip-sync** — Hedra, OmniHuman, Pika, HeyGen, VEED Fabric, Synthesia, or auto.

Paid TTS, B-roll, and music calls must record provenance and write to
`usage_logs`.

## QA Loop

`runVideoQaReport()` validates the rendered artifact rather than the plan. It
still checks black frames, audio clipping, silent gaps, and missing media, and
now also receives expected duration and cut-boundary times from the render
pipeline:

- `buildCutBoundaryFindings()` creates a bounded window around each cut boundary
  and attaches nearby black-frame, clipping, or silence findings.
- Duration mismatch is reported when rendered duration differs from expected
  project duration by more than 250ms.
- `runBoundedVideoQaLoop()` renders at most three attempts (`maxIterations` is
  clamped, default 2), summarizes residual issues, and emits sample windows at
  the beginning, middle, end, and cut boundaries. A host-supplied `attemptFix`
  callback is the only way fixes run between iterations.

## Cloud Render

`src-api/src/shared/services/render/` offers local and cloud render. Adapters
are `local` (FFmpeg subprocess, no upload) and `fal` (async polling). Cloud
render uploads project assets to the selected provider and requires explicit
first-time consent.

## HTML / Motion Templates

Template-first HTML/Motion videos are backed by a gallery loaded from branded
defaults plus workspace overrides under `<workDir>/.neuma/video-templates`.
Each template is described by `template.video.yaml`, optional variable schemas,
source files, preview metadata, and license information. Projects persist the
selected template and variable values, then expose them to the agent through the
HTML template prompt context.

The content graph persists frame intent separately from timeline clips. Frame
strip edits write graph nodes and per-frame HTML, then the render engine compiles
the graph into previewable frames. Native enhancement can enrich data frames
before they are rendered, but the graph remains the contract the renderer and
agent share.

## Linked Sources

`linked-sources/` indexes external folders (local, Google Drive, Box, Dropbox,
OneDrive, Immich, S3) as browsable, searchable catalogs without copying files
into the project. Each source carries a `role` (context / b-roll / reference)
and a budget (max files, max bytes, TTL). The crawler extracts metadata;
search combines semantic embeddings with filename and metadata matching. Assets
are bound lazily — only metadata is stored until an asset is attached, and the
file is read at render time. Local access is gated by scoped folder grants
(`local-grants.ts`).

## Capture

Production capture (screen / camera / mic, with teleprompter) runs through
native Tauri commands with scoped capabilities and allowlisted sidecar
arguments (`src-tauri/src/capture.rs`, `teleprompter.rs`, and the
`video-capture` / `teleprompter` capability files). The browser `MediaRecorder`
path is a camera-only development fallback for `pnpm dev:web` and is not
production parity. Recorded takes can be inserted at the playhead, appended, or
used to replace a selected clip; `capture/align.ts` aligns a take to the
timeline.

## Storage Layout

All generated and imported files live under the workspace:

```
<workDir>/.neuma/video/<projectId>/
  project.json        # canonical project state (single source of truth)
  assets/             # generated/imported images, video, audio, captions
  sources/            # imported source footage for analysis
  cache/              # regeneratable artifacts (scene cache, proxies, thumbnails)
```

`storage-tree.ts` exposes two roots — `project` and `cache` — to the frontend
storage browser. Backend reads validate every path with `validateInputFile` /
`validatePath`; nothing escapes the project directory.

## Database

Migrations `027`–`033` add the Video Mode schema:

| Migration                          | Adds                                              |
| ---------------------------------- | ------------------------------------------------- |
| `027_video_mode_foundation`        | Projects, provider configs, sources, analyses, cut plans, jobs |
| `028_video_linked_sources`         | Linked sources and indexed linked assets          |
| `029_video_linked_asset_search`    | Search index (FTS + embeddings) for linked assets  |
| `030_video_linked_asset_activity`  | Linked-asset activity (recents, favorites, opened) |
| `031_embedding_cache_lru`          | LRU cache for embeddings                           |
| `032_video_conversation_mode`      | Agent journal for conversational editing           |
| `033_video_recipe_tool_rename`     | Recipe tool rename migration                       |

Migrations `034`–`035` add the centralized Assets Catalog and its materialization
cache (see [Assets Catalog](assets-catalog.md) and
[Database Schema](../reference/database-schema.md)). Video Mode reads asset bytes
through the catalog when a user drags a catalog asset onto the timeline; the
per-project materialization budget is enforced through `asset_materializations`.

Later Video Mode migrations add workspace and agent/plugin state:

| Migration                                  | Adds                                               |
| ------------------------------------------ | -------------------------------------------------- |
| `037_video_project_workspace_root`         | `video_projects.workspace_root` for moved workspaces |
| `038_plugin_runtime_trust`                 | `installed_plugins` trust/digest columns and `video_plugin_candidates` |
| `039_video_intent_plugin_snapshot`         | `video_intent_log.applied_plugin_json`             |
| `040_video_plugin_candidate_source_id`     | Source plugin id tracking for candidates           |
| `041_video_agent_history`                  | Per-project `video_agent_history`                  |
| `042_video_media_frame_search`             | `media_frames` plus FTS triggers for frame search  |

## Catalog Asset Bridge

`src-api/src/shared/video/catalog-assets.ts` bridges the centralized Assets Catalog
into Video Mode timelines. When a user drags a catalog asset (image, video, or
audio) into a scene, the bridge:

1. Records an `asset_materializations` row scoped to the video project so the
   per-project storage budget is enforced.
2. Triggers `AssetMaterializer.materialize()` for the active asset (and a
   `proxy` preset when the source exceeds proxy thresholds), reusing
   `<workDir>/.neuma/assets/cache/` bytes across projects when possible.
3. Emits per-tile materialization progress on the `/assets/events` SSE stream,
   which the timeline UI renders as per-clip badges with cancel and retry
   affordances.
4. Resolves the materialized path into a `TimelineClip.sourceUri` so the renderer
   reads the same bytes any other clip would.

See [Assets Catalog](assets-catalog.md) for the full materializer, budget, and
attribution model.

## Video Plugins

Video plugins are Anthropic-style plugins with `metadata.neuma.surfaces:
['video']` and a `metadata.neuma.videoManifest` pointer to `video-plugin.json`.
`loadVideoPlugins()` merges bundled, user, project, and marketplace plugin roots,
validates the domain manifest, registers the plugin, and records diagnostics for
invalid manifests without failing the whole load.

The video manifest declares:

- `video.kind`, `mode`, supported `aspectRatios`, and render `engine`
- a pipeline of stages built from atoms such as `research-search`,
  `broll-stock`, `ai-image`, `ai-clip`, `music-select`,
  `timeline-assemble`, `reference-analyze`, and `reference-vision`
- capability requirements such as `research:web`, `network:stock`,
  `network:music`, `media:generate`, `media:vision`, `media:transcribe`,
  `video:analyze`, `video:edit`, and `network:youtube`
- optional GenUI surfaces, prompt guide text, templates, inputs, and network
  policy

`computeVideoPluginRunGate()` maps requested capabilities to grants using the
shared plugin runtime. Unsaved or changed manifests are restricted until the
current digest is reviewed; restricted runs suppress prompt injection, network,
media generation, vision, transcription, analysis, video editing, and YouTube
capabilities. `applyVideoPlugin()`
returns a hydrated prompt plus a context payload that the Video agent carries
through the run.

After a successful plugin-backed render, `detectVideoPluginCandidateAfterRender()`
can create a `video_plugin_candidates` row from the applied snapshot. Saving the
candidate scaffolds a real plugin under the project or user plugin root, writes
both `.claude-plugin/plugin.json` and `video-plugin.json`, marks it with
`trust_tier = 'saved'`, and pins `last_reviewed_digest` to the generated
manifest digest. Bundles export/import as `neuma.video-plugin.bundle.v1`.

## Editor Handoff

`src-api/src/shared/video/editor-handoff/` exports interoperable edit packages
for offline NLE workflows. The UI exposes targets for Final Cut Pro, Premiere
Pro, DaVinci Resolve, OTIO, EDL, and CapCut fallback, with media mode set to
copy or link. The agent must call `video_get_handoff_conformance` before
queuing `video_export_editor_handoff`, because target support is not verified
until the conformance report is generated.

`createEditorHandoffPackage()` writes a deterministic package directory under
`outputs/editor-handoff/<jobId>/` and zips it as `neuma-video-handoff.zip`.
The package contains `manifest.json`, media and derivative manifests, analysis
artifacts, the action log, `captions.srt`, `cut-list.json`, OTIO JSON, FCPXML,
Premiere XML, EDL, `conformance.json`, SHA-256 checksums, and a best-effort
reference render or `reference/README.txt`.

Audio edits travel with the package: clip gain/mute, fades, track volume,
crossfades, ducking, and generated-audio provenance are carried on media refs
and clip metadata. Conformance warns when an interchange target (for example
EDL or the CapCut fallback) may require manual verification of those audio
edits.

## MCP

The video MCP server (`src-api/src/shared/mcp/video-server/` and the in-process
`video-edit-server.ts`) exposes the same project verbs as the agent runtime
(plan/approve, scene and timeline edits, generation, render). Register it for
development with `pnpm --filter neumar-api dev -- mcp video-server`, or packaged
as `neuma mcp video-server`.

The source-analysis MCP surface includes `import_source`, `analyze_source`,
`suggest_cuts`, `get_packed_transcript`, `inspect_source_range`,
`apply_cut_plan`, and `run_bounded_qa`. Plugin-backed Video agent runs mount
this source server only after the plugin capability gate allows the requested
capabilities.

## Known Limits

Remotion overlays depend on the packaged renderer artifact. IndexTTS is
license-gated. Suno/Udio are excluded. OpenAI Sora/Videos is not offered as a
launch provider while its deprecation notice is active. Render jobs drain
sequentially per worker today; parallel per-project rendering is not supported
until the worker and queue both support it.

---

_See also: [Backend Overview](index.md) · [Media Generation](media-generation.md) · [DesignMode Backend](design-mode.md) · [Speech](speech.md) · [Video Mode Runbook](../../dev-doc/runbooks/video-mode.md)_
