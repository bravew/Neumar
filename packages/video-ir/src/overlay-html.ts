// Pure-HTML vivid-overlay engine core: authoring-contract lint, document
// compilation (CSP + seek shim injection), and instantiation (typed control
// values). Everything here is plain string processing so the frontend preview
// host and the backend export harness share one implementation.
//
// The engine deliberately has NO framework runtime. Overlay documents animate
// via CSS @keyframes, WAAPI, or paused GSAP timelines registered in
// `window.__timelines` (HyperFrames-compatible convention), and the injected
// shim makes the whole document a pure function of time: seek(tMs) positions
// every animation deterministically. Proven by
// dev-doc/video-mode/07-02-transitions/spikes/2026-07-06-pure-html-overlay/.

import type { VividOverlayControlValue } from './overlay-types.js';

export type OverlayLintSeverity = 'error' | 'warning';

export interface OverlayLintIssue {
  rule: string;
  severity: OverlayLintSeverity;
  message: string;
}

export class OverlayCompileError extends Error {
  constructor(readonly issues: OverlayLintIssue[]) {
    super(
      `Overlay document violates the authoring contract: ${issues
        .map((issue) => issue.rule)
        .join(', ')}`,
    );
    this.name = 'OverlayCompileError';
  }
}

interface LintRule {
  rule: string;
  severity: OverlayLintSeverity;
  test: (html: string) => boolean;
  message: string;
}

