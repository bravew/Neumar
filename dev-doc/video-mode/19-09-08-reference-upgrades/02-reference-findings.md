# Reference findings

## openreel-video

Baseline reviewed previously: `2566c34`, 2026-08-18
Current HEAD: `5f3c85e`, 2026-08-29
Material feature commit: `128d99b`

The new sync changes 259 files with 17,203 insertions and 7,843 deletions.

### Multicamera workflow

This is the largest transferable addition.

#### Data and governance

The multicamera module is `packages/core/src/multicam/`, and every stage below
ships with a colocated test file: `manifest`, `bleed-calibration`, `silero-vad`,
`drift`, `orma`, `reaction-analysis`, `shot-planner`, `automatic-edit`,
`cut-review`, `social-clips`, and `otio`. That one-test-per-stage layout is the
part worth copying wholesale — it is what makes the pipeline auditable.

`packages/core/src/multicam/manifest.ts` defines a versioned manifest with:

- participants and isolated microphones
- camera identity, type, subject, file hint, clip, and runtime angle
- sync method and reference camera
- minimum and maximum shot duration
- cut lead and reaction timing
- a jump-cut prohibition
- a mandatory locked-off wide camera

The manifest is useful because it separates shoot identity from the generated
edit. Neumar should adapt this boundary and use its own Zod conventions.

Two details of the OpenReel implementation should **not** be copied:

- The manifest stores `fps: number`. OpenReel's timebase is a float throughout,
  and `deriveSourceExportMatch` in `apps/web/src/services/export-source-match.ts`
  rounds 29.97 to 30 and 23.976 to 24 on export — its own tests assert that
  rounding. This is precisely the defect Phase 2 removes from Neumar. Store
  `{num, den}` on the Neumar manifest and on every derived artifact.
- The manifest is hand-validated with a bespoke walker that accumulates into an
  `errors: string[]`. Neumar has Zod 4 across the boundary already; use a schema
  and get the parse errors, the type, and the JSON Schema for free.

OpenReel does accept both JSON and YAML manifests (`parseManifest(contents,
format: "json" | "yaml" | "auto")`). Neumar can defer YAML as planned; note the
`auto` sniffing as the shape to match if it is added later.

#### Analysis artifacts

OpenReel separates each stage:

- bleed calibration corrects microphone cross-talk
- Silero VAD produces per-speaker activity probabilities
- drift fitting maps source time to group time
- `.orma` stores a fingerprinted, reusable activity artifact
- reaction analysis produces optional face cues
- shot planning converts activity into layouts and cuts
- cut review stores accept, reject, nudge, and camera overrides
- social clip extraction ranks reusable ranges

This separation fits Neumar's `analysisArtifacts` and durable plan model. The
specific `.orma` extension does not need to be copied.

#### Agent surface

OpenReel adds eight focused operations:

- read manifest
- read activity map
- read transcript
- update edit policy
- annotate a time range
- read edit summary
- override a proposed cut
- preview a frame

The small domain surface is better than exposing every DSP and planning helper.
Neumar should add equivalent `video_multicam_*` tools only after the UI and
domain layer exist.

Two implementation details in `packages/agent/src/registry.ts` are worth
matching. Every tool carries `domain: "multicam"`, and every handler opens with
`if (!host.multicam) return fail("Multicam tools are unavailable in this host",
"UNSUPPORTED")`. The domain gate is a runtime capability check, not a
registration-time exclusion, so the model gets a typed refusal instead of a
missing tool. Neumar's equivalent is `getVideoFeatureFlag('video.multicam')`
returning a typed unavailable reason from each handler — the same pattern the
engine registry already uses for unavailable render engines.

`src-api/src/shared/mcp/video-edit-server.ts` already names 121 distinct
`video_*` tools. Adding nine more is a real context cost on every Video turn.
Gate the whole domain off when `video.multicam` is disabled so the tools do not
reach the model at all on projects with no camera group, and treat the tool-count
growth as a reason to keep the multicamera surface at nine rather than mirroring
every internal helper.

#### Interchange

OpenReel exports the shot plan as OTIO. Neumar already has OTIO, EDL, FCPXML,
and Premiere XML handoff modules. Multicamera metadata should extend that
existing package instead of creating a second export path.

### Explicit editing frame rate

`apps/web/src/components/editor/editing-frame-rate.ts` offers 23.976, 24, 25,
29.97, 30, 50, 59.94, and 60 fps as `{ value: number, label: string }` pairs.
Neumar's rational type is stronger, but the product control and project lock are
missing. Adopt the UX idea — the same eight rates, labelled the way editors
say them — and keep Neumar's rational storage. Neumar's preset table should map
each label to exact `{num, den}` (`24000/1001`, `30000/1001`, `60000/1001` for
the three NTSC entries) rather than to a rounded float.

