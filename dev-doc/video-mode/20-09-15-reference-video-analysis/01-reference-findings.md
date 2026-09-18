# Reference findings: how Hypit analyzes a video

Audited checkout: `_sample/hypit` (working tree as of 2026-09-15). No file in
`_sample/` was modified. `_sample/` is gitignored and is one contributor's local
reference material, not shared project context — treat every claim here as
observed behavior of that checkout, not as a contract.

## The shape of the feature in hypit

Hypit splits the work into three layers that never blur together:

1. **A documented reading method** — prose instructions to the agent, in
   `skills/hypit/references/creation/reference-video.md`.
2. **A local, deterministic evidence toolset** — `hypit media` and
   `hypit transcribe`, implemented in `packages/video-cli/src/media.ts` and
   `transcript.ts`, backed by ffmpeg, sharp, WhisperX and a pinned yt-dlp.
3. **A file-shaped artifact convention** — `ANALYSIS.md`, `TIMELINE.md`,
   `transcript.json`, `evidence/`, `PROGRESS.md`, documented in
   `references/creation/project-files.md`.

The agent is never asked to "watch" a video. It is given commands that turn a
video into *time-labeled images and timed words*, and a method for reading them.
That is the single most transferable idea in the reference.

## Layer 1 — the reading method

`references/creation/reference-video.md` is the core document. Its operative
rules, condensed:

| Rule | Why it matters for Neumar |
| --- | --- |
| Read the whole piece first (hook → argument → payoff → intended response), then read that meaning through its concrete realization | Produces two artifacts, not one: a whole-piece model and a timed realization account. Neumar's `ReferenceAnalysis` / `ReferenceTimeline` split comes directly from this |
| Every designed element gets an account of content, appearance, spatial relationship, **entry, active behavior, persistence and exit** | This five-part lifecycle is the schema for a "system" in the framework. It is what makes a reading reusable rather than descriptive |
| Whole-piece and close readings revise each other; a system can outlive a cut | Forbids a naive shot-list model. A framework's systems must be able to span sections |
| "A motion's name is a starting point" — inspect path, scale, opacity, pace, overshoot, settling | Sets the required detail level for a system's motion description |
| Compression comes from identifying one coherent behavior that explains many frames | This is the framework-extraction objective, stated exactly |
| State what is visible or audible separately from what you infer it means | Becomes the `observed` vs `interpretation` split in the artifact schema |
| Player controls and viewing chrome belong to the viewing surface, not the video | A real failure mode for VLM readings of screen-recorded references. Worth an explicit prompt rule |
| "Several implementations can express the observed behavior, so the account need not guess the original author's source code" | The licence for structure-only extraction. Also the rights argument |
| Samples establish what appears at their times, with gaps between them; a few stills cannot supply a temporal account | Sets a minimum sampling density contract, and forbids reporting confidence the sampling does not support |

The document also states the handoff explicitly: *"Record the observed behavior
before choosing how the target will implement it."* That ordering is what makes
the framework source-agnostic, and it is why this plan puts framework extraction
(Phase 5) strictly after the reading (Phase 4) rather than fusing them.

## Layer 2 — the evidence toolset

`packages/video-cli/src/media.ts:18` declares the full command set:

```ts
export const mediaCommands = ["probe", "cut", "frames", "tile", "tiles", "boundaries", "fetch"] as const;
```

| Command | What it does | Neumar equivalent today |
| --- | --- | --- |
| `probe` | duration, dimensions, frame rate, audio presence | `probeFile()` in `@/shared/services/ffmpeg` — **exists** |
| `fetch` | one link → one local file via pinned yt-dlp | `source/ytdlp.ts` + `importYoutubeBroll` — **exists, YouTube-framed** |
| `cut` | save one exact stretch as a clip, `--label-time` burns absolute source time into the evidence copy | **missing** |
| `frames` | individual frames named by source time, with word context below each picture | partially: `getFilmstrip()` in `asset-thumbs.ts` produces an unlabeled strip |
| `tile` | one time-labeled grid, `--every` or `--frames`, `--transcript` puts word times under each cell | partially: `buildSourceRangeFilmstrip()` in `analysis/source-range-evidence.ts` — 160px frames, `MAX_FRAME_COUNT = 8`, no labels |
| `tiles` | the same, paginated into `--columns × --rows` pages, or driven by a JSON range file | **missing** |
| `boundaries` | mechanical adjacent-frame change candidates with scores | **missing**; Neumar's scene detection is a stub |
| `transcribe` | word-level times, explicit `--language` | `analysis/transcript.ts` — **exists** |

Details worth importing rather than reinventing:

- **Time labels and word labels are burned into the image.** `media.ts` places
  word labels *below* the picture so the reference's own captions and motion
  graphics stay visible. A VLM reading an unlabeled grid cannot anchor what it
  sees to a source time; this is the difference between usable and unusable
  evidence.
- **`--around "<phrase>" --transcript ...`** selects a range by spoken phrase
  instead of by seconds, with `--occurrence` for repeats and `--padding`
  (default 0.3 s) either side. It is how the agent navigates a reference it has
  only read in transcript form. `phraseRanges()` / `wordsAt()` in
  `packages/video-cli/src/transcript.ts` implement it.
- **`boundaries` is explicitly non-editorial.** Its own help text says the
  scores "are never editorial shot labels", and the CLI prints that caveat with
  every result. Keeping the mechanical signal separate from the semantic
  reading is what stops a bad detector from poisoning the framework.
- **Commands refuse to overwrite.** `destination()` in `media.ts` asserts the
  target does not exist; `tiles()` writes into a `mkdtemp` staging directory and
  `rename`s it into place, removing it on any error. Evidence is therefore
  either complete or absent, never half-written.
