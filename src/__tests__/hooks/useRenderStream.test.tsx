import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRenderStream } from '@/shared/video/useRenderStream';

const sources: MockEventSource[] = [];

class MockEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  url: string;

  constructor(url: string) {
    this.url = url;
    sources.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(data: unknown, seq?: number) {
    this.onmessage?.({
      data: JSON.stringify(data),
      lastEventId: seq != null ? String(seq) : '',
    } as MessageEvent<string>);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  sources.length = 0;
});

describe('useRenderStream', () => {
  it('does not open a stream when disabled', () => {
    vi.stubGlobal('EventSource', MockEventSource);
    renderHook(() => useRenderStream('p1', false));
    expect(sources).toHaveLength(0);
  });

  it('tracks progress events and the latest sequence', () => {
    vi.stubGlobal('EventSource', MockEventSource);
    const { result } = renderHook(() => useRenderStream('p1', true));
    expect(sources).toHaveLength(1);

    act(() => sources[0].onopen?.());
    act(() =>
      sources[0].emit({ type: 'progress', status: 'running', progress: 35 }, 4),
    );

    expect(result.current.connected).toBe(true);
    expect(result.current.status).toBe('running');
    expect(result.current.progress).toBe(35);
    expect(result.current.lastSeq).toBe(4);
  });

  it('closes the stream on a terminal event so it does not reconnect', () => {
    vi.stubGlobal('EventSource', MockEventSource);
    const { result } = renderHook(() => useRenderStream('p1', true));

    act(() =>
      sources[0].emit({ type: 'done', status: 'done', progress: 100 }, 9),
    );

    expect(sources[0].closed).toBe(true);
    expect(result.current.status).toBe('done');
    expect(result.current.connected).toBe(false);
  });

  it('closes the stream on unmount', () => {
    vi.stubGlobal('EventSource', MockEventSource);
    const { unmount } = renderHook(() => useRenderStream('p1', true));
    unmount();
    expect(sources[0].closed).toBe(true);
  });
});
