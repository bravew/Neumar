import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSiteSession } from '@/shared/auth/site-auth';
import {
  bootstrapCloudStorageConnectionsCache,
  CloudStorageError,
} from '@/shared/integrations/cloud-storage';
import {
  markCachedConnectionsNeedsReauth,
  upsertCachedConnections,
} from '@/shared/integrations/cloud-storage/cache';

vi.mock('@/shared/auth/site-auth', () => ({
  getSiteSession: vi.fn(),
}));

vi.mock('@/shared/integrations/cloud-storage/cache', () => ({
  markCachedConnectionsNeedsReauth: vi.fn(),
  upsertCachedConnections: vi.fn(),
}));

const mockedGetSiteSession = vi.mocked(getSiteSession);
const mockedUpsert = vi.mocked(upsertCachedConnections);
const mockedMarkNeedsReauth = vi.mocked(markCachedConnectionsNeedsReauth);

describe('cloud storage bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetSiteSession.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1777910400,
      userId: 'user-1',
      userEmail: 'user@example.com',
      userName: 'User',
      userAvatar: '',
    });
  });

  it('populates the local connection cache from the site', async () => {
    const client = {
      getJson: vi.fn(async () => ({
        connections: [
          {
            id: 'conn-1',
            provider: 'google_drive',
            status: 'active',
          },
          {
            id: 'conn-2',
            provider: 'dropbox',
            status: 'active',
          },
        ],
      })),
    };

    await bootstrapCloudStorageConnectionsCache(client as never);

    expect(client.getJson).toHaveBeenCalledWith(
      '/api/cloud-storage/connections',
    );
    expect(mockedUpsert).toHaveBeenCalledWith([
      { id: 'conn-1', provider: 'google_drive', status: 'active' },
      { id: 'conn-2', provider: 'dropbox', status: 'active' },
    ]);
  });

  it('marks cached connections for reauth when site auth is revoked', async () => {
    const client = {
      getJson: vi.fn(async () => {
        throw new CloudStorageError('auth_revoked');
      }),
    };

    await bootstrapCloudStorageConnectionsCache(client as never);

    expect(mockedMarkNeedsReauth).toHaveBeenCalledTimes(1);
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it('preserves cache when the site is unreachable', async () => {
    const client = {
      getJson: vi.fn(async () => {
        throw new CloudStorageError('site_unreachable');
      }),
    };

    await bootstrapCloudStorageConnectionsCache(client as never);

    expect(mockedMarkNeedsReauth).not.toHaveBeenCalled();
    expect(mockedUpsert).not.toHaveBeenCalled();
  });
});
