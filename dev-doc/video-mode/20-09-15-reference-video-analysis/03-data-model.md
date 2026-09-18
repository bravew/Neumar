# Data model

Proposed types, storage layout, and invalidation rules. Type sketches are
illustrative, not final signatures; agree the shape here, then let the
implementation correct it.

## Artifact chain

The chain mirrors `multicam/store.ts`, which stores each artifact as its own
versioned file "so recomputing activity does not invalidate a sync map that is
still good, and a cancelled run leaves the artifacts it had already finished".

```text
reference (acquired)
  └─ probe            deterministic   ffprobe
  └─ transcript       deterministic   analysis/transcript.ts
  └─ boundaries       deterministic   ffmpeg scene-change scores
  └─ evidence[]       deterministic   labeled grids, frames, clips
       └─ analysis    semantic        whole-piece model          (agent)
       └─ timeline    semantic        time-locatable realization (agent)
            └─ framework   derived    source-agnostic structure  (agent + validator)
                 └─ template   materialized   VideoTemplate (custom)
                      └─ binding    applied    proposed TimelineOp[]
```

Each artifact records the `sourceFingerprint` it was derived from. Recomputing
an upstream artifact marks downstream ones stale; it does not delete them, so a
correction to the transcript does not silently discard an hour of reading.

## Envelope

```ts
export type ReferenceArtifactKind =
  | 'probe'
  | 'transcript'
  | 'boundaries'
  | 'evidence'
  | 'analysis'
  | 'timeline'
  | 'framework';

export interface ReferenceArtifactEnvelope<T> {
  kind: ReferenceArtifactKind;
  referenceId: string;
  /** Fingerprint of every input this artifact was derived from. */
  sourceFingerprint: string;
  /** Fingerprint values of the upstream artifacts at derivation time. */
  derivedFrom: Partial<Record<ReferenceArtifactKind, string>>;
  generatedAt: string;
  /** Producer identity: 'ffmpeg' | 'whisperx' | `agent:${model}` | 'user'. */
  producer: string;
  data: T;
}
```

`multicam/manifest.ts` already parses an equivalent envelope; reuse its
validation discipline rather than hand-rolling a second one.

## `VideoReference`

A reference is evidence under study. It is deliberately **not** a `MediaItem`
and is not listed in `project.assets`.

```ts
export interface VideoReference {
  id: string;
  /** Human label; defaults to the fetched title, else the file stem. */
  label: string;
  origin: 'link' | 'upload' | 'workspace-path';
  /** Present for origin 'link'. Stored for provenance, never re-fetched blind. */
  sourceUrl?: string;
  /** yt-dlp extractor key, e.g. 'youtube', 'tiktok', 'bilibili'. */
  extractor?: string;
  /** Path relative to the reference archive dir. Never an absolute path. */
  mediaPath: string;
  contentHash: string;
  durationMs: number;
  /** Rights posture. Studying is not publishing; see 05-open-questions §Rights. */
  rights: {
    /** The user asserted they may study this. Required before any fetch. */
    studyAcknowledged: boolean;
    /** Separate, explicit, and false by default. Gates asset promotion. */
    reuseAcknowledged: boolean;
    notes?: string;
  };
  /** The live run, if one is in flight. */
  runId?: string;
  artifactIds: string[];
  createdAt: string;
}
```

Added to `VideoProject` as `references?: VideoReference[]`, beside the existing
`sources?: SourceMedia[]`.

**Promotion.** If the user decides a reference is also material, an explicit
action creates a `MediaItem` + `SourceMedia` from the same bytes and records
`reuseAcknowledged`. Until then the reference is invisible to `video_list_assets`,
`video_attach_asset`, and `analyzeProjectAssets`.

## Deterministic artifacts

```ts
export interface ReferenceProbe {
  durationMs: number;
  width: number;
  height: number;
  frameRate: { num: number; den: number };   // rational, per packages/video-ir/src/timebase.ts
  hasAudio: boolean;
  audioTrackCount: number;
  containerFormat: string;
  videoCodec?: string;
  audioCodec?: string;
}

export interface BoundaryCandidate {
  atMs: number;
  /** 0..1 adjacent-frame change score. NOT a shot label. */
  score: number;
}

export interface ReferenceBoundaries {
  sampleRate: number;        // samples per second
  threshold: number;
  candidates: BoundaryCandidate[];
  /** Verbatim caveat surfaced to the agent with every read. */
  caveat: 'Mechanical adjacent-frame change candidates. Not shot labels.';
}
```

