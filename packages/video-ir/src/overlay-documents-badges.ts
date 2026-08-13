// Wave-1 badge vivid-overlay documents (authoring contract per
// overlay-documents.ts).

const LIVE_PILL_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .pill {
    position: absolute; top: 7%; left: 6%;
    display: flex; align-items: center; gap: 10px;
    padding: 10px 22px;
    border-radius: 999px;
    background: var(--overlay-color, #dc2626);
    color: #fff;
    font: 800 24px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.12em;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
    animation: pill-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
  }
  .dot {
    width: 12px; height: 12px; border-radius: 50%;
    background: #fff;
    animation: dot-blink 0.9s steps(1, end) 0.55s 3;
  }
  @keyframes pill-in { from { transform: translateY(-24px) scale(0.7); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes dot-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
</style>
</head>
<body>
  <div class="pill"><span class="dot"></span><span class="txt"></span></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      document.querySelector('.txt').textContent =
        typeof controls.text === 'string' ? controls.text : 'LIVE';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const RIBBON_CORNER_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .anchor { position: absolute; top: 0; width: 240px; height: 240px; overflow: hidden; }
  .anchor.tl { left: 0; }
  .anchor.tr { right: 0; }
  .ribbon {
    position: absolute; top: 58px; width: 340px;
    padding: 12px 0;
    text-align: center;
    background: var(--overlay-color, #16a34a);
    color: #fff;
    font: 800 24px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.1em; text-transform: uppercase;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
  }
  .anchor.tl .ribbon { left: -100px; transform: rotate(-45deg); animation: ribbon-tl 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both; }
  .anchor.tr .ribbon { right: -100px; transform: rotate(45deg); animation: ribbon-tr 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both; }
  @keyframes ribbon-tl { from { transform: rotate(-45deg) translateY(-140px); } to { transform: rotate(-45deg) translateY(0); } }
  @keyframes ribbon-tr { from { transform: rotate(45deg) translateY(-140px); } to { transform: rotate(45deg) translateY(0); } }
</style>
</head>
<body>
  <div class="anchor tl"><div class="ribbon"></div></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      document.querySelector('.ribbon').textContent =
        typeof controls.text === 'string' ? controls.text : 'NEW';
      var corner = controls.corner === 'top-right' ? 'tr' : 'tl';
      document.querySelector('.anchor').className = 'anchor ' + corner;
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const RATING_STARS_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 14px; }
  .star { width: 72px; height: 72px; }
  .star svg { width: 100%; height: 100%; overflow: visible; }
  .star .outline { fill: rgba(255, 255, 255, 0.25); }
  .star .fill {
    fill: var(--overlay-color, #facc15);
    transform-origin: center;
    animation: star-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  .star.empty .fill { animation: none; opacity: 0; }
  @keyframes star-pop { from { transform: scale(0) rotate(-72deg); } to { transform: scale(1) rotate(0deg); } }
</style>
</head>
<body>
  <div class="wrap"></div>
  <script>
    (function () {
      var STAR =
        '<svg viewBox="0 0 24 24">' +
        '<path class="outline" d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/>' +
        '<path class="fill" d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/>' +
        '</svg>';
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      var count = typeof controls.count === 'number' ? Math.round(controls.count) : 5;
      count = Math.max(0, Math.min(5, count));
      var wrap = document.querySelector('.wrap');
      for (var i = 0; i < 5; i++) {
        var star = document.createElement('div');
        star.className = i < count ? 'star' : 'star empty';
        star.innerHTML = STAR;
        var fill = star.querySelector('.fill');
        fill.style.animationDelay = 0.15 + i * 0.16 + 's';
        wrap.appendChild(star);
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const VERIFIED_POP_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .badge { position: relative; width: 140px; height: 140px; }
  .seal {
    position: absolute; inset: 0;
    animation: seal-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
  }
  .seal svg { width: 100%; height: 100%; }
  .seal .disc { fill: var(--overlay-color, #3b82f6); }
  .check {
    fill: none; stroke: #fff; stroke-width: 2.6;
    stroke-linecap: round; stroke-linejoin: round;
    stroke-dasharray: 100; stroke-dashoffset: 100;
    animation: check-draw 0.35s cubic-bezier(0.65, 0, 0.35, 1) 0.5s forwards;
  }
  .ring {
    position: absolute; inset: -8px; border-radius: 50%;
    border: 4px solid var(--overlay-color, #3b82f6);
    animation: ring-out 0.8s ease-out 0.55s both;
  }
  @keyframes seal-pop { from { transform: scale(0) rotate(-30deg); } to { transform: none; } }
  @keyframes check-draw { to { stroke-dashoffset: 0; } }
  @keyframes ring-out { from { transform: scale(0.9); opacity: 0.8; } to { transform: scale(1.4); opacity: 0; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="badge">
      <span class="ring"></span>
      <span class="seal">
        <svg viewBox="0 0 24 24">
          <path class="disc" d="M12 1l2.4 2 3.1-.4 1.2 2.9 2.9 1.2-.4 3.1 2 2.4-2 2.4.4 3.1-2.9 1.2-1.2 2.9-3.1-.4-2.4 2-2.4-2-3.1.4-1.2-2.9L2.4 17l.4-3.1-2-2.4 2-2.4-.4-3.1 2.9-1.2L6.5 2.6l3.1.4z"/>
          <path class="check" pathLength="100" d="M7.5 12.2l3 3 6-6.4"/>
        </svg>
      </span>
    </div>
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

export const VIVID_OVERLAY_BADGE_DOCUMENTS: Record<string, string> = {
  'live-pill': LIVE_PILL_DOCUMENT,
  'ribbon-corner': RIBBON_CORNER_DOCUMENT,
  'rating-stars': RATING_STARS_DOCUMENT,
  'verified-pop': VERIFIED_POP_DOCUMENT,
};
