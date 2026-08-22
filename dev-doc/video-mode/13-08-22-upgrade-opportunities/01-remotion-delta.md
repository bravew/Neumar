# Remotion 4.0.507 → 4.0.515

Method: release notes for each patch, plus a `.d.ts` export diff between the
4.0.507 and 4.0.515 copies still present in `node_modules/.pnpm/`.

## Release-by-release

| Version | Date | What landed |
|---|---|---|
| 4.0.508 | Aug 11 | Five new colour-grading effects — `exposure()`, `whiteBalance()`, `vibrance()`, `levels()`, `shadowsHighlights()`. Byte-based media cache scaling. Keyframe-bank preservation for active playheads. Lambda writable output stream for the web renderer. |
| 4.0.509 | Aug 12 | `colorCorrection()` — one effect consolidating the grading knobs. `_experimentalKeepAudioContextAlive`. Property copying between components. Timeline track virtualization. Failed frame-extraction isolation. |
| 4.0.510 | Aug 14 | `regionBlur()`. Studio 3D transform controls, precise numeric timeline inputs, **"Hold" easing**. AWS China regions for Lambda. |
| 4.0.511 / .512 | Aug 14 | Interactivity regression fix (keyframe-clock revert); .512 is a republish of .511. |
| 4.0.513 | Aug 18 | `@remotion/mac-cursors`. `tile()` effect. **Connected composition support in `<Series.Sequence>`.** Fixes: 3D rotation interpolation from zero, audio sample-rate conversion. |
| 4.0.514 | Aug 20 | **Reverted nested HTML-in-canvas** (upstream breaking change). Studio visual mode client-side rendering. Timeline virtualization for wide items / many tracks. Sequence reordering + keyframe operations in browser Studio. |
| 4.0.515 | Aug 21 | `outline()` effect. **Lambda render cancellation.** Encoder backpressure handling. MapTiler-compatible map components (experimental). Fixes: timeline waveform flicker, SVG gradient stroke preservation, oversized border-radius clamping. |

## Declaration-diff (what the type surface actually gained)

`@remotion/renderer` — five new exports, all render-throughput or lifecycle:

```
+ enableCancellationOption
+ experimentalKeepAudioContextAliveOption
+ hasEnoughMemoryForParallelEncoding
+ makeLazyCompositor
+ writeWithBackpressure
```

`remotion` core — the mediabunny bridge is now first-class:

```
+ MEDIABUNNY_DURATION_VALUE_KEY
+ getMediabunnyInputResourceKey
+ globalMediaResourceManager
+ makeMediaResourceManager
+ getFrameInKeyframedStatusClock
+ interpolateTranslate
+ wrapInSchema
```

`@remotion/player`, `@remotion/transitions`, `@remotion/captions`,
`@remotion/media-parser`, `@remotion/media-utils`, `@remotion/bundler`: **no
public declaration changes.** The player, transitions, and caption surfaces
Neuma already uses are byte-for-byte compatible.

`mediabunny` 1.53.0 → 1.55.2: **no declaration changes.** Patch-only.

## Packages published at 4.0.515 that Neuma does not depend on

Confirmed via `npm view <pkg>@4.0.515 version`:

| Package | What it gives | Relevance to Neuma |
|---|---|---|
| **`@remotion/effects`** | 72 GPU shader effects | **High** — see below |
| **`@remotion/media`** | mediabunny-powered `<Video>` / `<Audio>` — the *recommended* tags for new projects; accepts the same `effects` array in preview and render | **High** — and Neuma has the exact video-tag fragmentation it fixes: preview (`RemotionTimelineComposition.tsx`) uses `Html5Video`, while render (`remotion-composition.ts`) uses `OffthreadVideo` |
| `@remotion/animation-utils` | interpolate-styles helpers | Low |
| `@remotion/webcodecs` | in-browser transcode / trim | Medium — could replace parts of `webcodecs-renderer.ts` |
| `@remotion/mac-cursors` | native macOS cursor capture | Medium — screen-recording mode |
| `@remotion/lambda`, `@remotion/cloudrun` | distributed render | Out of scope (Neuma renders locally / via sidecar) |

