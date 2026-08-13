import { describe, expect, it, vi } from 'vitest';

import { ProjectCoverDiscoveryPool } from '@/components/design/project-cover-pool';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('ProjectCoverDiscoveryPool', () => {
  it('starts at most six unresolved requests', async () => {
    const pool = new ProjectCoverDiscoveryPool(6);
    const work = Array.from({ length: 12 }, () => deferred<number>());
    const started: number[] = [];
    const promises = work.map((item, index) =>
      pool.schedule(new AbortController().signal, () => {
        started.push(index);
        return item.promise;
      }),
    );
    await flushMicrotasks();
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pool.activeCount).toBe(6);

    work[0]!.resolve(0);
    await promises[0];
    await flushMicrotasks();
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('retains a started slot after abort until the work settles', async () => {
    const pool = new ProjectCoverDiscoveryPool(1);
    const first = deferred<void>();
    const controller = new AbortController();
    const firstPromise = pool.schedule(controller.signal, () => first.promise);
    await flushMicrotasks();
    controller.abort();

    const second = vi.fn(async () => undefined);
    void pool.schedule(new AbortController().signal, second);
    await flushMicrotasks();
    expect(second).not.toHaveBeenCalled();
    expect(pool.activeCount).toBe(1);

    first.resolve();
    await firstPromise;
    await flushMicrotasks();
    expect(second).toHaveBeenCalledOnce();
  });

  it('pumps on a microtask so a torn-down queued sibling never starts', async () => {
    const pool = new ProjectCoverDiscoveryPool(1);
    const first = deferred<void>();
    const firstPromise = pool.schedule(
      new AbortController().signal,
      () => first.promise,
    );
    const tornDownController = new AbortController();
    const tornDown = vi.fn(async () => undefined);
    void pool.schedule(tornDownController.signal, tornDown).catch(() => {});
    await flushMicrotasks();

    first.resolve();
    tornDownController.abort();
    await firstPromise;
    await flushMicrotasks();
    expect(tornDown).not.toHaveBeenCalled();
  });
});
