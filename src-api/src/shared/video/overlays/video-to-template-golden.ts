import type { VividOverlayCategory } from '@neumar/video-ir';

export interface VideoToTemplateGoldenCase {
  id: string;
  cue: string;
  expectedCategory: VividOverlayCategory;
  expectedTags: string[];
  visibleText?: string;
  palette?: string[];
}

export interface VideoToTemplateGoldenPrediction {
  id: string;
  category: VividOverlayCategory;
  text?: string;
  colors?: string[];
}

export interface VideoToTemplateGoldenReport {
  total: number;
  categoryMatches: number;
  textMatches: number;
  paletteMatches: number;
  misses: Array<{
    id: string;
    expectedCategory: VividOverlayCategory;
    actualCategory?: VividOverlayCategory;
  }>;
}

export const VIDEO_TO_TEMPLATE_GOLDEN_SET: VideoToTemplateGoldenCase[] = [
  {
    id: 'quote-marker-yellow',
    cue: 'yellow marker sweep over one quoted sentence',
    expectedCategory: 'callout',
    expectedTags: ['highlight', 'marker'],
    visibleText: 'THIS MATTERS',
    palette: ['#ffd166'],
  },
  {
    id: 'glass-lower-third',
    cue: 'speaker name and role in a translucent lower third',
    expectedCategory: 'title',
    expectedTags: ['lower-third', 'name'],
    visibleText: 'JANE DOE',
    palette: ['#22d3ee'],
  },
  {
    id: 'subscribe-cta',
    cue: 'animated subscribe button with red accent',
    expectedCategory: 'social',
    expectedTags: ['subscribe', 'button'],
    visibleText: 'SUBSCRIBE',
    palette: ['#ef4444'],
  },
  {
    id: 'verified-pop',
    cue: 'blue verified badge pops beside a profile name',
    expectedCategory: 'badge',
    expectedTags: ['verified', 'badge'],
    palette: ['#3b82f6'],
  },
  {
    id: 'confetti-reaction',
    cue: 'celebration burst around the center of frame',
    expectedCategory: 'reaction',
    expectedTags: ['celebration', 'confetti'],
  },
  {
    id: 'top-progress',
    cue: 'thin progress bar filling across the top edge',
    expectedCategory: 'progress',
    expectedTags: ['progress', 'bar'],
  },
  {
    id: 'countdown-ring',
    cue: 'countdown number inside a circular timer',
    expectedCategory: 'progress',
    expectedTags: ['countdown', 'ring'],
    visibleText: '3',
  },
  {
    id: 'phone-frame',
    cue: 'phone mockup frame around vertical app footage',
    expectedCategory: 'frame',
    expectedTags: ['phone', 'mockup'],
  },
  {
    id: 'vhs-scanlines',
    cue: 'retro VHS scanline effect over the whole screen',
    expectedCategory: 'screen',
    expectedTags: ['vhs', 'scanlines'],
  },
  {
    id: 'ambient-bokeh',
    cue: 'soft floating bokeh particles in the background',
    expectedCategory: 'ambient',
    expectedTags: ['bokeh', 'particles'],
  },
];

export function evaluateVideoToTemplateGoldenMatches(
  predictions: VideoToTemplateGoldenPrediction[],
): VideoToTemplateGoldenReport {
  const byId = new Map(
    predictions.map((prediction) => [prediction.id, prediction]),
  );
  let categoryMatches = 0;
  let textMatches = 0;
  let paletteMatches = 0;
  const misses: VideoToTemplateGoldenReport['misses'] = [];

  for (const item of VIDEO_TO_TEMPLATE_GOLDEN_SET) {
    const prediction = byId.get(item.id);
    if (prediction?.category === item.expectedCategory) {
      categoryMatches += 1;
    } else {
      misses.push({
        id: item.id,
        expectedCategory: item.expectedCategory,
        ...(prediction ? { actualCategory: prediction.category } : {}),
      });
    }
    if (
      item.visibleText &&
      normalizeText(prediction?.text) === normalizeText(item.visibleText)
    ) {
      textMatches += 1;
    }
    if (item.palette && hasPaletteHit(item.palette, prediction?.colors)) {
      paletteMatches += 1;
    }
  }

  return {
    total: VIDEO_TO_TEMPLATE_GOLDEN_SET.length,
    categoryMatches,
    textMatches,
    paletteMatches,
    misses,
  };
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function hasPaletteHit(
  expected: readonly string[],
  actual: readonly string[] | undefined,
): boolean {
  if (!actual || actual.length === 0) return false;
  const normalized = new Set(actual.map((color) => color.toLowerCase()));
  return expected.some((color) => normalized.has(color.toLowerCase()));
}
