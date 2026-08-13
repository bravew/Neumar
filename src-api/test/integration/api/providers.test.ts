import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  validateBaseUrl: vi.fn((baseUrl: string) => {
    if (baseUrl.includes('169.254')) {
      return {
        valid: false,
        reason: 'Private or internal IP addresses are not allowed',
      };
    }
    return { valid: true };
  }),
  validateBaseUrlForFetch: vi.fn(async (baseUrl: string) => {
    if (baseUrl.includes('169.254')) {
      return {
        valid: false,
        reason: 'Private or internal IP addresses are not allowed',
      };
    }
    return { valid: true };
  }),
  NetworkPolicyDenied: class MockNetworkPolicyDenied extends Error {
    readonly reason: string;
    readonly url: string;

    constructor(url: string, reason: string) {
      super(`Network policy denied ${url}: ${reason}`);
      this.name = 'NetworkPolicyDenied';
      this.url = url;
      this.reason = reason;
    }
  },
}));

vi.mock('@/shared/utils/url-validator', () => ({
  NetworkPolicyDenied: mocks.NetworkPolicyDenied,
  safeFetch: mocks.safeFetch,
  validateBaseUrl: mocks.validateBaseUrl,
  validateBaseUrlForFetch: mocks.validateBaseUrlForFetch,
}));

// Mock out heavy dependencies that are not needed for route testing
vi.mock('@/core/agent/registry', () => ({
  getAgentRegistry: () => ({
    getAllAgentMetadata: () => [
      {
        type: 'claude',
        name: 'Claude',
        description: 'Anthropic Claude agent',
        available: true,
      },
    ],
    getAvailable: () => Promise.resolve(['claude']),
  }),
}));

vi.mock('@/core/sandbox/registry', () => ({
  getSandboxRegistry: () => ({
    getAllSandboxMetadata: () => [],
    getAvailable: () => Promise.resolve([]),
  }),
}));

vi.mock('@/shared/provider/manager', () => ({
  getProviderManager: () => ({
    getConfig: () => ({ agent: { type: 'claude' }, sandbox: null }),
  }),
  initProviderManager: vi.fn(),
  shutdownProviderManager: vi.fn(),
}));

vi.mock('@/config/loader', () => ({
  getConfigLoader: () => ({
    get: () => ({}),
  }),
  loadConfig: vi.fn(),
}));

describe('Providers API', () => {
  beforeEach(() => {
    mocks.safeFetch.mockReset();
    mocks.validateBaseUrl.mockImplementation((baseUrl: string) => {
      if (baseUrl.includes('169.254')) {
        return {
          valid: false,
          reason: 'Private or internal IP addresses are not allowed',
        };
      }
      return { valid: true };
    });
    mocks.validateBaseUrlForFetch.mockImplementation(
      async (baseUrl: string) => {
        if (baseUrl.includes('169.254')) {
          return {
            valid: false,
            reason: 'Private or internal IP addresses are not allowed',
          };
        }
        return { valid: true };
      },
    );
  });

  it('lists agent providers', async () => {
    const { providersRoutes } = await import('@/app/api/providers');
    const res = await providersRoutes.request('/agents');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('providers');
    expect(Array.isArray(body.providers)).toBe(true);
  });

  it('lists sandbox providers', async () => {
    const { providersRoutes } = await import('@/app/api/providers');
    const res = await providersRoutes.request('/sandbox');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('providers');
  });

  it('dedupes and sorts fetched OpenAI-compatible models', async () => {
    mocks.safeFetch.mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: Buffer.from(
        JSON.stringify({
          data: [
            { id: 'zeta' },
            { id: 'alpha', name: 'Alpha preview' },
            { id: 'alpha', name: 'Duplicate' },
          ],
        }),
      ),
      finalUrl: 'https://openrouter.ai/api/v1/models',
      redirectChain: [],
    });

    const { providersRoutes } = await import('@/app/api/providers');
    const res = await providersRoutes.request('/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'sk-test-secret-123',
        baseUrl: 'https://openrouter.ai/api/v1',
        agentType: 'codex',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      models: Array<{ id: string; displayLabel: string }>;
      totalCount: number;
      upstreamStatus: number;
      latencyMs: number;
    };
    expect(body.models).toEqual([
      {
        id: 'alpha',
        name: 'Alpha preview',
        displayLabel: 'alpha (Alpha preview)',
      },
      { id: 'zeta', displayLabel: 'zeta' },
    ]);
    expect(body.totalCount).toBe(2);
    expect(body.upstreamStatus).toBe(200);
    expect(typeof body.latencyMs).toBe('number');
  });

  it('rejects Azure OpenAI deployment discovery explicitly', async () => {
    const { providersRoutes } = await import('@/app/api/providers');
    const res = await providersRoutes.request('/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'sk-test-secret-123',
        baseUrl: 'https://example.openai.azure.com',
        agentType: 'codex',
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain(
      'Azure OpenAI deployment discovery is not supported',
    );
    expect(mocks.safeFetch).not.toHaveBeenCalled();
  });

  it('tests a saved custom deployment id without replacing it', async () => {
    mocks.safeFetch.mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: Buffer.from(
        JSON.stringify({
          model: 'deployment-prod-2026',
          choices: [{ message: { content: 'ok' } }],
        }),
      ),
      finalUrl: 'https://api.example.com/v1/chat/completions',
      redirectChain: [],
    });

    const { providersRoutes } = await import('@/app/api/providers');
    const res = await providersRoutes.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'sk-test-secret-123',
        baseUrl: 'https://api.example.com/v1',
        model: 'deployment-prod-2026',
        agentType: 'openai-compat',
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      model: 'deployment-prod-2026',
    });
    const [, , init] = mocks.safeFetch.mock.calls[0] as [
      string,
      unknown,
      { body?: string },
    ];
    expect(JSON.parse(init.body ?? '{}')).toMatchObject({
      model: 'deployment-prod-2026',
    });
  });

  it.each([
    'doubao-seedance-2-0-260128',
    'senseaudio-image-2.0-260319',
    'sensenova-u1-fast',
    'senseaudio-asr-1.0-260319',
    'senseaudio-tts-1.5-260319',
    'senseaudio-music-1.0-260319',
  ])('uses the Models API for non-chat model %s', async (model) => {
    mocks.safeFetch.mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: Buffer.from(JSON.stringify({ data: [{ id: model }] })),
      finalUrl: 'https://api.example.com/v1/models',
      redirectChain: [],
    });

    const { providersRoutes } = await import('@/app/api/providers');
    const res = await providersRoutes.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'sk-test-secret-123',
        baseUrl: 'https://api.example.com/v1',
        model,
        agentType: 'openai-compat',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain('Auth verified');
    expect(mocks.safeFetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.anything(),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('forwards auth failures while redacting provider secrets', async () => {
    mocks.safeFetch.mockResolvedValueOnce({
      status: 401,
      headers: {},
      body: Buffer.from(
        JSON.stringify({
          error: { message: 'invalid key sk-test-secret-123' },
        }),
      ),
      finalUrl: 'https://api.openai.com/v1/models',
      redirectChain: [],
    });

    const { providersRoutes } = await import('@/app/api/providers');
    const res = await providersRoutes.request('/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'sk-test-secret-123',
        baseUrl: 'https://api.openai.com/v1',
        agentType: 'codex',
      }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('invalid key [redacted]');
    expect(body.message).not.toContain('sk-test-secret-123');
  });
});
