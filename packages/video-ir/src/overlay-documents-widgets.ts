// Wave-2 progress/widget vivid-overlay documents (authoring contract per
// overlay-documents.ts). Variable-distance animations (digit rolls, ring
// percentages) use WAAPI .animate() with values computed synchronously from
// controls — deterministic and seekable, never timer-driven.

const PROGRESS_TOP_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .bar {
    position: absolute; top: 0; left: 0; right: 0;
    height: 10px;
    background: rgba(255, 255, 255, 0.18);
  }
  .fill {
    position: absolute; inset: 0;
    background: var(--overlay-color, #ef4444);
    transform-origin: left center;
  }
  @keyframes bar-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
</style>
</head>
<body>
  <div class="bar"><div class="fill"></div></div>
  <script>
    (function () {
      var params = window.__overlayParams || {};
      var controls = params.controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      var durationMs =
        typeof params.durationMs === 'number' && params.durationMs > 0
          ? params.durationMs
          : 10000;
      // The fill spans the whole clip, so the duration is bound inline.
      document.querySelector('.fill').style.animation =
        'bar-fill ' + durationMs / 1000 + 's linear both';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const PROGRESS_CHAPTERS_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .rail { position: absolute; left: 6%; right: 6%; bottom: 8%; display: flex; gap: 10px; }
  .seg {
    flex: 1;
    height: 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.25);
    overflow: hidden;
    animation: seg-in 0.4s ease-out both;
  }
  .seg .fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--overlay-color, #22d3ee);
    transform-origin: left center;
    transform: scaleX(0);
  }
  .seg.done .fill { transform: scaleX(1); }
  .seg.active .fill { animation: seg-fill 1.4s cubic-bezier(0.22, 1, 0.36, 1) 0.5s both; }
  @keyframes seg-in { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes seg-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
</style>
</head>
<body>
  <div class="rail"></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      var active = typeof controls.count === 'number' ? Math.round(controls.count) : 2;
      active = Math.max(1, Math.min(5, active));
      var rail = document.querySelector('.rail');
      for (var i = 0; i < 5; i++) {
        var seg = document.createElement('div');
        seg.className =
          'seg' + (i < active - 1 ? ' done' : i === active - 1 ? ' active' : '');
        seg.style.animationDelay = 0.1 + i * 0.08 + 's';
        var fill = document.createElement('span');
        fill.className = 'fill';
        seg.appendChild(fill);
        rail.appendChild(seg);
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const COUNTDOWN_RING_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .ring-box { position: relative; width: 260px; height: 260px; }
  .ring-box svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .track { fill: none; stroke: rgba(255, 255, 255, 0.2); stroke-width: 7; }
  .drain {
    fill: none;
    stroke: var(--overlay-color, #8b5cf6);
    stroke-width: 7;
    stroke-linecap: round;
    stroke-dasharray: 100;
    animation: ring-drain 5s linear both;
  }
  .nums { position: absolute; inset: 0; }
  .num {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    font: 900 110px/1 system-ui, -apple-system, sans-serif;
    color: #fff;
    text-shadow: 0 2px 16px rgba(0, 0, 0, 0.45);
    opacity: 0;
  }
  .n1 { animation: win1 5s linear both; }
  .n2 { animation: win2 5s linear both; }
  .n3 { animation: win3 5s linear both; }
  .n4 { animation: win4 5s linear both; }
  .n5 { animation: win5 5s linear both; }
  @keyframes ring-drain { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 100; } }
  @keyframes win1 { 0%, 19.99% { opacity: 1; } 20%, 100% { opacity: 0; } }
  @keyframes win2 { 0%, 19.99% { opacity: 0; } 20%, 39.99% { opacity: 1; } 40%, 100% { opacity: 0; } }
  @keyframes win3 { 0%, 39.99% { opacity: 0; } 40%, 59.99% { opacity: 1; } 60%, 100% { opacity: 0; } }
  @keyframes win4 { 0%, 59.99% { opacity: 0; } 60%, 79.99% { opacity: 1; } 80%, 100% { opacity: 0; } }
  @keyframes win5 { 0%, 79.99% { opacity: 0; } 80%, 100% { opacity: 1; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="ring-box">
      <svg viewBox="0 0 100 100">
        <circle class="track" cx="50" cy="50" r="45" pathLength="100"></circle>
        <circle class="drain" cx="50" cy="50" r="45" pathLength="100"></circle>
      </svg>
      <div class="nums">
        <span class="num n1">5</span>
        <span class="num n2">4</span>
        <span class="num n3">3</span>
        <span class="num n4">2</span>
        <span class="num n5">1</span>
      </div>
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

const PART_INDICATOR_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .chip {
    position: absolute; top: 7%; left: 6%;
    padding: 12px 24px;
    border-radius: 12px;
    background: var(--overlay-color, #0ea5e9);
    color: #fff;
    font: 800 26px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    animation: chip-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
  }
  @keyframes chip-pop { from { transform: translateY(-18px) scale(0.7); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
</head>
<body>
  <div class="chip"></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      document.querySelector('.chip').textContent =
        typeof controls.text === 'string' ? controls.text : 'PART 2/5';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const COUNTER_TICKER_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
  .counter {
    display: flex;
    font: 900 120px/1 ui-monospace, 'SF Mono', Menlo, monospace;
    color: var(--overlay-color, #34d399);
    text-shadow: 0 4px 22px rgba(0, 0, 0, 0.35);
    animation: counter-in 0.4s ease-out 0.1s both;
  }
  .col { height: 1em; overflow: hidden; }
  .digit { display: block; height: 1em; }
  .suffix {
    font: 600 34px/1 system-ui, -apple-system, sans-serif;
    color: #fff;
    animation: suffix-in 0.5s ease-out 1.4s both;
  }
  @keyframes counter-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes suffix-in { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="counter"></div>
    <div class="suffix"></div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      var value =
        typeof controls.text === 'string' && controls.text ? controls.text : '100';
      document.querySelector('.suffix').textContent =
        typeof controls.title === 'string' ? controls.title : 'subscribers';
      var counter = document.querySelector('.counter');
      var chars = value.split('');
      for (var i = 0; i < chars.length; i++) {
        var ch = chars[i];
        var col = document.createElement('span');
        col.className = 'col';
        if (ch >= '0' && ch <= '9') {
          var target = ch.charCodeAt(0) - 48;
          // Roll through a full 0-9 cycle, then land on the target digit.
          var steps = 10 + target;
          for (var d = 0; d <= steps; d++) {
            var digit = document.createElement('span');
            digit.className = 'digit';
            digit.textContent = String(d % 10);
            col.appendChild(digit);
          }
          col.animate(
            [
              { transform: 'translateY(0)' },
              { transform: 'translateY(-' + steps + 'em)' },
            ],
            {
              duration: 1200,
              delay: 150 + i * 120,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
              fill: 'both',
            },
          );
        } else {
          var literal = document.createElement('span');
          literal.className = 'digit';
          literal.textContent = ch;
          col.appendChild(literal);
        }
        counter.appendChild(col);
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const VS_CARD_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .card {
    position: relative;
    display: flex; align-items: stretch;
    width: min(760px, 86%);
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.4);
    font-family: system-ui, -apple-system, sans-serif;
  }
  .side {
    flex: 1;
    padding: 44px 26px;
    display: flex; align-items: center; justify-content: center;
    font-size: 40px; font-weight: 800;
    color: #fff;
    text-align: center;
  }
  .side.left {
    background: rgba(23, 26, 36, 0.95);
    animation: slam-left 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  .side.right {
    background: rgba(52, 30, 46, 0.95);
    animation: slam-right 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  .vs {
    position: absolute; left: 50%; top: 50%;
    width: 92px; height: 92px;
    margin: -46px 0 0 -46px;
    border-radius: 50%;
    background: var(--overlay-color, #f59e0b);
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    font: 900 36px/1 system-ui, -apple-system, sans-serif;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    animation: vs-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.55s both;
  }
  @keyframes slam-left { from { transform: translateX(-120%); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes slam-right { from { transform: translateX(120%); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes vs-pop { from { transform: scale(0) rotate(-20deg); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="side left"></div>
      <div class="side right"></div>
      <div class="vs">VS</div>
    </div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      document.querySelector('.left').textContent =
        typeof controls.title === 'string' ? controls.title : 'Option A';
      document.querySelector('.right').textContent =
        typeof controls.subtitle === 'string' ? controls.subtitle : 'Option B';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const PERCENTAGE_RING_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .box { position: relative; width: 280px; height: 280px; }
  .box svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .track { fill: none; stroke: rgba(255, 255, 255, 0.18); stroke-width: 8; }
  .arc {
    fill: none;
    stroke: var(--overlay-color, #22d3ee);
    stroke-width: 8;
    stroke-linecap: round;
    stroke-dasharray: 100;
    stroke-dashoffset: 100;
  }
  .center {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  }
  .pct {
    font: 900 64px/1 system-ui, -apple-system, sans-serif;
    color: #fff;
    animation: fade-up 0.5s ease-out 0.7s both;
  }
  .label {
    font: 600 26px/1 system-ui, -apple-system, sans-serif;
    color: rgba(255, 255, 255, 0.75);
    animation: fade-up 0.5s ease-out 0.85s both;
  }
  @keyframes fade-up { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="box">
      <svg viewBox="0 0 100 100">
        <circle class="track" cx="50" cy="50" r="45" pathLength="100"></circle>
        <circle class="arc" cx="50" cy="50" r="45" pathLength="100"></circle>
      </svg>
      <div class="center">
        <div class="pct"></div>
        <div class="label"></div>
      </div>
    </div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      var pct = typeof controls.count === 'number' ? Math.round(controls.count) : 87;
      pct = Math.max(0, Math.min(100, pct));
      document.querySelector('.pct').textContent = pct + '%';
      document.querySelector('.label').textContent =
        typeof controls.text === 'string' ? controls.text : 'faster';
      // The arc end value depends on the control, so it is a WAAPI animation.
      document.querySelector('.arc').animate(
        [{ strokeDashoffset: 100 }, { strokeDashoffset: 100 - pct }],
        {
          duration: 1300,
          delay: 200,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'both',
        },
      );
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

export const VIVID_OVERLAY_WIDGET_DOCUMENTS: Record<string, string> = {
  'progress-top': PROGRESS_TOP_DOCUMENT,
  'progress-chapters': PROGRESS_CHAPTERS_DOCUMENT,
  'countdown-ring': COUNTDOWN_RING_DOCUMENT,
  'part-indicator': PART_INDICATOR_DOCUMENT,
  'counter-ticker': COUNTER_TICKER_DOCUMENT,
  'vs-card': VS_CARD_DOCUMENT,
  'percentage-ring': PERCENTAGE_RING_DOCUMENT,
};
