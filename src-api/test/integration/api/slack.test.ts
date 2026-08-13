import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const getSlackConfigMock = vi
  .fn()
  .mockReturnValue({ botToken: 'xoxb-test-token' });

vi.mock('@/shared/services/slack-config', () => ({
  getSlackConfig: () => getSlackConfigMock(),
  loadSlackConfig: vi.fn(),
  saveSlackConfig: vi.fn(),
}));

vi.mock('@/shared/services/slack-cowork-handler', () => ({
  slackCoworkHandler: { getActiveSessions: vi.fn().mockReturnValue([]) },
}));

vi.mock('@/shared/services/slack-gateway', () => ({
  slackGateway: {
    isInitialized: vi.fn().mockReturnValue(false),
    initialize: vi.fn(),
    shutdown: vi.fn(),
  },
  toGatewayConfig: vi.fn(),
}));

vi.mock('@/shared/auth/token-manager', () => ({
  getTokens: vi.fn(),
  saveTokens: vi.fn(),
  getConnection: vi.fn(),
}));

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

describe('Slack /channels', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    getSlackConfigMock.mockReset().mockReturnValue({ botToken: 'xoxb-test' });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function loadRoutes() {
    const mod = await import('@/app/api/slack');
    return mod.slackRoutes;
  }

  it('forwards cursor, limit, exclude_archived, types', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          channels: [{ id: 'C1', name: 'general', is_channel: true }],
          response_metadata: { next_cursor: 'next-1' },
        }),
        { status: 200 },
      ),
    );
    const routes = await loadRoutes();
    const res = await routes.request(
      '/channels?cursor=abc&limit=50&exclude_archived=false&types=public_channel',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.nextCursor).toBe('next-1');

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('cursor=abc');
    expect(url).toContain('limit=50');
    expect(url).toContain('exclude_archived=false');
    expect(url).toContain('types=public_channel');
  });

  it('returns null nextCursor when Slack omits it', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          channels: [],
          response_metadata: {},
        }),
        { status: 200 },
      ),
    );
    const routes = await loadRoutes();
    const res = await routes.request('/channels');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.nextCursor).toBeNull();
  });

  it('maps invalid_auth -> 401', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }), {
        status: 200,
      }),
    );
    const routes = await loadRoutes();
    const res = await routes.request('/channels');
    expect(res.status).toBe(401);
  });

  it('maps missing_scope -> 403', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'missing_scope' }), {
        status: 200,
      }),
    );
    const routes = await loadRoutes();
    const res = await routes.request('/channels');
    expect(res.status).toBe(403);
  });

  it('maps rate_limited -> 429 with Retry-After', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'rate_limited' }), {
        status: 200,
        headers: { 'Retry-After': '30' },
      }),
    );
    const routes = await loadRoutes();
    const res = await routes.request('/channels');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('returns 400 when bot token missing', async () => {
    getSlackConfigMock.mockReturnValue({ botToken: '' });
    const routes = await loadRoutes();
    const res = await routes.request('/channels');
    expect(res.status).toBe(400);
  });
});
