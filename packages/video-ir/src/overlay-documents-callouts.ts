// Wave-1 callout/annotation vivid-overlay documents (authoring contract per
// overlay-documents.ts). SVG draw-on effects use stroke-dashoffset keyframes.

const CIRCLE_MARKER_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  svg { width: 46%; height: auto; overflow: visible; }
  .ring {
    fill: none;
    stroke: var(--overlay-color, #ef4444);
    stroke-width: var(--overlay-stroke, 6);
    stroke-linecap: round;
    stroke-dasharray: 1000;
    stroke-dashoffset: 1000;
    animation: ring-draw 0.9s cubic-bezier(0.65, 0, 0.35, 1) 0.15s forwards;
  }
  @keyframes ring-draw { to { stroke-dashoffset: 0; } }
</style>
</head>
<body>
  <div class="wrap">
    <svg viewBox="0 0 320 180">
      <path class="ring" pathLength="1000"
        d="M160 18 C 258 10, 306 46, 305 88 C 304 140, 236 168, 158 165 C 76 162, 16 136, 18 88 C 20 40, 92 14, 178 22" />
    </svg>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      var root = document.documentElement;
      if (typeof controls.color === 'string') {
        root.style.setProperty('--overlay-color', controls.color);
      }
      if (typeof controls.strokeWidth === 'number') {
        root.style.setProperty('--overlay-stroke', String(controls.strokeWidth));
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const ARROW_LABEL_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center; gap: 18px;
  }
  .wrap.dir-left { flex-direction: row; }
  .wrap.dir-right { flex-direction: row-reverse; }
  .wrap.dir-up { flex-direction: column; }
  .wrap.dir-down { flex-direction: column-reverse; }
  svg { width: 110px; height: 110px; overflow: visible; }
  .shaft {
    fill: none;
    stroke: var(--overlay-color, #facc15);
    stroke-width: 9; stroke-linecap: round;
    stroke-dasharray: 400; stroke-dashoffset: 400;
    animation: draw 0.55s cubic-bezier(0.65, 0, 0.35, 1) 0.1s forwards;
  }
  .head {
    fill: var(--overlay-color, #facc15);
    transform-origin: 22px 24px;
    animation: head-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) 0.55s both;
  }
  .label {
    padding: 10px 20px; border-radius: 10px;
    background: rgba(12, 14, 20, 0.88);
    color: #fff;
    font: 700 26px/1.25 system-ui, -apple-system, sans-serif;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    animation: label-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.65s both;
  }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  @keyframes head-pop { from { transform: scale(0); } to { transform: scale(1); } }
  @keyframes label-in { from { transform: scale(0.7); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
</head>
<body>
  <div class="wrap dir-left">
    <svg viewBox="0 0 110 110">
      <g class="rot">
        <path class="shaft" pathLength="400" d="M96 88 C 70 82, 40 66, 26 30" />
        <path class="head" d="M22 24 L14 48 L38 40 Z" />
      </g>
    </svg>
    <div class="label"></div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      document.querySelector('.label').textContent =
        typeof controls.text === 'string' ? controls.text : 'Look here';
      var dir = typeof controls.direction === 'string' ? controls.direction : 'left';
      var wrap = document.querySelector('.wrap');
      wrap.className = 'wrap dir-' + (['left', 'right', 'up', 'down'].indexOf(dir) >= 0 ? dir : 'left');
      var rotations = { left: 0, right: 90, up: 45, down: 200 };
      document.querySelector('svg').style.transform = 'rotate(' + (rotations[dir] || 0) + 'deg)';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const SPOTLIGHT_DIM_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .dim {
    position: absolute; inset: 0;
    /* A radial cutout: transparent center, dimmed surround. */
    background: radial-gradient(
      ellipse 34% 38% at 50% 46%,
      rgba(0, 0, 0, 0) 58%,
      rgba(0, 0, 0, var(--overlay-dim, 0.55)) 100%
    );
    animation: dim-in 0.8s ease-out 0.1s both;
  }
  @keyframes dim-in { from { opacity: 0; } to { opacity: 1; } }
</style>
</head>
<body>
  <div class="dim"></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.dimOpacity === 'number') {
        document.documentElement.style.setProperty(
          '--overlay-dim',
          String(Math.max(0, Math.min(0.9, controls.dimOpacity))),
        );
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const STEP_PIN_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .pin {
    position: relative;
    width: 110px; height: 110px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: var(--overlay-color, #2563eb);
    color: #fff;
    font: 800 52px/1 system-ui, -apple-system, sans-serif;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    animation: pin-drop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
  }
  .halo {
    position: absolute; inset: -10px; border-radius: 50%;
    border: 3px solid var(--overlay-color, #2563eb);
    animation: halo-ring 0.9s ease-out 0.5s 2 both;
  }
  @keyframes pin-drop { from { transform: translateY(-0.9em) scale(0.4); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes halo-ring { from { transform: scale(0.85); opacity: 0.9; } to { transform: scale(1.35); opacity: 0; } }
</style>
</head>
<body>
  <div class="wrap"><div class="pin"><span class="num"></span><span class="halo"></span></div></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      document.querySelector('.num').textContent =
        typeof controls.text === 'string' ? controls.text : '1';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const UNDERLINE_SWEEP_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .word {
    position: relative;
    font: 800 var(--overlay-font-size, 60px)/1.25 system-ui, -apple-system, sans-serif;
    color: #ffffff;
    text-shadow: 0 2px 14px rgba(0, 0, 0, 0.5);
    animation: word-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  .word svg {
    position: absolute; left: -4%; right: -4%; bottom: -0.34em;
    width: 108%; height: 0.42em; overflow: visible;
  }
  .stroke {
    fill: none;
    stroke: var(--overlay-color, #fb923c);
    stroke-width: 10; stroke-linecap: round;
    stroke-dasharray: 1000; stroke-dashoffset: 1000;
    animation: sweep 0.55s cubic-bezier(0.65, 0, 0.35, 1) 0.45s forwards;
  }
  @keyframes word-in { from { transform: translateY(0.35em); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes sweep { to { stroke-dashoffset: 0; } }
</style>
</head>
<body>
  <div class="wrap">
    <span class="word">
      <span class="txt"></span>
      <svg viewBox="0 0 300 40" preserveAspectRatio="none">
        <path class="stroke" pathLength="1000" d="M6 26 C 80 12, 210 10, 294 20" />
      </svg>
    </span>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      var root = document.documentElement;
      if (typeof controls.fontSize === 'number') {
        root.style.setProperty('--overlay-font-size', controls.fontSize + 'px');
      }
      if (typeof controls.color === 'string') {
        root.style.setProperty('--overlay-color', controls.color);
      }
      document.querySelector('.txt').textContent =
        typeof controls.text === 'string' ? controls.text : 'underline this';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

export const VIVID_OVERLAY_CALLOUT_DOCUMENTS: Record<string, string> = {
  'circle-marker': CIRCLE_MARKER_DOCUMENT,
  'arrow-label': ARROW_LABEL_DOCUMENT,
  'spotlight-dim': SPOTLIGHT_DIM_DOCUMENT,
  'step-pin': STEP_PIN_DOCUMENT,
  'underline-sweep': UNDERLINE_SWEEP_DOCUMENT,
};
