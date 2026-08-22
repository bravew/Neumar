import type { ClipEffectStack } from '@neumar/video-ir';
import { describe, expect, it, vi } from 'vitest';

import { buildClipEffectsCanvasFilter } from '@/components/video/preview/webcodecs/clipEffectsCanvasFilter';

function stack(effects: ClipEffectStack['effects']): ClipEffectStack {
  return { schema: 'neuma.video.clip-effects.v1', effects };
}

describe('buildClipEffectsCanvasFilter', () => {
  it('returns nothing for an absent or empty stack', () => {
    expect(buildClipEffectsCanvasFilter(undefined, 0)).toBeUndefined();
    expect(buildClipEffectsCanvasFilter(stack([]), 0)).toBeUndefined();
  });

  it('maps brightness from a -1..1 offset onto the CSS multiplier', () => {
    expect(
      buildClipEffectsCanvasFilter(
        stack([
          { id: 'a', version: 1, kind: 'brightness', params: { amount: 0.9 } },
        ]),
        0,
      ),
    ).toBe('brightness(1.9)');
  });

  it('maps contrast, saturation, and blur one-to-one', () => {
    expect(
      buildClipEffectsCanvasFilter(
        stack([
          { id: 'a', version: 1, kind: 'contrast', params: { amount: 1.4 } },
          { id: 'b', version: 1, kind: 'saturation', params: { amount: 0.5 } },
          {
            id: 'c',
            version: 1,
            kind: 'blur',
            params: { radius: 8, horizontal: true, vertical: true },
          },
        ]),
        0,
      ),
    ).toBe('contrast(1.4) saturate(0.5) blur(8px)');
  });

  it('skips neutral values so the canvas filter stays "none" when nothing is set', () => {
    expect(
      buildClipEffectsCanvasFilter(
        stack([
          { id: 'a', version: 1, kind: 'brightness', params: { amount: 0 } },
          { id: 'b', version: 1, kind: 'contrast', params: { amount: 1 } },
          { id: 'c', version: 1, kind: 'saturation', params: { amount: 1 } },
          {
            id: 'd',
            version: 1,
            kind: 'blur',
            params: { radius: 0, horizontal: true, vertical: true },
          },
        ]),
        0,
      ),
    ).toBeUndefined();
  });

  it('skips a disabled effect', () => {
    expect(
      buildClipEffectsCanvasFilter(
        stack([
          {
            id: 'a',
            version: 1,
            kind: 'brightness',
            params: { amount: 0.5 },
            disabled: true,
          },
          { id: 'b', version: 1, kind: 'contrast', params: { amount: 2 } },
        ]),
        0,
      ),
    ).toBe('contrast(2)');
  });

  it('approximates a warm white balance with sepia and a hue shift', () => {
    const filter = buildClipEffectsCanvasFilter(
      stack([
        {
          id: 'a',
          version: 1,
          kind: 'white-balance',
          params: { temperature: 0.5, tint: 0 },
        },
      ]),
      0,
    );
    expect(filter).toContain('sepia(');
    expect(filter).toContain('hue-rotate(-6deg)');
  });

  it('softens a single-axis blur, which CSS blur() cannot express', () => {
    expect(
      buildClipEffectsCanvasFilter(
        stack([
          {
            id: 'a',
            version: 1,
            kind: 'blur',
            params: { radius: 10, horizontal: true, vertical: false },
          },
        ]),
        0,
      ),
    ).toBe('blur(5px)');
  });

  it('drops a blur with both axes disabled', () => {
    expect(
      buildClipEffectsCanvasFilter(
        stack([
          {
            id: 'a',
            version: 1,
            kind: 'blur',
            params: { radius: 10, horizontal: false, vertical: false },
          },
        ]),
        0,
      ),
    ).toBeUndefined();
  });

  it('never emits a negative brightness multiplier', () => {
    expect(
      buildClipEffectsCanvasFilter(
        stack([
          { id: 'a', version: 1, kind: 'brightness', params: { amount: -3 } },
        ]),
        0,
      ),
    ).toBe('brightness(0)');
  });
});

describe('reportPreviewAudioFailure', () => {
  it('stays silent for an abort, which is a normal stop, not a fault', async () => {
    const { reportPreviewAudioFailure } =
      await import('@/components/video/preview/webcodecs/audioFailure');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    reportPreviewAudioFailure(new DOMException('Aborted', 'AbortError'));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('logs a decode failure without throwing, so playback continues', async () => {
    const { reportPreviewAudioFailure } =
      await import('@/components/video/preview/webcodecs/audioFailure');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() =>
      reportPreviewAudioFailure(new Error('Unable to decode audio data')),
    ).not.toThrow();
    warn.mockRestore();
  });
});
