# HyperFrames 0.6.97 → 0.8.7

Method: both versions are still in `node_modules/.pnpm/`, so this delta was taken
by diffing the packages directly and running `--help` on every command in both
binaries — not from release notes.

```
old  node_modules/.pnpm/hyperframes@0.6.97_.../node_modules/hyperframes
new  src-video/node_modules/hyperframes            (0.8.7)
```

## Packaging changes

| | 0.6.97 | 0.8.7 |
|---|---|---|
| bin | `./dist/cli.js` | `./bin/hyperframes.mjs` (Node ≥ 22 guard via `dist/runtimeVersion.js`) |
| CLI bundle | 8.2 MB | 10.9 MB |
| runtime bundle | 190 KB | 391 KB |
| license | unspecified | Apache-2.0 |
| new dist artifacts | — | `beat-analyzer.global.js`, `hyperframes-player.global.js`, `hyperframes-slideshow.global.js`, `commands/motion-sample.browser.js` |
| removed | `dist/pngDecodeBlitWorker.js` | — |
| deps | `@hono/node-server ^1.8`, `@puppeteer/browsers ^2.13`, `puppeteer-core ^24.39`, `sharp ^0.34.5`, `adm-zip ^0.5.16` | `^2.0.5`, `^3.2.1`, `^25.8.0`, `^0.35.0`, `^0.6.0` |

The dependency bumps are why G13 was prioritised — they clear the `postcss`
sourcemap-disclosure and `extract-zip` symlink-traversal advisories that rode in
through `puppeteer-core` / `@puppeteer/browsers`.

**Node ≥ 22 is now a hard requirement.** `bin/hyperframes.mjs` refuses to start
below it. Checked: this is fine — every `src-api` sidecar target is
`PKG_NODE_RANGE=22` / `node22-*` across macOS arm64, macOS x64, Linux x64, and
Windows x64. The real packaging constraint is different and covered in
[`04-gaps-and-proposals.md`](04-gaps-and-proposals.md) Gap 2: `hyperframes` is a
`src-video` **devDependency** and is not in `src-api`'s `pkg.scripts` bundle
list, so a packaged build has no CLI on disk unless one is shipped as a Tauri
resource or found on `PATH`.

## Nine new commands

| Command | What it does |
|---|---|
| `check` | Lint + runtime validation + layout + motion + WCAG AA contrast in **one browser session**, `--json` for agents. Supersedes `validate` (now marked deprecated). Knobs: `--at`, `--at-transitions`, `--caption-zone`, `--frame-check`, `--collapse-static`, `--strict`, `--snapshots`. |
| `beats` | Detects beats in the project's music track in headless Chrome, writes `beats/<audio>.json`. Requires `data-timeline-role="music"` (or an id containing `music`/`bgm`/`soundtrack`). |
| `keyframes` | Surfaces GSAP tweens, CSS `@keyframes`, and Anime.js timelines. `--shot` renders an **onion-skin diagnostic PNG** — ghosts of the real element sampled across the timeline, with `--angle` orbit presets (`front\|iso\|top\|side\|rear-iso` or `yaw,pitch`), `--layout path\|strip`, and `--ghost` for canvas/WebGL compositing. |
| `media-treatment` | Discover / analyze / apply / clear deterministic colour grading on one `<img>` or `<video>`. `--capabilities` prints an agent-readable capability overview; `--analyze` measures local media and *suggests* a bounded correction. |
| `normalize-audio` | Matches one authored audio clip's loudness to another by integrated LUFS. `--write` persists the measured gain into `index.html`. |
| `grade-compare` | Renders candidate grades (JSON blocks or `.cube` LUTs) onto a reference frame as one labeled comparison PNG. |
| `compare` | Renders 2–16 independent composition variants at a shared `--at` timestamp into one labeled contact sheet. |
| `present` | Serves a slideshow deck in presenter mode with audience sync. |
| `play` | Serves the composition through the embeddable `<hyperframes-player>` web component instead of the full Studio. |

## Materially changed existing commands

### `render`

