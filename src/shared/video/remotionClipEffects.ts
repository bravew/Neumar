import {
  resolveClipEffectParameter,
  type ClipEffectStack,
} from '@neumar/video-ir';
import { blur } from '@remotion/effects/blur';
import { brightness } from '@remotion/effects/brightness';
import { contrast } from '@remotion/effects/contrast';
import { saturation } from '@remotion/effects/saturation';
import { whiteBalance } from '@remotion/effects/white-balance';
import type { EffectsProp } from 'remotion';

export function buildRemotionClipEffects(
  stack: ClipEffectStack | undefined,
  localMs: number,
): EffectsProp {
  if (!stack) return [];
  return stack.effects.flatMap((effect) => {
    if (effect.disabled) return [];
    switch (effect.kind) {
      case 'brightness':
        return [
          brightness({
            amount: resolveClipEffectParameter(
              stack,
              effect,
              'amount',
              localMs,
            ),
          }),
        ];
      case 'contrast':
        return [
          contrast({
            amount: resolveClipEffectParameter(
              stack,
              effect,
              'amount',
              localMs,
            ),
          }),
        ];
      case 'saturation':
        return [
          saturation({
            amount: resolveClipEffectParameter(
              stack,
              effect,
              'amount',
              localMs,
            ),
          }),
        ];
      case 'white-balance':
        return [
          whiteBalance({
            temperature: resolveClipEffectParameter(
              stack,
              effect,
              'temperature',
              localMs,
            ),
            tint: resolveClipEffectParameter(stack, effect, 'tint', localMs),
          }),
        ];
      case 'blur':
        return [
          blur({
            radius: resolveClipEffectParameter(
              stack,
              effect,
              'radius',
              localMs,
            ),
            horizontal: effect.params.horizontal,
            vertical: effect.params.vertical,
          }),
        ];
      default: {
        const exhaustive: never = effect;
        return exhaustive;
      }
    }
  });
}
