import { describe, expect, it } from 'vitest';

import { withProjectLock } from '@/shared/video/project-lock';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('withProjectLock', () => {
  it('serializes callbacks for the same project (mutual exclusion)', async () => {
    const events: string[] = [];
    const slow = withProjectLock('p1', async () => {
      events.push('a:start');
      await tick(20);
      events.push('a:end');
    });
    const fast = withProjectLock('p1', async () => {
      events.push('b:start');
      events.push('b:end');
    });
    await Promise.all([slow, fast]);
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('runs different projects concurrently', async () => {
    const events: string[] = [];
    await Promise.all([
      withProjectLock('a', async () => {
        events.push('a:start');
        await tick(20);
        events.push('a:end');
      }),
      withProjectLock('b', async () => {
        events.push('b:start');
        await tick(0);
        events.push('b:end');
      }),
    ]);
    // 'b' must not be blocked behind 'a'.
    expect(events.indexOf('b:end')).toBeLessThan(events.indexOf('a:end'));
  });

  it('propagates the callback result and error to the caller', async () => {
    await expect(withProjectLock('p1', async () => 42)).resolves.toBe(42);
    await expect(
      withProjectLock('p1', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('does not leak an unhandled rejection when the callback throws', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      await withProjectLock('lonely', async () => {
        throw new Error('boom inside lock');
      }).catch(() => {});
      // Let any stray bookkeeping rejection surface as a macrotask.
      await tick(20);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it('still serializes the next acquirer after the previous one throws', async () => {
    const events: string[] = [];
    const first = withProjectLock('p1', async () => {
      events.push('first');
      throw new Error('nope');
    }).catch(() => {});
    const second = withProjectLock('p1', async () => {
      events.push('second');
    });
    await Promise.all([first, second]);
    expect(events).toEqual(['first', 'second']);
  });
});
