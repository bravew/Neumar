import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAssetMaterializationEvents } from '@/shared/hooks/useAssetMaterializationEvents';

// Minimal EventSource stand-in: jsdom has no EventSource, so the hook would
// otherwise bail. Tracks instances so we can assert how many connections open.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  private listeners = new Map<string, Set<(e: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: string) {
    this.listeners
      .get(type)
      ?.forEach((fn) => fn(new MessageEvent(type, { data })));
  }
}

function progressEvent(assetId: string, percent: number) {
  return JSON.stringify({
    type: 'materialize.progress',
    assetId,
    scope: 'video_project',
    scopeId: 'p1',
    bytes: percent,
    total: 100,
    percent,
  });
}

describe('useAssetMaterializationEvents (behavior pin)', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens one connection per session and maps progress events to state', () => {
    const { result } = renderHook(() =>
      useAssetMaterializationEvents('sess-1'),
    );
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() =>
      FakeEventSource.instances[0]!.emit(
        'materialize.progress',
        progressEvent('a1', 50),
      ),
    );
    expect(result.current.a1?.status).toBe('progress');
    expect(result.current.a1?.percent).toBe(50);
  });

  it('closes the connection on unmount', () => {
    const { unmount } = renderHook(() =>
      useAssetMaterializationEvents('sess-1'),
    );
    const es = FakeEventSource.instances[0]!;
    expect(es.closed).toBe(false);
    unmount();
    expect(es.closed).toBe(true);
  });

  it('opens a single connection when two consumers share one session id', () => {
    renderHook(() => {
      useAssetMaterializationEvents('shared');
      useAssetMaterializationEvents('shared');
    });
    // The behavior we are about to introduce: same session id → one shared
    // connection. Pinned here so the refactor is proven against it.
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
