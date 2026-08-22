# Reference project findings since 2026-06-14

The last deep review of these repos was `12-video-mode-4` (2026-06-13/14). Both
have moved since. Method: `git log --since=2026-06-14` in each checkout, then
reading the code the large commits added.

---

## `_sample/openreel-video`

HEAD `2566c34`, 2026-08-18. Two commits matter:

- **`7ef1b6c` — "feat: sync public web and desktop updates (#88)"**, 7,964 files
  changed, +1,060,297 lines. This is the whole product's private→public sync, not
  an incremental feature.
- **`2566c34` — "Improve caption workflows and discovery (#96)"**, 2026-08-18.

### A. A full motion-graphics engine (`packages/core/src/motion/`)

134 files. This is an After-Effects-class layer engine sitting *beside* the
existing NLE timeline, not inside it:

```
motion-engine  motion-renderer  motion-keyframes  motion-roving-keyframes
motion-hierarchy  motion-precomps  motion-null-layers  motion-adjustment-layers
motion-masks  motion-mask-path-keyframes  motion-track-mattes  motion-blend-modes
motion-shape-path  motion-shape-boolean  motion-shape-modifiers  motion-shape-contents
motion-text-animators  motion-text-shader-animator  motion-text-wrap  motion-text-stroke
motion-expressions  motion-expression-controls  motion-variables  motion-variable-bindings
motion-camera  motion-lights  motion-scene3d  motion-3d-transform  motion-three-renderer
motion-particles  motion-particle-presets  motion-puppet  motion-morph  motion-disintegrate
motion-optical-flow  motion-tracking  motion-motion-blur  motion-supersample
motion-shader-renderer  motion-shader-validator  motion-gpu-compositor  motion-gpu-blend
motion-markers  motion-snapping  motion-guides  motion-layout  motion-time-remap
```

Every file has a paired `.test.ts`. The design docs are in
`docs/superpowers/plans/` (2026-06-25 → 2026-07-03: agent-native creation engine,
native render engine, 3D scene authoring, shader FX A/B, expression engine, graph
editor, bezier pen path system, RAM preview + render queue, paper shaders,
per-glyph shader text, AI-generated shaders).

### B. `.fxpkg` — a portable, versioned effect-package format (`packages/fxpkg/`)

The most transferable idea in the repo. A signed, ABI-versioned artifact that
carries a node graph, declared parameters, and declared *requirements*:

```ts
kind: "template" | "filter" | "effect"
abi:  "1.0" | "1.1" | "1.2"          // minor versions backward-compatible
id:   "handle/slug"                   // enforced by regex
requirements: {
  webgpu: boolean;
  detection: ("subject_mask" | "pose" | "face" | "depth")[];
  frame_history_depth: number;
  max_particles: number;
  uses_3d: boolean;
  max_resolution: [number, number];
  perf_budget_ms_per_frame: number;
  perf_budget_ms_detection: number;
}
checksums: Record<string, string>
```

Three properties worth stealing wholesale:

1. **Requirements are declared, so the loader can refuse before runtime.**
   "Unknown nodes are rejected at load time, not as runtime errors."
2. **Resource caps are per-ABI-version** (`ABI_CAPS`), so a host knows exactly
   what a 1.1 package may demand vs a 1.2 one.
3. **Perf budgets are part of the contract**, not a hope.

Host-provided uniforms are a fixed set: `u_source`, `u_samp`, `u_resolution`,
`u_time`, `u_frame`. `money.ts` in the same package implies a paid-effects
marketplace is the intended endpoint.

### C. An effect-authoring Studio (`apps/studio/src/effect/`)

Effects are composed from **atomics** (`blur`, `color-tint`, `distort`, `glow`,
`mask-edge`, `particles`, `replace`) into **presets**
(`aura-glow.v1`, `background-replace.v1`, `cinematic-bars.v1`, `clone.three.v1`,
`dreamy.v1`, `face-tint.v1`, `fire-aura.v1`, `ghost-trail.v1`,
`sparkles.face.v1`, `warm-look.v1`), compiled (`compile.ts`) against a subject
detector pool (`preview/DetectorPool.ts`) with a live `PreviewEngine`.

