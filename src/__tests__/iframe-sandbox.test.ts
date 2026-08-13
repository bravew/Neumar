import { describe, expect, it } from 'vitest';

import {
  acceptMessage,
  annotateMissingNeumaIds,
  findNearestAnnotatedTarget,
  SANDBOX_ATTR,
  SANDBOX_CSP,
  wrapHtmlSrcdoc,
  wrapSvgSrcdoc,
} from '@/components/artifacts/live/iframe-sandbox';

function makeMessage(overrides: Record<string, unknown>) {
  return new MessageEvent('message', { data: overrides });
}

describe('acceptMessage', () => {
  const fakeWindow = {} as Window;
  const nonce = 'n1';

  it('rejects messages from a foreign source', () => {
    const ev = new MessageEvent('message', {
      data: { nonce, type: 'ready' },
      source: {} as MessageEventSource,
    });
    expect(acceptMessage(ev, fakeWindow, nonce)).toBeNull();
  });

  it('rejects messages with the wrong nonce', () => {
    const ev = new MessageEvent('message', {
      data: { nonce: 'wrong', type: 'ready' },
      source: fakeWindow as unknown as MessageEventSource,
    });
    expect(acceptMessage(ev, fakeWindow, nonce)).toBeNull();
  });

  it('rejects null/non-object data', () => {
    expect(
      acceptMessage(makeMessage(null as never), fakeWindow, nonce),
    ).toBeNull();
  });

  it('rejects unknown message types', () => {
    const ev = new MessageEvent('message', {
      data: { nonce, type: 'eval' },
      source: fakeWindow as unknown as MessageEventSource,
    });
    expect(acceptMessage(ev, fakeWindow, nonce)).toBeNull();
  });

  it('rejects resize without a finite numeric height', () => {
    const ev = new MessageEvent('message', {
      data: { nonce, type: 'resize', height: -1 },
      source: fakeWindow as unknown as MessageEventSource,
    });
    expect(acceptMessage(ev, fakeWindow, nonce)).toBeNull();
  });

  it('accepts valid resize, ready, event messages', () => {
    const okResize = new MessageEvent('message', {
      data: { nonce, type: 'resize', height: 200 },
      source: fakeWindow as unknown as MessageEventSource,
    });
    expect(acceptMessage(okResize, fakeWindow, nonce)).toEqual({
      type: 'resize',
      height: 200,
    });

    const okReady = new MessageEvent('message', {
      data: { nonce, type: 'ready' },
      source: fakeWindow as unknown as MessageEventSource,
    });
    expect(acceptMessage(okReady, fakeWindow, nonce)).toEqual({
      type: 'ready',
    });

    const okEvent = new MessageEvent('message', {
      data: { nonce, type: 'event', payload: { hi: 1 } },
      source: fakeWindow as unknown as MessageEventSource,
    });
    expect(acceptMessage(okEvent, fakeWindow, nonce)).toEqual({
      type: 'event',
      payload: { hi: 1 },
    });
  });

  it('rejects everything when no source is registered', () => {
    const ev = new MessageEvent('message', {
      data: { nonce, type: 'ready' },
      source: fakeWindow as unknown as MessageEventSource,
    });
    expect(acceptMessage(ev, null, nonce)).toBeNull();
  });
});

describe('srcdoc wrappers', () => {
  it('uses scripts and downloads without allow-same-origin', () => {
    expect(SANDBOX_ATTR).toBe('allow-scripts allow-downloads');
    expect(SANDBOX_ATTR).not.toContain('allow-same-origin');
  });

  it('locks the CSP down', () => {
    expect(SANDBOX_CSP).toContain("default-src 'none'");
    expect(SANDBOX_CSP).toContain("connect-src 'none'");
    expect(SANDBOX_CSP).toContain("form-action 'none'");
    expect(SANDBOX_CSP).toContain("base-uri 'none'");
    // frame-ancestors is intentionally absent: it's ignored in a <meta> CSP
    // (the only delivery path here) and framing is gated by the sandbox attr.
    expect(SANDBOX_CSP).not.toContain('frame-ancestors');
  });

  it('injects a meta CSP into srcdoc html', () => {
    const html = wrapHtmlSrcdoc('<p>hi</p>', 'n1');
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain('<p>hi</p>');
  });

  it('installs the DesignMode data-neuma-id target bridge', () => {
    const html = wrapHtmlSrcdoc(
      '<button data-neuma-id="hero-cta">Go</button>',
      'n1',
    );
    expect(html).toContain('[data-neuma-id]');
    expect(html).toContain("kind:'neuma-target'");
    expect(html).toContain('parent.postMessage');
  });

  it('can enable the inspect bridge without allow-same-origin', () => {
    const html = wrapHtmlSrcdoc(
      '<button data-neuma-id="hero-cta">Go</button>',
      'n1',
      'inspect',
    );
    expect(html).toContain('MODE="inspect"');
    expect(html).toContain('neuma-inspect-style');
    expect(html).toContain('[data-neuma-inspect-selected="true"]');
    expect(SANDBOX_ATTR).not.toContain('allow-same-origin');
  });

  it('wraps SVG inside a centered host element', () => {
    const html = wrapSvgSrcdoc('<svg/>', 'n1');
    expect(html).toContain('<svg></svg>');
    expect(html).toContain('display:flex');
  });

  it('finds the nearest annotated ancestor for comment pins', () => {
    document.body.innerHTML = `
      <main data-neuma-id="outer">
        <section data-neuma-id="nearest">
          <span id="child">Copy</span>
        </section>
      </main>
    `;
    const child = document.getElementById('child');
    expect(
      findNearestAnnotatedTarget(child)?.getAttribute('data-neuma-id'),
    ).toBe('nearest');
  });

  it('auto-annotates structural imported HTML with stable Neuma ids', () => {
    const html = annotateMissingNeumaIds(`
      <main>
        <h1>Welcome</h1>
        <div class="hero">
          <p>Body copy stays quiet.</p>
        </div>
        <button data-neuma-id="existing">Keep me</button>
      </main>
    `);

    expect(html).toContain('data-neuma-id="neuma-auto-path-0"');
    expect(html).toContain('data-neuma-id="neuma-auto-path-0-0"');
    expect(html).toContain('data-neuma-id="neuma-auto-path-0-1"');
    expect(html).toContain('data-neuma-label="Welcome"');
    expect(html).toContain('data-neuma-id="existing"');
    expect(html).not.toContain('data-neuma-id="neuma-auto-path-0-1-0"');
  });
});
