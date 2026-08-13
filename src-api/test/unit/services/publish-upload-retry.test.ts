import { describe, expect, it, vi } from 'vitest';

import {
  classifyHttpStatus,
  withRetry,
} from '@/shared/services/publish/retry-policy';

describe('publish upload retry policy', () => {
  it('backs off transient failures and respects retry-after', async () => {
    const sleep = vi.fn(async () => undefined);
    const task = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate'), { status: 429 }))
      .mockResolvedValueOnce('ok');

    await expect(
      withRetry(task, {
        sleep,
        classifier: (error) =>
          classifyHttpStatus((error as { status: number }).status, '2'),
      }),
    ).resolves.toBe('ok');

    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('does not retry terminal auth failures', async () => {
    const sleep = vi.fn(async () => undefined);
    await expect(
      withRetry(
        async () => {
          throw Object.assign(new Error('auth'), { status: 401 });
        },
        {
          sleep,
          classifier: (error) =>
            classifyHttpStatus((error as { status: number }).status),
        },
      ),
    ).rejects.toThrow('auth');
    expect(sleep).not.toHaveBeenCalled();
  });
});
