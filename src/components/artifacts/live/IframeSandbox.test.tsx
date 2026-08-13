import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IframeSandbox } from './IframeSandbox';

describe('IframeSandbox shell readiness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waits for shell:ready before posting palette requests', () => {
    render(
      <IframeSandbox
        srcdoc="<!doctype html><html><body></body></html>"
        nonce="ready-nonce"
        identity="ready-frame"
        paletteRequest={{ type: 'palette/reset' }}
      />,
    );

    const iframe = screen.getByTitle('live artifact') as HTMLIFrameElement;
    const frameWindow = iframe.contentWindow as Window;
    const postMessage = vi.spyOn(frameWindow, 'postMessage');

    expect(postMessage).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { nonce: 'ready-nonce', type: 'shell:ready' },
          source: frameWindow,
        }),
      );
    });

    expect(postMessage).toHaveBeenCalledWith(
      { nonce: 'ready-nonce', type: 'palette/reset' },
      '*',
    );
  });

  it('pins the iframe to fixedHeight and ignores content resize (device preview)', () => {
    render(
      <IframeSandbox
        srcdoc="<!doctype html><html><body></body></html>"
        nonce="fixed-nonce"
        identity="fixed-frame"
        fixedHeight={844}
      />,
    );

    const iframe = screen.getByTitle('live artifact') as HTMLIFrameElement;
    expect(iframe.style.height).toBe('844px');
    expect(iframe.getAttribute('scrolling')).toBe('auto');

    // A collapsed content-resize message (the bug's trigger) must not shrink it.
    const frameWindow = iframe.contentWindow as Window;
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { nonce: 'fixed-nonce', type: 'resize', height: 150 },
          source: frameWindow,
        }),
      );
    });
    expect(iframe.style.height).toBe('844px');
  });

  it('auto-fits height to content resize when no fixedHeight is set', () => {
    render(
      <IframeSandbox
        srcdoc="<!doctype html><html><body></body></html>"
        nonce="auto-nonce"
        identity="auto-frame"
      />,
    );

    const iframe = screen.getByTitle('live artifact') as HTMLIFrameElement;
    expect(iframe.getAttribute('scrolling')).toBe('no');
    const frameWindow = iframe.contentWindow as Window;
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { nonce: 'auto-nonce', type: 'resize', height: 512 },
          source: frameWindow,
        }),
      );
    });
    expect(iframe.style.height).toBe('512px');
  });

  it('falls back after the watchdog instead of freezing bridge updates', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <IframeSandbox
        srcdoc="<!doctype html><html><body></body></html>"
        nonce="watchdog-nonce"
        identity="watchdog-frame"
        inspectPatch={{ id: 'hero', prop: 'color', value: 'red' }}
      />,
    );

    const iframe = screen.getByTitle('live artifact') as HTMLIFrameElement;
    const frameWindow = iframe.contentWindow as Window;
    const postMessage = vi.spyOn(frameWindow, 'postMessage');

    expect(postMessage).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(warn).toHaveBeenCalledWith('[LiveArtifact] shell_ready_timeout', {
      degraded: true,
      watchdogMs: 2000,
    });
    expect(postMessage).toHaveBeenCalledWith(
      {
        nonce: 'watchdog-nonce',
        type: 'neuma-inspect-style',
        patch: { id: 'hero', prop: 'color', value: 'red' },
      },
      '*',
    );
  });
});
