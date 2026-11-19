import { describe, expect, it } from 'vitest';

import { PausableSource } from '@/shared/services/ag-ui/pausable-source';

/** A source whose next value is released by the test. */
function gatedSource() {
  const gates: Array<() => void> = [];
  let closed = false;
  async function* generate() {
    try {
      for (const value of [1, 2, 3]) {
        await new Promise<void>((resolve) => gates.push(resolve));
        yield value;
      }
    } finally {
      closed = true;
    }
  }
  return {
    source: new PausableSource(generate()),
    release: () => gates.shift()?.(),
    isClosed: () => closed,
  };
}

describe('PausableSource', () => {
  it('shares one pull until it is settled', async () => {
    const { source, release } = gatedSource();

    const a = source.pull();
    const b = source.pull();
    release();

    expect(await a).toEqual({ value: 1, done: false });
    expect(await b).toEqual({ value: 1, done: false });
  });

  it('hands a pull that was abandoned to the next reader, without losing it', async () => {
    const { source, release } = gatedSource();

    // The first reader starts a pull, then stops reading before it settles.
    source.pull();
    release();
    const second = await source.pull();
    source.settle();
    const third = source.pull();
    release();

    expect(second).toEqual({ value: 1, done: false });
    expect(await third).toEqual({ value: 2, done: false });
  });

  it('does not report an abandoned pull that later fails as unhandled', async () => {
    async function* failing(): AsyncGenerator<number> {
      yield await Promise.reject(new Error('agent crashed'));
    }
    const source = new PausableSource(failing());

    source.pull();
    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(source.pull()).rejects.toThrow('agent crashed');
  });

  it('closes without waiting for a pull that is still blocked', async () => {
    const { source, isClosed } = gatedSource();
    source.pull();

    source.close();

    expect(isClosed()).toBe(false);
  });
});
