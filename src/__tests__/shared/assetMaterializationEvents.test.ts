import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ASSET_MATERIALIZATION_NOTICE_TTL_MS,
  acquireAssetMaterializationLease,
} from '@/shared/assets/materializationLease';
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
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens one connection per session and maps progress events to state', () => {
    const { result } = renderHook(() =>
      useAssetMaterializationEvents('sess-1', { enabled: true }),
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
      useAssetMaterializationEvents('sess-2', { enabled: true }),
    );
    const es = FakeEventSource.instances[0]!;
    expect(es.closed).toBe(false);
    unmount();
    expect(es.closed).toBe(true);
  });

  it('opens a single connection when two consumers share one session id', () => {
    renderHook(() => {
      useAssetMaterializationEvents('shared', { enabled: true });
      useAssetMaterializationEvents('shared', { enabled: true });
    });
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('owns no connection for an idle session', () => {
    renderHook(() => useAssetMaterializationEvents('idle-session'));
    // The starvation bug: an idle editor tab held one of the browser's ~6
    // per-host sockets, so the native picker POST never got one.
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('opens on lease acquire and closes only after the grace window', () => {
    vi.useFakeTimers();
    renderHook(() => useAssetMaterializationEvents('leased-session'));
    expect(FakeEventSource.instances).toHaveLength(0);

    let release = () => {};
    act(() => {
      release = acquireAssetMaterializationLease('leased-session');
    });
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => release());
    // Proxy/artifact events arrive after the attach request has resolved, so
    // the stream has to outlive the operation that opened it.
    expect(FakeEventSource.instances[0]!.closed).toBe(false);

    act(() => {
      vi.advanceTimersByTime(ASSET_MATERIALIZATION_NOTICE_TTL_MS);
    });
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });

  it('keeps the stream while a second holder still has the lease', () => {
    vi.useFakeTimers();
    renderHook(() => useAssetMaterializationEvents('two-holders'));

    let releaseFirst = () => {};
    let releaseSecond = () => {};
    act(() => {
      releaseFirst = acquireAssetMaterializationLease('two-holders');
      releaseSecond = acquireAssetMaterializationLease('two-holders');
    });
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => {
      releaseFirst();
      vi.advanceTimersByTime(ASSET_MATERIALIZATION_NOTICE_TTL_MS * 2);
    });
    expect(FakeEventSource.instances[0]!.closed).toBe(false);

    act(() => {
      releaseSecond();
      vi.advanceTimersByTime(ASSET_MATERIALIZATION_NOTICE_TTL_MS);
    });
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });
});