```
--experimental-fast-capture   Chrome drawElementImage instead of Page.captureScreenshot —
                              reads DOM paint records directly, ~2× faster. Default: on where
                              it can engage (macOS + hardware-GPU browser). Falls back to
                              screenshot capture automatically on incompatible compositions.
--frames-cache-dir <dir>      Content-addressed extracted-frame cache. Relocate off the system
                              drive, or "off"/"none"/"false"/"0" to disable.
                              Env: HYPERFRAMES_EXTRACT_CACHE_DIR
-f, --fps                     Now accepts ffmpeg-style rationals: 30000/1001 (29.97),
                              24000/1001 (23.976), 60000/1001 (59.94). Range 1–240.
--video-frame-format          auto | jpg | png. Use png for UI recordings, screen captures,
                              and colour-sensitive sources; alpha sources always extract PNG.
--vp9-cpu-used                libvpx-vp9 -cpu-used, -8..8. Env: PRODUCER_VP9_CPU_USED
--best-effort / --no-best-effort   Allow (default) or reject output with capture-readiness warnings
--debug                       Full render diagnostics + retained intermediates
--batch --json                Exactly one final JSON result document
```

### `preview` — the agent bridge

This is the biggest integration surface added in 0.8.x.

```
--background / --foreground / --status / --stop / --list / --kill-all
        Managed persistent preview lifecycle. Bare `preview` auto-creates a managed
        persistent session in a non-TTY (agent) shell.
--selection --json
        Print the element the user selected in a running Studio and exit.
--context --json --context-fields server,selection,lint,capabilities
--context-detail compact|full
        Read agent-useful state out of a running Studio session and exit.
--proxy / --no-proxy
        Auto-transcode browser-hostile codecs (HEVC, ProRes, AV1) to a cached
        authoring proxy. Default on; overrides hyperframes.json media.autoProxy.
--browser-path / --user-data-dir / --remote-debugging-port / --browser-no-gpu / --browser-gpu
```

The compact `--context` payload carries: selected element's source file,
composition path, current timeline time, `data-hf-id` **or** selector target,
bounding box, text content, and a thumbnail URL. `--context-detail full` adds
`computedStyles`, `inlineStyles`, `dataAttributes`, and editable text-field
metadata.

Documented failure codes: `preview-not-running`, `ambiguous-preview-server`,
`preview-port-mismatch`, `no-selection`, `selection-unavailable`.

Studio project URL convention: `http://localhost:<port>/#project/<project-name>`,
or `http://localhost:<port>/?view=storyboard#project/<name>` to land on the
storyboard. A URL missing the `#project/…` hash opens Studio with nothing loaded.

### `snapshot`

```
--at <a,b,c>      Exact timestamps
--frames <n>      Evenly-spaced count (default 5)
--end / --no-end  Always include a readable end-of-timeline frame (default on)
--angle           Orthogonal 3D camera preset for depth/occlusion checks
--zoom <sel|x,y,w,h> --zoom-scale <n>
                  Crop a high-density screenshot (raised deviceScaleFactor —
                  never CSS zoom or viewport resize, so layout stays identical).
                  A selector matching nothing is an error, not a silent full frame.
--describe        Gemini vision frame analysis; runs by default when GEMINI_API_KEY
                  is set. Pass a custom question or `false` to opt out.
```

### Others

- `transcribe` — new `--engine auto|parakeet|whisper` (Parakeet via
  `uv pip install parakeet-mlx` is faster and more accurate), `--to srt|vtt`
  sidecar export, `--preserve-cues` (for CJK / single-word cues), `--optional`
  (skip and exit 0 when whisper-cpp is unavailable), `--timeout`.
- `catalog` — `--on-device` semantic ("by meaning") search over the block registry.
- `publish` — `--update <url|id>` in-place update, `--space <id>` shared team
  space, `--public`, `--proxy` to bake H.264 proxies into the archive.
- `add` — `--vars <json>` bakes variable values into the printed snippet;
  `--force` overwrites locally edited files (kept by default).
- `skills` — became a subcommand group: `skills check` / `skills update [names…]`.
- `upgrade` — `--project <dir>` bumps a project's pinned `hyperframes@<version>`
  package.json scripts; `--check` is read-only.
- `init` — `--skill <slug>` stamps the owning authoring workflow into
  `hyperframes.json` for telemetry attribution. `--skip-skills` is *temporarily
  ignored*; use `HYPERFRAMES_SKIP_SKILLS=1` in CI.

## Runtime: 22 new `data-*` attributes

