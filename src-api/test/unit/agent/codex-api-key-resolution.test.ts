import { describe, expect, it } from 'vitest';

import {
  resolveCodexApiKey,
  resolveCodexOpenAiBaseUrl,
} from '@/extensions/agent/codex/auth';

describe('resolveCodexApiKey', () => {
  it('prefers an explicitly configured key', () => {
    expect(
      resolveCodexApiKey(
        { apiKey: 'configured-key' },
        {
          CODEX_API_KEY: 'codex-env-key',
          OPENAI_API_KEY: 'openai-env-key',
        },
      ),
    ).toEqual({ apiKey: 'configured-key', source: 'config' });
  });

  it('uses CODEX_API_KEY before OPENAI_API_KEY', () => {
    expect(
      resolveCodexApiKey(
        {},
        {
          CODEX_API_KEY: 'codex-env-key',
          OPENAI_API_KEY: 'openai-env-key',
        },
      ),
    ).toEqual({ apiKey: 'codex-env-key', source: 'CODEX_API_KEY' });
  });

  it('does not use a stale OPENAI_API_KEY without a custom base URL', () => {
    expect(
      resolveCodexApiKey({}, { OPENAI_API_KEY: 'openai-env-key' }),
    ).toEqual({
      source: 'none',
    });
  });

  it('falls back to OPENAI_API_KEY only with a custom base URL', () => {
    expect(
      resolveCodexApiKey(
        {},
        {
          OPENAI_API_KEY: 'openai-env-key',
          OPENAI_BASE_URL: 'https://gateway.example/v1',
        },
      ),
    ).toEqual({
      apiKey: 'openai-env-key',
      source: 'OPENAI_API_KEY',
    });
  });

  it('treats blank values as missing', () => {
    expect(
      resolveCodexApiKey(
        { apiKey: ' ' },
        {
          CODEX_API_KEY: ' ',
          OPENAI_API_KEY: '',
        },
      ),
    ).toEqual({ source: 'none' });
  });

  it('resolves a configured custom base URL before env', () => {
    expect(
      resolveCodexOpenAiBaseUrl(
        { baseUrl: 'https://configured.example/v1' },
        { OPENAI_BASE_URL: 'https://env.example/v1' },
      ),
    ).toBe('https://configured.example/v1');
  });
});
