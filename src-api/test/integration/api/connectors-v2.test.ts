import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { corsMiddleware } from '@/app/middleware/cors';

const mocks = vi.hoisted(() => ({
  provider: {
    getFastDefinitions: vi.fn(),
    getPublicConfig: vi.fn(),
    setApiKey: vi.fn(),
    prepareAuthConfig: vi.fn(),
    completeOAuthCallback: vi.fn(),
    disconnect: vi.fn(),
    executeTool: vi.fn(),
    getDetail: vi.fn(),
    isConfigured: vi.fn(),
    startConnection: vi.fn(),
    getConnectedConnectorIds: vi.fn(() => new Set<string>()),
    refreshCatalog: vi.fn(),
    cancelPending: vi.fn(),
  },
}));

vi.mock('@/shared/connectors/providers/composio', async () => {
  const actual = await vi.importActual<
    typeof import('@/shared/connectors/providers/composio')
  >('@/shared/connectors/providers/composio');
  return {
    ...actual,
    getComposioProvider: () => mocks.provider,
  };
});

describe('connectors v2 routes', () => {
  beforeEach(() => {
    mocks.provider.getFastDefinitions.mockReset();
    mocks.provider.getPublicConfig.mockReset();
    mocks.provider.setApiKey.mockReset();
    mocks.provider.prepareAuthConfig.mockReset();
    mocks.provider.completeOAuthCallback.mockReset();
    mocks.provider.disconnect.mockReset();
    mocks.provider.executeTool.mockReset();
    mocks.provider.getDetail.mockReset();
    mocks.provider.isConfigured.mockReset();
    mocks.provider.startConnection.mockReset();
    vi.stubEnv('NEUMA_CONNECTORS_PLATFORM_V2', 'true');
  });

  it('returns 404 for v2 routes when the platform flag is disabled', async () => {
    vi.stubEnv('NEUMA_CONNECTORS_PLATFORM_V2', 'false');
    const { connectorsRoutes } = await import('@/app/api/connectors');

    const res = await connectorsRoutes.request('/');

    expect(res.status).toBe(404);
    expect(mocks.provider.getFastDefinitions).not.toHaveBeenCalled();
  });

  it('returns the seed catalog from GET /', async () => {
    const { CONNECTOR_SEED_CATALOG } = await import('@/shared/connectors/seed');
    mocks.provider.getFastDefinitions.mockReturnValue(CONNECTOR_SEED_CATALOG);
    const { connectorsRoutes } = await import('@/app/api/connectors');

    const res = await connectorsRoutes.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      connectors: Array<{ id: string; apiKeyUrl?: string }>;
    };
    expect(body.connectors.map((connector) => connector.id)).toContain(
      'github',
    );
    expect(body.connectors.map((connector) => connector.id)).toContain('slack');
    expect(
      Object.fromEntries(
        body.connectors.map((connector) => [connector.id, connector.apiKeyUrl]),
      ),
    ).toMatchObject({
      github: 'https://github.com/settings/personal-access-tokens',
      notion: 'https://www.notion.so/my-integrations',
      linear: 'https://linear.app/settings/api',
      slack: 'https://api.slack.com/apps',
      stripe: 'https://dashboard.stripe.com/apikeys',
      gmail: 'https://console.cloud.google.com/apis/credentials',
      drive: 'https://console.cloud.google.com/apis/credentials',
      calendar: 'https://console.cloud.google.com/apis/credentials',
    });
  });

  it.each([
    ['drive', 'googledrive'],
    ['calendar', 'googlecalendar'],
    ['google_drive', 'googledrive'],
    ['google_calendar', 'googlecalendar'],
    ['drive_composio', 'googledrive'],
    ['calendar_composio', 'googlecalendar'],
    ['gmail_composio', 'gmail'],
  ])('normalizes connector logo slug %s', async (input, expected) => {
    const { normalizeConnectorLogoSlug } = await import('@/app/api/connectors');

    expect(normalizeConnectorLogoSlug(input)).toBe(expected);
  });

  it('keeps config writes admin desktop only', async () => {
    mocks.provider.getPublicConfig.mockReturnValue({
      configured: false,
      apiKeyTail: '',
    });
    const { connectorsRoutes } = await import('@/app/api/connectors');

    const denied = await connectorsRoutes.request('/composio/config', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'cmp_key' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(denied.status).toBe(403);

    const allowed = await connectorsRoutes.request('/composio/config', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'cmp_key' }),
      headers: {
        'content-type': 'application/json',
        'x-neuma-admin-origin': 'desktop',
        origin: 'http://127.0.0.1:3420',
      },
    });
    expect(allowed.status).toBe(200);
    expect(mocks.provider.setApiKey).toHaveBeenCalledWith('cmp_key');
  });

  it('allows the desktop admin header in CORS preflight requests', async () => {
    const { connectorsRoutes } = await import('@/app/api/connectors');
    const app = new Hono();
    app.use('*', corsMiddleware);
    app.route('/connectors', connectorsRoutes);

    const res = await app.request('/connectors/composio/config', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:3420',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type,x-neuma-admin-origin',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'http://127.0.0.1:3420',
    );
    expect(res.headers.get('access-control-allow-headers')).toContain(
      'X-Neuma-Admin-Origin',
    );
  });

  it('rejects OAuth callbacks on non-loopback hosts', async () => {
    const { connectorsRoutes } = await import('@/app/api/connectors');

    const res = await connectorsRoutes.request(
      '/oauth/callback/github?state=abc&status=success',
      { headers: { host: 'example.com' } },
    );
    expect(res.status).toBe(403);
    expect(mocks.provider.completeOAuthCallback).not.toHaveBeenCalled();
  });

  it('accepts loopback OAuth callbacks and delegates exact query params', async () => {
    mocks.provider.completeOAuthCallback.mockResolvedValue({
      connectorId: 'github',
    });
    const { connectorsRoutes } = await import('@/app/api/connectors');

    const res = await connectorsRoutes.request(
      '/oauth/callback/github?state=abc&status=success&connected_account_id=ca_1',
      { headers: { host: '127.0.0.1:2620' } },
    );
    expect(res.status).toBe(200);
    expect(mocks.provider.completeOAuthCallback).toHaveBeenCalledWith(
      'github',
      'abc',
      expect.any(URLSearchParams),
    );
  });

  it('validates scoped connection keys before starting OAuth', async () => {
    const { connectorsRoutes } = await import('@/app/api/connectors');

    const res = await connectorsRoutes.request('/github/connect', {
      method: 'POST',
      body: JSON.stringify({
        callbackBaseUrl: 'http://127.0.0.1:5126',
        scopeKey: 'desktop:local<script>',
        userId: 'desktop',
      }),
      headers: {
        'content-type': 'application/json',
        'x-neuma-admin-origin': 'desktop',
        origin: 'http://127.0.0.1:3420',
      },
    });

    expect(res.status).toBe(400);
    expect(mocks.provider.startConnection).not.toHaveBeenCalled();
  });

  it('keeps in-process execution behind admin desktop origin', async () => {
    const { connectorsRoutes } = await import('@/app/api/connectors');

    const denied = await connectorsRoutes.request(
      '/github/tools/github.github_search_repositories/execute',
      {
        method: 'POST',
        body: JSON.stringify({
          connectedAccountId: 'ca_1',
          userId: 'desktop',
          input: {},
        }),
        headers: {
          'content-type': 'application/json',
          'x-neuma-connector-execution': 'in-process',
        },
      },
    );

    expect(denied.status).toBe(403);
    expect(mocks.provider.getDetail).not.toHaveBeenCalled();
  });
});
