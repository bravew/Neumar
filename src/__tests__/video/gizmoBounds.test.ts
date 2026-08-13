import { describe, expect, it } from 'vitest';

import {
  hitTestOverlayLayers,
  layerBoundsToGizmoBounds,
  transformForDrag,
  type EditCanvasDragState,
  type OverlayLayerBounds,
} from '@/components/video/preview/EditCanvasOverlayModel';
import { gizmoHandlePosition } from '@/components/video/preview/gizmoHandles';
import type { RemotionPreviewData } from '@/components/video/preview/remotionPreviewData';
import type { PreviewViewportGeometry } from '@/components/video/preview/webcodecs/previewViewport';

describe('edit canvas gizmo bounds', () => {
  it('places resize handles around the unrotated gizmo box', () => {
    expect(
      gizmoHandlePosition({ h: 100, w: 200 }, { x: 0.5, y: -0.5 }),
    ).toEqual({ x: 100, y: -50 });
  });

  it('maps transformed layer bounds into overlay coordinates', () => {
    const bounds = layerBoundsToGizmoBounds({
      clip: clip({
        transform: { positionX: 0.75, rotation: 12, scale: 1.5 },
      }),
      data: previewData(),
      sourceSize: { height: 50, width: 100 },
      viewport: viewport(),
    });

    expect(bounds).toEqual({
      cx: 300,
      cy: 100,
      h: 300,
      rotation: 12,
      w: 600,
    });
  });

  it('hit-tests the topmost layer in overlay coordinates', () => {
    const lower = overlayLayer('lower', {
      cx: 100,
      cy: 100,
      h: 100,
      rotation: 0,
      w: 100,
    });
    const upper = overlayLayer('upper', {
      cx: 100,
      cy: 100,
      h: 50,
      rotation: 0,
      w: 50,
    });

    expect(
      hitTestOverlayLayers([lower, upper], { x: 100, y: 100 })?.clipId,
    ).toBe('upper');
    expect(hitTestOverlayLayers([lower, upper], { x: 160, y: 100 })).toBeNull();
  });

  it('converts move pointer deltas into normalized clip position', () => {
    const next = transformForDrag({
      drag: dragState({ handle: 'move' }),
      event: { clientX: 210, clientY: 120, shiftKey: false },
      viewport: viewport({
        canvasHeight: 500,
        canvasWidth: 1000,
        scale: 2,
      }),
    });

    expect(next.positionX).toBeCloseTo(0.6, 6);
    expect(next.positionY).toBeCloseTo(0.6, 6);
  });

  it('scales uniformly from corner handles', () => {
    const next = transformForDrag({
      drag: dragState({ handle: 'scale-ne' }),
      event: { clientX: 175, clientY: 25, shiftKey: false },
      viewport: viewport(),
    });

    expect(next.scaleX).toBeCloseTo(1.5, 6);
    expect(next.scaleY).toBeCloseTo(1.5, 6);
  });
});

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
    label: 'clip.mp4',
    layer: 0,
    mediaKind: 'video',
    sourceEndFrame: 30,
    sourceStartFrame: 0,
    src: '/clip.mp4',
    trackId: 'track',
    trackKind: 'video',
    ...overrides,
  };
}

function viewport(
  overrides: Partial<PreviewViewportGeometry> = {},
): PreviewViewportGeometry {
  return {
    canvasHeight: 100,
    canvasWidth: 200,
    centerX: 100,
    centerY: 50,
    scale: 2,
    viewportHeight: 200,
    viewportWidth: 400,
    ...overrides,
  };
}

function overlayLayer(
  clipId: string,
  bounds: OverlayLayerBounds['bounds'],
): OverlayLayerBounds {
  return {
    bounds,
    clip: clip({ id: clipId }),
    clipId,
    sourceSize: { height: 100, width: 100 },
  };
}

function dragState(
  overrides: Partial<EditCanvasDragState> = {},
): EditCanvasDragState {
  const startTransform = {
    positionX: 0.5,
    positionY: 0.5,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };
  return {
    clipId: 'clip',
    handle: 'move',
    latestTransform: startTransform,
    pointerId: 1,
    startBounds: { cx: 100, cy: 100, h: 100, rotation: 0, w: 100 },
    startCenterClientX: 100,
    startCenterClientY: 100,
    startClientX: 10,
    startClientY: 20,
    startRotationAngle: 0,
    startTransform,
    ...overrides,
  };
}