`ReferenceBoundaries.caveat` is carried in the payload rather than only in the
tool description so it survives into whatever context the agent assembles. This
is the mitigation for gap 1 in
[`02-current-state-and-gaps.md`](02-current-state-and-gaps.md): the stub's
mislabeled `method: 'ffmpeg-scdet'` is what happens when a signal loses its
caveat.

Transcript reuses `TranscriptData` (`types.ts`) unchanged.

## Evidence

```ts
export type EvidenceKind = 'grid' | 'frames' | 'clip';

export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  /** Human-readable, stable: 'opening-hook', 'list-change-6800-8400'. */
  name: string;
  range: { startMs: number; endMs: number };
  /** Sampled source times, in order. Establishes what the evidence can prove. */
  sampledAtMs: number[];
  /** Relative to the reference archive dir. A grid page or a clip file. */
  paths: string[];
  labels: { time: boolean; words: boolean };
  grid?: { columns: number; rows: number; cellWidth: number; pages: number };
  /** Why this evidence was made. Written by whoever requested it. */
  question?: string;
}
```

Two rules carried from hypit:

- **`sampledAtMs` is part of the evidence, not metadata.** A reading may only
  claim what the samples support. An agent asserting a continuous behavior over
  an interval it sampled twice is making an inference, and must mark it as one.
- **Writes are atomic and refuse to overwrite.** Build into a staging directory,
  `rename` into place, remove the staging directory on any error. Evidence is
  complete or absent, never half-written.

## Semantic artifacts

### `ReferenceAnalysis` — the whole-piece model

```ts
export interface ReferenceAnalysis {
  /** What the piece is trying to achieve and for whom. */
  intent: string;
  /** Hook, argument or story, shifts of attention, payoff, intended response. */
  arc: string;
  /** Why it holds together. The provisional explanation, revised. */
  thesis: string;
  systems: ReferenceSystem[];
  /** Claims the evidence does not yet settle. Preserved, not hidden. */
  openQuestions: Array<{ question: string; atMs?: number; note?: string }>;
  /** Facts and interpretation stay separable. */
  observed: string[];
  inferred: string[];
}

/** A visual or audio element with a lifetime, which may outlive any one shot. */
export interface ReferenceSystem {
  id: string;
  /** 'caption' | 'lower-third' | 'typography' | 'mg' | 'b-roll' | 'sound-bed' | … */
  role: string;
  content: string;
  appearance: string;
  spatial: string;
  /** The lifecycle that makes a reading reusable. */
  entry: string;
  behavior: string;
  persistence: string;
  exit: string;
  /** What this does for the viewer. */
  function: string;
  /** Every span where this system is active. */
  occurrences: Array<{ startMs: number; endMs: number; variation?: string }>;
  evidenceIds: string[];
  confidence: number;
}
```

### `ReferenceTimeline` — time-locatable realization

Each section corresponds to one `##` block in hypit's `TIMELINE.md`. The seven
fields are read directly off the worked example quoted in
[`01-reference-findings.md`](01-reference-findings.md).

```ts
export interface ReferenceTimelineSection {
  id: string;
  startMs: number;
  endMs: number;
  /** A meaningful phase name: 'The workload accelerates'. */
  phase: string;
  /** The spoken or acted anchor this section serves. */
  anchor?: string;
  /** Systems active here, and what each does in this span. */
  activeSystems: Array<{ systemId: string; note: string }>;
  /** What the choices do for the viewer. */
  effect: string;
  evidenceIds: string[];
  confidence: number;
  /** Sections may overlap; a system may span several. */
  overlapsWith?: string[];
}

export interface ReferenceTimelineArtifact {
  sections: ReferenceTimelineSection[];
  /** Density actually achieved, so a thin reading is visible as thin. */
  coverage: { sampledMs: number; totalMs: number; thinRanges: Array<{ startMs: number; endMs: number }> };
}
```

