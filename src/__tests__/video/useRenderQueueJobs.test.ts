import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRenderQueueJobs } from '@/components/video/useRenderQueueJobs';
import type { VideoJob } from '@/shared/types/video';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useRenderQueueJobs', () => {
  it('loads only valid render queue jobs', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        jobs: [jobFixture({ id: 'valid' }), { id: 'invalid' }],
      }),
    ) as typeof fetch;

    const { result } = renderHook(() =>
      useRenderQueueJobs('project-1', { pollIntervalMs: 0 }),
    );

    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    expect(result.current.jobs[0]?.id).toBe('valid');
  });

  it('falls back to an empty queue for malformed responses', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ jobs: { bad: true } }),
    ) as typeof fetch;

    const { result } = renderHook(() =>
      useRenderQueueJobs('project-1', { pollIntervalMs: 0 }),
    );

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(result.current.jobs).toEqual([]);
  });

  it('does not fetch when disabled', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() =>
      useRenderQueueJobs('project-1', { enabled: false }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.jobs).toEqual([]);
  });

  it('reloads the current queue on demand', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ jobs: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ jobs: [jobFixture({ id: 'after-reload' })] }),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() =>
      useRenderQueueJobs('project-1', { pollIntervalMs: 0 }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.jobs[0]?.id).toBe('after-reload');
  });

  it('polls and aborts the in-flight request on cleanup', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    globalThis.fetch = vi.fn(async (_input, init) => {
      if (init?.signal) signals.push(init.signal);
      return jsonResponse({ jobs: [jobFixture()] });
    }) as typeof fetch;

    const { unmount } = renderHook(() =>
      useRenderQueueJobs('project-1', { pollIntervalMs: 1000 }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    unmount();
    expect(signals[0]?.aborted).toBe(true);
  });
});

function jobFixture(overrides: Partial<VideoJob> = {}): VideoJob {
  return {
    id: 'job-1',
    projectId: 'project-1',
    kind: 'render',
    status: 'running',
    payload: { aspectRatios: ['16:9'] },
    caller: 'in-app',
    ...overrides,
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
