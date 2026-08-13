import { describe, expect, it, vi } from 'vitest';

import type { RemotionPreviewData } from '@/components/video/preview/remotionPreviewData';
import { drawWebCodecsFrame } from '@/components/video/preview/webcodecs/Compositor';
import type { WebCodecsVisualLayer } from '@/components/video/preview/webcodecs/sceneModel';

describe('WebCodecs compositor viewport render', () => {
  it('renders through the viewport transform without clipping and marks the frame', () => {
    const ctx = createMockCanvasContext();
    const source = { height: 50, width: 100 } as CanvasImageSource;

    drawWebCodecsFrame({
      ctx,
      data: previewData(),
      dpr: 2,
      frame: 0,
      layers: [
        {
          kind: 'image',
          layer: {
            clip: clip({
              mediaKind: 'image',
              transform: { positionX: 0.75, scale: 1.5 },
            }) as Extract<WebCodecsVisualLayer, { kind: 'image' }>['clip'],
            kind: 'image',
            timelineFrame: 0,
          },
          source,
        },
      ],
      viewport: {
        canvasHeight: 100,
        canvasWidth: 200,
        centerX: 100,
        centerY: 50,
        scale: 1,
        viewportHeight: 300,
        viewportWidth: 400,
      },
    });

    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 400, 300);
    expect(ctx.translate).toHaveBeenCalledWith(100, 100);
    expect(ctx.scale).toHaveBeenCalledWith(1, 1);
    expect(ctx.translate).toHaveBeenCalledWith(50, 0);
    expect(ctx.scale).toHaveBeenCalledWith(1.5, 1.5);
    expect(ctx.clip).not.toHaveBeenCalled();
    expect(ctx.strokeRect).toHaveBeenCalledWith(100, 100, 200, 100);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(2);

    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 400, 100);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 200, 400, 100);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 100, 100, 100);
    expect(ctx.fillRect).toHaveBeenCalledWith(300, 100, 100, 100);
  });
});

function createMockCanvasContext(): CanvasRenderingContext2D & {
  clip: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
} {
  return {
    clip: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 1 })),
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    strokeRect: vi.fn(),
    strokeText: vi.fn(),
    translate: vi.fn(),
  } as unknown as CanvasRenderingContext2D & {
    clip: ReturnType<typeof vi.fn>;
    clearRect: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    scale: ReturnType<typeof vi.fn>;
    setTransform: ReturnType<typeof vi.fn>;
    strokeRect: ReturnType<typeof vi.fn>;
    translate: ReturnType<typeof vi.fn>;
  };
}

function previewData(): RemotionPreviewData {
  return {
    vividOverlays: [],
    audioClips: [],
    captions: [],
    compositionHeight: 100,
    compositionWidth: 200,
    durationInFrames: 30,
    fps: 30,
    visualClips: [],
  };
}

function clip(
  overrides: Partial<RemotionPreviewData['visualClips'][number]> = {},
): RemotionPreviewData['visualClips'][number] {
  return {
    durationInFrames: 30,
    fromFrame: 0,
    id: 'clip',
    label: 'clip.png',
    layer: 0,
    mediaKind: 'image',
    sourceEndFrame: 30,
    sourceStartFrame: 0,
    src: '/clip.png',
    trackId: 'track',
    trackKind: 'overlay',
    ...overrides,
  };
}
