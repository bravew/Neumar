import { describe, expect, it, vi } from 'vitest';

import type { RemotionVisualClip } from '@/components/video/preview/remotionPreviewData';
import { drawVisualLayer } from '@/components/video/preview/webcodecs/Compositor';

/**
 * Regression: the Phase A2 effect stack rendered only through
 * `@remotion/effects`, so the WebCodecs live preview — which is the default
 * renderer whenever WebCodecs is supported — ignored it entirely. Applying an
 * effect changed the project but nothing on screen.
 */
function recordingContext() {
  const filters: string[] = [];
  let current = 'none';
  const ctx = {
    get filter() {
      return current;
    },
    set filter(value: string) {
      current = value;
      filters.push(value);
    },
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    globalAlpha: 1,
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
  return { ctx, filters };
}

const SOURCE = {
  width: 1920,
  height: 1080,
} as unknown as Parameters<typeof drawVisualLayer>[0]['source'];

const DATA = { compositionWidth: 1280, compositionHeight: 720, fps: 30 };

function clip(overrides: Partial<RemotionVisualClip> = {}): RemotionVisualClip {
  return {
    id: 'clip-1',
    durationInFrames: 60,
    fromFrame: 0,
    label: 'clip.mp4',
    layer: 0,
    mediaKind: 'video',
    sourceEndFrame: 60,
    sourceStartFrame: 0,
    trackId: 'track-video',
    trackKind: 'video',
    ...overrides,
  };
}

describe('drawVisualLayer clip effects', () => {
  it('applies the effect stack to the canvas filter', () => {
    const { ctx, filters } = recordingContext();

    drawVisualLayer({
      clip: clip({
        effects: {
          schema: 'neuma.video.clip-effects.v1',
          effects: [
            {
              id: 'e1',
              version: 1,
              kind: 'brightness',
              params: { amount: 0.5 },
            },
          ],
        },
      }),
      ctx,
      data: DATA,
      frame: 0,
      source: SOURCE,
    });

    expect(filters).toContain('brightness(1.5)');
  });

  it('composes legacy filters and the effect stack, legacy first', () => {
    const { ctx, filters } = recordingContext();

    drawVisualLayer({
      clip: clip({
        filters: { saturation: 1.2 },
        effects: {
          schema: 'neuma.video.clip-effects.v1',
          effects: [
            { id: 'e1', version: 1, kind: 'contrast', params: { amount: 2 } },
          ],
        },
      }),
      ctx,
      data: DATA,
      frame: 0,
      source: SOURCE,
    });

    expect(filters).toContain('saturate(1.200) contrast(2)');
  });

  it('leaves the filter at none when the clip has neither', () => {
    const { ctx, filters } = recordingContext();

    drawVisualLayer({
      clip: clip(),
      ctx,
      data: DATA,
      frame: 0,
      source: SOURCE,
    });

    expect(filters.every((value) => value === 'none')).toBe(true);
  });
});
