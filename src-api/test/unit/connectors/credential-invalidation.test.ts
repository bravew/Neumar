import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ComposioProvider,
  MemoryComposioConfigStore,
} from '@/shared/connectors/providers/composio';
import {
  __resetCredentialCacheForTests,
  getCachedAccessToken,
  setCachedAccessToken,
} from '@/shared/connectors/providers/composio/credentials-cache';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Composio credential invalidation', () => {
  beforeEach(() => {
    __resetCredentialCacheForTests();
  });

  it('disconnect() clears the cached access token for the connector', async () => {
    const config = new MemoryComposioConfigStore();
    config.setApiKey('cmp_key');
    config.setAuthConfigId('box', 'auth_box');
    config.setConnectedAccount('desktop:local', 'box', {
      id: 'ca_box_1',
      label: 'box@example.com',
      userId: 'user_1',
      authConfigId: 'auth_box',
      connectedAt: new Date().toISOString(),
    });

    // Pre-seed the cache as if a recent first-party request stored a token.
    setCachedAccessToken('ca_box_1', 'live-token', 600);
    expect(getCachedAccessToken('ca_box_1')).toBe('live-token');

    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const provider = new ComposioProvider({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.disconnect('box');

    expect(getCachedAccessToken('ca_box_1')).toBeNull();
    // Composio DELETE on the connected account should have been called.
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('setApiKey() wipes every cached token regardless of connector', () => {
    setCachedAccessToken('ca_a', 'tok-a', 600);
    setCachedAccessToken('ca_b', 'tok-b', 600);

    const provider = new ComposioProvider({
      config: new MemoryComposioConfigStore(),
    });
    provider.setApiKey('new_key_value');

    expect(getCachedAccessToken('ca_a')).toBeNull();
    expect(getCachedAccessToken('ca_b')).toBeNull();
  });

  it('tool auth expiry clears only the stale connected account', async () => {
    const config = new MemoryComposioConfigStore();
    config.setApiKey('cmp_key');
    config.setConnectedAccount('desktop:local', 'github', {
      id: 'ca_github_1',
      label: 'octo',
      userId: 'user_1',
      connectedAt: new Date().toISOString(),
    });
    config.setConnectedAccount('desktop:local', 'slack', {
      id: 'ca_slack_1',
      label: 'workspace',
      userId: 'user_1',
      connectedAt: new Date().toISOString(),
    });
    setCachedAccessToken('ca_github_1', 'stale-token', 600);

    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url =
        input instanceof Request
          ? new URL(input.url)
          : new URL(input.toString());
      if (url.pathname === '/api/v3.1/org/project/config') {
        return jsonResponse({ ok: true });
      }
      return jsonResponse(
        {
          successful: false,
          error: { message: 'Bad credentials. Please reconnect.' },
        },
        200,
      );
    });
    const provider = new ComposioProvider({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      provider.executeTool({
        connectorId: 'github',
        toolName: 'github.github_search_repositories',
        connectedAccountId: 'ca_github_1',
        userId: 'user_1',
        input: {},
      }),
    ).rejects.toMatchObject({
      code: 'CONNECTOR_AUTH_EXPIRED',
      details: { connectorId: 'github', action: 'reconnect' },
    });

    expect(getCachedAccessToken('ca_github_1')).toBeNull();
    expect(config.getConnectedAccountIds()).toEqual({
      'desktop:local': {
        slack: expect.objectContaining({ id: 'ca_slack_1' }),
      },
    });
  });

  it('does not clear connector grants for platform-level Composio auth errors', async () => {
    const config = new MemoryComposioConfigStore();
    config.setApiKey('cmp_key');
    config.setConnectedAccount('desktop:local', 'github', {
      id: 'ca_github_1',
      label: 'octo',
      userId: 'user_1',
      connectedAt: new Date().toISOString(),
    });
    setCachedAccessToken('ca_github_1', 'still-valid', 600);

    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url =
        input instanceof Request
          ? new URL(input.url)
          : new URL(input.toString());
      if (url.pathname === '/api/v3.1/org/project/config') {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: { message: 'Unauthorized' } }, 401);
    });
    const provider = new ComposioProvider({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.prepareAuthConfig('github')).resolves.toMatchObject({
      status: 'error',
    });
    expect(getCachedAccessToken('ca_github_1')).toBe('still-valid');
    expect(config.getConnectedAccountIds()).toEqual({
      'desktop:local': {
        github: expect.objectContaining({ id: 'ca_github_1' }),
      },
    });
  });
});
