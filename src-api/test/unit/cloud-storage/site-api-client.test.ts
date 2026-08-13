import { describe, expect, it, vi } from 'vitest';

import { SiteApiClient } from '@/shared/auth/site-api-client';
import { CloudStorageError } from '@/shared/integrations/cloud-storage/errors';

const session = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1777910400,
  userId: 'user-1',
  userEmail: 'user@example.com',
  userName: 'User',
  userAvatar: '',
};

describe('SiteApiClient', () => {
  it('injects auth and desktop headers', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true }));
    const client = new SiteApiClient({
      fetchFn: fetchFn as typeof fetch,
      sessionProvider: async () => session,
    });

    await client.getJson('/api/cloud-storage/connections');

    expect(fetchFn).toHaveBeenCalledWith(
      'https://neumar.app/api/cloud-storage/connections',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-1',
          'X-Neuma-Client': 'desktop',
        }),
      }),
    );
  });

  it('refreshes once on 401', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'auth_revoked' }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const refreshProvider = vi.fn(async () => ({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresAt: Date.now() + 3600,
      tokenType: 'bearer' as const,
      scopes: [],
    }));
    const client = new SiteApiClient({
      fetchFn: fetchFn as typeof fetch,
      sessionProvider: async () => session,
      refreshProvider,
    });

    await expect(
      client.getJson('/api/cloud-storage/connections'),
    ).resolves.toEqual({ ok: true });
    expect(refreshProvider).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('surfaces auth_revoked after a failed refresh', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: 'auth_revoked' }, 401),
    );
    const client = new SiteApiClient({
      fetchFn: fetchFn as typeof fetch,
      sessionProvider: async () => session,
      refreshProvider: async () => null,
    });

    await expect(
      client.getJson('/api/cloud-storage/connections'),
    ).rejects.toMatchObject({ code: 'auth_revoked' });
  });

  it('retries 429 once using Retry-After', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: 'rate_limited' }, 429, { 'Retry-After': '0' }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new SiteApiClient({
      fetchFn: fetchFn as typeof fetch,
      sessionProvider: async () => session,
      maxRetryAfterMs: 0,
    });

    await expect(
      client.getJson('/api/cloud-storage/connections'),
    ).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('plumbs caller abort signals', async () => {
    const fetchFn = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const client = new SiteApiClient({
      fetchFn: fetchFn as typeof fetch,
      sessionProvider: async () => session,
    });
    const controller = new AbortController();
    const request = client.getJson('/api/cloud-storage/connections', {
      signal: controller.signal,
    });

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects poisoned site URLs before fetch', async () => {
    process.env.SITE_URL = 'http://10.0.0.1';
    const fetchFn = vi.fn();
    const client = new SiteApiClient({
      fetchFn: fetchFn as typeof fetch,
      sessionProvider: async () => session,
    });

    await expect(
      client.getJson('/api/cloud-storage/connections'),
    ).rejects.toBeInstanceOf(CloudStorageError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
