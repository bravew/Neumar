# Current state and gaps

Audited at `b459bbf` (2026-09-13) by source read, `rg`, and Git history.
`graphify-out/` is absent from this working tree, so no knowledge-graph query
was used. Line numbers are from the audited tree and will drift; treat the
symbol name as the durable reference.

## What Neumar already has

### Acquisition

| Capability | Owner | Assessment |
| --- | --- | --- |
| Download a link with yt-dlp | `src-api/src/shared/video/source/ytdlp.ts` | Solid. `validateYtDlpUrl()` routes through `validateBaseUrlForFetch`; `buildYtDlpArgs()` uses `--no-playlist`, `--restrict-filenames`, `--write-info-json`, `--clean-info-json`, `--merge-output-format mp4`, and deliberately never section-downloads |
| yt-dlp error classification | `source/ytdlp.ts` (`YtDlpErrorClassification`) | Good and unusual: the module's own comment says raw stderr "can contain cookies, auth tokens, or signed URLs, so callers must surface THIS message and never the raw stderr" |
| Agent-facing download | `video_import_youtube` in `src-api/src/shared/mcp/video-edit-server.ts` | Works, but is framed and named as YouTube-and-b-roll, and its result is a project **asset** |
| File/workspace-path import | `importSource()` behind `POST /projects/:id/sources/import` | Handles both multipart upload and workspace path, and records `rights.userConfirmed` |
| Link → article/repo Markdown | `source/ingest.ts` | Unrelated to video. `video_fetch_source` is prose ingestion, not media |
| SSRF-safe fetch | `@/shared/network-policy/fetch` (`safeFetch`, `externalApiPolicy`) | Established and already used by the video source path |

### Evidence

| Capability | Owner | Assessment |
| --- | --- | --- |
| Probe | `probeFile()` in `@/shared/services/ffmpeg` | Exists; exported alongside `runFFmpeg`, `validateInputFile`, `validatePath` |
| Word-level transcription | `analysis/transcript.ts` (`transcribeSourceMedia`, `extractSourceAudioPcm`, `transcriptDataFromSttResult`) | Strong. Produces `TranscriptData { engine, language, words, segments }` with a `degraded` signal that downgrades cut candidates to `review-only` |
| Packed transcript artifact | `analysis/pack-transcript.ts` | Token-efficient transcript form for the agent; already an `AnalysisArtifact` with a cache path |
| Range evidence (filmstrip + waveform + word labels) | `analysis/source-range-evidence.ts` | The closest existing thing to a hypit grid. Produces `SourceRangeEvidencePayload` with `filmstrip`, `waveform`, and `words[]` carrying both absolute and range-relative times |
| Filmstrip / peaks caching | `asset-thumbs.ts` (`getFilmstrip`, `getPeaks`) | Content-hash-keyed cache already in place |
| Frame caption index + search | `analysis/frame-index.ts` (`indexProjectFrames`, `searchProjectFrames`) | Real VLM-caption index in SQLite `media_frames` + optional `vec_media_frames`. Gated by `video.frameSearch`, default **off** |
| Beats | `analysis/beats.ts` | Audio beat detection, anchored to an audio clip |

### Workflow, progress, and application

