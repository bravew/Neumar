import type { MediaDataEgress } from '@/shared/media/data-egress';

import type { Storyboard, StoryboardScene } from './types';

export interface VideoCostEstimate {
  low: number;
  high: number;
  confidence: 'low' | 'medium' | 'high';
  breakdown: Array<{
    sceneId: string;
    kind: string;
    lowCents: number;
    highCents: number;
    provider?: string;
  }>;
}

export function estimateStoryboardCostCents(
  storyboard: Pick<Storyboard, 'scenes'>,
): VideoCostEstimate {
  const breakdown = storyboard.scenes.map(estimateSceneCost);
  const low = breakdown.reduce((total, item) => total + item.lowCents, 0);
  const high = breakdown.reduce((total, item) => total + item.highCents, 0);
  const usesDefaults = breakdown.some((item) => item.highCents > item.lowCents);

  return {
    low,
    high,
    confidence: usesDefaults ? 'low' : 'high',
    breakdown,
  };
}

export function estimateStoryboardCostUsd(
  storyboard: Pick<Storyboard, 'scenes'>,
): Storyboard['costEstimateUsd'] {
  const estimate = estimateStoryboardCostCents(storyboard);
  return {
    low: centsToUsd(estimate.low),
    high: centsToUsd(estimate.high),
  };
}

const CLOUD_ASR_CENTS_PER_MINUTE = 2;

export function estimateAsrCostCents(input: {
  durationMs: number;
  dataEgress: MediaDataEgress;
}): number {
  if (input.dataEgress === 'local') return 0;
  const minutes = Math.max(0, input.durationMs) / 60_000;
  return Math.ceil(minutes * CLOUD_ASR_CENTS_PER_MINUTE);
}

// Deliberately conservative: this is also the figure shown to the user for
// approval, so over-estimating is safer than under-estimating. Characters are
// the real token driver for translation, not cue count.
const CHARS_PER_KILOTOKEN = 3_000;
const CENTS_PER_KILOTOKEN = 3;

/**
 * Estimated cost of translating caption text with a cloud LLM. Floors at 1 cent
 * for any non-empty input so a rounding-to-zero never bypasses the cost gate.
 */
export function estimateTranslationCostCents(input: {
  charCount: number;
}): number {
  const chars = Math.max(0, input.charCount);
  if (chars === 0) return 0;
  const kilotokens = chars / CHARS_PER_KILOTOKEN;
  return Math.max(1, Math.ceil(kilotokens * CENTS_PER_KILOTOKEN));
}

function estimateSceneCost(scene: StoryboardScene) {
  const plan = scene.assetPlan;
  if (plan.kind === 'ai-image') {
    return {
      sceneId: scene.id,
      kind: plan.kind,
      lowCents: 5,
      highCents: 20,
      provider: plan.provider,
    };
  }
  if (plan.kind === 'ai-clip') {
    const durationSec = Math.ceil((plan.durationMs ?? scene.durationMs) / 1000);
    return {
      sceneId: scene.id,
      kind: plan.kind,
      lowCents: durationSec * 4,
      highCents: durationSec * 10,
      provider: plan.provider,
    };
  }
  if (plan.kind === 'broll-search') {
    const paid = plan.provider === 'storyblocks';
    return {
      sceneId: scene.id,
      kind: plan.kind,
      lowCents: paid ? 25 : 0,
      highCents: paid ? 75 : 0,
      provider: plan.provider,
    };
  }
  if (plan.kind === 'tts-narration') {
    const paid = plan.provider && plan.provider !== 'kokoro';
    const charCount = plan.text.length;
    const cents = paid ? Math.ceil(charCount * 0.002) : 0;
    return {
      sceneId: scene.id,
      kind: plan.kind,
      lowCents: cents,
      highCents: cents,
      provider: plan.provider,
    };
  }
  return {
    sceneId: scene.id,
    kind: plan.kind,
    lowCents: 0,
    highCents: 0,
  };
}

function centsToUsd(cents: number): number {
  return Math.round(cents) / 100;
}
