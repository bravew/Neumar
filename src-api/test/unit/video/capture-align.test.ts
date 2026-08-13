import { describe, expect, it } from 'vitest';

import { alignCaptureToStoryboard } from '@/shared/video/capture/align';
import type { Storyboard, Subtitle } from '@/shared/video/types';

describe('capture storyboard alignment', () => {
  it('aligns transcript word ranges to storyboard scenes', () => {
    const markers = alignCaptureToStoryboard(storyboardFixture(), [
      subtitle(
        'Intro line for scene one Product value proof for scene two Closing call to action',
      ),
    ]);

    expect(markers).toHaveLength(3);
    expect(markers[0]).toMatchObject({
      sceneId: 'scene-1',
      startMs: 0,
      confidence: 1,
    });
    expect(markers[1]).toMatchObject({
      sceneId: 'scene-2',
      transcriptText: 'Product value proof for scene two',
      confidence: 1,
    });
    expect(markers[2]?.startMs).toBeGreaterThan(markers[1]!.startMs);
  });

  it('falls back to proportional markers without transcript words', () => {
    const markers = alignCaptureToStoryboard(storyboardFixture(), []);

    expect(markers).toEqual([
      {
        sceneId: 'scene-1',
        startMs: 0,
        endMs: 3000,
        confidence: 0.2,
        transcriptText: '',
      },
      {
        sceneId: 'scene-2',
        startMs: 3000,
        endMs: 7000,
        confidence: 0.2,
        transcriptText: '',
      },
      {
        sceneId: 'scene-3',
        startMs: 7000,
        endMs: 10000,
        confidence: 0.2,
        transcriptText: '',
      },
    ]);
  });
});

function storyboardFixture(): Storyboard {
  return {
    status: 'draft',
    intent: 'test capture alignment',
    totalDurationMs: 10000,
    costEstimateUsd: { low: 0, high: 0 },
    scenes: [
      {
        id: 'scene-1',
        durationMs: 3000,
        intent: 'Intro line for scene one',
        caption: { text: 'Intro line for scene one' },
        assetPlan: { kind: 'ai-image', prompt: 'intro' },
      },
      {
        id: 'scene-2',
        durationMs: 4000,
        intent: 'Product value proof for scene two',
        caption: { text: 'Product value proof for scene two' },
        assetPlan: { kind: 'ai-image', prompt: 'proof' },
      },
      {
        id: 'scene-3',
        durationMs: 3000,
        intent: 'Closing call to action',
        caption: { text: 'Closing call to action' },
        assetPlan: { kind: 'ai-image', prompt: 'closing' },
      },
    ],
  };
}

function subtitle(text: string): Subtitle {
  const words = text.split(/\s+/);
  return {
    id: 'subtitle-1',
    text,
    startMs: 0,
    endMs: words.length * 500,
    words: words.map((word, index) => ({
      text: word,
      startMs: index * 500,
      endMs: index * 500 + 400,
    })),
  };
}
