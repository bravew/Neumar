import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({
  API_BASE_URL: 'http://localhost:5126',
}));

const mockQueueState = {
  running: 1,
  maxConcurrent: 3,
  queued: 2,
  runningTaskIds: ['task-1'],
};

describe('useQueueStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: mockQueueState }),
    });
  });

  it('returns loading state initially', async () => {
    const { useQueueStatus } = await import('@/shared/hooks/useQueueStatus');
    const { result } = renderHook(() => useQueueStatus());
    expect(result.current.loading).toBe(true);
  });

  it('fetches queue state and derives canAccept', async () => {
    const { useQueueStatus } = await import('@/shared/hooks/useQueueStatus');
    const { result } = renderHook(() => useQueueStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state).toEqual(mockQueueState);
    expect(result.current.canAccept).toBe(true); // 1 < 3
  });

  it('passes profileId as query param', async () => {
    const { useQueueStatus } = await import('@/shared/hooks/useQueueStatus');
    renderHook(() => useQueueStatus('profile-abc'));

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('profileId=profile-abc'),
        expect.anything(),
      ),
    );
  });

  it('canAccept is false when at capacity', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { running: 3, maxConcurrent: 3, queued: 0, runningTaskIds: [] },
        }),
    });

    const { useQueueStatus } = await import('@/shared/hooks/useQueueStatus');
    const { result } = renderHook(() => useQueueStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canAccept).toBe(false);
  });

  it('polls at the configured interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { useQueueStatus } = await import('@/shared/hooks/useQueueStatus');
    const { result } = renderHook(() => useQueueStatus());

    // Let initial fetch resolve
    await vi.advanceTimersByTimeAsync(100);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const initialCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls.length;

    // Advance past poll interval (5s)
    await act(() => vi.advanceTimersByTimeAsync(5_100));
    expect(globalThis.fetch).toHaveBeenCalledTimes(initialCalls + 1);
  });

  it('cleans up on unmount without errors', async () => {
    const { useQueueStatus } = await import('@/shared/hooks/useQueueStatus');
    const { unmount } = renderHook(() => useQueueStatus());
    unmount(); // should not throw or update state post-unmount
  });
});

describe('useGlobalQueueStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            totalRunning: 2,
            totalQueued: 1,
            perProfile: { 'profile-1': { running: 2, queued: 1, max: 3 } },
          },
        }),
    });
  });

  it('fetches global stats', async () => {
    const { useGlobalQueueStats } =
      await import('@/shared/hooks/useQueueStatus');
    const { result } = renderHook(() => useGlobalQueueStats());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stats?.totalRunning).toBe(2);
    expect(result.current.stats?.totalQueued).toBe(1);
  });
});