### Universal timeline items

OpenReel adds a resolver over media, text, shape, SVG, sticker, adjustment, and
motion items. It gives every item a capability map and common placement policy.

Neumar already stores all editable material in a discriminated `TimelineClip`
union. Migrating to a second universal-item abstraction would add indirection
without solving a current gap. Borrow capability-driven UI checks only when a
new clip kind makes the existing discriminated union awkward.

### Export limits and media recovery

OpenReel adds WebCodecs safety limits for long or memory-intensive exports and
placeholder recovery for missing browser media. Neumar renders final output in
the sidecar and already has external-master health, relink, and consolidation.

Adapt the user-facing safety pattern:

- preflight requested resolution, codec, frame rate, and duration
- return warnings and an explicit adjusted proposal
- never silently lower final export settings
- show missing or offline media before render

Do not copy browser-specific blob recovery into the sidecar architecture.

### Agent conversation UX

OpenReel adds model discovery, a provider/model picker, saved conversation
history, Markdown messages, and structured error cards. Neumar already has
provider configuration, server-backed history, shared agent diagnostics, and a
turn-budget event. The remaining useful idea is a compact per-run failure card
with retry context. Fold it into the editor ownership cleanup instead of adding
a second chat system.

## OpenMontage

Previously reviewed HEAD: `1bab711`, 2026-08-18
Current HEAD: `08e2151`, 2026-09-05

The only new commit adds a showcase. There is no new implementation delta to
import.

The following established practices remain useful:

- separate creative grammar from technical render runtime
- present every available runtime before locking the choice
- use canonical artifacts between stages
- keep decisions append-only when a choice changes
- checkpoint before expensive generation
- review each stage before proceeding
- make music and source provenance first-class production decisions

Neumar already implements most of these through engine selection, plans,
execution logs, cost approval, storyboard approval, and QA. The remaining work
belongs in acceptance tests and UI clarity, not a new orchestration framework.

## OpenCut

HEAD: `400f097`, 2026-08-01

OpenCut has no commit after the prior review date. Its README says the product is
being rewritten around a Rust core, plugin-first architecture, Editor API, MCP,
headless mode, and scripting. The current tree contains UI primitives and shell
panels, not a mature editing engine.

Decision:

- do not migrate Neumar's TypeScript video IR into Rust
- do not wait for OpenCut's Editor API
- continue using OpenCut as a directional architecture watch
- revisit only when its core has stable persistence, rendering, and tests

Neumar already has an MCP surface, headless sidecar operations, plugins, and a
desktop shell. A rewrite would trade working capabilities for architectural
symmetry.

## video-studio

HEAD: `05cec08`, 2026-07-06

There is no post-August commit delta. It remains valuable as a mature editor
reference.

### Canvas timeline migration

`docs/timeline-canvas-rewrite-plan.md` documents a strangler migration:

- keep DOM for headers, menus, and active interaction
- paint inactive timeline items on canvas
- materialize selected, dragged, resized, or otherwise interactive items as DOM
- hit-test in data space and route into existing handlers
- measure zoom storms after each track type migrates

Neumar currently virtualizes rows but not clips within a visible row. Adapt the
strangler approach only if Phase 0 proves that time-windowed DOM rendering is
insufficient. The first implementation should window clips by visible time and
pin active clips. Canvas painting is the second step, not the starting point.

### Preview/render parity

`docs/preview-render-paths.md` records a recurring failure mode: paused frames
and active playback use different render paths, so transform math must be tested
in both. Neumar also has multiple paths through WebCodecs, Remotion Player, and
final render. Add a parity matrix for transforms, effects, captions, playback
rate, and fractional frame rates.

### Proxy-local media invariant

`docs/proxy-local-media.md` keeps one preview route:

- preview uses a local proxy
- export materializes the original
- missing proxies fail clearly
- no silent streaming or memory fallback changes the contract

Neumar's external-reference model is compatible with this principle. Add a
single media-health report and make render readiness use it. Do not copy
video-studio's Cloudflare-specific storage stack.

### Version history

`version-history-sheet.tsx` shows a useful product shape:

- group revisions into edit sessions
- identify user and agent authors
- allow named versions
- preview an old revision without replacing the current document
- restore non-destructively by saving the pre-restore head first

Neumar should implement the same behavior over local project snapshots. The
storage format should remain filesystem-based and workspace-confined.

### Keyframe registry

video-studio uses a central property registry to define value kind, default,
support predicate, getter, setter, and interpolation. Neumar's current
`KeyframeableProperty` union and effect-parameter tracks remain small enough.
Defer a registry until at least two more domains need keyframes, such as audio
FX and multicamera layout. Add a plan note now so the next expansion does not
grow a switch statement in every renderer and inspector.
