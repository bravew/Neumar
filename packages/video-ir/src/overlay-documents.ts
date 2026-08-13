// Built-in vivid-overlay HTML preset documents (authoring-contract compliant:
// CSS @keyframes / WAAPI only, self-contained, transparent background, reads
// typed controls from window.__overlayParams, sets window.__overlayReady).
// Compiled + instantiated via overlay-html.ts. Keyed by
// VividOverlayPresetDef.documentId. Wave-1/2 catalog documents live in the
// per-category overlay-documents-*.ts modules merged below.

import { VIVID_OVERLAY_BADGE_DOCUMENTS } from './overlay-documents-badges.js';
import { VIVID_OVERLAY_CALLOUT_DOCUMENTS } from './overlay-documents-callouts.js';
import { VIVID_OVERLAY_FRAME_DOCUMENTS } from './overlay-documents-frames.js';
import { VIVID_OVERLAY_LOWER_THIRD_DOCUMENTS } from './overlay-documents-lower-thirds.js';
import { VIVID_OVERLAY_SCREEN_DOCUMENTS } from './overlay-documents-screen.js';
import { VIVID_OVERLAY_SOCIAL_DOCUMENTS } from './overlay-documents-social.js';
import { VIVID_OVERLAY_TITLE_DOCUMENTS } from './overlay-documents-titles.js';
import { VIVID_OVERLAY_WIDGET_DOCUMENTS } from './overlay-documents-widgets.js';
import { MOTION_ANYTHING_LOTTIE_ASSETS } from './overlay-lottie-assets.generated.js';