`coverage` is the guard against hypit's stated failure mode: *"Samples establish
what appears at their times, with gaps between them… A few representative stills
cannot supply that temporal account."* A reading whose `thinRanges` cover half
the piece must not present itself as complete, and Phase 5 refuses to extract a
framework from one.

### Validation, not generation

Neumar does not generate this prose. It **validates** what the agent wrote:

- every `startMs`/`endMs` lies within `probe.durationMs`;
- every `evidenceIds` entry resolves to a real `EvidenceItem` whose range
  contains or overlaps the claim;
- every `systemId` in a timeline section resolves to a `ReferenceSystem`;
- sections, sorted, leave no unexplained gap larger than a configured threshold
  without a matching `thinRanges` entry;
- `confidence` is present and in `[0, 1]`.

Failures are returned to the agent as a typed validation error naming the
offending anchor, the same way `templates/validator.ts` rejects a bad template.

## `VideoFramework` — the source-agnostic structure

This is the deliverable of requirement 3 and the thing that gets reused.
Nothing here references the original media.

```ts
export type FrameworkSectionRole =
  | 'hook' | 'premise' | 'context' | 'proof' | 'escalation'
  | 'turn' | 'demonstration' | 'payoff' | 'cta' | 'outro';

export interface FrameworkSection {
  id: string;
  role: FrameworkSectionRole;
  /** What this section must accomplish, in target-neutral terms. */
  purpose: string;
  /** Relative timing so a 34s reference can produce a 60s target. */
  timing: {
    proportion: number;              // fraction of total, sums to ~1
    minMs: number;
    maxMs: number;
    /** Observed absolute duration in the reference, for reference only. */
    observedMs: number;
  };
  /** Typed holes a target asset or generated item can fill. */
  slots: FrameworkSlot[];
  /** Systems active in this section, by framework system id. */
  systemIds: string[];
  pacing: { cutsPerMinute: number; shortestHoldMs: number; longestHoldMs: number };
  confidence: number;
  /** Which timeline sections this was derived from. */
  derivedFromSectionIds: string[];
}

export interface FrameworkSlot {
  id: string;
  /** 'a-roll' | 'b-roll' | 'screen' | 'product' | 'reaction' | 'title' | 'narration' | … */
  kind: string;
  /** What must be true of whatever fills this slot. */
  constraints: {
    minDurationMs?: number;
    aspect?: AspectRatio[];
    requiresSpeech?: boolean;
    requiresMotion?: boolean;
    subject?: string;              // free text, matched semantically
  };
  /** How to fill it if the user has nothing suitable. */
  fallback:
    | { kind: 'generate-image'; promptTemplate: string }
    | { kind: 'generate-clip'; promptTemplate: string }
    | { kind: 'broll-search'; queryTemplate: string }
    | { kind: 'tts-narration'; textTemplate: string }
    | { kind: 'ask-user' };
  required: boolean;
}

/** A system, restated without the reference's content. */
export interface FrameworkSystem {
  id: string;
  role: string;
  /** Behavior to reproduce, with content parameterized away. */
  behavior: { entry: string; active: string; exit: string };
  /** Style defaults a target can override. */
  style?: { captionStyle?: SubtitleStyle; fontFamily?: string; palette?: string[] };
  /** Framework section ids this system spans. */
  spans: string[];
}

export interface VideoFramework {
  id: string;
  version: 1;
  displayName: string;
  /** Maps onto VideoTemplateCategory at materialization. */
  category: VideoTemplateCategory;
  hook: VideoTemplateHook;
  pace: VideoTemplatePace;
  aspectRatios: AspectRatio[];
  totalDuration: { typicalMs: number; minMs: number; maxMs: number };
  sections: FrameworkSection[];
  systems: FrameworkSystem[];
  /** Audio bed character, not the reference's actual music. */
  audio?: { bedCharacter: string; duckingUnderSpeech: boolean; tempoBpm?: number };
  provenance: {
    referenceId: string;
    referenceUrl?: string;
    /** Deliberately no media path, no frames, no verbatim script. */
    derivedFromArtifacts: string[];
    extractedBy: string;
    extractedAt: string;
  };
  /** Lowest section confidence. Gates materialization. */
  confidence: number;
}
```

### Structure-only enforcement

