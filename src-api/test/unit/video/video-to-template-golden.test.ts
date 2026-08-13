import { describe, expect, it } from 'vitest';

import {
  evaluateVideoToTemplateGoldenMatches,
  VIDEO_TO_TEMPLATE_GOLDEN_SET,
} from '@/shared/video/overlays/video-to-template-golden';

describe('video-to-template golden set', () => {
  it('defines the ten-case category fixture required by CP6', () => {
    expect(VIDEO_TO_TEMPLATE_GOLDEN_SET).toHaveLength(10);
    expect(
      new Set(VIDEO_TO_TEMPLATE_GOLDEN_SET.map((item) => item.id)).size,
    ).toBe(10);
    expect(
      VIDEO_TO_TEMPLATE_GOLDEN_SET.map((item) => item.expectedCategory),
    ).toEqual(
      expect.arrayContaining([
        'callout',
        'title',
        'social',
        'badge',
        'reaction',
        'progress',
        'frame',
        'screen',
        'ambient',
      ]),
    );
  });

  it('scores category, visible text, and palette matches', () => {
    const report = evaluateVideoToTemplateGoldenMatches(
      VIDEO_TO_TEMPLATE_GOLDEN_SET.map((item) => ({
        id: item.id,
        category: item.expectedCategory,
        text: item.visibleText?.toLowerCase(),
        colors: item.palette,
      })),
    );

    expect(report).toMatchObject({
      total: 10,
      categoryMatches: 10,
      misses: [],
    });
    expect(report.textMatches).toBeGreaterThan(0);
    expect(report.paletteMatches).toBeGreaterThan(0);
  });
});