| Capability | Owner | Assessment |
| --- | --- | --- |
| Durable agent plan | `agent-plan.ts`, `plan-runner.ts`, `execution-log.ts`, `reconciliation.ts` | Strong. `expectedProjectRevision` conflict token, resume, and `renderVideoAgentPlanMarkdown()` for a handoff view |
| Streamed job progress | `job-events.ts` (`publishRenderStatus`, `subscribeRenderStream`, sequence bounds, buffer) | A working SSE contract with replay bounds — but it is *render*-shaped |
| Job queue | `jobs.ts` (`enqueueRenderJob`, `enqueueEditorHandoffJob`, `recoverInterruptedJobs`, `drainVideoJobs`) | Two job kinds today; adding a third is the established extension point |
| Artifact chain on disk | `multicam/store.ts` | The exact pattern to copy: `MulticamArtifactEnvelope<T>` with `kind`, `sourceFingerprint`, `generatedAt`, `data`, stored as separate versioned files "so recomputing activity does not invalidate a sync map that is still good" |
| Templates | `templates/` (`types.ts`, `validator.ts`, `custom-loader.ts`, `gallery-loader.ts`, `form-mapper.ts`, `search.ts`, `agent-bridge.ts`, `provenance-lint.ts`) | A complete custom-template lifecycle: `VideoTemplate` with `storyboardSeed.scenes[]`, typed `inputs[]`, `VideoTemplateAssetPlan` union, and `saveCustomTemplate()` writing validated JSON under `getVideoRoot()/templates/` |
| Timeline ops + approval | `timeline-ops.ts`, `video_propose_timeline_ops`, `video.agentApply` flag | The approval boundary Phase 7 must use |
| Tool permission/cost metadata | `src-api/src/extensions/agent/video/permissions.ts` | `READ_TOOLS` / `WRITE_TOOLS` / `DESTRUCTIVE_TOOLS` plus `getVideoToolCostClass()`; an unregistered tool throws at startup |
| Feature flags | `shared/video/flags.ts` | `VideoFeatureFlag` union + `VIDEO_FEATURE_FLAG_DEFAULTS` (`satisfies`) + `snapshotVideoFeatureFlags()` |

## Confirmed gaps

### 1. Scene detection is a stub that mislabels its own provenance

`buildDeterministicAnalysis()` (`src-api/src/shared/video/store.ts:2320`) is the
only producer of `SourceMediaAnalysis.scenes`. It returns exactly two scenes
split at `sceneMidpoint = max(1000, floor(durationMs / 2))`, each stamped
`confidence: 0.6, method: 'ffmpeg-scdet'` (`store.ts:2371–2385`). No ffmpeg
scene-change detection runs. `visualBeats` is likewise a single whole-duration
entry captioned `'Imported source material'` with `source: 'scene-detector'`
(`store.ts:2390`).

This is worse than a missing feature: a downstream consumer reading
`method: 'ffmpeg-scdet'` has no way to know the value is synthetic. Phase 2
must replace the producer **and** the labels in the same change.

### 2. No time-labeled or word-labeled frame evidence

`buildSourceRangeFilmstrip()` (`analysis/source-range-evidence.ts:226`) builds a
horizontal strip with `tile=${frameCount}x1` at `FILMSTRIP_FRAME_WIDTH = 160`
and `MAX_FRAME_COUNT = 8` (lines 21–23). The word labels exist in the payload's
`words[]` but are never drawn onto the image.

For a VLM reading, an unlabeled 160px 8-frame strip cannot support the temporal
account hypit's method requires. Missing, concretely:

- absolute source time burned under each cell;
- spoken words burned under each cell, below the picture so the reference's own
  captions stay visible;
- configurable cell width, column count, and row count;
- pagination across many cells for a long passage;
- range selection by spoken phrase rather than by seconds;
- a labeled clip excerpt (`cut --label-time`) for motion that a grid cannot show.

### 3. No mechanical shot-boundary signal

There is no equivalent of `hypit media boundaries`: adjacent-frame change scores
at a chosen sample rate, returned as *candidates with scores* and explicitly not
as shot labels. `analysis/auto-cut.ts` produces cut candidates, but from speech
and silence, not from picture change.

### 4. A reference is indistinguishable from an asset

`SourceMedia` (`types.ts:1523`) has `origin: 'upload' | 'workspace-path' | 'yt-dlp' | 'capture'`
and always points at a `mediaItemId` in `project.assets`. There is no way to say
"this video is evidence I am studying, not material I am going to cut". Every
downloaded reference therefore:

- appears in the asset browser and in `video_list_assets`;
- is a candidate for `video_attach_asset` and `analyzeProjectAssets`;
- carries `rights.userConfirmed` semantics designed for material the user will
  publish.

That is the wrong default for a copyrighted reference and it makes the
rights story in [`05-open-questions-and-rollout.md`](05-open-questions-and-rollout.md)
impossible to state cleanly.

### 5. `SourceMediaAnalysis` cannot hold a reading

`SourceMediaAnalysis` (`types.ts:1535`) is a flat bag of detector output:
`scenes`, `speechRanges`, `transcript`, `diarization`, `visualBeats`,
`qualitySignals`, `duplicateCandidates`, `cutCandidates`. It has nowhere to put:

