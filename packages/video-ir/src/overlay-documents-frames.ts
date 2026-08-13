// Wave-3 frame + widget vivid-overlay documents (authoring contract per
// overlay-documents.ts). Control-dependent geometry (frame inset, typed text
// width) is computed synchronously from window.__overlayParams and driven by
// CSS @keyframes or WAAPI .animate() — deterministic and seekable.

const ROUNDED_FRAME_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .edge {
    fill: none;
    stroke: var(--overlay-color, #ffffff);
    stroke-dasharray: 100;
    stroke-dashoffset: 100;
    animation: frame-draw 1.2s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both;
  }
  @keyframes frame-draw { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
</style>
</head>
<body>
  <svg><rect class="edge" pathLength="100"></rect></svg>
  <script>
    (function () {
      var params = window.__overlayParams || {};
      var controls = params.controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      var w = typeof params.widthPx === 'number' && params.widthPx > 0 ? params.widthPx : 1920;
      var h = typeof params.heightPx === 'number' && params.heightPx > 0 ? params.heightPx : 1080;
      var strokeWidth = typeof controls.strokeWidth === 'number' ? controls.strokeWidth : 5;
      strokeWidth = Math.max(2, Math.min(14, strokeWidth));
      var radius = typeof controls.count === 'number' ? controls.count : 24;
      radius = Math.max(0, Math.min(48, radius));
      // Pixel-space viewBox so the stroke and corner radius stay round on any
      // canvas aspect ratio.
      var inset = Math.round(Math.min(w, h) * 0.045);
      document.querySelector('svg').setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      var rect = document.querySelector('.edge');
      rect.setAttribute('x', String(inset));
      rect.setAttribute('y', String(inset));
      rect.setAttribute('width', String(w - inset * 2));
      rect.setAttribute('height', String(h - inset * 2));
      rect.setAttribute('rx', String(radius));
      rect.setAttribute('stroke-width', String(strokeWidth));
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const POLAROID_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .polaroid {
    position: relative;
    width: min(46%, 440px);
    aspect-ratio: 3.4 / 4;
    box-sizing: border-box;
    border-style: solid;
    border-color: #fdfdfa;
    border-width: 18px 18px 84px 18px;
    border-radius: 4px;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
    animation: polaroid-drop 0.85s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
  }
  .caption {
    position: absolute; left: -14px; right: -14px; bottom: -76px;
    text-align: center;
    font: 500 32px/1.2 'Snell Roundhand', 'Segoe Script', cursive;
    color: #44403c;
    animation: caption-in 0.5s ease-out 0.75s both;
  }
  @keyframes polaroid-drop {
    from { transform: translateY(-46vh) rotate(-10deg); opacity: 0; }
    to { transform: rotate(-3deg); opacity: 1; }
  }
  @keyframes caption-in {
    from { transform: translateY(10px); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="polaroid"><div class="caption"></div></div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      document.querySelector('.caption').textContent =
        typeof controls.text === 'string' ? controls.text : 'Summer 2026';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const PHONE_MOCKUP_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .phone {
    position: relative;
    height: 86%;
    aspect-ratio: 9 / 19;
    box-sizing: border-box;
    border: 12px solid var(--overlay-color, #111827);
    border-radius: 48px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
    animation: phone-in 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s both;
  }
  .notch {
    position: absolute; top: 8px; left: 50%;
    width: 38%; height: 20px;
    margin-left: -19%;
    border-radius: 999px;
    background: var(--overlay-color, #111827);
  }
  @keyframes phone-in {
    from { transform: scale(0.78); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="phone"><div class="notch"></div></div>
  </div>
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

const TAPE_CORNERS_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .tape { position: absolute; width: 170px; height: 44px; }
  .tape i {
    display: block; width: 100%; height: 100%;
    background: var(--overlay-color, #e5e7eb);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
    opacity: 0;
    animation: tape-slap 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  .tape.tl { left: -48px; top: 26px; transform: rotate(-45deg); }
  .tape.tr { right: -48px; top: 26px; transform: rotate(45deg); }
  .tape.br { right: -48px; bottom: 26px; transform: rotate(-45deg); }
  .tape.bl { left: -48px; bottom: 26px; transform: rotate(45deg); }
  .tape.tl i { animation-delay: 0.15s; }
  .tape.tr i { animation-delay: 0.4s; }
  .tape.br i { animation-delay: 0.65s; }
  .tape.bl i { animation-delay: 0.9s; }
  @keyframes tape-slap {
    from { transform: scale(1.5); opacity: 0; }
    to { transform: none; opacity: 0.62; }
  }
</style>
</head>
<body>
  <div class="tape tl"><i></i></div>
  <div class="tape tr"><i></i></div>
  <div class="tape br"><i></i></div>
  <div class="tape bl"><i></i></div>
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

const NEON_BORDER_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .neon {
    position: absolute; inset: 3.2%;
    border: 3px solid var(--overlay-color, #22d3ee);
    border-radius: 22px;
    animation: neon-pulse 2.4s ease-in-out infinite;
  }
  @keyframes neon-pulse {
    0%, 100% {
      box-shadow:
        0 0 10px var(--overlay-color, #22d3ee),
        inset 0 0 8px var(--overlay-color, #22d3ee);
      opacity: 0.8;
    }
    50% {
      box-shadow:
        0 0 26px var(--overlay-color, #22d3ee),
        0 0 60px var(--overlay-color, #22d3ee),
        inset 0 0 18px var(--overlay-color, #22d3ee);
      opacity: 1;
    }
  }
</style>
</head>
<body>
  <div class="neon"></div>
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

const LOCATION_PIN_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap {
    position: absolute; top: 9%; left: 6%;
    display: flex; align-items: center; gap: 12px;
  }
  .pin {
    width: 60px; height: 60px;
    filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.35));
    animation: pin-drop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
  }
  .pin svg { width: 100%; height: 100%; fill: var(--overlay-color, #ef4444); }
  .chip {
    background: rgba(14, 16, 22, 0.85);
    color: #fff;
    font: 600 26px/1 system-ui, -apple-system, sans-serif;
    padding: 13px 22px;
    border-radius: 999px;
    transform-origin: left center;
    animation: chip-expand 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.65s both;
  }
  @keyframes pin-drop {
    0% { transform: translateY(-90px) scale(0.7); opacity: 0; }
    60% { transform: translateY(6px) scale(1.04); opacity: 1; }
    80% { transform: translateY(-4px) scale(1); }
    100% { transform: none; opacity: 1; }
  }
  @keyframes chip-expand {
    from { transform: scaleX(0); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="pin">
      <svg viewBox="0 0 24 24">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"></path>
      </svg>
    </div>
    <div class="chip"></div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      document.querySelector('.chip').textContent =
        typeof controls.text === 'string' ? controls.text : 'Lisbon, Portugal';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const TIMESTAMP_CHIP_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .chip {
    position: absolute; top: 7%; right: 6%;
    display: flex; align-items: center;
    background: rgba(10, 12, 16, 0.78);
    border-radius: 10px;
    padding: 12px 16px;
    font: 600 24px/1 ui-monospace, 'SF Mono', Menlo, monospace;
    color: #e7e5e4;
    letter-spacing: 0.06em;
    animation: chip-in 0.35s ease-out both;
  }
  .txt { display: inline-block; overflow: hidden; white-space: nowrap; }
  .caret {
    display: inline-block;
    width: 0.55em; height: 1em;
    margin-left: 0.12em;
    background: #e7e5e4;
    animation: caret-blink 0.5s steps(1, end) 0.35s 4;
  }
  @keyframes chip-in { from { transform: translateY(-14px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes caret-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
</style>
</head>
<body>
  <div class="chip"><span class="txt"></span><span class="caret"></span></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      var text =
        typeof controls.text === 'string' ? controls.text : 'JUL 07 2026 · 14:32';
      var txt = document.querySelector('.txt');
      txt.textContent = text;
      // The typed width depends on the text control, so the per-character
      // steps() reveal is a WAAPI animation with a computed step count.
      var chars = Math.max(1, text.length);
      txt.animate(
        [{ maxWidth: '0ch' }, { maxWidth: chars + 'ch' }],
        {
          duration: 1300,
          delay: 350,
          easing: 'steps(' + chars + ', end)',
          fill: 'both',
        },
      );
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const NOW_PLAYING_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .card {
    position: absolute; left: 5%; bottom: 8%;
    display: flex; align-items: center; gap: 20px;
    background: rgba(12, 14, 20, 0.88);
    border-radius: 16px;
    padding: 18px 28px 18px 20px;
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.4);
    font-family: system-ui, -apple-system, sans-serif;
    animation: card-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  .eq { display: flex; align-items: flex-end; gap: 5px; width: 46px; height: 40px; }
  .eq span {
    flex: 1; height: 100%;
    border-radius: 3px 3px 0 0;
    background: var(--overlay-accent, #22c55e);
    transform-origin: center bottom;
  }
  /* Bar periods (0.9 / 0.72 / 0.6 / 0.45s) all divide the 3600ms cycle, so
     the EQ loops seamlessly with a deterministic stagger. */
  .eq .q1 { animation: eq-bounce 0.9s ease-in-out infinite; }
  .eq .q2 { animation: eq-bounce 0.72s ease-in-out infinite; }
  .eq .q3 { animation: eq-bounce 0.6s ease-in-out infinite; }
  .eq .q4 { animation: eq-bounce 0.45s ease-in-out infinite; }
  .title {
    font-size: 26px; font-weight: 700; color: #fff; line-height: 1.25;
    animation: line-up 0.45s ease-out 0.35s both;
  }
  .artist {
    font-size: 20px; font-weight: 500; line-height: 1.3;
    color: rgba(255, 255, 255, 0.65);
    animation: line-up 0.45s ease-out 0.45s both;
  }
  @keyframes card-in { from { transform: translateX(-40px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes eq-bounce { 0%, 100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }
  @keyframes line-up { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
</head>
<body>
  <div class="card">
    <div class="eq">
      <span class="q1"></span><span class="q2"></span><span class="q3"></span><span class="q4"></span>
    </div>
    <div class="meta">
      <div class="title"></div>
      <div class="artist"></div>
    </div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.accentColor === 'string') {
        document.documentElement.style.setProperty(
          '--overlay-accent',
          controls.accentColor,
        );
      }
      document.querySelector('.title').textContent =
        typeof controls.title === 'string' ? controls.title : 'Song title';
      document.querySelector('.artist').textContent =
        typeof controls.subtitle === 'string' ? controls.subtitle : 'Artist';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const HASHTAG_CHIP_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap {
    position: absolute; left: 0; right: 0; bottom: 10%;
    display: flex; justify-content: center;
  }
  .chip {
    background: var(--overlay-color, #0ea5e9);
    color: #fff;
    font: 800 30px/1 system-ui, -apple-system, sans-serif;
    padding: 16px 30px;
    border-radius: 999px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
    animation: hash-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
  }
  @keyframes hash-pop {
    0% { transform: scale(0) rotate(-8deg); opacity: 0; }
    55% { transform: scale(1.12) rotate(3deg); opacity: 1; }
    75% { transform: scale(0.96) rotate(-2deg); }
    100% { transform: none; opacity: 1; }
  }
</style>
</head>
<body>
  <div class="wrap"><div class="chip"></div></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      document.querySelector('.chip').textContent =
        typeof controls.text === 'string' ? controls.text : '#trending';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

export const VIVID_OVERLAY_FRAME_DOCUMENTS: Record<string, string> = {
  'rounded-frame': ROUNDED_FRAME_DOCUMENT,
  polaroid: POLAROID_DOCUMENT,
  'phone-mockup': PHONE_MOCKUP_DOCUMENT,
  'tape-corners': TAPE_CORNERS_DOCUMENT,
  'neon-border': NEON_BORDER_DOCUMENT,
  'location-pin': LOCATION_PIN_DOCUMENT,
  'timestamp-chip': TIMESTAMP_CHIP_DOCUMENT,
  'now-playing': NOW_PLAYING_DOCUMENT,
  'hashtag-chip': HASHTAG_CHIP_DOCUMENT,
};
