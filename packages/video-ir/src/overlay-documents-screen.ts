// Wave-3 full-frame screen-effect vivid-overlay documents (authoring contract
// per overlay-documents.ts). Ambience presets are authored as one seamless
// cycle: looping keyframes start and end on the same frame, and every
// sub-animation period divides the preset's defaultDurationMs so clip-level
// looping never visibly jumps.

const VIGNETTE_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .vignette {
    position: absolute; inset: -2%;
    background: radial-gradient(ellipse at center, transparent 52%, rgba(0, 0, 0, 0.92) 100%);
    animation: vignette-breathe 4s ease-in-out infinite;
  }
  @keyframes vignette-breathe {
    0%, 100% { opacity: calc(var(--overlay-dim, 0.45) * 0.72); }
    50% { opacity: var(--overlay-dim, 0.45); }
  }
</style>
</head>
<body>
  <div class="vignette"></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.dimOpacity === 'number') {
        document.documentElement.style.setProperty(
          '--overlay-dim',
          String(controls.dimOpacity),
        );
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const FILM_GRAIN_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .grain {
    position: absolute; left: -50%; top: -50%;
    width: 200%; height: 200%;
    opacity: var(--overlay-dim, 0.18);
  }
  .g1 { animation: grain-a 1s steps(1, end) infinite; }
  .g2 { opacity: calc(var(--overlay-dim, 0.18) * 0.6); animation: grain-b 0.5s steps(1, end) infinite; }
  @keyframes grain-a {
    0% { transform: translate(0, 0); }
    12.5% { transform: translate(-3%, -6%); }
    25% { transform: translate(4%, -2%); }
    37.5% { transform: translate(-6%, 3%); }
    50% { transform: translate(2%, 6%); }
    62.5% { transform: translate(-4%, -4%); }
    75% { transform: translate(6%, 2%); }
    87.5% { transform: translate(-2%, 5%); }
    100% { transform: translate(0, 0); }
  }
  @keyframes grain-b {
    0% { transform: translate(0, 0); }
    25% { transform: translate(5%, -3%); }
    50% { transform: translate(-3%, 5%); }
    75% { transform: translate(3%, 3%); }
    100% { transform: translate(0, 0); }
  }
</style>
</head>
<body>
  <svg class="grain g1" preserveAspectRatio="none" viewBox="0 0 300 300">
    <filter id="noise-fine">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch"></feTurbulence>
      <feColorMatrix type="saturate" values="0"></feColorMatrix>
    </filter>
    <rect width="300" height="300" filter="url(#noise-fine)"></rect>
  </svg>
  <svg class="grain g2" preserveAspectRatio="none" viewBox="0 0 300 300">
    <filter id="noise-coarse">
      <feTurbulence type="fractalNoise" baseFrequency="0.45" numOctaves="2" seed="13" stitchTiles="stitch"></feTurbulence>
      <feColorMatrix type="saturate" values="0"></feColorMatrix>
    </filter>
    <rect width="300" height="300" filter="url(#noise-coarse)"></rect>
  </svg>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.dimOpacity === 'number') {
        document.documentElement.style.setProperty(
          '--overlay-dim',
          String(controls.dimOpacity),
        );
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const VHS_SCANLINES_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .lines {
    position: absolute; inset: 0;
    background: repeating-linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0.55) 0px,
      rgba(0, 0, 0, 0.55) 2px,
      transparent 2px,
      transparent 5px
    );
    animation: lines-flicker 0.6s steps(1, end) infinite;
  }
  .band {
    position: absolute; left: 0; right: 0; top: -16%;
    height: 14%;
    background: linear-gradient(
      to bottom,
      transparent,
      rgba(255, 255, 255, 0.3) 42%,
      rgba(140, 140, 150, 0.2) 58%,
      transparent
    );
    opacity: calc(var(--overlay-dim, 0.35) * 1.5);
    animation: band-sweep 3s linear infinite;
  }
  .fringe { position: absolute; top: 0; bottom: 0; width: 2.4%; }
  .fringe.l {
    left: 0;
    background: linear-gradient(to right, rgba(255, 32, 96, 0.55), transparent);
    animation: fringe-shimmer 1.5s ease-in-out infinite;
  }
  .fringe.r {
    right: 0;
    background: linear-gradient(to left, rgba(34, 211, 238, 0.55), transparent);
    animation: fringe-shimmer 1.5s ease-in-out infinite;
  }
  @keyframes lines-flicker {
    0%, 100% { opacity: var(--overlay-dim, 0.35); }
    33% { opacity: calc(var(--overlay-dim, 0.35) * 0.82); }
    66% { opacity: calc(var(--overlay-dim, 0.35) * 0.92); }
  }
  @keyframes band-sweep {
    from { transform: translateY(0); }
    to { transform: translateY(840%); }
  }
  @keyframes fringe-shimmer {
    0%, 100% { opacity: calc(var(--overlay-dim, 0.35) * 0.9); }
    50% { opacity: calc(var(--overlay-dim, 0.35) * 1.4); }
  }
