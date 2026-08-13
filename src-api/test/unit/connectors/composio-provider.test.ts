import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  ComposioClient,
  ComposioProvider,
  MemoryComposioConfigStore,
} from '@/shared/connectors/providers/composio';
import { ComposioCatalogCache } from '@/shared/connectors/providers/composio/catalog-cache';
import { ConnectorServiceError } from '@/shared/connectors/providers/composio/errors';

interface RecordedRequest {
  url: URL;
  method: string;
  headers: Headers;
  body?: unknown;
}

type MockResponder = (
  request: RecordedRequest,
  index: number,
) => Response | Promise<Response>;

function createFetchMock(responder: MockResponder): {
  fetchImpl: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url =
      input instanceof Request ? new URL(input.url) : new URL(input.toString());
    const bodyText =
      typeof init?.body === 'string' ? (init.body as string) : undefined;
    const request: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: bodyText ? JSON.parse(bodyText) : undefined,
    };
    // ComposioProvider's constructor opportunistically flips the
    // "mask connected account secrets" project flag whenever an API key
    // is configured. That's incidental to every test in this file, so
    // swallow the call here instead of forcing each responder to match it.
    if (request.url.pathname === '/api/v3.1/org/project/config') {
      return jsonResponse({});
    }
    requests.push(request);
    return responder(request, requests.length - 1);
  }) as typeof fetch;

  return { fetchImpl, requests };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('ComposioProvider', () => {
  it('reports public config without leaking the api key', () => {
    const config = new MemoryComposioConfigStore();
    const provider = new ComposioProvider({ config });

    expect(provider.isConfigured()).toBe(false);
    expect(provider.getPublicConfig()).toEqual({
      configured: false,
      apiKeyTail: '',
    });

    provider.setApiKey('cmp_test_123456');
    expect(provider.isConfigured()).toBe(true);
    expect(provider.getPublicConfig()).toEqual({
      configured: true,
      apiKeyTail: '3456',
    });
  });

  it('discovers the broad Composio toolkit catalog after configuration', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'neuma-composio-provider-'));
    const config = new MemoryComposioConfigStore();
    config.setApiKey('cmp_key');
    const { fetchImpl, requests } = createFetchMock((request) => {
      expect(request.headers.get('x-api-key')).toBe('cmp_key');
      if (request.url.pathname === '/api/v3.1/toolkits') {
        return jsonResponse({
          items: [
            {
              slug: 'AIRTABLE',
              name: 'Airtable',
              description: 'Airtable toolkit',
              categories: [{ name: 'Productivity' }],
              meta: { tools_count: 23 },
            },
            {
              slug: 'APALEO',
              name: 'Apaleo',
              description: 'Apaleo toolkit',
              categories: [{ name: 'Scheduling' }],
              meta: { tools_count: 29 },
            },
          ],
        });
      }
      throw new Error(`Unexpected Composio request: ${request.url.pathname}`);
    });
    const provider = new ComposioProvider({
      config,
      fetchImpl,
      catalogCache: new ComposioCatalogCache(path.join(dir, 'catalog.json')),
    });

    try {
      const catalog = await provider.refreshCatalog();

      expect(catalog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'airtable',
            name: 'Airtable',
            category: 'Productivity',
            provider: 'composio',
            authentication: 'composio',
            toolCount: 23,
          }),
          expect.objectContaining({
            id: 'apaleo',
            name: 'Apaleo',
            category: 'Scheduling',
            toolCount: 29,
          }),
          expect.objectContaining({ id: 'github' }),
        ]),
      );
      expect(requests.map((request) => request.url.pathname)).toEqual([
        '/api/v3.1/toolkits',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('short-circuits auth config preparation when id is persisted', async () => {
    const config = new MemoryComposioConfigStore();
    config.setApiKey('cmp_key');
    config.setAuthConfigId('github', 'auth_existing');
    const { fetchImpl, requests } = createFetchMock(() => jsonResponse({}));
    const provider = new ComposioProvider({ config, fetchImpl });

    await expect(provider.prepareAuthConfig('github')).resolves.toEqual({
      status: 'ready',
      authConfigId: 'auth_existing',
    });
    expect(requests).toHaveLength(0);
  });

  it('discovers an enabled auth config and persists it', async () => {
    const config = new MemoryComposioConfigStore();
    config.setApiKey('cmp_key');
    const { fetchImpl, requests } = createFetchMock((request) => {
      expect(request.headers.get('x-api-key')).toBe('cmp_key');
      expect(request.url.pathname).toBe('/api/v3.1/auth_configs');
      expect(request.url.searchParams.get('toolkit_slug')).toBe('github');
      return jsonResponse({
        items: [{ id: 'auth_github', status: 'ENABLED' }],
      });
    });
    const provider = new ComposioProvider({ config, fetchImpl });

    await expect(provider.prepareAuthConfig('github')).resolves.toEqual({
      status: 'ready',
      authConfigId: 'auth_github',
    });
    expect(config.getAuthConfigIds()).toEqual({ github: 'auth_github' });
    expect(requests).toHaveLength(1);
  });

  it('creates a managed auth config when discovery returns none', async () => {
    const config = new MemoryComposioConfigStore();
    config.setApiKey('cmp_key');
    const { fetchImpl, requests } = createFetchMock((request) => {
      if (request.method === 'GET') return jsonResponse({ items: [] });
      expect(request.method).toBe('POST');
      expect(request.url.pathname).toBe('/api/v3.1/auth_configs');
      expect(request.body).toEqual({
        toolkit: { slug: 'github' },
        auth_config: { type: 'use_composio_managed_auth' },
      });
      return jsonResponse({ data: { id: 'auth_created' } }, 201);
    });
    const provider = new ComposioProvider({ config, fetchImpl });

    await expect(provider.prepareAuthConfig('github')).resolves.toEqual({
      status: 'ready',
      authConfigId: 'auth_created',
    });
    expect(config.getAuthConfigIds()).toEqual({ github: 'auth_created' });
    expect(requests).toHaveLength(2);
  });

  it('deduplicates concurrent auth config creation', async () => {
    const config = new MemoryComposioConfigStore();
    config.setApiKey('cmp_key');
    const { fetchImpl, requests } = createFetchMock((request) => {
      if (request.method === 'GET') return jsonResponse({ items: [] });
      return jsonResponse({ id: 'auth_once' }, 201);
    });
    const provider = new ComposioProvider({ config, fetchImpl });

    await expect(
      Promise.all([
        provider.prepareAuthConfig('github'),
        provider.prepareAuthConfig('github'),
      ]),
    ).resolves.toEqual([
      { status: 'ready', authConfigId: 'auth_once' },
      { status: 'ready', authConfigId: 'auth_once' },
    ]);
    expect(
      requests.filter((request) => request.method === 'POST'),
    ).toHaveLength(1);
  });

  it('starts and completes an OAuth link flow for the exact returned account', async () => {
    const config = new MemoryComposioConfigStore();
    config.setApiKey('cmp_key');
    config.setAuthConfigId('github', 'auth_github');
    let callbackUrl = '';
    const { fetchImpl } = createFetchMock((request) => {
      if (request.url.pathname.endsWith('/connected_accounts/link')) {
        const body = request.body as Record<string, unknown>;
        callbackUrl = String(body.callback_url);
        expect(body).toMatchObject({
          auth_config_id: 'auth_github',
          user_id: 'user_1',
        });
        return jsonResponse(
          {
            redirect_url: 'https://platform.composio.dev/connect/link-token',
            connected_account_id: 'ca_pending',
            expires_at: '2026-05-16T01:00:00.000Z',
          },
          201,
        );
      }
      expect(request.url.pathname).toBe(
        '/api/v3.1/connected_accounts/ca_exact',
      );
      return jsonResponse({
        data: {
          id: 'ca_exact',
          user_id: 'user_1',
          auth_config_id: 'auth_github',
          status: 'ACTIVE',
          account_label: '@octocat',
        },
      });
    });
    const provider = new ComposioProvider({ config, fetchImpl });

    await expect(
      provider.startConnection({
        connectorId: 'github',
        callbackBaseUrl: 'http://127.0.0.1:2620',
        scopeKey: 'desktop:local',
        userId: 'user_1',
      }),
    ).resolves.toMatchObject({
      kind: 'redirect_required',
      redirectUrl: 'https://platform.composio.dev/connect/link-token',
      providerConnectionId: 'ca_pending',
    });

    const state = new URL(callbackUrl).searchParams.get('state');
    expect(state?.length).toBeGreaterThan(20);
    const result = await provider.completeOAuthCallback(
      'github',
      state ?? '',
      new URLSearchParams({
        status: 'success',
        connected_account_id: 'ca_exact',
      }),
    );

    expect(result).toMatchObject({
      connectorId: 'github',
      scopeKey: 'desktop:local',
      connectedAccountId: 'ca_exact',
      accountLabel: '@octocat',
    });
    expect(config.getConnectedAccountIds()).toMatchObject({
      'desktop:local': { github: { id: 'ca_exact', userId: 'user_1' } },
    });
  });

  it('rejects OAuth callback accounts that do not match pending state', async () => {
    const config = new MemoryComposioConfigStore();
    config.setApiKey('cmp_key');
    config.setAuthConfigId('github', 'auth_github');
    let callbackUrl = '';
    const { fetchImpl } = createFetchMock((request) => {
      if (request.url.pathname.endsWith('/connected_accounts/link')) {
        callbackUrl = String(
          (request.body as Record<string, unknown>).callback_url,
        );
        return jsonResponse({ redirect_url: 'https://connect.test' }, 201);
      }
      return jsonResponse({
        id: 'ca_wrong',
        user_id: 'other_user',
        auth_config_id: 'auth_github',
        status: 'ACTIVE',
      });
    });
    const provider = new ComposioProvider({ config, fetchImpl });

    await provider.startConnection({
      connectorId: 'github',
      callbackBaseUrl: 'http://127.0.0.1:2620',
      scopeKey: 'desktop:local',
      userId: 'user_1',
    });
    const state = new URL(callbackUrl).searchParams.get('state') ?? '';

    await expect(
      provider.completeOAuthCallback(
        'github',
        state,
        new URLSearchParams({
          status: 'success',
          connected_account_id: 'ca_wrong',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('executes tools with explicit connected account and scoped user id', async () => {
    const config = new MemoryComposioConfigStore();
    config.setApiKey('cmp_key');
    const { fetchImpl, requests } = createFetchMock((request) => {
      expect(request.url.pathname).toBe(
        '/api/v3.1/tools/execute/github.github_search_repositories',
      );
      expect(request.body).toEqual({
        user_id: 'user_1',
        connected_account_id: 'ca_1',
        arguments: { query: 'neuma' },
      });
      return jsonResponse({
        successful: true,
        data: { items: [{ name: 'neuma' }], access_token: 'secret' },
        log_id: 'log_1',
      });
    });
    const provider = new ComposioProvider({ config, fetchImpl });

    await expect(
      provider.executeTool({
        connectorId: 'github',
        toolName: 'github.github_search_repositories',
        connectedAccountId: 'ca_1',
        userId: 'user_1',
        input: { query: 'neuma' },
      }),
    ).resolves.toEqual({
      output: { items: [{ name: 'neuma' }], access_token: '[redacted]' },
      truncated: false,
      logId: 'log_1',
    });
    expect(requests).toHaveLength(1);
  });

  it('revokes remote connected accounts before removing local connection refs', async () => {
    const config = new MemoryComposioConfigStore();
    config.setApiKey('cmp_key');
    config.setConnectedAccount('desktop:local', 'github', {
      id: 'ca_1',
      connectedAt: '2026-05-16T00:00:00.000Z',
    });
    config.setConnectedAccount('channel:slack:bot:user', 'github', {
      id: 'ca_2',
      connectedAt: '2026-05-16T00:00:00.000Z',
    });
    config.setConnectedAccount('desktop:local', 'slack', {
      id: 'ca_slack',
      connectedAt: '2026-05-16T00:00:00.000Z',
    });
    const { fetchImpl, requests } = createFetchMock((request) => {
      expect(request.method).toBe('DELETE');
      return jsonResponse({});
    });
    const provider = new ComposioProvider({ config, fetchImpl });

    await provider.disconnect('github');

    expect(requests.map((request) => request.url.pathname).sort()).toEqual([
      '/api/v3.1/connected_accounts/ca_1',
      '/api/v3.1/connected_accounts/ca_2',
    ]);
    expect(config.getConnectedAccountIds()).toEqual({
      'desktop:local': {
        slack: {
          id: 'ca_slack',
          connectedAt: '2026-05-16T00:00:00.000Z',
        },
      },
    });
  });
});

describe('ComposioClient', () => {
  it('retries HTTP 429 once with x-api-key authentication', async () => {
    let calls = 0;
    const client = new ComposioClient({
      apiKeyProvider: () => 'cmp_key',
      fetchImpl: (async (_input, init) => {
        calls += 1;
        expect(new Headers(init?.headers).get('x-api-key')).toBe('cmp_key');
        if (calls === 1) {
          return jsonResponse({ error: { message: 'slow down' } }, 429, {
            'retry-after': '0',
          });
        }
        return jsonResponse({ ok: true });
      }) as typeof fetch,
    });

    await expect(client.getJson('/api/v3.1/tools')).resolves.toEqual({
      ok: true,
    });
    expect(calls).toBe(2);
  });

  it('maps upstream errors without leaking raw bodies', async () => {
    const client = new ComposioClient({
      apiKeyProvider: () => 'cmp_key',
      fetchImpl: (async () =>
        jsonResponse(
          { error: { message: 'nope', secret: 'raw' } },
          403,
        )) as typeof fetch,
    });

    await expect(client.getJson('/api/v3.1/tools')).rejects.toBeInstanceOf(
      ConnectorServiceError,
    );
  });
});
