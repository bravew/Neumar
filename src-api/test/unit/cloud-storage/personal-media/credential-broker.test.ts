import { describe, expect, it, vi } from 'vitest';

import { PersonalMediaCredentialBroker } from '@/shared/integrations/cloud-storage/providers/personal-media-credential-broker';

describe('PersonalMediaCredentialBroker', () => {
  it('resolves and caches short-lived personal media credentials in memory', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const getJson = vi.fn(async () => ({
      handle: 'handle-1',
      expiresAt,
    }));
    const postJson = vi.fn(async () => ({
      expiresAt,
      credential: {
        credentialId: 'cred-1',
        provider: 'immich',
        baseUrl: 'http://192.168.1.20:2283',
        apiKey: 'secret',
        serverVersion: '1.132.0',
        serverInstanceId: 'server-1',
      },
    }));
    const broker = new PersonalMediaCredentialBroker({
      getJson,
      postJson,
    } as never);

    await expect(broker.resolve('conn-1')).resolves.toMatchObject({
      credentialId: 'cred-1',
      provider: 'immich',
      baseUrl: 'http://192.168.1.20:2283',
      apiKey: 'secret',
      serverInstanceId: 'server-1',
      expiresAt,
    });
    await broker.resolve('conn-1');

    expect(getJson).toHaveBeenCalledTimes(1);
    expect(getJson).toHaveBeenCalledWith(
      '/api/cloud-storage/connections/conn-1/credential-handle',
    );
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson).toHaveBeenCalledWith(
      '/api/cloud-storage/connections/conn-1/credential-handle',
      { handle: 'handle-1' },
    );
  });

  it('rejects blocked credential handle base URLs', async () => {
    const getJson = vi.fn(async () => ({
      handle: 'handle-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    const postJson = vi.fn(async () => ({
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      credential: {
        credentialId: 'cred-1',
        provider: 'immich',
        baseUrl: 'http://169.254.169.254/latest',
        apiKey: 'secret',
      },
    }));
    const broker = new PersonalMediaCredentialBroker({
      getJson,
      postJson,
    } as never);

    await expect(broker.resolve('conn-1')).rejects.toMatchObject({
      code: 'permission_denied',
    });
  });

  it('refetches when the cached handle is near expiry', async () => {
    const getJson = vi
      .fn()
      .mockResolvedValueOnce({
        handle: 'handle-1',
        expiresAt: new Date(Date.now() + 1_000).toISOString(),
      })
      .mockResolvedValueOnce({
        handle: 'handle-2',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
    const postJson = vi
      .fn()
      .mockResolvedValueOnce({
        expiresAt: new Date(Date.now() + 1_000).toISOString(),
        credential: credential('old-secret'),
      })
      .mockResolvedValueOnce({
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        credential: credential('new-secret'),
      });
    const broker = new PersonalMediaCredentialBroker({
      getJson,
      postJson,
    } as never);

    expect((await broker.resolve('conn-1')).apiKey).toBe('old-secret');
    expect((await broker.resolve('conn-1')).apiKey).toBe('new-secret');
    expect(getJson).toHaveBeenCalledTimes(2);
    expect(postJson).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid handle issuance responses', async () => {
    const broker = new PersonalMediaCredentialBroker({
      getJson: vi.fn(async () => ({
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })),
      postJson: vi.fn(),
    } as never);

    await expect(broker.resolve('conn-1')).rejects.toMatchObject({
      code: 'transient_upstream',
    });
  });
});

function credential(apiKey: string) {
  return {
    credentialId: 'cred-1',
    provider: 'immich',
    baseUrl: 'http://192.168.1.20:2283',
    apiKey,
  };
}
