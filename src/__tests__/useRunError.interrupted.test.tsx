import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRunError } from '@/shared/hooks/useRunError';

describe('useRunError interrupted-run recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stops a stale local run when the backend marked it as failed', async () => {
    vi.useFakeTimers();
    const abortRun = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          isRunning: false,
          taskStatus: 'error',
          messages: [
            { role: 'user', content: 'make a video' },
            { role: 'assistant', content: 'I created partial output' },
          ],
        }),
      }),
    );

    const { result } = renderHook(() =>
      useRunError(
        'task-1',
        {
          messages: [{ role: 'user', content: 'make a video' }],
          isRunning: true,
          abortRun,
        },
        'Agent run failed',
      ),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.runError).toBe('Agent run failed');
    expect(abortRun).toHaveBeenCalledOnce();
  });
});
