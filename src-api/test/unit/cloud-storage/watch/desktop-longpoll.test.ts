import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/integrations/cloud-storage/registry', () => ({
  cloudStorageRegistry: {
    resolve: vi.fn(),
  },
}));

import { cloudStorageRegistry } from '@/shared/integrations/cloud-storage/registry';
import { runDesktopLongpollOnce } from '@/shared/integrations/cloud-storage/watch';

describe('desktop cloud storage longpoll fallback', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sleeps when the site reports webhook wakeups', async () => {
    await expect(
      runDesktopLongpollOnce({
        id: 'conn-1',
        provider: 'google_drive',
        wakeupMode: 'webhook',
      }),
    ).resolves.toBe('slept');
    expect(cloudStorageRegistry.resolve).not.toHaveBeenCalled();
  });

  it('polls adapter changes for longpoll mode', async () => {
    const getChanges = vi.fn(async () => ({ changes: [], hasMore: false }));
    vi.mocked(cloudStorageRegistry.resolve).mockReturnValue({
      getChanges,
    } as never);

    await expect(
      runDesktopLongpollOnce({
        id: 'conn-1',
        provider: 'dropbox',
        wakeupMode: 'longpoll',
        cursor: 'cursor-1',
      }),
    ).resolves.toBe('polled');
    expect(getChanges).toHaveBeenCalledWith({ cursor: 'cursor-1' });
  });
});