// The authoring contract. Regex-based on the raw document text — strict by
// design: a false positive means rewording a preset, a false negative means a
// nondeterministic export.
const LINT_RULES: LintRule[] = [
  {
    rule: 'no-css-transition',
    severity: 'error',
    test: (html) => /transition(-property|-duration|-delay)?\s*:/i.test(html),
    message:
      'CSS transitions are not random-access seekable; use animation/@keyframes or WAAPI',
  },
  {
    rule: 'no-scroll-driven',
    severity: 'error',
    test: (html) => /animation-timeline\s*:|ScrollTrigger/i.test(html),
    message: 'Scroll-driven animation cannot be seeked by time',
  },
  {
    rule: 'no-infinite-gsap-repeat',
    severity: 'error',
    test: (html) => /repeat\s*:\s*-1/.test(html),
    message: 'repeat: -1 makes timeline duration infinite; use finite repeats',
  },
  {
    rule: 'no-wall-clock',
    severity: 'error',
    test: (html) =>
      /Math\.random|Date\.now|new Date\s*\(|performance\.now/.test(html),
    message: 'Wall-clock and randomness break preview/export determinism',
  },
  {
    rule: 'no-timers',
    severity: 'error',
    test: (html) => /setTimeout|setInterval|requestAnimationFrame/.test(html),
    message:
      'Timer/rAF-driven state cannot be seeked; drive everything from animations or the overlay-seek event',
  },
  {
    rule: 'no-media-elements',
    severity: 'error',
    test: (html) => /<video[\s>]|<audio[\s>]/i.test(html),
    message: 'Media elements are banned inside overlay documents',
  },
  {
    rule: 'no-animated-image',
    severity: 'error',
    test: (html) => /\.gif["')\s]|\.apng["')\s]/i.test(html),
    message:
      'Animated GIF/APNG <img> cannot be seeked; use the gif overlay backend instead',
  },
  {
    rule: 'no-network',
    severity: 'error',
    test: (html) =>
      /(?:src|href)\s*=\s*["']https?:|url\(\s*["']?https?:|@import/i.test(html),
    message:
      'Overlay documents must be self-contained (inline styles, data: URIs); network access is blocked by CSP',
  },
  {
    rule: 'no-external-script',
    severity: 'error',
    test: (html) => /<script[^>]*\ssrc\s*=/i.test(html),
    message: 'External scripts are banned; inline all JS',
  },
  {
    rule: 'requires-ready-flag',
    severity: 'error',
    test: (html) => !/window\.__overlayReady\s*=\s*true/.test(html),
    message:
      'Document must set window.__overlayReady = true synchronously after setup',
  },
  {
    rule: 'requires-seekable-animation',
    severity: 'error',
    test: (html) => !/@keyframes|\.animate\s*\(|__timelines/.test(html),
    message:
      'No seekable animation found (CSS @keyframes, WAAPI .animate(), or window.__timelines)',
  },
  {
    rule: 'transparent-background',
    severity: 'warning',
    test: (html) => {
      const bodyBlock = /(?:html|body)[^{}]*\{([^}]*)\}/i.exec(html)?.[1];
      if (!bodyBlock) return false;
      const background = /background(?:-color)?\s*:\s*([^;]+)/i.exec(
        bodyBlock,
      )?.[1];
      return background !== undefined && !/transparent|none/i.test(background);
    },
    message:
      'html/body should keep a transparent background — the whole point of the overlay layer',
  },
];

export function lintOverlayDocument(html: string): OverlayLintIssue[] {
  return LINT_RULES.filter((rule) => rule.test(html)).map(
    ({ rule, severity, message }) => ({ rule, severity, message }),
  );
}

const PARAMS_PLACEHOLDER = '<!--neuma-overlay-params-->';

// Injected into every compiled document. Makes the document a pure function
// of time: __neumaOverlaySeek(tMs) pauses and positions WAAPI/CSS animations
// (re-enumerated every call, shadow roots included), registered GSAP
// timelines, the GSAP global timeline, and SMIL SVG clocks, then dispatches a
// cancelable hook for synchronous canvas drawers. postMessage drives it from
// a (possibly opaque-origin) parent; acks fire after a two-rAF settle.
const OVERLAY_SEEK_SHIM = `(function () {
  'use strict';
  function collectRoots(root, out) {
    out.push(root);
    var walker = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (var i = 0; i < walker.length; i++) {
      if (walker[i].shadowRoot) collectRoots(walker[i].shadowRoot, out);
    }
  }
  function seek(tMs) {
    var roots = [];
    collectRoots(document, roots);
    for (var r = 0; r < roots.length; r++) {
      var animations = roots[r].getAnimations
        ? roots[r].getAnimations({ subtree: true })
        : [];
      for (var i = 0; i < animations.length; i++) {
        try {
          animations[i].pause();
          animations[i].currentTime = tMs;
        } catch (_e) {
          /* seeking past an endpoint of a fill:none animation can throw */
        }
      }
    }
    var timelines = window.__timelines || {};
    for (var key in timelines) {
      var tl = timelines[key];
      if (tl && typeof tl.pause === 'function' && typeof tl.time === 'function') {
        tl.pause();
        tl.time(tMs / 1000);
      }
    }
    if (window.gsap && window.gsap.globalTimeline) {
      window.gsap.ticker && window.gsap.ticker.lagSmoothing(0);
      window.gsap.globalTimeline.pause();
      window.gsap.globalTimeline.time(tMs / 1000, true);
    }
    var svgs = document.querySelectorAll('svg');
    for (var s = 0; s < svgs.length; s++) {
      if (typeof svgs[s].pauseAnimations === 'function') {
        svgs[s].pauseAnimations();
        svgs[s].setCurrentTime(tMs / 1000);
      }
    }
    document.dispatchEvent(
      new CustomEvent('neuma-overlay-seek', { detail: { tMs: tMs } }),
    );
  }
  window.__neumaOverlaySeek = seek;
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'neuma-overlay-seek') return;
    seek(data.tMs);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (event.source && event.source.postMessage) {
          event.source.postMessage(
            { type: 'neuma-overlay-seeked', seq: data.seq, tMs: data.tMs },
            event.origin || '*',
          );
        }
      });
    });
  });
  function announceReady() {
    window.__overlayReadyResolved = true;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'neuma-overlay-ready' }, '*');
    }
  }
  // Documents with async setup (e.g. generated GIF documents pre-decoding
  // frames) gate readiness on window.__overlayReadyPromise; plain documents
  // are ready once fonts are.
  var fontsReady =
    document.fonts && document.fonts.ready
      ? document.fonts.ready
      : Promise.resolve();
  Promise.all([fontsReady, Promise.resolve(window.__overlayReadyPromise)])
    .then(announceReady)
    .catch(announceReady);
})();`;

export interface CompiledOverlayDocument {
  html: string;
  issues: OverlayLintIssue[];
}

const CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src blob: data:\">";

/**
 * Lint, then inject the no-network CSP, the params placeholder, and the seek
 * shim. Throws OverlayCompileError when any error-severity rule fires;
 * warnings ride along in the result.
 */
export function compileOverlayDocument(html: string): CompiledOverlayDocument {
  const issues = lintOverlayDocument(html);
  if (issues.some((issue) => issue.severity === 'error')) {
    throw new OverlayCompileError(
      issues.filter((issue) => issue.severity === 'error'),
    );
  }
  return { html: injectOverlayScaffold(html), issues };
}

/**
 * Compile a machine-GENERATED document (gif/lottie backends): same CSP and
 * shim injection, but no authoring lint — embedded vendored runtimes (e.g.
 * lottie-web) legitimately contain tokens the authored contract bans, and the
 * generators are covered by their own tests instead.
 */
export function compileGeneratedOverlayDocument(html: string): string {
  return injectOverlayScaffold(html);
}

function injectOverlayScaffold(html: string): string {
  const headInjection = `${CSP_META}${PARAMS_PLACEHOLDER}`;
  let compiled = html;
  if (/<head[^>]*>/i.test(compiled)) {
    compiled = compiled.replace(/<head[^>]*>/i, (m) => `${m}${headInjection}`);
  } else if (/<html[^>]*>/i.test(compiled)) {
    compiled = compiled.replace(
      /<html[^>]*>/i,
      (m) => `${m}<head>${headInjection}</head>`,
    );
  } else {
    compiled = `<head>${headInjection}</head>${compiled}`;
  }
  const shimTag = `<script>${OVERLAY_SEEK_SHIM}</script>`;
  compiled = /<\/body>/i.test(compiled)
    ? compiled.replace(/<\/body>/i, `${shimTag}</body>`)
    : `${compiled}${shimTag}`;
  return compiled;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export interface OverlayInstantiation {
  controls: Record<string, VividOverlayControlValue>;
  /** Design-space dimensions the document may read for layout decisions. */
  widthPx?: number;
  heightPx?: number;
  fps?: number;
  durationMs?: number;
}

/**
 * Bind typed control values into a compiled document. The params script
 * replaces the compile-time placeholder in <head>, so it runs before any
 * document script reads window.__overlayParams. Deterministic serialization
 * (sorted keys) keeps instantiation raster-cache-friendly.
 */
export function instantiateOverlayDocument(
  compiledHtml: string,
  instantiation: OverlayInstantiation,
): string {
  if (!compiledHtml.includes(PARAMS_PLACEHOLDER)) {
    throw new Error(
      'Document was not compiled with compileOverlayDocument (params placeholder missing)',
    );
  }
  const paramsScript = `<script>window.__overlayParams = Object.freeze(${stableStringify(
    {
      controls: instantiation.controls,
      widthPx: instantiation.widthPx,
      heightPx: instantiation.heightPx,
      fps: instantiation.fps,
      durationMs: instantiation.durationMs,
    },
  )});</script>`;
  return compiledHtml.replace(PARAMS_PLACEHOLDER, paramsScript);
}
