import { describe, expect, it } from 'vitest';

import { classifyProviderError } from '@/shared/channels/_shared/errors';
import { ChannelFallbackService } from '@/shared/channels/_shared/fallback-service';
import { buildPlainTextFallback } from '@/shared/channels/_shared/fallback-templates';
import { classifyPublishError } from '@/shared/services/publish/retry-policy';

describe('provider error classification and fallbacks', () => {
  it('normalizes status and provider codes', () => {
    expect(
      classifyProviderError({ status: 429 }, { provider: 'slack' }),
    ).toMatchObject({
      class: 'rate_limited_429',
      retryable: true,
    });

    expect(
      classifyProviderError(
        { data: { error: 'invalid_auth' } },
        { provider: 'slack' },
      ),
    ).toMatchObject({
      class: 'auth_revoked_401',
      terminal: true,
    });
  });

  it('maps provider errors into publish retry classes', () => {
    expect(classifyPublishError({ status: 503 })).toMatchObject({
      class: 'provider_5xx',
      terminal: false,
    });
  });

  it('builds bounded plain-text fallbacks and records diagnostics', async () => {
    const service = new ChannelFallbackService(1);
    const result = await service.deliverWithFallback({
      content: 'A'.repeat(40),
      context: { provider: 'discord', operation: 'sendMessage' },
      sendPrimary: async () => {
        throw {
          status: 400,
          message: 'invalid embed for user@example.com with xoxb-secret-token',
        };
      },
      sendFallback: async (content) => ({ content }),
      fallbackMaxLength: 35,
    });

    expect(result.content.length).toBeLessThanOrEqual(35);
    expect(service.listDiagnostics()).toHaveLength(1);
    expect(service.listDiagnostics()[0]).toMatchObject({
      provider: 'discord',
      errorClass: 'format_invalid',
      primaryMessage:
        'invalid embed for [redacted-email] with [redacted-token]',
      succeeded: true,
    });
  });

  it('appends the provider error class to fallback text', () => {
    const text = buildPlainTextFallback({
      content: 'hello',
      error: classifyProviderError({ status: 500 }, { provider: 'telegram' }),
    });
    expect(text).toContain('provider_5xx');
  });
});