The `hyperframe.manifest.json` is byte-identical between versions, and
`dist/docs/*.md` changed only in `rendering.md` (the two new render flags) — but
the runtime bundle doubled in size and gained these attributes:

**Author-facing (new capability):**

| Attribute | Apparent purpose |
|---|---|
| `data-color-grading` | Per-element colour grading — pairs with the `media-treatment` CLI |
| `data-fx-chain` | Effect chains on an element |
| `data-audio-group` | Audio grouping / bussing — pairs with `normalize-audio` |
| `data-automation` | Parameter automation envelopes |
| `data-playback-rate` | Constant media speed; **render-safe for picture and pitch-preserved sound**, per the skill. Does *not* make source speed ramps keyframeable — ramps must be preprocessed |
| `data-layer` | Explicit layering |
| `data-var-text`, `data-var-src` | Variable binding for text and media sources (templating) |
| `data-requires-webgpu` | Declare a WebGPU requirement |
| `data-hidden` | Hide without affecting timing |

**Internal / Studio-stamped:** `data-hf-id`, `data-hf-root`, `data-hf-render-id`,
`data-hf-autostamped`, `data-hf-css-vars`, `data-hf-ignore`,
`data-hyperframes-ignore`, `data-hyperframes-picker-ignore`,
`data-hf-authored-opacity`, `data-hf-color-grading-canvas`,
`data-hf-color-grading-source-hidden`, `data-hf-edit-base-x`,
`data-hf-edit-base-y`, `data-hf-edit-original-translate`,
`data-hf-studio-manual-edit-gesture`.

`data-hf-id` is the stable element handle the `preview --context` bridge prefers
over CSS selectors.

**Because the manifest is unchanged, existing Neuma-authored HyperFrames
compositions keep rendering identically.** The new attributes are purely
additive. That matches the sweep's "no CLI-surface breaks" verdict — it just
undersells how much new surface arrived.

## Skills: monolith → router + lazy domain skills

0.6.97 shipped two skill trees (`hyperframes`, `hyperframes-cli`) plus a `gsap`
skill. 0.8.7 replaces that with a router and a lazily-installed registry.

```
skills/hyperframes/
  SKILL.md                        router: project-state table → route table → domain skills
  references/
    intent-interview.md           full fresh-creation conversation, ends by writing BRIEF.md
    capability-menu.md
    pitch-round.md
    route-briefs.md
    skill-lifecycle.md            core-vs-lazy split, install/diagnose, CI opt-out
    workflow-catalog.md
    routes/                       one contract file per route
      embedded-captions  faceless-explainer  general-video  motion-graphics
      music-to-video  pr-to-video  product-launch-video  remotion-to-hyperframes
      slideshow  talking-head-recut
skills/hyperframes-cli/
  SKILL.md
  references/
    beats  cloud  cloudrun  compare-and-batch  doctor-browser
    init-and-scaffold  lambda  lint-validate-inspect  preview-render  upgrade-info-misc
```

The `gsap` skill (with `references/effects.md` and
`scripts/extract-audio-data.py`) was **removed** from the package. Its content
moved into lazily-installed domain skills fetched via `hyperframes skills update`:
`/hyperframes-core`, `/hyperframes-animation`, `/hyperframes-keyframes`,
`/hyperframes-creative`, `/hyperframes-audio`, `/hyperframes-cli`,
`/hyperframes-registry`, `/media-use`, `/figma`.

The router also defines a **pin-currency protocol** worth mirroring: a scaffolded
project pins `hyperframes@<version>` in its `package.json` scripts, the pin never
advances on its own, and a pinned run of an older CLI prints no warning. Before
the first render-affecting command on a resumed project, the agent is expected to
run `npx hyperframes@latest upgrade --project . --check`, apply with
`upgrade --project .` if behind, verify with `check`, and name the old and new
version in its summary — reverting to the pin if `check` fails.

### Impact on Neuma

`plugins/builtin/design-skills/hyperframes/skills/hyperframes/` currently holds
Neuma's own copy of the **0.6.x monolithic** skill:

```
SKILL.md  house-style.md
references/{dynamic-techniques,captions,transcript-guide,tts,transitions}.md
references/transitions/catalog.md
```

That shape no longer exists upstream. Neuma's copy will keep working (it's
self-contained prose), but it teaches agents an obsolete routing model and
predates every command in this document.