The versioned preset naming (`.v1`) matters: presets are content, and content
needs migration paths.

### D. The 276-tool agent registry (`packages/agent/`)

`registry.ts` is 31,930 lines. Neuma's equivalent
(`src-api/src/shared/mcp/video-edit-server.ts`) is 4,800 lines / 105 `video_*`
tools. The interesting parts are not the tool count — they're the ergonomics:

**Reference resolution happens in the executor, not each tool.**
`executor.ts::resolveRefs` turns `clipIndex` or `atSec` (+ optional `trackIndex`)
into a canonical `clipId` before dispatch, "so the model never has to juggle
UUIDs". Neuma resolves `$selection` / `$transcript_selection` inside
`video_apply_timeline_ops` only.

**Every tool is flagged, and the flags feed both the gate and the prompt.**

```ts
isReadOnly(name)  → getTool(name)?.readOnly
isDestructive(name), isExpensive(name)
```

`toCapabilityDoc()` renders the whole registry into the system prompt grouped by
domain, with `(read-only, destructive, expensive)` annotations inline. The prompt
then instructs: *"Destructive/expensive tools (delete, remove, export, AI jobs)
require user confirmation — explain what you're about to do."*

**Bulk creation with symbolic keys.** `add_motion_layers` takes an *array* of
specs, each with a `key` and optional `parentKey`, creates them all in one call,
and returns `data.layerIds` keyed by the caller's keys. The prompt says it
outright: *"Reconstruct a 40-layer page in a handful of calls, not 40."*
`animate_motion_layers` then applies a named entrance/exit/emphasis preset to
many layers at once with a `stagger`.

**A visual self-verification loop.** From the system prompt, verbatim:

> **SEE YOUR WORK:** after building or adjusting a reconstruction, call
> `render_motion_frame` (compositionId, optional timeSeconds, scale 1–2) to
> render the composition to an image and VISUALLY compare it against the source.
> Then correct layout, z-order, colour, and text wrap; iterate until it matches.

Tool results can carry an image: `loop.ts::buildToolResultContent` returns a
`[{type:"text"}, {type:"image"}]` block pair when `result.image` is present.

**A real turn budget.** `runTurn` takes `limits: { maxSteps, maxToolCalls,
maxTokens }` and reports a typed `StopReason` of
`end_turn | max_steps | max_tool_calls | budget | error`. `maxTokens` is
documented as a soft ceiling checked *between* steps — "it can't un-spend a
completion".

**Discipline about where output lands.** The prompt is emphatic that a finished
motion composition stays in Motion Creator and only reaches the main timeline via
an explicit `insert_motion_into_editor`, and only when the user asked for it or
is exporting. That separation is what makes a 276-tool surface tractable.

### E. Browser-side Whisper + linked captions (#96)

`apps/web/src/workers/whisper-worker.ts` runs `@huggingface/transformers` in a
worker against a self-hosted model host, with WebGPU→wasm backend fallback:

| Key | Model | Size |
|---|---|---|
| `accurate` (default) | `onnx-community/whisper-large-v3-turbo_timestamped` | ~760 MB |
| `fast` | `onnx-community/whisper-tiny` | ~100 MB |

`utils/whisper-audio.ts` mixes to mono and resamples **only the selected source
range** to 16 kHz — transcribe-a-selection rather than transcribe-everything.

`utils/linked-caption-edit.ts` is the ergonomics win: captions are linked to their
source clip either explicitly (`caption.metadata.captionSourceClipId`) or
implicitly (same track `groupId` + time overlap), and `moveLinkedCaptions` /
delete propagate through the link. Moving a clip moves its captions.

Also added: `CaptionBatchSelectButton`, `CaptionEditorPanel`, SRT import in the
inspector, custom font upload, `TrackClipSelectionMenu`.

---

## `_sample/OpenMontage`

HEAD `1bab711`, 2026-08-18. An agentic *pipeline* system (Python + a
`remotion-composer/` React package), not an editor — so what it contributes is
process, not code.

### A. It uses HyperFrames too, and formalised the runtime choice

