import {
  CLIP_EFFECT_CATALOG,
  createClipEffect,
  type ClipEffectStack,
} from '@neumar/video-ir';
import { describe, expect, it } from 'vitest';

import { buildRemotionClipEffects } from '@/shared/video/remotion-clip-effects';

describe('Remotion clip effect catalog', () => {
  it('resolves every runtime catalog entry to an installed effect export', () => {
    for (const entry of CLIP_EFFECT_CATALOG) {
      const stack: ClipEffectStack = {
        schema: 'neuma.video.clip-effects.v1',
        effects: [createClipEffect(entry.kind)],
      };

      expect(buildRemotionClipEffects(stack, 0), entry.kind).toHaveLength(1);
    }
  });

  it('omits disabled effects', () => {
    const effect = createClipEffect('brightness');
    const stack: ClipEffectStack = {
      schema: 'neuma.video.clip-effects.v1',
      effects: [{ ...effect, disabled: true }],
    };

    expect(buildRemotionClipEffects(stack, 0)).toEqual([]);
  });
});
