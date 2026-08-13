import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { subscribeSharedEventSource } from '@/shared/lib/shared-event-source';

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

describe('subscribeSharedEventSource', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens one connection for multiple subscribers of the same url', () => {
    const off1 = subscribeSharedEventSource('u1', ['x'], () => {});
    const off2 = subscribeSharedEventSource('u1', ['x'], () => {});
    expect(FakeEventSource.instances).toHaveLength(1);
    off1();
    off2();
  });

  it('delivers each event to every subscriber', () => {
    const a: string[] = [];
    const b: string[] = [];
    const off1 = subscribeSharedEventSource('u2', ['x'], (_n, m) =>
      a.push(m.data),
    );
    const off2 = subscribeSharedEventSource('u2', ['x'], (_n, m) =>
      b.push(m.data),
    );
    FakeEventSource.instances[0]!.emit('x', 'hello');
    expect(a).toEqual(['hello']);
    expect(b).toEqual(['hello']);
    off1();
    off2();
  });

  it('keeps the connection until the last subscriber releases', () => {
    const off1 = subscribeSharedEventSource('u3', ['x'], () => {});
    const off2 = subscribeSharedEventSource('u3', ['x'], () => {});
    const es = FakeEventSource.instances[0]!;
    off1();
    expect(es.closed).toBe(false);
    off2();
    expect(es.closed).toBe(true);
  });

  it('opens distinct connections for distinct urls', () => {
    const off1 = subscribeSharedEventSource('a', ['x'], () => {});
    const off2 = subscribeSharedEventSource('b', ['x'], () => {});
    expect(FakeEventSource.instances).toHaveLength(2);
    off1();
    off2();
  });

  it('reopens after the pool entry was fully released', () => {
    subscribeSharedEventSource('reopen', ['x'], () => {})();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    const off = subscribeSharedEventSource('reopen', ['x'], () => {});
    expect(FakeEventSource.instances).toHaveLength(2);
    off();
  });
});
