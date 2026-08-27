import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRunTreeStore } from '@/shared/stores/run-tree-store';

const originalFetch = globalThis.fetch;

const REQUEST_TIMEOUT_MS = 12_000;

function emptyTreePayload() {
  return {
    tree: [],
    rollup: {
      totalCostUsd: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      runCount: 0,
      runningCount: 0,
      failedCount: 0,
    },
    executions: [],
  };
}

/** A request that only settles when its own AbortSignal fires. */
function hangingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  useRunTreeStore.setState({ byTaskId: {}, byOwner: {} });
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('run-tree-store', () => {
  it('settles loading with an error when the request never gets a socket', async () => {
    vi.useFakeTimers();
    globalThis.fetch = hangingFetch();

    const pending = useRunTreeStore.getState().fetchOwner('video', 'stalled');
    expect(useRunTreeStore.getState().byOwner['video:stalled']?.loading).toBe(
      true,
    );

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await pending;

    const entry = useRunTreeStore.getState().byOwner['video:stalled'];
    // Before the timeout this stayed `loading: true` forever, which is what
    // pinned the panel on "Loading diagnostics…".
    expect(entry?.loading).toBe(false);
    expect(entry?.error).toBe('Request timed out');
  });

  it('does not strand a second caller when the first one goes away', async () => {
    let resolveRequest: (value: Response) => void = () => {};
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    ) as unknown as typeof fetch;

    const store = useRunTreeStore.getState();
    const first = store.fetchOwner('video', 'shared');
    const second = store.fetchOwner('video', 'shared');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    resolveRequest(Response.json(emptyTreePayload()));
    await Promise.all([first, second]);

    const entry = useRunTreeStore.getState().byOwner['video:shared'];
    expect(entry?.loading).toBe(false);
    expect(entry?.error).toBeNull();
  });

  it('reports an upstream failure instead of spinning', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('nope', { status: 502 }),
    ) as typeof fetch;

    await useRunTreeStore.getState().fetch('task-502');

    const entry = useRunTreeStore.getState().byTaskId['task-502'];
    expect(entry?.loading).toBe(false);
    expect(entry?.error).toBe('HTTP 502');
  });
});
