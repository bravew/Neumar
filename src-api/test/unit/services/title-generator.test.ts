import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/services/usage-logger', () => ({
  logUsage: vi.fn(),
}));

vi.mock('@/shared/utils/provider-resolution', async () => {
  const actual = await vi.importActual<
    typeof import('@/shared/utils/provider-resolution')
  >('@/shared/utils/provider-resolution');
  return {
    ...actual,
    resolveApiCredentials: vi.fn(() => ({})),
  };
});

import { generateTitle } from '@/shared/services/title-generator';

describe('generateTitle fallback', () => {
  it('uses AI context when no title model key is configured', async () => {
    const title = await generateTitle(
      'In one or two sentences, what kinds of visual directions should we explore?',
      'Goal: build a launch promo for Stillwater Labs\nSteps:\n- Draft storyboard',
      undefined,
      'en-US',
    );

    expect(title).toBe('Build a Launch Promo for Stillwater Labs');
  });

  it('turns prompt-only instruction text into a sentence-case topic', async () => {
    const title = await generateTitle(
      'In one or two sentences, what kinds of visual directions should we explore?',
      undefined,
      undefined,
      'en-US',
    );

    expect(title).toBe('Visual directions to explore');
  });

  it('falls back to a default title when prompt cleanup removes all content', async () => {
    const title = await generateTitle(
      'In one sentence',
      undefined,
      undefined,
      'en-US',
    );

    expect(title).toBe('New Conversation');
  });
});