</style>
</head>
<body>
  <div class="lines"></div>
  <div class="fringe l"></div>
  <div class="fringe r"></div>
  <div class="band"></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.dimOpacity === 'number') {
        document.documentElement.style.setProperty(
          '--overlay-dim',
          String(controls.dimOpacity),
        );
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const LIGHT_LEAK_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .leak {
    position: absolute;
    left: -40%; top: 55%;
    width: 80%; aspect-ratio: 1;
    border-radius: 50%;
    background: radial-gradient(circle, var(--overlay-color, #fbbf24) 0%, transparent 65%);
    filter: blur(28px);
    animation: leak-sweep 3.5s linear both;
  }
  .leak.trail {
    left: -55%; top: 75%;
    width: 46%;
    filter: blur(36px);
    animation: leak-sweep-trail 3.5s linear both;
  }
  @keyframes leak-sweep {
    0% { transform: translate(0, 0) scale(0.8); opacity: 0; }
    18% { opacity: 0.8; }
    50% { transform: translate(95%, -85%) scale(1.15); opacity: 0.88; }
    82% { opacity: 0.55; }
    100% { transform: translate(190%, -170%) scale(1.3); opacity: 0; }
  }
  @keyframes leak-sweep-trail {
    0% { transform: translate(0, 0) scale(0.7); opacity: 0; }
    30% { opacity: 0.55; }
    60% { transform: translate(160%, -130%) scale(1.1); opacity: 0.6; }
    100% { transform: translate(320%, -260%) scale(1.25); opacity: 0; }
  }
</style>
</head>
<body>
  <div class="leak"></div>
  <div class="leak trail"></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const BOKEH_PARTICLES_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .dot {
    position: absolute;
    border-radius: 50%;
    background: radial-gradient(circle, var(--overlay-color, #93c5fd) 0%, transparent 70%);
    animation: bokeh-drift 6s ease-in-out infinite;
  }
  @keyframes bokeh-drift {
    0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.5; }
    33% { transform: translate(16px, -24px) scale(1.08); opacity: 0.78; }
    66% { transform: translate(-14px, 14px) scale(0.94); opacity: 0.42; }
  }
</style>
</head>
<body>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      // [leftPct, topPct, sizePx, blurPx, delaySeconds] — delays are negative
      // phase offsets so every particle shares the seamless 6s period.
      var dots = [
        [7, 68, 130, 9, 0],
        [18, 22, 90, 6, -1.1],
        [30, 78, 70, 5, -2.3],
        [42, 12, 150, 11, -3.4],
        [55, 58, 60, 4, -0.7],
        [64, 30, 110, 8, -4.2],
        [76, 72, 85, 6, -1.9],
        [86, 18, 65, 5, -5.1],
        [92, 52, 120, 9, -2.8],
      ];
      for (var i = 0; i < dots.length; i++) {
        var d = dots[i];
        var el = document.createElement('div');
        el.className = 'dot';
        el.style.left = d[0] + '%';
        el.style.top = d[1] + '%';
        el.style.width = d[2] + 'px';
        el.style.height = d[2] + 'px';
        el.style.filter = 'blur(' + d[3] + 'px)';
        el.style.animationDelay = d[4] + 's';
        document.body.appendChild(el);
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const SNOW_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .flake { position: absolute; top: 0; animation: snow-fall linear infinite; }
  .flake i {
    display: block;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.5);
    animation: snow-sway ease-in-out infinite;
  }
  @keyframes snow-fall {
    from { transform: translateY(-8vh); }
    to { transform: translateY(108vh); }
  }
  @keyframes snow-sway {
    0%, 100% { transform: translateX(-9px); }
    50% { transform: translateX(9px); }
  }
</style>
</head>
<body>
  <script>
    (function () {
      // [leftPct, sizePx, fallSeconds, fallDelay, swaySeconds, swayDelay] —
      // fall periods (5s / 2.5s) and sway periods (2.5s / 1.25s) both divide
      // the 5000ms cycle, so the loop wrap lands on the same frame.
      var flakes = [
        [4, 10, 5, -1.2, 2.5, -0.4],
        [13, 7, 2.5, -0.5, 1.25, -0.9],
        [22, 12, 5, -3.4, 2.5, -1.6],
        [31, 8, 2.5, -1.8, 1.25, -0.2],
        [40, 11, 5, -0.7, 2.5, -2.1],
        [50, 6, 2.5, -2.2, 1.25, -0.7],
        [59, 13, 5, -4.1, 2.5, -0.9],
        [68, 9, 2.5, -0.3, 1.25, -1.1],
        [77, 10, 5, -2.6, 2.5, -1.3],
        [86, 7, 2.5, -1.4, 1.25, -0.5],
        [94, 12, 5, -3.9, 2.5, -0.1],
      ];
      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i];
        var flake = document.createElement('div');
        flake.className = 'flake';
        flake.style.left = f[0] + '%';
        flake.style.animationDuration = f[2] + 's';
        flake.style.animationDelay = f[3] + 's';
        var dot = document.createElement('i');
        dot.style.width = f[1] + 'px';
        dot.style.height = f[1] + 'px';
        dot.style.animationDuration = f[4] + 's';
        dot.style.animationDelay = f[5] + 's';
        flake.appendChild(dot);
        document.body.appendChild(flake);
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const RAIN_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .sky {
    position: absolute; inset: -12%;
    transform: rotate(8deg);
    opacity: var(--overlay-dim, 0.4);
  }
  .streak {
    position: absolute; top: 0;
    width: 2px;
    background: linear-gradient(to bottom, transparent, rgba(255, 255, 255, 0.9));
    border-radius: 999px;
    animation: rain-fall linear infinite;
  }
  @keyframes rain-fall {
    from { transform: translateY(-18vh); }
    to { transform: translateY(118vh); }
  }
</style>
</head>
<body>
  <div class="sky"></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.dimOpacity === 'number') {
        document.documentElement.style.setProperty(
          '--overlay-dim',
          String(controls.dimOpacity),
        );
      }
      // [leftPct, heightVh, fallSeconds, delaySeconds] — fall periods (0.8s /
      // 0.4s) divide the 1600ms cycle for a seamless loop.
      var streaks = [
        [3, 13, 0.8, -0.12],
        [11, 9, 0.4, -0.31],
        [19, 14, 0.8, -0.55],
        [26, 8, 0.4, -0.07],
        [34, 12, 0.8, -0.72],
        [42, 10, 0.4, -0.22],
        [50, 15, 0.8, -0.4],
        [58, 9, 0.4, -0.35],
        [66, 13, 0.8, -0.18],
        [74, 8, 0.4, -0.14],
        [82, 14, 0.8, -0.62],
        [90, 10, 0.4, -0.27],
        [97, 12, 0.8, -0.48],
      ];
      var sky = document.querySelector('.sky');
      for (var i = 0; i < streaks.length; i++) {
        var s = streaks[i];
        var el = document.createElement('div');
        el.className = 'streak';
        el.style.left = s[0] + '%';
        el.style.height = s[1] + 'vh';
        el.style.animationDuration = s[2] + 's';
        el.style.animationDelay = s[3] + 's';
        sky.appendChild(el);
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const LETTERBOX_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .bar {
    position: absolute; left: 0; right: 0;
    height: var(--overlay-bar, 12%);
    background: #000;
  }
  .bar.top { top: 0; animation: bar-top 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both; }
  .bar.bottom { bottom: 0; animation: bar-bottom 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both; }
  @keyframes bar-top { from { transform: translateY(-100%); } to { transform: none; } }
  @keyframes bar-bottom { from { transform: translateY(100%); } to { transform: none; } }
</style>
</head>
<body>
  <div class="bar top"></div>
  <div class="bar bottom"></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      var height = typeof controls.count === 'number' ? controls.count : 12;
      height = Math.max(5, Math.min(20, height));
      document.documentElement.style.setProperty('--overlay-bar', height + '%');
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const RGB_SPLIT_PULSE_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .f { position: absolute; opacity: 0; }
  .f.l {
    left: 0; top: 0; bottom: 0; width: 6%;
    background: linear-gradient(to right, rgba(255, 32, 96, 0.85), transparent);
    transform-origin: left center;
    animation: fringe-pulse-x 0.9s ease-out both;
  }
  .f.r {
    right: 0; top: 0; bottom: 0; width: 6%;
    background: linear-gradient(to left, rgba(34, 211, 238, 0.85), transparent);
    transform-origin: right center;
    animation: fringe-pulse-x 0.9s ease-out both;
  }
  .f.t {
    top: 0; left: 0; right: 0; height: 5%;
    background: linear-gradient(to bottom, rgba(255, 32, 96, 0.6), transparent);
    transform-origin: center top;
    animation: fringe-pulse-y 0.9s ease-out both;
  }
  .f.b {
    bottom: 0; left: 0; right: 0; height: 5%;
    background: linear-gradient(to top, rgba(34, 211, 238, 0.6), transparent);
    transform-origin: center bottom;
    animation: fringe-pulse-y 0.9s ease-out both;
  }
  @keyframes fringe-pulse-x {
    0% { opacity: 0; transform: scaleX(0.4); }
    35% { opacity: var(--overlay-dim, 0.3); transform: scaleX(1); }
    100% { opacity: 0; transform: scaleX(0.6); }
  }
  @keyframes fringe-pulse-y {
    0% { opacity: 0; transform: scaleY(0.4); }
    35% { opacity: calc(var(--overlay-dim, 0.3) * 0.8); transform: scaleY(1); }
    100% { opacity: 0; transform: scaleY(0.6); }
  }
</style>
</head>
<body>
  <div class="f l"></div>
  <div class="f r"></div>
  <div class="f t"></div>
  <div class="f b"></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.dimOpacity === 'number') {
        document.documentElement.style.setProperty(
          '--overlay-dim',
          String(controls.dimOpacity),
        );
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

export const VIVID_OVERLAY_SCREEN_DOCUMENTS: Record<string, string> = {
  vignette: VIGNETTE_DOCUMENT,
  'film-grain': FILM_GRAIN_DOCUMENT,
  'vhs-scanlines': VHS_SCANLINES_DOCUMENT,
  'light-leak': LIGHT_LEAK_DOCUMENT,
  'bokeh-particles': BOKEH_PARTICLES_DOCUMENT,
  snow: SNOW_DOCUMENT,
  rain: RAIN_DOCUMENT,
  letterbox: LETTERBOX_DOCUMENT,
  'rgb-split-pulse': RGB_SPLIT_PULSE_DOCUMENT,
};