`skills/meta/animation-runtime-selector.md` and `skills/core/hyperframes.md`
define a contract Neuma's `EnginePicker.tsx` currently has no equivalent of:

- `renderer_family` (creative grammar) is separated from `render_runtime`
  (technical engine: `remotion` | `hyperframes` | `ffmpeg`).
- Both are locked at proposal time and carried through `edit_decisions`
  unchanged. **"Silent runtime swaps at compose time are a contract violation."**
- **HARD RULE:** when both runtimes are available, the agent MUST present both to
  the user with a one-line description, an honest one-line tradeoff, and a
  recommendation with reason — then wait for explicit approval and log a
  `render_runtime_selection` decision naming both options. A decision recording
  only one option when both were available is a CRITICAL reviewer finding.
- If the selected runtime is unavailable: **escalate, do not substitute
  silently.**

Their decision matrix, condensed:

| Brief | Runtime |
|---|---|
| Existing React scene stack; word-level caption burn; avatar / lip-sync | **remotion** |
| Kinetic typography, HTML/GSAP-native motion, product promo, launch reel | **hyperframes** |
| Website → video, UI-driven composition | **hyperframes** |
| Registry block needed (data-chart, grain overlay, shader transitions) | **hyperframes** |
| Beat-synced music video (audio drives scene timing) | **hyperframes** (`hyperframes beats`) |
| Browser-native editable 3D terrain / free-viewpoint fly-through | **hyperframes** |
| Reference-grade 3D world | ffmpeg packaging of Blender frames |
| Pure concat / trim | **ffmpeg** |

They also track the HyperFrames 0.7 skill split precisely, listing
`hyperframes-core` / `-creative` / `-media` / `-animation` / `-cli` / `-registry`
plus `website-to-video`, `music-to-video`, `motion-graphics`, `media-use`,
`remotion-to-hyperframes` — independent confirmation of the restructure
documented in [`02-hyperframes-delta.md`](02-hyperframes-delta.md).

Note `24617af — "fix: resolve relative HyperFrames output paths"`: relative
`--output` resolution against the composition dir vs cwd is a real footgun.
Neuma's `hyperframes-renderer.ts` resolves the output to an absolute path before
spawning and sets `cwd` to the composition dir, so it is not exposed — worth
keeping that way.

### B. Authoring mode as a first-class decision

Before runtime *or* library, OpenMontage decides **templated** (assemble stock
`cut.type` scenes) vs **atelier** (hand-author from scratch), defaulting to
atelier for hero work. In atelier mode stock scene-types and registry blocks are
explicitly off-limits, and *"does a stock cut-type fit?" is not a valid shortcut
for a hero piece.*

Neuma's template-first flow (`TemplatePicker`, `TemplateUseForm`,
`video_select_template`) has no atelier counterpart and no explicit mode gate.

### C. Provider breadth as a moving target

Since June: Atlas Cloud media-model gateway, Gemini Omni / Seedance 2.5 /
MiniMax H3 routes, Tencent Hunyuan (image + cloud video via TokenHub),
Volcengine Ark Seedance 2.0, Seedream v4/v5, fal ElevenLabs speech, fish.audio
TTS, Azure AI Speech, Google Lyria music, ComfyUI per-capability server URLs with
websocket completion instead of polling, and a production 3D world pipeline.

The transferable detail is *not* the provider list — it's
**`ca203e4 — "wait on ComfyUI websocket feed instead of polling for completion"`**
and **`ceee7c7 — job resume support`**. Neuma's generation jobs
(`src-api/src/shared/video/jobs.ts`) should be audited for the same two
properties.

### D. Skill taxonomy

`skills/{core,creative,meta,pipelines}` with 13 declarative pipelines in
`pipeline_defs/*.yaml`. The `meta` layer is the interesting one:
`animation-runtime-selector`, `bespoke-composition`, `capability-extension`,
`checkpoint-protocol`, `creative-intake`, `onboarding`, `reviewer`,
`skill-creator`, `taste-direction`, `video-reference-analyst`,
`voice-performance-director`. Neuma has recipes and plugins but no
`reviewer` / `taste-direction` / `checkpoint-protocol` equivalent — the "is this
actually good?" layer.
