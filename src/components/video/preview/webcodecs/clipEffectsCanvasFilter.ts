import {
  resolveClipEffectParameter,
  type ClipEffectStack,
} from '@neumar/video-ir';

/**
 * Clip effects in the WebCodecs live preview.
 *
 * The authoritative renderer for the Phase A2 effect stack is
 * `@remotion/effects`, which runs real shaders on the Remotion canvas. The
 * live preview composites with the Canvas 2D API, which has no shader hook —
 * so the preview approximates the stack with `ctx.filter`.
 *
 * The approximation is exact for brightness, contrast, saturation, and an
 * isotropic blur, because those map 1:1 onto CSS filter functions. It is
 * deliberately approximate for:
 *   - white balance, which has no CSS filter equivalent; a warm shift is
 *     modelled with sepia + a small hue rotation, a cool shift with hue
 *     rotation alone;
 *   - a single-axis blur, which CSS `blur()` cannot express — it blurs both
 *     axes.
 * The render path is unaffected and stays the source of truth for output.
 */

/** CSS `blur()` is isotropic, so a one-axis blur is softened rather than skipped. */
const SINGLE_AXIS_BLUR_SCALE = 0.5;
/** Hue degrees applied per unit of temperature/tint. Empirical, not physical. */
const TEMPERATURE_HUE_DEG = 12;
const TINT_HUE_DEG = 20;

export function buildClipEffectsCanvasFilter(
  stack: ClipEffectStack | undefined,
  localMs: number,
): string | undefined {
  if (!stack || stack.effects.length === 0) return undefined;
  const parts: string[] = [];
  for (const effect of stack.effects) {
    if (effect.disabled) continue;
    switch (effect.kind) {
      case 'brightness': {
        // Remotion's brightness is a -1..1 offset around neutral.
        const amount = resolveClipEffectParameter(
          stack,
          effect,
          'amount',
          localMs,
        );
        if (amount === 0) break;
        parts.push(`brightness(${format(Math.max(0, 1 + amount))})`);
        break;
      }
      case 'contrast': {
        const amount = resolveClipEffectParameter(
          stack,
          effect,
          'amount',
          localMs,
        );
        if (amount === 1) break;
        parts.push(`contrast(${format(Math.max(0, amount))})`);
        break;
      }
      case 'saturation': {
        const amount = resolveClipEffectParameter(
          stack,
          effect,
          'amount',
          localMs,
        );
        if (amount === 1) break;
        parts.push(`saturate(${format(Math.max(0, amount))})`);
        break;
      }
      case 'white-balance': {
        const temperature = resolveClipEffectParameter(
          stack,
          effect,
          'temperature',
          localMs,
        );
        const tint = resolveClipEffectParameter(stack, effect, 'tint', localMs);
        if (temperature > 0) {
          parts.push(`sepia(${format(clamp01(temperature * 0.6))})`);
          parts.push(
            `hue-rotate(${format(-temperature * TEMPERATURE_HUE_DEG)}deg)`,
          );
        } else if (temperature < 0) {
          parts.push(
            `hue-rotate(${format(-temperature * TEMPERATURE_HUE_DEG)}deg)`,
          );
          parts.push(`saturate(${format(1 + Math.abs(temperature) * 0.15)})`);
        }
        if (tint !== 0) {
          parts.push(`hue-rotate(${format(tint * TINT_HUE_DEG)}deg)`);
        }
        break;
      }
      case 'blur': {
        const radius = resolveClipEffectParameter(
          stack,
          effect,
          'radius',
          localMs,
        );
        if (radius <= 0) break;
        const horizontal = effect.params.horizontal !== false;
        const vertical = effect.params.vertical !== false;
        if (!horizontal && !vertical) break;
        const isotropic = horizontal && vertical;
        parts.push(
          `blur(${format(isotropic ? radius : radius * SINGLE_AXIS_BLUR_SCALE)}px)`,
        );
        break;
      }
      default: {
        // Compile-time exhaustiveness check only — an effect kind this build
        // does not know about is skipped, not returned as a filter value.
        const exhaustive: never = effect;
        void exhaustive;
        continue;
      }
    }
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function format(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(4))) : '0';
}
