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

  it('runs a nested acquisition inline instead of deadlocking', async () => {
    // updateProjectDocument() takes this lock, and route handlers take it too.
    // A plain queue would wait here on a promise that cannot settle until the
    // outer holder returns.
    const events: string[] = [];

    await withProjectLock('p1', async () => {
      events.push('outer:start');
      await withProjectLock('p1', async () => {
        events.push('inner');
      });
      events.push('outer:end');
    });

    expect(events).toEqual(['outer:start', 'inner', 'outer:end']);
  });

  it('still excludes a separate caller while a nested section runs', async () => {
    const events: string[] = [];

    const held = withProjectLock('p1', async () => {
      events.push('outer:start');
      await withProjectLock('p1', async () => {
        await tick(20);
        events.push('inner');
      });
      events.push('outer:end');
    });
    const other = withProjectLock('p1', async () => {
      events.push('other');
    });

    await Promise.all([held, other]);
    expect(events).toEqual(['outer:start', 'inner', 'outer:end', 'other']);
  });

  it('does not treat a different project as held by an outer section', async () => {
    const events: string[] = [];

    await withProjectLock('p1', async () => {
      const blocker = withProjectLock('p2', async () => {
        await tick(20);
        events.push('p2:first');
      });
      const follower = withProjectLock('p2', async () => {
        events.push('p2:second');
      });
      await Promise.all([blocker, follower]);
    });

    // p2 is a different document, so it queues normally rather than inheriting
    // the p1 holder's re-entrancy.
    expect(events).toEqual(['p2:first', 'p2:second']);
  });
});
