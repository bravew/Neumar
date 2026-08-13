import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  FFMPEG_MAX_CONCURRENT_RENDERS,
  getMemoryBudgetSupervisor,
} from '@/shared/services/memory-budget';

describe('memory budget supervisor', () => {
  beforeEach(() => {
    getMemoryBudgetSupervisor().resetForTests();
  });

  afterEach(() => {
    getMemoryBudgetSupervisor().resetForTests();
  });

  it('caps concurrent FFmpeg operations and queues overflow', async () => {
    const supervisor = getMemoryBudgetSupervisor();
    const first = deferred<void>();
    const second = deferred<void>();
    const third = deferred<void>();
    const started: string[] = [];

    const firstRun = supervisor.runWithFfmpegSlot(async () => {
      started.push('first');
      await first.promise;
      return 'first';
    });
    const secondRun = supervisor.runWithFfmpegSlot(async () => {
      started.push('second');
      await second.promise;
      return 'second';
    });
    const thirdRun = supervisor.runWithFfmpegSlot(async () => {
      started.push('third');
      await third.promise;
      return 'third';
    });

    await flushMicrotasks();

    expect(started).toEqual(['first', 'second']);
    expect(supervisor.getStatus()).toMatchObject({
      activeFfmpegRenders: FFMPEG_MAX_CONCURRENT_RENDERS,
      queuedFfmpegRenders: 1,
    });

    first.resolve();
    await expect(firstRun).resolves.toBe('first');
    await flushMicrotasks();

    expect(started).toEqual(['first', 'second', 'third']);
    expect(supervisor.getStatus()).toMatchObject({
      activeFfmpegRenders: FFMPEG_MAX_CONCURRENT_RENDERS,
      queuedFfmpegRenders: 0,
    });

    second.resolve();
    third.resolve();
    await expect(Promise.all([secondRun, thirdRun])).resolves.toEqual([
      'second',
      'third',
    ]);
    expect(supervisor.getStatus()).toMatchObject({
      activeFfmpegRenders: 0,
      queuedFfmpegRenders: 0,
    });
  });

  it('removes aborted FFmpeg operations from the queue', async () => {
    const supervisor = getMemoryBudgetSupervisor();
    const first = deferred<void>();
    const second = deferred<void>();
    const controller = new AbortController();

    const firstRun = supervisor.runWithFfmpegSlot(async () => first.promise);
    const secondRun = supervisor.runWithFfmpegSlot(async () => second.promise);
    const queuedRun = supervisor.runWithFfmpegSlot(
      async () => undefined,
      controller.signal,
    );

    await flushMicrotasks();
    expect(supervisor.getStatus().queuedFfmpegRenders).toBe(1);

    controller.abort();
    await expect(queuedRun).rejects.toThrow('FFmpeg render was aborted');
    expect(supervisor.getStatus()).toMatchObject({
      activeFfmpegRenders: FFMPEG_MAX_CONCURRENT_RENDERS,
      queuedFfmpegRenders: 0,
    });

    first.resolve();
    second.resolve();
    await Promise.all([firstRun, secondRun]);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
