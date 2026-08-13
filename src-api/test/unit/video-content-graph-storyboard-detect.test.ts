import { describe, expect, it } from 'vitest';

import {
  htmlStoryboardTemplateId,
  isHtmlSeededScene,
  isHtmlStoryboard,
} from '@/shared/video/content-graph/storyboard-detect';
import type { Storyboard, StoryboardScene } from '@/shared/video/types';

const sceneWithoutSeed = (id: string): StoryboardScene => ({
  id,
  durationMs: 1000,
  intent: 'data',
  assetPlan: { kind: 'existing', assetId: `media-${id}` },
});

const sceneWithSeed = (id: string, templateId: string): StoryboardScene => ({
  ...sceneWithoutSeed(id),
  htmlFrameSeed: {
    nodeId: id,
    templateId,
    engine: 'html',
    variables: { text: id },
  },
});

const sb = (scenes: StoryboardScene[]): Storyboard => ({
  status: 'draft',
  intent: 'explainer',
  totalDurationMs: scenes.reduce((sum, s) => sum + s.durationMs, 0),
  costEstimateUsd: { low: 0, high: 0 },
  scenes,
});

describe('isHtmlStoryboard', () => {
  it('returns false for undefined / null / no scenes', () => {
    expect(isHtmlStoryboard()).toBe(false);
    expect(isHtmlStoryboard(null)).toBe(false);
    expect(isHtmlStoryboard(sb([]))).toBe(false);
  });

  it('returns false when no scene carries htmlFrameSeed', () => {
    expect(
      isHtmlStoryboard(sb([sceneWithoutSeed('a'), sceneWithoutSeed('b')])),
    ).toBe(false);
  });

  it('returns true if any scene carries htmlFrameSeed (mixed allowed)', () => {
    expect(
      isHtmlStoryboard(
        sb([sceneWithoutSeed('a'), sceneWithSeed('b', 'frame-bold')]),
      ),
    ).toBe(true);
    expect(isHtmlStoryboard(sb([sceneWithSeed('only', 'frame-bold')]))).toBe(
      true,
    );
  });

  it('per-scene predicate also exposes the type guard', () => {
    const seeded = sceneWithSeed('a', 'frame-bold');
    if (isHtmlSeededScene(seeded)) {
      expect(seeded.htmlFrameSeed.nodeId).toBe('a');
    }
    expect(isHtmlSeededScene(sceneWithoutSeed('a'))).toBe(false);
  });
});

describe('htmlStoryboardTemplateId', () => {
  it('returns the unique templateId across HTML scenes', () => {
    const result = htmlStoryboardTemplateId(
      sb([
        sceneWithSeed('a', 'frame-bold'),
        sceneWithSeed('b', 'frame-bold'),
        // non-seeded scenes are ignored
        sceneWithoutSeed('c'),
      ]),
    );
    expect(result).toBe('frame-bold');
  });

  it('throws if no HTML scenes are present', () => {
    expect(() => htmlStoryboardTemplateId(sb([sceneWithoutSeed('a')]))).toThrow(
      /no HTML-seeded scenes/,
    );
  });

  it('throws if scenes mix templateIds (lowering compiler bug surface)', () => {
    expect(() =>
      htmlStoryboardTemplateId(
        sb([
          sceneWithSeed('a', 'frame-bold'),
          sceneWithSeed('b', 'frame-data'),
        ]),
      ),
    ).toThrow(/mixes 2 templates/);
  });
});
