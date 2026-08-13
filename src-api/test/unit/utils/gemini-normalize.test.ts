import { describe, expect, it } from 'vitest';

import {
  isNativeGeminiUrl,
  normalizeGeminiBaseUrl,
} from '@/shared/utils/gemini';

describe('normalizeGeminiBaseUrl', () => {
  it('strips trailing slashes, query strings, hashes, and version suffixes', () => {
    expect(
      normalizeGeminiBaseUrl(
        'https://generativelanguage.googleapis.com/v1beta/?key=secret#models',
      ),
    ).toBe('https://generativelanguage.googleapis.com');

    expect(
      normalizeGeminiBaseUrl(
        'https://generativelanguage.googleapis.com/v1?alt=json',
      ),
    ).toBe('https://generativelanguage.googleapis.com');
  });

  it('preserves proxy base paths after removing a duplicate /v1 suffix', () => {
    expect(normalizeGeminiBaseUrl('https://openrouter.ai/api/v1/')).toBe(
      'https://openrouter.ai/api',
    );
  });

  it('preserves native-vs-proxy detection after normalization', () => {
    expect(
      isNativeGeminiUrl(
        'https://generativelanguage.googleapis.com/v1beta?key=secret',
      ),
    ).toBe(true);
    expect(
      isNativeGeminiUrl(
        'https://proxy.example/v1?target=generativelanguage.googleapis.com',
      ),
    ).toBe(false);
  });
});