`provenance-lint.ts` already polices template provenance. Extend it with a
framework lint that **fails** rather than warns when a framework contains:

- any path under the reference archive;
- any `contentHash` of reference media;
- any base64 or data URI;
- a `purpose`, `promptTemplate` or `textTemplate` containing a verbatim run of
  the reference transcript above a configured token threshold.

The last check is the one that matters, and it needs the transcript to run, so
the lint takes the reference as an input and the framework as its subject.

## Storage layout

Under `getVideoProjectDir(projectId)`, alongside the existing `multicam/`:

```text
<project dir>/
├── project.json
├── assets/
├── sources/
├── multicam/<groupId>/…
└── references/<referenceId>/
    ├── media/source.mp4          # the fetched or copied bytes
    ├── media/source.info.json    # yt-dlp --write-info-json, cleaned
    ├── probe.json                # ReferenceArtifactEnvelope<ReferenceProbe>
    ├── transcript.json           # envelope<TranscriptData>
    ├── boundaries.json           # envelope<ReferenceBoundaries>
    ├── evidence/
    │   ├── index.json            # envelope<EvidenceItem[]>
    │   ├── opening-hook-p001.jpg
    │   └── list-change-6800-8400.mp4
    ├── analysis.json             # envelope<ReferenceAnalysis>
    ├── timeline.json             # envelope<ReferenceTimelineArtifact>
    ├── framework.json            # envelope<VideoFramework>
    └── run.json                  # the step ledger, see Phase 3
```

Every path is constructed with `path.join(getVideoProjectDir(projectId), …)` and
passed through `validatePath(…, getVideoWorkspaceRoot(), 'write')`, matching
`multicam/store.ts` and `templates/custom-loader.ts`. `referenceId` is validated
against `/^[a-z0-9][a-z0-9-]{2,100}$/` before it touches a path, matching
`assertSafeTemplateId()`.

Rendered Markdown views (`ANALYSIS.md`, `TIMELINE.md`, `PROGRESS.md`) are
**derived**, written next to their JSON for human reading and handoff, and
regenerated from the JSON. The JSON is the source of truth; hypit's files are
the source of truth in hypit because hypit has no other store.

A materialized template is written by the existing `saveCustomTemplate()` into
`getVideoRoot()/templates/<id>.json`, so it is shared across projects. Only the
framework it came from stays project-local.

## Fingerprints and invalidation

```ts
sourceFingerprint(probe)      = hash(contentHash)
sourceFingerprint(transcript) = hash(contentHash, engine, language, modelId)
sourceFingerprint(boundaries) = hash(contentHash, sampleRate, threshold)
sourceFingerprint(evidence)   = hash(contentHash, kind, range, sampledAtMs, labels, grid)
sourceFingerprint(analysis)   = hash(transcript.fp, boundaries.fp, evidenceIds.sorted, promptVersion)
sourceFingerprint(timeline)   = hash(analysis.fp, evidenceIds.sorted, promptVersion)
sourceFingerprint(framework)  = hash(analysis.fp, timeline.fp, extractorVersion)
```

`multicam/fingerprint.ts` already implements this shape; extend it rather than
adding a second hasher.

Invalidation is **advisory**: a stale downstream artifact is marked
`stale: true` with the fingerprint that changed, surfaced in the UI, and left
intact. Only an explicit user or agent action recomputes it. Deleting an hour of
agent reading because a transcript was re-run with a different model would be
the wrong default.

## Where this sits relative to `SourceMedia`

They do not merge.

| | `SourceMedia` | `VideoReference` |
| --- | --- | --- |
| Question | "What can I cut out of my own footage?" | "How is this piece built?" |
| Is a project asset | yes | no, until explicitly promoted |
| Output | `CutCandidate[]`, `SourceCutPlan`, `CutTimeMap` | reading → framework → template |
| Rights posture | user will publish this | user is studying this |
| Lives in | `project.sources[]`, `project.sourceAnalyses[]` | `project.references[]`, `references/<id>/` |

Shared: the ffmpeg service, `transcribeSourceMedia()`, `asset-thumbs` caching,
and the evidence builders extended in Phase 2. Phase 2's boundary detector and
labeled grids are written so `SourceMedia` can use them too — that is how gap 1
(the scene-detection stub) gets fixed for both.