- a whole-piece explanation (what the piece is trying to achieve, how its
  pacing works, why it holds together);
- a *system* — a visual or audio element with content, appearance, spatial
  relationship, entry, active behavior, persistence and exit, that may outlive
  any one shot;
- the separation between what was observed and what it was inferred to mean;
- evidence paths proving a claim;
- the open questions a partial reading leaves behind.

`AnalysisArtifact.kind` (`types.ts:61–72`) is a closed union of ten kinds, none
of which fits. Extending it is the established move; `'custom'` with untyped
`metadata` is not good enough for something the framework extractor must parse.

### 6. `videoArchitecture` from the 06-14 plan does not exist

`rg 'videoArchitecture|VideoArchitecture'` over `src/`, `src-api/src/` and
`packages/` returns nothing. Section "Video Architecture And Template
Extraction" of [`06-14-media-anaylyze/README.md`](../06-14-media-anaylyze/README.md)
(lines 431–470) is unimplemented. Its guardrails are still the right ones and
this plan carries them forward verbatim:

> The blueprint describes structure, not the original frames. Do not store or
> re-emit the source video's pixels as part of a template.

### 7. Progress reporting is render-shaped

`job-events.ts` streams `RenderStreamEvent`. `jobs.ts` knows two job kinds
(render, editor-handoff). `agent-plan.ts` has a durable plan with steps and a
Markdown renderer, but a plan is the *agent's* plan, not a system-owned analysis
pipeline with deterministic stages.

The user requirement "provide the detailed steps about the progress" needs a
third thing: a durable, resumable, inspectable ledger of analysis stages —
fetch → probe → transcribe → boundaries → sample → read → extract — each with
status, timing, cost, produced artifact, and failure reason. Phase 3 builds it
by generalizing the two existing mechanisms rather than adding a third pattern.

### 8. Templates cannot express a structural framework

`VideoTemplate.storyboardSeed.scenes[]` is a list of `VideoTemplateSceneSeed`
(`templates/types.ts`), each with `durationMs`, `intent`, a concrete
`assetPlan`, and optional caption/transition/reframe. That is a *recipe for
generating scenes*, not a *description of a structure to be filled*.

What is missing for framework materialization:

- a section **role** vocabulary (hook, premise, proof, escalation, turn, payoff,
  CTA, outro) distinct from `intent` free text;
- **slots** — typed holes a user asset can be bound into, with constraints
  (minimum duration, aspect, has-speech, has-motion) rather than a fixed
  `assetPlan`;
- **systems** that span scenes (a persistent lower third, a recurring sound bed,
  a caption treatment) rather than per-scene properties;
- **relative** timing (proportion of total, or beat-anchored) so a 34-second
  reference framework can produce a 60-second target;
- **provenance and confidence** per section, so a mis-segmented reading can be
  corrected before it drives edits.

`VideoTemplate.version` and `source: 'builtin' | 'community' | 'custom'` give a
place to hang this, and `provenance-lint.ts` already exists to police template
provenance claims.

### 9. No slot-binding or framework-application path

`templates/form-mapper.ts` maps typed `VideoTemplateInput`s to a form and
expands a template into a storyboard. There is no path that takes "here is a
structure and here are 40 of my own clips" and proposes which clip fills which
role. `video_search_assets`, `video_rank_moments`, `analyzeProjectAssets` and
`searchProjectFrames` are the ingredients; the matcher is missing.

## Summary table

| Gap | Phase that closes it |
| --- | --- |
| Reference is not an asset | 1 |
| Multi-site acquisition, probe, rights record, archive layout | 1 |
| Mechanical shot boundaries | 2 |
| Time- and word-labeled grids, pagination, phrase navigation, labeled cuts | 2 |
| Durable analysis run with step ledger and streamed progress | 3 |
| `ReferenceAnalysis` / `ReferenceTimeline` artifacts, system lifecycle schema | 4 |
| `VideoFramework`: roles, slots, systems, relative timing, confidence | 5 |
| Framework → `VideoTemplate` materialization and gallery entry | 6 |
| Slot binding and proposed `TimelineOp[]` batch | 7 |