const MARKER_HIGHLIGHT_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .marker {
    position: relative;
    display: inline-block;
    padding: 0.12em 0.4em;
    font: 800 var(--overlay-font-size, 64px)/1.25 system-ui, -apple-system, sans-serif;
    color: #111;
    letter-spacing: 0.01em;
  }
  .marker .hl {
    position: absolute; inset: 0;
    background: var(--overlay-color, #ffd166);
    border-radius: 0.18em;
    transform-origin: left center;
    animation: hl-sweep 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both;
    z-index: 0;
  }
  .marker .txt {
    position: relative; z-index: 1; display: inline-block;
    animation: txt-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both;
  }
  @keyframes hl-sweep { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes txt-pop {
    from { transform: translateY(0.4em) scale(0.82); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
</style>
</head>
<body>
  <div class="wrap"><span class="marker"><span class="hl"></span><span class="txt"></span></span></div>
  <script>
    (function () {
      var params = window.__overlayParams || {};
      var controls = params.controls || {};
      var root = document.documentElement;
      if (typeof controls.fontSize === 'number') {
        root.style.setProperty('--overlay-font-size', controls.fontSize + 'px');
      }
      if (typeof controls.color === 'string') {
        root.style.setProperty('--overlay-color', controls.color);
      }
      document.querySelector('.txt').textContent =
        typeof controls.text === 'string' ? controls.text : 'Highlight this';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const LOWER_THIRD_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .third {
    position: absolute; left: 6%; bottom: 12%;
    display: flex; align-items: stretch; gap: 0;
    animation: third-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  .bar {
    width: 0.55em; border-radius: 4px 0 0 4px;
    background: var(--overlay-accent, #33ccff);
    font-size: 28px;
    transform-origin: center bottom;
    animation: bar-grow 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.25s both;
  }
  .text {
    background: rgba(12, 14, 20, 0.82);
    border-radius: 0 6px 6px 0;
    padding: 14px 26px 14px 18px;
    font-family: system-ui, -apple-system, sans-serif;
    overflow: hidden;
  }
  .title {
    font-size: 34px; font-weight: 800; color: #fff; line-height: 1.2;
    animation: line-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.35s both;
  }
  .subtitle {
    font-size: 20px; font-weight: 500; line-height: 1.35;
    color: var(--overlay-accent, #33ccff);
    animation: line-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.5s both;
  }
  @keyframes third-in { from { transform: translateX(-36px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes bar-grow { from { transform: scaleY(0.2); } to { transform: scaleY(1); } }
  @keyframes line-up { from { transform: translateY(120%); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
</head>
<body>
  <div class="third">
    <div class="bar"></div>
    <div class="text">
      <div class="title"></div>
      <div class="subtitle"></div>
    </div>
  </div>
  <script>
    (function () {
      var params = window.__overlayParams || {};
      var controls = params.controls || {};
      if (typeof controls.accentColor === 'string') {
        document.documentElement.style.setProperty(
          '--overlay-accent',
          controls.accentColor,
        );
      }
      document.querySelector('.title').textContent =
        typeof controls.title === 'string' ? controls.title : 'Your Name';
      document.querySelector('.subtitle').textContent =
        typeof controls.subtitle === 'string' ? controls.subtitle : 'What you do';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const TITLE_POP_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .title {
    display: flex; flex-wrap: wrap; justify-content: center; gap: 0 0.28em;
    max-width: 84%;
    font: 900 var(--overlay-font-size, 92px)/1.15 system-ui, -apple-system, sans-serif;
    color: var(--overlay-color, #ffffff);
    -webkit-text-stroke: 0.04em rgba(10, 10, 14, 0.9);
    paint-order: stroke fill;
    text-transform: uppercase;
    letter-spacing: 0.01em;
  }
  .title span {
    display: inline-block;
    animation: word-pop 0.42s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  @keyframes word-pop {
    from { transform: translateY(0.55em) scale(0.6) rotate(-4deg); opacity: 0; }
    60% { transform: translateY(-0.06em) scale(1.08); opacity: 1; }
    to { transform: none; opacity: 1; }
  }
</style>
</head>
<body>
  <div class="wrap"><div class="title"></div></div>
  <script>
    (function () {
      var params = window.__overlayParams || {};
      var controls = params.controls || {};
      var root = document.documentElement;
      if (typeof controls.fontSize === 'number') {
        root.style.setProperty('--overlay-font-size', controls.fontSize + 'px');
      }
      if (typeof controls.color === 'string') {
        root.style.setProperty('--overlay-color', controls.color);
      }
      var text =
        typeof controls.text === 'string' ? controls.text : 'BIG TITLE';
      var title = document.querySelector('.title');
      var words = text.split(/\\s+/).filter(Boolean);
      for (var i = 0; i < words.length; i++) {
        var span = document.createElement('span');
        span.textContent = words[i];
        span.style.animationDelay = 0.12 + i * 0.14 + 's';
        title.appendChild(span);
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const CALLOUT_BOX_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .callout {
    position: absolute; right: 7%; top: 14%;
    max-width: 42%;
    padding: 18px 22px;
    border-radius: 14px 14px 4px 14px;
    background: var(--overlay-color, #7c3aed);
    color: #fff;
    font: 700 var(--overlay-font-size, 34px)/1.3 system-ui, -apple-system, sans-serif;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    transform-origin: 90% 110%;
    animation:
      callout-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both,
      callout-wiggle 0.9s ease-in-out 0.65s 2;
  }
  .callout::after {
    content: '';
    position: absolute; right: 12px; bottom: -14px;
    border: 10px solid transparent;
    border-top-color: var(--overlay-color, #7c3aed);
    border-right-color: var(--overlay-color, #7c3aed);
  }
  @keyframes callout-pop {
    from { transform: scale(0.3) rotate(6deg); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
  @keyframes callout-wiggle {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(-1.6deg); }
    75% { transform: rotate(1.6deg); }
  }
</style>
</head>
<body>
  <div class="callout"></div>
  <script>
    (function () {
      var params = window.__overlayParams || {};
      var controls = params.controls || {};
      var root = document.documentElement;
      if (typeof controls.fontSize === 'number') {
        root.style.setProperty('--overlay-font-size', controls.fontSize + 'px');
      }
      if (typeof controls.color === 'string') {
        root.style.setProperty('--overlay-color', controls.color);
      }
      document.querySelector('.callout').textContent =
        typeof controls.text === 'string' ? controls.text : 'Did you know?';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

export const VIVID_OVERLAY_DOCUMENTS: Record<string, string> = {
  'marker-highlight': MARKER_HIGHLIGHT_DOCUMENT,
  'lower-third': LOWER_THIRD_DOCUMENT,
  'title-pop': TITLE_POP_DOCUMENT,
  'callout-box': CALLOUT_BOX_DOCUMENT,
  ...VIVID_OVERLAY_TITLE_DOCUMENTS,
  ...VIVID_OVERLAY_LOWER_THIRD_DOCUMENTS,
  ...VIVID_OVERLAY_CALLOUT_DOCUMENTS,
  ...VIVID_OVERLAY_BADGE_DOCUMENTS,
  ...VIVID_OVERLAY_SOCIAL_DOCUMENTS,
  ...VIVID_OVERLAY_WIDGET_DOCUMENTS,
  ...VIVID_OVERLAY_SCREEN_DOCUMENTS,
  ...VIVID_OVERLAY_FRAME_DOCUMENTS,
};

export function vividOverlayDocument(documentId: string): string | undefined {
  return VIVID_OVERLAY_DOCUMENTS[documentId];
}

// First-party Lottie animations (hand-authored — no third-party licensing).
// Keyed by `lottie:<name>` documentIds in the preset registry.
const LOTTIE_PULSE_BADGE = JSON.stringify({
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 60,
  w: 512,
  h: 512,
  nm: 'pulse-badge',
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'circle',
      sr: 1,
      ks: {
        o: {
          a: 1,
          k: [
            { i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] }, t: 0, s: [0] },
            { t: 12, s: [100] },
          ],
        },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [256, 256, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: {
          a: 1,
          k: [
            {
              i: { x: [0.3, 0.3, 0.3], y: [1, 1, 1] },
              o: { x: [0.7, 0.7, 0.7], y: [0, 0, 0] },
              t: 0,
              s: [30, 30, 100],
            },
            {
              i: { x: [0.3, 0.3, 0.3], y: [1, 1, 1] },
              o: { x: [0.7, 0.7, 0.7], y: [0, 0, 0] },
              t: 30,
              s: [115, 115, 100],
            },
            { t: 60, s: [95, 95, 100] },
          ],
        },
      },
      shapes: [
        {
          ty: 'gr',
          nm: 'g',
          it: [
            {
              ty: 'el',
              nm: 'e',
              p: { a: 0, k: [0, 0] },
              s: { a: 0, k: [280, 280] },
            },
            {
              ty: 'st',
              nm: 's',
              c: { a: 0, k: [1, 1, 1, 1] },
              o: { a: 0, k: 100 },
              w: { a: 0, k: 14 },
            },
            {
              ty: 'fl',
              nm: 'f',
              c: { a: 0, k: [1, 0.28, 0.45, 1] },
              o: { a: 0, k: 90 },
            },
            {
              ty: 'tr',
              nm: 't',
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
              sk: { a: 0, k: 0 },
              sa: { a: 0, k: 0 },
            },
          ],
        },
      ],
      ip: 0,
      op: 60,
      st: 0,
    },
  ],
});

// Confetti burst: eight rectangles flying out from center with rotation and
// a fade, staggered starts. 54 frames @30fps ≈ 1.8s.
const CONFETTI_COLORS: Array<[number, number, number]> = [
  [1, 0.31, 0.42],
  [0.24, 0.83, 0.63],
  [0.98, 0.75, 0.14],
  [0.35, 0.53, 0.97],
  [0.78, 0.42, 0.95],
  [0.2, 0.83, 0.93],
  [0.98, 0.45, 0.09],
  [0.94, 0.27, 0.68],
];

const LOTTIE_CONFETTI = JSON.stringify({
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 54,
  w: 512,
  h: 512,
  nm: 'confetti-burst',
  ddd: 0,
  assets: [],
  layers: CONFETTI_COLORS.map((color, index) => {
    const angle = (index / CONFETTI_COLORS.length) * Math.PI * 2;
    const distance = 200 + (index % 3) * 26;
    const endX = 256 + Math.round(Math.cos(angle) * distance);
    const endY = 256 + Math.round(Math.sin(angle) * distance) + 40;
    const start = index % 4;
    return {
      ddd: 0,
      ind: index + 1,
      ty: 4,
      nm: `p${index}`,
      sr: 1,
      ks: {
        o: {
          a: 1,
          k: [
            {
              i: { x: [0.4], y: [1] },
              o: { x: [0.6], y: [0] },
              t: start,
              s: [0],
            },
            { t: start + 4, s: [100] },
            {
              i: { x: [0.4], y: [1] },
              o: { x: [0.6], y: [0] },
              t: 40,
              s: [100],
            },
            { t: 52, s: [0] },
          ],
        },
        r: {
          a: 1,
          k: [
            {
              i: { x: [0.4], y: [1] },
              o: { x: [0.6], y: [0] },
              t: start,
              s: [0],
            },
            { t: 52, s: [index % 2 === 0 ? 340 : -300] },
          ],
        },
        p: {
          a: 1,
          k: [
            {
              i: { x: 0.2, y: 1 },
              o: { x: 0.5, y: 0 },
              t: start,
              s: [256, 276, 0],
              to: [0, 0, 0],
              ti: [0, 0, 0],
            },
            { t: 50, s: [endX, endY, 0] },
          ],
        },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      shapes: [
        {
          ty: 'gr',
          nm: 'g',
          it: [
            {
              ty: 'rc',
              nm: 'r',
              p: { a: 0, k: [0, 0] },
              s: { a: 0, k: [26, 16] },
              r: { a: 0, k: 3 },
            },
            {
              ty: 'fl',
              nm: 'f',
              c: { a: 0, k: [...color, 1] },
              o: { a: 0, k: 100 },
            },
            {
              ty: 'tr',
              nm: 't',
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
              sk: { a: 0, k: 0 },
              sa: { a: 0, k: 0 },
            },
          ],
        },
      ],
      ip: start,
      op: 54,
      st: start,
    };
  }),
});

export const VIVID_OVERLAY_LOTTIE_ASSETS: Record<string, string> = {
  'pulse-badge': LOTTIE_PULSE_BADGE,
  confetti: LOTTIE_CONFETTI,
  ...MOTION_ANYTHING_LOTTIE_ASSETS,
};
