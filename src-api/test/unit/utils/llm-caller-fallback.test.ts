import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  credentials: {
    apiKey: 'test-key',
    baseUrl: 'https://proxy.example/v1',
    model: 'custom-chat-model',
  } as { apiKey?: string; baseUrl?: string; model?: string },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => mocks.logger,
}));

vi.mock('@/shared/utils/provider-resolution', () => ({
  getFastModelForProvider: (_baseUrl: string, model?: string) =>
    model ?? 'custom-chat-model',
  isAnthropicNative: () => false,
  resolveApiCredentials: () => mocks.credentials,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestBody(callIndex: number): Record<string, unknown> {
  const fetchMock = vi.mocked(fetch);
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe('buildLightweightLLMCaller token-param fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.credentials = {
      apiKey: 'test-key',
      baseUrl: 'https://proxy.example/v1',
      model: 'custom-chat-model',
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries max_tokens requests once when the 400 body names max_completion_tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('Use max_completion_tokens instead.', { status: 400 }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
        ),
    );

    const { buildLightweightLLMCaller } =
      await import('@/shared/utils/llm-caller');
    const caller = buildLightweightLLMCaller({ maxTokens: 20 });

    await expect(caller('hello')).resolves.toBe('ok');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(requestBody(0)).toMatchObject({ max_tokens: 20 });
    expect(requestBody(0)).not.toHaveProperty('max_completion_tokens');
    expect(requestBody(1)).toMatchObject({ max_completion_tokens: 20 });
    expect(requestBody(1)).not.toHaveProperty('max_tokens');
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'token_param_fallback_retry',
      expect.objectContaining({
        from: 'max_tokens',
        to: 'max_completion_tokens',
        model: 'custom-chat-model',
      }),
    );
  });

  it('retries max_completion_tokens requests once when the 400 body names max_tokens', async () => {
    mocks.credentials = {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            'Unsupported parameter: max_completion_tokens. Use max_tokens.',
            {
              status: 400,
            },
          ),
        )
        .mockResolvedValueOnce(
          jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
        ),
    );

    const { buildLightweightLLMCaller } =
      await import('@/shared/utils/llm-caller');
    const caller = buildLightweightLLMCaller({ maxTokens: 10 });

    await expect(caller('hello')).resolves.toBe('ok');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(requestBody(0)).toMatchObject({ max_completion_tokens: 10 });
    expect(requestBody(1)).toMatchObject({ max_tokens: 10 });
  });
});
