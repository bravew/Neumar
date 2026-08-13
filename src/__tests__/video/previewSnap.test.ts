import { describe, expect, it } from 'vitest';

import {
  snapPosition,
  snapRotation,
  snapScale,
} from '@/components/video/preview/webcodecs/previewSnap';
import type { PreviewViewportGeometry } from '@/components/video/preview/webcodecs/previewViewport';

describe('preview snap', () => {
  it('snaps a clip center to the frame center within screen tolerance', () => {
    const result = snapPosition({
      boundsHeight: 100,
      boundsWidth: 100,
      transform: transform({ positionX: 0.504, positionY: 0.5 }),
      viewport: viewport(),
    });

    expect(result.transform.positionX).toBe(0.5);
    expect(result.guides).toContainEqual({ axis: 'x', position: 500 });
  });

  it('snaps clip edges to frame edges', () => {
    const result = snapPosition({
      boundsHeight: 100,
      boundsWidth: 100,
      transform: transform({ positionX: 0.049, positionY: 0.5 }),
      viewport: viewport(),
    });

    expect(result.transform.positionX).toBe(0.05);
    expect(result.guides).toContainEqual({ axis: 'x', position: 0 });
  });

  it('snaps scale handles to frame edges', () => {
    const result = snapScale({
      handle: 'scale-e',
      startBoundsHeight: 180,
      startBoundsWidth: 180,
      startTransform: transform({ positionX: 0.9 }),
      transform: transform({ positionX: 0.9, scaleX: 1.1 }),
      viewport: viewport(),
    });

    expect(result.transform.scaleX).toBeCloseTo(10 / 9, 6);
    expect(result.guides).toContainEqual({ axis: 'x', position: 1000 });
  });

  it('snaps rotation to right angles within five degrees', () => {
    expect(snapRotation(88)).toBe(90);
    expect(snapRotation(84)).toBe(84);
  });
});

function viewport(): PreviewViewportGeometry {
  return {
    canvasHeight: 1000,
    canvasWidth: 1000,
    centerX: 500,
    centerY: 500,
    scale: 1,
    viewportHeight: 1000,
    viewportWidth: 1000,
  };
}

function transform(
  overrides: Partial<{
    positionX: number;
    positionY: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  }> = {},
) {
  return {
    positionX: 0.5,
    positionY: 0.5,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    ...overrides,
  };
}
