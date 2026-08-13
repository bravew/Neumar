// Wave-2 social/reaction vivid-overlay documents (authoring contract per
// overlay-documents.ts): CSS @keyframes / WAAPI only, self-contained,
// transparent background, reads window.__overlayParams, sets
// window.__overlayReady synchronously. All stagger/position values are
// hardcoded arrays — no randomness, no timers.

const SUBSCRIBE_BUTTON_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 9%; }
  .btn {
    position: relative;
    display: flex; align-items: center; gap: 14px;
    padding: 16px 34px;
    border-radius: 999px;
    background: var(--overlay-accent, #ff0033);
    color: #fff;
    font: 800 30px/1 system-ui, -apple-system, sans-serif;
    letter-spacing: 0.08em;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    animation:
      btn-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both,
      btn-click 0.36s ease-in-out 0.9s 1;
  }
  .ripple {
    position: absolute; inset: -6px;
    border-radius: 999px;
    border: 3px solid var(--overlay-accent, #ff0033);
    animation: ripple-out 0.9s ease-out 1.05s 2 both;
  }
  .bell { width: 30px; height: 30px; transform-origin: 50% 10%; animation: bell-swing 0.7s ease-in-out 1.3s 2; }
  .bell svg { display: block; width: 100%; height: 100%; fill: #fff; }
  @keyframes btn-in { from { transform: translateY(40px) scale(0.7); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes btn-click { 0%, 100% { transform: scale(1); } 50% { transform: scale(0.92); } }
  @keyframes ripple-out {
    0% { transform: scale(0.95); opacity: 0; }
    25% { opacity: 0.85; }
    100% { transform: scale(1.35); opacity: 0; }
  }
  @keyframes bell-swing { 0%, 100% { transform: rotate(0deg); } 30% { transform: rotate(16deg); } 70% { transform: rotate(-12deg); } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="btn">
      <span class="ripple"></span>
      <span class="bell"><svg viewBox="0 0 24 24"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6v-5a7 7 0 0 0-5-6.7V4a2 2 0 1 0-4 0v0.3A7 7 0 0 0 5 11v5l-2 2v1h18v-1z"/></svg></span>
      <span class="txt"></span>
    </div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.accentColor === 'string') {
        document.documentElement.style.setProperty('--overlay-accent', controls.accentColor);
      }
      document.querySelector('.txt').textContent =
        typeof controls.text === 'string' ? controls.text : 'SUBSCRIBE';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const FOLLOW_REMINDER_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; gap: 14px; padding-bottom: 9%; }
  .chip {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 28px;
    border-radius: 999px;
    background: rgba(15, 17, 24, 0.85);
    color: #fff;
    font: 700 28px/1 system-ui, -apple-system, sans-serif;
    box-shadow: 0 8px 26px rgba(0, 0, 0, 0.35);
    animation: chip-slide 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  .chip .plus { color: var(--overlay-accent, #ec4899); font-weight: 800; }
  .heart {
    width: 40px; height: 40px;
    animation: heart-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.7s both;
  }
  .heart svg { display: block; width: 100%; height: 100%; fill: var(--overlay-accent, #ec4899); }
  @keyframes chip-slide { from { transform: translateX(-60px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes heart-pop {
    0% { transform: scale(0); opacity: 0; }
    60% { transform: scale(1.3); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="chip"><span class="plus">+</span><span class="txt"></span></div>
    <span class="heart"><svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41 0.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></span>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.accentColor === 'string') {
        document.documentElement.style.setProperty('--overlay-accent', controls.accentColor);
      }
      document.querySelector('.txt').textContent =
        typeof controls.text === 'string' ? controls.text : '@yourhandle';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const LINK_IN_BIO_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 9%; }
  .chip {
    display: flex; align-items: center; gap: 12px;
    padding: 16px 30px;
    border-radius: 999px;
    background: var(--overlay-color, #8b5cf6);
    color: #fff;
    font: 700 28px/1 system-ui, -apple-system, sans-serif;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
    animation: chip-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  .arrow { width: 28px; height: 28px; animation: arrow-bounce 0.8s ease-in-out 0.7s 3; }
  .arrow svg { display: block; width: 100%; height: 100%; fill: #fff; }
  @keyframes chip-up { from { transform: translateY(44px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes arrow-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="chip">
      <span class="arrow"><svg viewBox="0 0 24 24"><path d="M12 3l7 7h-4v10h-6V10H5z"/></svg></span>
      <span class="txt"></span>
    </div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      document.querySelector('.txt').textContent =
        typeof controls.text === 'string' ? controls.text : 'Link in bio';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const CORNER_BUG_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .bug {
    position: absolute;
    font: 600 26px/1.2 system-ui, -apple-system, sans-serif;
    color: rgba(255, 255, 255, 0.85);
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.5);
    letter-spacing: 0.04em;
    animation: bug-fade 0.8s ease-out 0.2s both;
  }
  .bug.tl { top: 5%; left: 5%; }
  .bug.tr { top: 5%; right: 5%; }
  .bug.bl { bottom: 6%; left: 5%; }
  .bug.br { bottom: 6%; right: 5%; }
  @keyframes bug-fade { from { opacity: 0; } to { opacity: 0.75; } }
</style>
</head>
<body>
  <div class="bug br"></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      var bug = document.querySelector('.bug');
      bug.textContent = typeof controls.text === 'string' ? controls.text : '@channel';
      var corners = {
        'top-left': 'tl',
        'top-right': 'tr',
        'bottom-left': 'bl',
        'bottom-right': 'br',
      };
      bug.className = 'bug ' + (corners[controls.corner] || 'br');
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const NOTIFICATION_TOAST_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: center; padding-top: 5%; }
  .toast {
    display: flex; align-items: center; gap: 16px;
    width: min(560px, 82%);
    padding: 18px 22px;
    border-radius: 18px;
    background: rgba(250, 250, 252, 0.96);
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.3);
    font-family: system-ui, -apple-system, sans-serif;
    animation: toast-down 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  .icon {
    flex: none;
    width: 48px; height: 48px;
    border-radius: 12px;
    background: var(--overlay-accent, #3b82f6);
    display: flex; align-items: center; justify-content: center;
  }
  .icon svg { width: 26px; height: 26px; fill: #fff; }
  .body { min-width: 0; }
  .title { font-size: 24px; font-weight: 700; color: #111; }
  .subtitle { font-size: 20px; color: #555; }
  @keyframes toast-down { from { transform: translateY(-140%); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="toast">
      <span class="icon"><svg viewBox="0 0 24 24"><path d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 4z"/></svg></span>
      <div class="body">
        <div class="title"></div>
        <div class="subtitle"></div>
      </div>
    </div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.accentColor === 'string') {
        document.documentElement.style.setProperty('--overlay-accent', controls.accentColor);
      }
      document.querySelector('.title').textContent =
        typeof controls.title === 'string' ? controls.title : 'New message';
      document.querySelector('.subtitle').textContent =
        typeof controls.subtitle === 'string' ? controls.subtitle : 'You have a new follower';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const CTA_BANNER_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .bar {
    position: absolute; left: 0; right: 0; bottom: 0;
    display: flex; align-items: center; justify-content: space-between; gap: 20px;
    padding: 22px 5%;
    background: rgba(10, 12, 18, 0.88);
    font-family: system-ui, -apple-system, sans-serif;
    animation: bar-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  .msg {
    color: #fff; font-size: 30px; font-weight: 700;
    animation: msg-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.35s both;
  }
  .btn {
    flex: none;
    padding: 14px 30px;
    border-radius: 12px;
    background: var(--overlay-color, #16a34a);
    color: #fff;
    font: 800 26px/1 system-ui, -apple-system, sans-serif;
    animation:
      cta-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s both,
      cta-pulse 1s ease-in-out 1.1s 3;
  }
  @keyframes bar-up { from { transform: translateY(100%); } to { transform: none; } }
  @keyframes msg-in { from { transform: translateY(16px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes cta-in { from { transform: scale(0.6); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes cta-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
</style>
</head>
<body>
  <div class="bar">
    <div class="msg"></div>
    <div class="btn"></div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      document.querySelector('.msg').textContent =
        typeof controls.text === 'string' ? controls.text : 'Try it free today';
      document.querySelector('.btn').textContent =
        typeof controls.title === 'string' ? controls.title : 'Get started';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const FLOATING_HEARTS_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .heart {
    position: absolute; bottom: -80px;
    animation-name: rise;
    animation-timing-function: linear;
    animation-fill-mode: both;
  }
  .heart svg { display: block; fill: var(--overlay-color, #f43f5e); }
  .sway { display: block; animation: sway 1.4s ease-in-out 0s 2 both; }
  @keyframes rise {
    0% { transform: translateY(0); opacity: 0; }
    8% { opacity: 1; }
    80% { opacity: 1; }
    100% { transform: translateY(-115vh); opacity: 0; }
  }
  @keyframes sway {
    0% { transform: translateX(0); }
    33% { transform: translateX(16px); }
    66% { transform: translateX(-16px); }
    100% { transform: translateX(0); }
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
      var HEART =
        '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41 0.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
      var LEFTS = [12, 26, 40, 54, 68, 80, 90];
      var DELAYS = [0, 0.35, 0.15, 0.55, 0.25, 0.65, 0.45];
      var DURATIONS = [2.6, 3.0, 2.8, 3.2, 2.7, 3.1, 2.9];
      var SIZES = [44, 60, 36, 66, 40, 52, 46];
      for (var i = 0; i < LEFTS.length; i++) {
        var heart = document.createElement('div');
        heart.className = 'heart';
        heart.style.left = LEFTS[i] + '%';
        heart.style.animationDelay = DELAYS[i] + 's';
        heart.style.animationDuration = DURATIONS[i] + 's';
        var sway = document.createElement('span');
        sway.className = 'sway';
        sway.style.animationDelay = DELAYS[i] + 's';
        sway.innerHTML = HEART;
        var svg = sway.querySelector('svg');
        svg.style.width = SIZES[i] + 'px';
        svg.style.height = SIZES[i] + 'px';
        heart.appendChild(sway);
        document.body.appendChild(heart);
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const EMOJI_RAIN_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .drop {
    position: absolute; top: -80px;
    line-height: 1;
    animation-name: fall;
    animation-timing-function: linear;
    animation-fill-mode: both;
  }
  @keyframes fall {
    0% { transform: translateY(0) rotate(0deg); opacity: 0; }
    6% { opacity: 1; }
    90% { opacity: 1; }
    100% { transform: translateY(120vh) rotate(220deg); opacity: 0; }
  }
</style>
</head>
<body>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      var raw =
        typeof controls.text === 'string' && controls.text
          ? controls.text
          : '🎉😂🔥❤️👏';
      var units = Array.from(raw);
      var emoji = [];
      for (var u = 0; u < units.length; u++) {
        var ch = units[u];
        if (emoji.length && (ch === '\\uFE0F' || ch === '\\u200D')) {
          emoji[emoji.length - 1] += ch;
          if (ch === '\\u200D' && u + 1 < units.length) {
            emoji[emoji.length - 1] += units[u + 1];
            u += 1;
          }
        } else if (ch.trim()) {
          emoji.push(ch);
        }
      }
      if (!emoji.length) emoji.push('🎉');
      var COLS = [8, 20, 32, 44, 56, 68, 80, 90, 14, 62];
      var DELAYS = [0, 0.5, 0.2, 0.7, 0.35, 0.9, 0.15, 0.6, 1.0, 0.45];
      var DURATIONS = [2.2, 2.6, 2.4, 2.8, 2.3, 2.7, 2.5, 2.9, 2.4, 2.6];
      var SIZES = [40, 56, 46, 60, 42, 52, 48, 58, 44, 50];
      for (var i = 0; i < COLS.length; i++) {
        var drop = document.createElement('div');
        drop.className = 'drop';
        drop.textContent = emoji[i % emoji.length];
        drop.style.left = COLS[i] + '%';
        drop.style.fontSize = SIZES[i] + 'px';
        drop.style.animationDelay = DELAYS[i] + 's';
        drop.style.animationDuration = DURATIONS[i] + 's';
        document.body.appendChild(drop);
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const FIRE_STREAK_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .streak {
    display: flex; align-items: center; gap: 16px;
    animation:
      streak-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both,
      streak-shake 0.5s ease-in-out 0.55s 1;
  }
  .flame { font-size: 96px; line-height: 1; }
  .num {
    font: 900 110px/1 system-ui, -apple-system, sans-serif;
    color: var(--overlay-color, #f97316);
    text-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
  }
  @keyframes streak-pop {
    0% { transform: scale(0.2); opacity: 0; }
    70% { transform: scale(1.15); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes streak-shake {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(-4deg); }
    50% { transform: rotate(3deg); }
    75% { transform: rotate(-2deg); }
  }
</style>
</head>
<body>
  <div class="wrap"><div class="streak"><span class="flame">🔥</span><span class="num"></span></div></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.color === 'string') {
        document.documentElement.style.setProperty('--overlay-color', controls.color);
      }
      document.querySelector('.num').textContent =
        typeof controls.text === 'string' ? controls.text : '7';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const CLAP_BURST_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .stage { position: relative; width: 240px; height: 240px; display: flex; align-items: center; justify-content: center; }
  .clap {
    font-size: 110px; line-height: 1;
    animation:
      clap-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both,
      clap-tilt 0.5s ease-in-out 0.7s 2;
  }
  .ring {
    position: absolute; inset: 24px;
    border-radius: 50%;
    border: 5px solid var(--overlay-color, #facc15);
    animation: ring-out 0.9s ease-out both;
  }
  .ring.r1 { animation-delay: 0.45s; }
  .ring.r2 { animation-delay: 0.75s; }
  .ring.r3 { animation-delay: 1.05s; }
  @keyframes clap-pop {
    0% { transform: scale(0); opacity: 0; }
    65% { transform: scale(1.2); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes clap-tilt { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-10deg); } }
  @keyframes ring-out {
    0% { transform: scale(0.5); opacity: 0; }
    20% { opacity: 0.9; }
    100% { transform: scale(1.7); opacity: 0; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="stage">
      <span class="ring r1"></span>
      <span class="ring r2"></span>
      <span class="ring r3"></span>
      <span class="clap">👏</span>
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

const CHAT_BUBBLES_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .thread { display: flex; flex-direction: column; gap: 14px; width: min(620px, 80%); font: 500 26px/1.35 system-ui, -apple-system, sans-serif; }
  .bubble {
    max-width: 78%;
    padding: 14px 22px;
    border-radius: 22px;
    animation: bubble-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  .bubble.them {
    align-self: flex-start;
    background: rgba(58, 60, 68, 0.95);
    color: #fff;
    border-bottom-left-radius: 6px;
    transform-origin: bottom left;
  }
  .bubble.me {
    align-self: flex-end;
    background: var(--overlay-accent, #3b82f6);
    color: #fff;
    border-bottom-right-radius: 6px;
    transform-origin: bottom right;
  }
  @keyframes bubble-pop { from { transform: scale(0.4); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
</head>
<body>
  <div class="wrap"><div class="thread"></div></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.accentColor === 'string') {
        document.documentElement.style.setProperty('--overlay-accent', controls.accentColor);
      }
      var text =
        typeof controls.text === 'string' && controls.text
          ? controls.text
          : 'Hey! Did you see this?|Yes 😍';
      var messages = text.split('|');
      var thread = document.querySelector('.thread');
      var shown = 0;
      for (var i = 0; i < messages.length && shown < 4; i++) {
        var body = messages[i].trim();
        if (!body) continue;
        var bubble = document.createElement('div');
        bubble.className = 'bubble ' + (shown % 2 === 0 ? 'them' : 'me');
        bubble.textContent = body;
        bubble.style.animationDelay = 0.15 + shown * 0.55 + 's';
        thread.appendChild(bubble);
        shown += 1;
      }
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const COMMENT_CARD_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .card {
    display: flex; gap: 16px;
    width: min(560px, 82%);
    padding: 20px 24px;
    border-radius: 16px;
    background: rgba(20, 22, 30, 0.92);
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
    font-family: system-ui, -apple-system, sans-serif;
    animation: card-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
  }
  .avatar {
    flex: none;
    width: 56px; height: 56px;
    border-radius: 50%;
    background: var(--overlay-accent, #6366f1);
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    font: 800 28px/1 system-ui, -apple-system, sans-serif;
    text-transform: uppercase;
    animation: avatar-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both;
  }
  .body { min-width: 0; }
  .user {
    color: rgba(255, 255, 255, 0.75);
    font-size: 20px; font-weight: 700;
    animation: line-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) 0.4s both;
  }
  .comment {
    margin-top: 6px;
    color: #fff; font-size: 24px; line-height: 1.35;
    animation: line-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) 0.5s both;
  }
  @keyframes card-pop { from { transform: scale(0.6) translateY(20px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes avatar-pop { from { transform: scale(0); } to { transform: scale(1); } }
  @keyframes line-in { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="avatar"></div>
      <div class="body">
        <div class="user"></div>
        <div class="comment"></div>
      </div>
    </div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.accentColor === 'string') {
        document.documentElement.style.setProperty('--overlay-accent', controls.accentColor);
      }
      var user = typeof controls.title === 'string' ? controls.title : '@username';
      document.querySelector('.user').textContent = user;
      document.querySelector('.comment').textContent =
        typeof controls.text === 'string' ? controls.text : 'This is amazing!';
      var initialSource = user.replace(/^@+/, '');
      document.querySelector('.avatar').textContent = initialSource
        ? Array.from(initialSource)[0]
        : '?';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const QUOTE_CARD_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .quote-box { width: min(720px, 84%); }
  .mark {
    font: 900 130px/0.6 Georgia, 'Times New Roman', serif;
    color: rgba(255, 255, 255, 0.9);
    animation: mark-in 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
  }
  .qtext {
    margin-top: 10px;
    font: 600 40px/1.4 Georgia, 'Times New Roman', serif;
    color: #fff;
    text-shadow: 0 2px 16px rgba(0, 0, 0, 0.45);
    animation: line-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.35s both;
  }
  .attr {
    margin-top: 18px;
    font: 500 26px/1 system-ui, -apple-system, sans-serif;
    color: rgba(255, 255, 255, 0.7);
    animation: line-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.55s both;
  }
  @keyframes mark-in { from { transform: translateY(-20px) scale(0.6); opacity: 0; } to { transform: none; opacity: 0.9; } }
  @keyframes line-up { from { transform: translateY(36px); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="quote-box">
      <div class="mark">&ldquo;</div>
      <div class="qtext"></div>
      <div class="attr"></div>
    </div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      document.querySelector('.qtext').textContent =
        typeof controls.text === 'string'
          ? controls.text
          : 'The best way to predict the future is to invent it.';
      document.querySelector('.attr').textContent =
        '— ' + (typeof controls.title === 'string' ? controls.title : 'Alan Kay');
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

export const VIVID_OVERLAY_SOCIAL_DOCUMENTS: Record<string, string> = {
  'subscribe-button': SUBSCRIBE_BUTTON_DOCUMENT,
  'follow-reminder': FOLLOW_REMINDER_DOCUMENT,
  'link-in-bio': LINK_IN_BIO_DOCUMENT,
  'corner-bug': CORNER_BUG_DOCUMENT,
  'notification-toast': NOTIFICATION_TOAST_DOCUMENT,
  'cta-banner': CTA_BANNER_DOCUMENT,
  'floating-hearts': FLOATING_HEARTS_DOCUMENT,
  'emoji-rain': EMOJI_RAIN_DOCUMENT,
  'fire-streak': FIRE_STREAK_DOCUMENT,
  'clap-burst': CLAP_BURST_DOCUMENT,
  'chat-bubbles': CHAT_BUBBLES_DOCUMENT,
  'comment-card': COMMENT_CARD_DOCUMENT,
  'quote-card': QUOTE_CARD_DOCUMENT,
};