### `@remotion/effects` — the full list

Introduced upstream in 4.0.464; extended through 4.0.515. Effects apply to
canvas-based components (`<Solid>`, `<Video>`, `<Img>`, `<CanvasImage>`,
`<AnimatedImage>`, `<Gif>`, `<HtmlInCanvas>`, `@remotion/shapes`) through an
`effects` array prop, compose in specification order, and can be driven from
`useCurrentFrame()`. Remotion needs no separate animation runtime, but Neuma's IR
still needs a typed `effectId + parameter` keyframe target because its current
`KeyframeableProperty` union only covers transform, audio, and text properties.

```
barrel-distortion  blur  brightness  burlap  checkerboard  chromatic-aberration
color-correction  color-key  contour-lines  contrast  corner-pin  dot-grid
drop-shadow  duotone  emboss  evolve  exposure  fisheye  flannel  glow
grayscale  gridlines  halftone  halftone-linear-gradient  hue  invert  levels
light-leak  light-trail  linear-gradient  linear-gradient-tint
linear-progressive-blur  linear-progressive-pixelate  lines  liquid-contours
mirror  noise  noise-displacement  outline  page-turn  paper  pattern
pixel-dissolve  pixelate  radial-progressive-blur  radial-progressive-pixelate
region-blur  rings  roughen-edges  saturation  scale  scanlines
shadows-highlights  shine  shrinkwrap  skew  speckle  starburst  thermal-vision
tile  tint  translate  tv-signal-off  venetian-blinds  vibrance  vignette  wave
waves  white-balance  white-noise  zigzag  zoom-blur
```

`colorCorrection()` alone covers the whole primary-grade panel Neuma would
otherwise have to build by hand:

```ts
type ColorCorrectionParams = {
  exposure?: number;    // stops, -5..5
  contrast?: number;    // multiplier
  pivot?: number;       // 0..1
  shadows?: number;     // -1..1
  highlights?: number;  // -1..1
  whites?: number;      // -1..1
  blacks?: number;      // -1..1
  temperature?: number; // blue↔amber, -1..1
  tint?: number;        // green↔magenta, -1..1
  saturation?: number;  // multiplier
  vibrance?: number;    // -1..1
};
```

Compare with everything Neuma can express today
(`src-api/src/shared/video/clip-filters.ts`, `ClipFilters`):
`brightness`, `contrast`, `saturation`, `hueRotateDeg`, `blurPx`, `grayscale`,
`sepia` — emitted as a CSS `filter` string.

## Things to watch when adopting

- **4.0.514 reverted nested HTML-in-canvas.** If any future Neuma work leans on
  `<HtmlInCanvas>`, nesting is not supported at 4.0.515. Don't design around it.
- **Effects require a canvas-based component.** A plain DOM `<div>` with a CSS
  filter is unaffected. Adopting effects for video clips means routing
  `Html5Video`, `BlurPadVideo`, and the three render-side `OffthreadVideo` call
  sites through `@remotion/media`'s `<Video>`. Core `Img` already accepts the
  `effects` prop in 4.0.515, so `BlurPadImage` and `RemotionKenBurnsImage` do not
  belong in the media migration. `RemotionVividOverlay` is an iframe and remains
  outside this effect path.
- **`@remotion/media` is "recommended for new projects"**, and core's tags stay
  available "for direct use and fallback-specific behavior". Treat the migration
  as opt-in per video surface, not a sweeping replacement. Clips with effects
  also need an explicit fallback policy because an `OffthreadVideo` fallback
  cannot preserve a canvas effect stack.
- **Apple ProRes decoding in `@remotion/media` is off by default** and needs
  explicit enabling. Relevant if Neuma ingests ProRes sources.
- **Lambda cancellation and encoder backpressure** don't change Neuma's local
  path, but `writeWithBackpressure` landing in `@remotion/renderer` suggests
  long-render memory behaviour improved — worth re-measuring the render queue's
  peak RSS on long timelines before/after, since the sweep's gate evidence didn't
  cover that.
