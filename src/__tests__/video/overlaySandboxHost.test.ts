import { compileOverlayDocument, vividOverlayDocument } from '@neumar/video-ir';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOverlaySandboxHost } from '@/shared/video/overlays/html/sandboxHost';

const compiled = compileOverlayDocument(
  vividOverlayDocument('marker-highlight')!,
).html;

function makeHost(overrides: Record<string, unknown> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const host = createOverlaySandboxHost({
    container,
    compiledHtml: compiled,
    instantiation: { controls: { text: 'Hi', color: '#fff', fontSize: 48 } },
    readyTimeoutMs: 500,
    seekTimeoutMs: 200,
    ...overrides,
  });
  return { container, host };
}

function emitFromIframe(iframe: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(
    new MessageEvent('message', { data, source: iframe.contentWindow }),
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createOverlaySandboxHost', () => {
  it('mounts a strict sandboxed iframe with the instantiated document', () => {
    const { container, host } = makeHost();
    expect(host.iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(host.iframe.style.pointerEvents).toBe('none');
    expect(host.iframe.srcdoc).toContain('window.__overlayParams');
    expect(host.iframe.srcdoc).toContain('__neumaOverlaySeek');
    expect(host.iframe.srcdoc).toContain('"text":"Hi"');
    expect(container.contains(host.iframe)).toBe(true);
    host.dispose();
  });

  it('grants same-origin only to trusted (built-in) documents', () => {
    const { host } = makeHost({ trusted: true });
    expect(host.iframe.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin',
    );
    host.dispose();
  });

  it('resolves ready on the document announcement and acks seeks by seq', async () => {
    const { host } = makeHost();
    emitFromIframe(host.iframe, { type: 'neuma-overlay-ready' });
    await expect(host.ready).resolves.toBeUndefined();

    const seekPromise = host.seek(500);
    await host.ready;
    // ack from an unrelated window must be ignored
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'neuma-overlay-seeked', seq: 1, tMs: 500 },
        source: window,
      }),
    );
    emitFromIframe(host.iframe, {
      type: 'neuma-overlay-seeked',
      seq: 1,
      tMs: 500,
    });
    await expect(seekPromise).resolves.toBeUndefined();
    host.dispose();
  });

  it('targets trusted seek messages to the current origin', async () => {
    const { host } = makeHost({ trusted: true });
    emitFromIframe(host.iframe, { type: 'neuma-overlay-ready' });
    await host.ready;
    const postMessage = vi.spyOn(host.iframe.contentWindow!, 'postMessage');

    const seekPromise = host.seek(125);
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'neuma-overlay-seek', tMs: 125, seq: 1 },
      window.location.origin,
    );
    emitFromIframe(host.iframe, {
      type: 'neuma-overlay-seeked',
      seq: 1,
      tMs: 125,
    });
    await expect(seekPromise).resolves.toBeUndefined();
    host.dispose();
  });

  it('rejects a seek that never gets acked', async () => {
    const { host } = makeHost({ seekTimeoutMs: 50 });
    emitFromIframe(host.iframe, { type: 'neuma-overlay-ready' });
    await host.ready;
    await expect(host.seek(1000)).rejects.toThrow(/timed out/);
    host.dispose();
  });

  it('dispose removes the iframe and rejects in-flight seeks', async () => {
    const { container, host } = makeHost();
    emitFromIframe(host.iframe, { type: 'neuma-overlay-ready' });
    await host.ready;
    const inFlight = host.seek(250);
    host.dispose();
    await expect(inFlight).rejects.toThrow(/disposed/);
    expect(container.contains(host.iframe)).toBe(false);
    await expect(host.seek(1)).rejects.toThrow(/disposed/);
  });
});
