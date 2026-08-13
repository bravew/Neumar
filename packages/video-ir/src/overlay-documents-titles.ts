// Wave-1 title/text-motion vivid-overlay documents. Same authoring contract
// as overlay-documents.ts: CSS @keyframes / WAAPI only, self-contained,
// transparent background, reads window.__overlayParams, sets
// window.__overlayReady synchronously.

const KINETIC_WORDS_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .line {
    display: flex; flex-wrap: wrap; justify-content: center; gap: 0 0.3em;
    max-width: 86%;
    font: 800 var(--overlay-font-size, 72px)/1.2 system-ui, -apple-system, sans-serif;
    color: var(--overlay-color, #ffffff);
    text-shadow: 0 2px 18px rgba(0, 0, 0, 0.45);
  }
  .line span {
    display: inline-block;
    animation: word-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes word-rise {
    from { transform: translateY(0.9em) rotate(3deg); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
</style>
</head>
<body>
  <div class="wrap"><div class="line"></div></div>
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
      var text = typeof controls.text === 'string' ? controls.text : 'One word at a time';
      var line = document.querySelector('.line');
      var words = text.split(/\\s+/).filter(Boolean);
      for (var i = 0; i < words.length; i++) {
        var span = document.createElement('span');
        span.textContent = words[i];
        span.style.animationDelay = 0.1 + i * 0.18 + 's';
        line.appendChild(span);
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const TRACKING_EXPAND_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .title {
    font: 300 var(--overlay-font-size, 64px)/1.2 system-ui, -apple-system, sans-serif;
    color: var(--overlay-color, #ffffff);
    text-transform: uppercase;
    white-space: nowrap;
    animation: track-open 1.4s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both;
  }
  @keyframes track-open {
    from { letter-spacing: -0.06em; opacity: 0; filter: blur(10px); }
    40% { opacity: 1; }
    to { letter-spacing: 0.32em; opacity: 1; filter: blur(0); }
  }
</style>
</head>
<body>
  <div class="wrap"><div class="title"></div></div>
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
      document.querySelector('.title').textContent =
        typeof controls.text === 'string' ? controls.text : 'CINEMATIC';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const GLITCH_TITLE_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .stack { position: relative; }
  .layer {
    font: 900 var(--overlay-font-size, 84px)/1.1 system-ui, -apple-system, sans-serif;
    color: var(--overlay-color, #ffffff);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    animation: settle 0.7s steps(6, end) both;
  }
  .layer.r, .layer.b { position: absolute; inset: 0; mix-blend-mode: screen; }
  .layer.r { color: #ff2d55; animation: split-r 0.7s steps(6, end) both; }
  .layer.b { color: #22d3ee; animation: split-b 0.7s steps(6, end) both; }
  @keyframes settle {
    0% { opacity: 0; transform: translateX(0.1em) skewX(-8deg); }
    35% { opacity: 1; transform: translateX(-0.06em) skewX(5deg); }
    70% { transform: translateX(0.03em) skewX(-2deg); }
    100% { opacity: 1; transform: none; }
  }
  @keyframes split-r {
    0% { opacity: 0.9; transform: translate(0.18em, -0.06em); }
    60% { opacity: 0.7; transform: translate(-0.08em, 0.04em); }
    100% { opacity: 0; transform: none; }
  }
  @keyframes split-b {
    0% { opacity: 0.9; transform: translate(-0.18em, 0.07em); }
    60% { opacity: 0.7; transform: translate(0.08em, -0.04em); }
    100% { opacity: 0; transform: none; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="stack">
      <div class="layer main"></div>
      <div class="layer r" aria-hidden="true"></div>
      <div class="layer b" aria-hidden="true"></div>
    </div>
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
      var text = typeof controls.text === 'string' ? controls.text : 'GLITCH';
      var layers = document.querySelectorAll('.layer');
      for (var i = 0; i < layers.length; i++) layers[i].textContent = text;
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const NEON_GLOW_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .neon {
    font: 700 var(--overlay-font-size, 76px)/1.15 system-ui, -apple-system, sans-serif;
    color: #ffffff;
    animation: flicker-on 1.1s linear both, glow-breathe 1.6s ease-in-out 1.1s 2;
  }
  @keyframes flicker-on {
    0%, 8%, 14%, 24% { opacity: 0; text-shadow: none; }
    4%, 11%, 19% { opacity: 0.6; text-shadow: 0 0 8px var(--overlay-color, #22d3ee); }
    30%, 100% {
      opacity: 1;
      text-shadow:
        0 0 6px #ffffff,
        0 0 14px var(--overlay-color, #22d3ee),
        0 0 34px var(--overlay-color, #22d3ee),
        0 0 60px var(--overlay-color, #22d3ee);
    }
  }
  @keyframes glow-breathe {
    0%, 100% {
      text-shadow:
        0 0 6px #ffffff,
        0 0 14px var(--overlay-color, #22d3ee),
        0 0 34px var(--overlay-color, #22d3ee),
        0 0 60px var(--overlay-color, #22d3ee);
    }
    50% {
      text-shadow:
        0 0 4px #ffffff,
        0 0 10px var(--overlay-color, #22d3ee),
        0 0 22px var(--overlay-color, #22d3ee),
        0 0 38px var(--overlay-color, #22d3ee);
    }
  }
</style>
</head>
<body>
  <div class="wrap"><div class="neon"></div></div>
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
      document.querySelector('.neon').textContent =
        typeof controls.text === 'string' ? controls.text : 'Neon nights';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const TYPEWRITER_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .type {
    position: relative;
    font: 600 var(--overlay-font-size, 54px)/1.3 ui-monospace, 'SF Mono', Menlo, monospace;
    color: var(--overlay-color, #ffffff);
    white-space: nowrap;
    overflow: hidden;
    text-shadow: 0 2px 14px rgba(0, 0, 0, 0.5);
  }
  .caret {
    display: inline-block;
    width: 0.08em;
    height: 1em;
    margin-left: 0.06em;
    vertical-align: text-bottom;
    background: var(--overlay-color, #ffffff);
    animation: caret-blink 0.7s steps(1, end) 0.2s 4;
  }
  @keyframes type-reveal { from { max-width: 0; } to { max-width: 100%; } }
  @keyframes caret-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
</style>
</head>
<body>
  <div class="wrap"><div class="type"><span class="txt"></span><span class="caret"></span></div></div>
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
      var text = typeof controls.text === 'string' ? controls.text : 'Typing it out…';
      document.querySelector('.txt').textContent = text;
      // steps() needs a literal count, so the reveal animation is set inline.
      document.querySelector('.type').style.animation =
        'type-reveal 1.6s steps(' + Math.max(1, text.length) + ', end) 0.2s both';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const MASKED_REVEAL_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .mask { position: relative; overflow: hidden; padding: 0.1em 0.05em; }
  .title {
    font: 800 var(--overlay-font-size, 68px)/1.2 system-ui, -apple-system, sans-serif;
    color: #ffffff;
    text-shadow: 0 2px 16px rgba(0, 0, 0, 0.4);
    animation: title-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.35s both;
  }
  .wipe {
    position: absolute; inset: 0;
    background: var(--overlay-accent, #f59e0b);
    transform-origin: left center;
    animation: wipe-through 1.1s cubic-bezier(0.83, 0, 0.17, 1) both;
  }
  @keyframes title-up { from { transform: translateY(110%); } to { transform: none; } }
  @keyframes wipe-through {
    0% { transform: scaleX(0); transform-origin: left center; }
    45% { transform: scaleX(1); transform-origin: left center; }
    55% { transform: scaleX(1); transform-origin: right center; }
    100% { transform: scaleX(0); transform-origin: right center; }
  }
</style>
</head>
<body>
  <div class="wrap"><div class="mask"><div class="title"></div><div class="wipe"></div></div></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      var root = document.documentElement;
      if (typeof controls.fontSize === 'number') {
        root.style.setProperty('--overlay-font-size', controls.fontSize + 'px');
      }
      if (typeof controls.accentColor === 'string') {
        root.style.setProperty('--overlay-accent', controls.accentColor);
      }
      document.querySelector('.title').textContent =
        typeof controls.text === 'string' ? controls.text : 'The Reveal';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

export const VIVID_OVERLAY_TITLE_DOCUMENTS: Record<string, string> = {
  'kinetic-words': KINETIC_WORDS_DOCUMENT,
  'tracking-expand': TRACKING_EXPAND_DOCUMENT,
  'glitch-title': GLITCH_TITLE_DOCUMENT,
  'neon-glow': NEON_GLOW_DOCUMENT,
  typewriter: TYPEWRITER_DOCUMENT,
  'masked-reveal': MASKED_REVEAL_DOCUMENT,
};
