// Wave-1 lower-third vivid-overlay documents (authoring contract per
// overlay-documents.ts).

const LOWER_THIRD_GLASS_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .third {
    position: absolute; left: 6%; bottom: 12%;
    display: flex; align-items: center; gap: 16px;
    padding: 16px 28px 16px 18px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.14);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.25);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
    animation: glass-in 0.65s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  .dot {
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--overlay-accent, #34d399);
    animation: dot-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s both;
  }
  .title {
    font: 700 30px/1.2 system-ui, -apple-system, sans-serif; color: #fff;
    animation: fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.35s both;
  }
  .subtitle {
    font: 500 19px/1.3 system-ui, -apple-system, sans-serif;
    color: rgba(255, 255, 255, 0.75);
    animation: fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.5s both;
  }
  @keyframes glass-in { from { transform: translateY(28px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes dot-pop { from { transform: scale(0); } to { transform: scale(1); } }
  @keyframes fade-up { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
</head>
<body>
  <div class="third">
    <div class="dot"></div>
    <div><div class="title"></div><div class="subtitle"></div></div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.accentColor === 'string') {
        document.documentElement.style.setProperty('--overlay-accent', controls.accentColor);
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

const LOWER_THIRD_BROADCAST_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .third { position: absolute; left: 5%; bottom: 10%; min-width: 34%; }
  .tier { overflow: hidden; }
  .name {
    display: inline-block;
    padding: 10px 26px;
    background: var(--overlay-accent, #dc2626);
    color: #fff;
    font: 800 32px/1.2 system-ui, -apple-system, sans-serif;
    text-transform: uppercase; letter-spacing: 0.02em;
    animation: tier-slide 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  .role {
    display: inline-block;
    padding: 7px 26px;
    background: rgba(10, 12, 18, 0.92);
    color: rgba(255, 255, 255, 0.92);
    font: 500 20px/1.3 system-ui, -apple-system, sans-serif;
    animation: tier-slide 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.3s both;
  }
  .ticker {
    height: 4px; margin-top: 2px;
    background: var(--overlay-accent, #dc2626);
    transform-origin: left center;
    animation: ticker-grow 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.45s both;
  }
  @keyframes tier-slide { from { transform: translateX(-105%); } to { transform: none; } }
  @keyframes ticker-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
</style>
</head>
<body>
  <div class="third">
    <div class="tier"><span class="name"></span></div>
    <div class="tier"><span class="role"></span></div>
    <div class="ticker"></div>
  </div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.accentColor === 'string') {
        document.documentElement.style.setProperty('--overlay-accent', controls.accentColor);
      }
      document.querySelector('.name').textContent =
        typeof controls.title === 'string' ? controls.title : 'Alex Rivera';
      document.querySelector('.role').textContent =
        typeof controls.subtitle === 'string' ? controls.subtitle : 'Senior Correspondent';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const LOWER_THIRD_SOCIAL_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .chip {
    position: absolute; left: 50%; bottom: 10%;
    display: flex; align-items: center; gap: 12px;
    padding: 12px 24px 12px 14px;
    border-radius: 999px;
    background: rgba(12, 14, 20, 0.88);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3);
    animation: chip-in 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
  }
  .glyph {
    width: 34px; height: 34px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: var(--overlay-accent, #ff0033);
    animation: glyph-spin 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.3s both;
  }
  .glyph svg { width: 18px; height: 18px; fill: #fff; }
  .name { font: 700 24px/1.2 system-ui, -apple-system, sans-serif; color: #fff; }
  .handle {
    font: 500 17px/1.2 system-ui, -apple-system, sans-serif;
    color: rgba(255, 255, 255, 0.65);
    animation: handle-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.45s both;
  }
  @keyframes chip-in { from { transform: translate(-50%, 30px) scale(0.8); opacity: 0; } to { transform: translate(-50%, 0) scale(1); opacity: 1; } }
  @keyframes glyph-spin { from { transform: rotate(-140deg) scale(0); } to { transform: none; } }
  @keyframes handle-in { from { transform: translateX(-8px); opacity: 0; } to { transform: none; opacity: 1; } }
  .chip { transform: translate(-50%, 0); }
</style>
</head>
<body>
  <div class="chip">
    <div class="glyph"></div>
    <div><span class="name"></span> <span class="handle"></span></div>
  </div>
  <script>
    (function () {
      var ICONS = {
        youtube: '<svg viewBox="0 0 24 24"><path d="M23 7.5s-.2-1.6-.9-2.3c-.9-.9-1.9-.9-2.3-1C16.6 4 12 4 12 4s-4.6 0-7.8.2c-.4.1-1.4.1-2.3 1-.7.7-.9 2.3-.9 2.3S1 9.4 1 11.3v1.4c0 1.9.2 3.8.2 3.8s.2 1.6.9 2.3c.9.9 2 .9 2.5 1 1.8.2 7.4.2 7.4.2s4.6 0 7.8-.2c.4-.1 1.4-.1 2.3-1 .7-.7.9-2.3.9-2.3s.2-1.9.2-3.8v-1.4c0-1.9-.2-3.8-.2-3.8zM9.8 15.3V8.7l6.2 3.3-6.2 3.3z"/></svg>',
        tiktok: '<svg viewBox="0 0 24 24"><path d="M19.6 6.7a4.8 4.8 0 0 1-3.5-1.6 4.8 4.8 0 0 1-1.2-3.1h-3.2v13.3a2.8 2.8 0 1 1-2-2.7V9.3a6 6 0 1 0 5.2 6V9.9a7.9 7.9 0 0 0 4.7 1.5V8.2c-.7 0-1.4-.1-2-.4z"/></svg>',
        instagram: '<svg viewBox="0 0 24 24"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.8-.4 2.2a3.8 3.8 0 0 1-.9 1.4c-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.2-2.2-.4a3.8 3.8 0 0 1-1.4-.9 3.8 3.8 0 0 1-.9-1.4c-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4 1.3-.1 1.7-.1 4.8-.1zm0 3.6a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4zm0 10.2a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm7.9-10.4a1.4 1.4 0 1 1-2.9 0 1.4 1.4 0 0 1 2.9 0z"/></svg>',
        x: '<svg viewBox="0 0 24 24"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L1.2 2h6.4l4.4 5.9L18.9 2zm-1.1 18h1.7L7.1 3.8H5.2L17.8 20z"/></svg>',
      };
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.accentColor === 'string') {
        document.documentElement.style.setProperty('--overlay-accent', controls.accentColor);
      }
      document.querySelector('.name').textContent =
        typeof controls.title === 'string' ? controls.title : 'Your Name';
      document.querySelector('.handle').textContent =
        typeof controls.subtitle === 'string' ? controls.subtitle : '@handle';
      var platform = typeof controls.platform === 'string' ? controls.platform : 'youtube';
      document.querySelector('.glyph').innerHTML = ICONS[platform] || ICONS.youtube;
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

const LOWER_THIRD_MINIMAL_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .third { position: absolute; left: 7%; bottom: 14%; }
  .name {
    font: 600 34px/1.2 system-ui, -apple-system, sans-serif;
    color: #ffffff;
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.45);
    animation: name-in 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.25s both;
  }
  .rule {
    height: 3px; width: 100%; margin-top: 8px; border-radius: 2px;
    background: var(--overlay-accent, #f59e0b);
    transform-origin: left center;
    animation: rule-grow 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  }
  @keyframes name-in { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes rule-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
</style>
</head>
<body>
  <div class="third"><div class="name"></div><div class="rule"></div></div>
  <script>
    (function () {
      var controls = (window.__overlayParams || {}).controls || {};
      if (typeof controls.accentColor === 'string') {
        document.documentElement.style.setProperty('--overlay-accent', controls.accentColor);
      }
      document.querySelector('.name').textContent =
        typeof controls.title === 'string' ? controls.title : 'Your Name';
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;

export const VIVID_OVERLAY_LOWER_THIRD_DOCUMENTS: Record<string, string> = {
  'lower-third-glass': LOWER_THIRD_GLASS_DOCUMENT,
  'lower-third-broadcast': LOWER_THIRD_BROADCAST_DOCUMENT,
  'lower-third-social': LOWER_THIRD_SOCIAL_DOCUMENT,
  'lower-third-minimal': LOWER_THIRD_MINIMAL_DOCUMENT,
};
