import { describe, expect, it } from 'vitest';

import {
  compileOverlayDocument,
  instantiateOverlayDocument,
  lintOverlayDocument,
  OverlayCompileError,
  VIVID_OVERLAY_DOCUMENTS,
  vividOverlayDocument,
} from '../src';

const VALID_DOC = `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { background: transparent; }
.a { animation: x 1s both; } @keyframes x { from { opacity: 0 } to { opacity: 1 } }
</style></head><body><div class="a">hi</div>
<script>window.__overlayReady = true;</script>
</body></html>`;

describe('overlay document lint', () => {
  it('accepts a contract-compliant document', () => {
    expect(lintOverlayDocument(VALID_DOC)).toEqual([]);
  });

  const violations: Array<[string, string]> = [
    ['no-css-transition', '<style>.a{transition: opacity 1s}</style>'],
    ['no-scroll-driven', '<style>.a{animation-timeline: scroll()}</style>'],
    ['no-infinite-gsap-repeat', '<script>tl.to(a,{repeat: -1})</script>'],
    ['no-wall-clock', '<script>var t = Date.now();</script>'],
    ['no-wall-clock', '<script>var r = Math.random();</script>'],
    ['no-timers', '<script>setTimeout(fn, 10)</script>'],
    ['no-timers', '<script>requestAnimationFrame(fn)</script>'],
    ['no-media-elements', '<video src="a.mp4"></video>'],
    ['no-animated-image', '<img src="party.gif" />'],
    ['no-network', '<img src="https://cdn.example.com/x.png" />'],
    ['no-network', '<style>@import "theme.css";</style>'],
    ['no-external-script', '<script src="./gsap.min.js"></script>'],
  ];

  for (const [rule, fragment] of violations) {
    it(`flags ${rule}`, () => {
      const doc = VALID_DOC.replace('<div class="a">hi</div>', fragment);
      expect(lintOverlayDocument(doc).map((issue) => issue.rule)).toContain(
        rule,
      );
    });
  }

  it('requires the ready flag and a seekable animation', () => {
    const noReady = VALID_DOC.replace(
      '<script>window.__overlayReady = true;</script>',
      '',
    );
    expect(lintOverlayDocument(noReady).map((issue) => issue.rule)).toContain(
      'requires-ready-flag',
    );
    const noAnimation = VALID_DOC.replace(/@keyframes[^}]+}[^}]*}/, '').replace(
      'animation: x 1s both;',
      '',
    );
    expect(
      lintOverlayDocument(noAnimation).map((issue) => issue.rule),
    ).toContain('requires-seekable-animation');
  });

  it('warns on opaque html/body backgrounds', () => {
    const opaque = VALID_DOC.replace(
      'background: transparent;',
      'background: #fff;',
    );
    const issues = lintOverlayDocument(opaque);
    expect(issues).toEqual([
      expect.objectContaining({
        rule: 'transparent-background',
        severity: 'warning',
      }),
    ]);
  });
});

describe('overlay document compile + instantiate', () => {
  it('injects CSP, params placeholder, and the seek shim', () => {
    const { html, issues } = compileOverlayDocument(VALID_DOC);
    expect(issues).toEqual([]);
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('__neumaOverlaySeek');
    expect(html).toContain('neuma-overlay-seeked');
    // CSP + placeholder land in <head>, shim before </body>
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(
      html.indexOf('<body>'),
    );
    expect(html.indexOf('__neumaOverlaySeek')).toBeGreaterThan(
      html.indexOf('<body>'),
    );
  });

  it('throws OverlayCompileError listing violated rules', () => {
    const bad = VALID_DOC.replace(
      '<div class="a">hi</div>',
      '<video src="x.mp4"></video><script>Date.now()</script>',
    );
    try {
      compileOverlayDocument(bad);
      throw new Error('expected compile to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(OverlayCompileError);
      const rules = (error as OverlayCompileError).issues.map(
        (issue) => issue.rule,
      );
      expect(rules).toContain('no-media-elements');
      expect(rules).toContain('no-wall-clock');
    }
  });

  it('does not fail compile on warnings', () => {
    const opaque = VALID_DOC.replace(
      'background: transparent;',
      'background: #fff;',
    );
    const { issues } = compileOverlayDocument(opaque);
    expect(issues.map((issue) => issue.rule)).toEqual([
      'transparent-background',
    ]);
  });

  it('binds controls deterministically before document scripts', () => {
    const { html } = compileOverlayDocument(VALID_DOC);
    const a = instantiateOverlayDocument(html, {
      controls: { b: 2, a: 'x', c: true },
      widthPx: 1280,
      heightPx: 720,
    });
    const b = instantiateOverlayDocument(html, {
      controls: { c: true, a: 'x', b: 2 },
      widthPx: 1280,
      heightPx: 720,
    });
    expect(a).toBe(b); // sorted-key serialization → cache-friendly identity
    expect(a).toContain('window.__overlayParams');
    expect(a.indexOf('__overlayParams')).toBeLessThan(
      a.indexOf('window.__overlayReady'),
    );
    expect(a).not.toContain('<!--neuma-overlay-params-->');
  });

  it('refuses to instantiate an uncompiled document', () => {
    expect(() =>
      instantiateOverlayDocument(VALID_DOC, { controls: {} }),
    ).toThrow(/not compiled/);
  });
});

describe('built-in overlay documents', () => {
  it('every built-in document passes the authoring contract and compiles', () => {
    for (const [id, doc] of Object.entries(VIVID_OVERLAY_DOCUMENTS)) {
      const issues = lintOverlayDocument(doc);
      expect({ id, issues }).toEqual({ id, issues: [] });
      const { html } = compileOverlayDocument(doc);
      const instantiated = instantiateOverlayDocument(html, {
        controls: { text: 'X', title: 'T', subtitle: 'S' },
      });
      expect(instantiated).toContain('__neumaOverlaySeek');
    }
  });

  it('resolves documents by id', () => {
    expect(vividOverlayDocument('marker-highlight')).toContain('hl-sweep');
    expect(vividOverlayDocument('lower-third')).toContain('third-in');
    expect(vividOverlayDocument('missing')).toBeUndefined();
  });
});