- **`--json` returns the complete machine view** for every command, with the
  human-readable form as the default. The JSON form carries the sampled times
  and per-frame word context, which is what an agent tool needs to return.
- **The downloader is pinned, not ambient.** `packages/yt-dlp/src/download.ts`
  reaches a `uv`-managed `services/yt-dlp` project by walking up from the module
  rather than from the working directory, with the comment: *"yt-dlp releases
  constantly because it is chasing sites that keep changing, so an unpinned copy
  makes the same link fetch differently on two machines."*
- **Download asks for video and audio together.** `--format bv*+ba/b` with
  `--merge-output-format`, plus `--format-sort res:1080,vcodec:h264` as a
  *preference* rather than a `height<=1080` filter that would refuse a link
  offering nothing under the bound. `--no-playlist` keeps a link inside a
  playlist from fetching the playlist. Neumar's `buildYtDlpArgs()` already
  matches this shape closely.
- **`isVideoUrl()` accepts only `http:`/`https:`** with the stated reason that
  a Windows path (`c:\clip.mp4`) parses as a URL with protocol `c:` and would
  otherwise be handed to the downloader.

## Layer 3 — the artifact convention

`references/creation/project-files.md` prescribes this layout:

```text
project/
├── references/<reference>/
│   ├── source.*
│   ├── ANALYSIS.md
│   ├── TIMELINE.md
│   ├── transcript.json
│   ├── evidence/
│   ├── PROGRESS.md          # only while understanding is in progress
│   └── drafts/
├── productions/<target>/
│   ├── BRIEF.md  TREATMENT.md  PROGRESS.md
│   └── authors/ recipes/ runs/ assets/ drafts/
└── assets/ packages/
```

The rules attached to it:

- **"Keep reference truth and target truth separate."** One reference can inform
  several productions; one production can draw on several references. The
  relationship is an ordinary relative link, with no central index.
- **Each document has exactly one job.** `ANALYSIS.md` = whole-piece model.
  `TIMELINE.md` = time-locatable realization, organized into sections named by
  source-media time and a meaningful phase. `transcript.json` = evidence, "not
  the director's interpretation". `evidence/` = "only media worth reopening,
  with ordinary human-readable names".
- **"Rewrite these files when the current truth changes. They are not logs."**
  The artifacts are current state, not an append-only history.
- **`PROGRESS.md` is "a short photograph of the work now"** — live question,
  what remains, next useful action, real blockers. It may sit beside a reference
  *or* a production, and disappears when there is nothing to hand over.
- **A reference file intentionally reused in the new film is referenced in
  place**; its documentary role does not require a duplicate.

The worked `TIMELINE.md` example in `reference-video.md` is the best single
specification of the target detail level:

```md
## 6.07–8.27 · The workload accelerates

The spoken list reaches "videos / voiceovers / ads / scripts". Each noun brings a new full-frame
illustration and a marker-style word at its center, replacing the preceding pair. The lower spoken
Caption gives way to these central labels so each example reads as one unit.

The word and picture enter together on each noun; the labels pop to size, settle briefly, and leave
with their picture on the next cut. The increasingly short holds make the workload feel excessive.
The 6.8–8.4 clip and list-change grid show the handoffs; word times are in transcript.json.
```

Note what that paragraph contains: a source time range, a phase name, the spoken
anchor, the systems active, their entry/persistence/exit, the *effect on the
viewer*, and the evidence paths that prove it. Those seven elements are the
field list for Neumar's `ReferenceTimeline` section schema in
[`03-data-model.md`](03-data-model.md).

## What this plan imports, adapts, and rejects

| Hypit idea | Decision | Note |
| --- | --- | --- |
| Reading method (whole ↔ close, observed vs inferred, system lifecycle) | **Adopt** | Becomes the Phase 4 system prompt and the artifact schema |
| `ANALYSIS` / `TIMELINE` / `transcript` / `evidence` split | **Adopt** | Phase 4; stored as versioned JSON envelopes with rendered Markdown, not loose Markdown |
| `boundaries` as a non-editorial mechanical signal | **Adopt** | Phase 2; replaces the current stub |
| Time-labeled and word-labeled grids, paginated | **Adopt** | Phase 2; the existing filmstrip builder is extended, not replaced |
| `--around <phrase>` navigation | **Adopt** | Phase 2; Neumar already has word-level transcripts to drive it |
| Evidence writes are atomic and refuse to overwrite | **Adopt** | Phase 2; `multicam/store.ts` already uses this discipline |
| Pinned downloader, video+audio muxed, preference-not-filter format sort | **Adopt** | Phase 1; Neumar's `buildYtDlpArgs()` is already close |
| Reference archive separate from production assets | **Adopt** | Phase 1; the rights argument depends on it |
| `PROGRESS.md` as a rewritten photograph of current work | **Adapt** | Phase 3; Neumar has a durable plan + execution log with SSE, which is strictly better than a rewritten file. Render the same information *into* a Markdown view for handoff |
| Loose Markdown files as the storage format | **Adapt** | Neumar's artifacts live in `project.json` and versioned files under the project dir. Store structured envelopes; render Markdown as a view |
| Hypit's `Script` / `Treatment` / `Recipe` / `Run` authoring vocabulary | **Reject** | Neumar has its own storyboard, content-graph, template, and timeline model. Importing a second authoring vocabulary would fork the product |
| Hypit's package/distribution/runtime-profile architecture | **Reject** | Out of scope; Neumar's registry-driven engines already cover engine selection |
| A separate `hypit media` CLI surface | **Reject** | The equivalent capability lands as agent tools and HTTP routes, matching how every other Video Mode analysis already reaches the agent |
