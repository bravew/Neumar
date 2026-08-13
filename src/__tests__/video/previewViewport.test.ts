import { describe, expect, it } from 'vitest';

import {
  canvasToOverlay,
  clampCenter,
  frameRectInViewport,
  getFitScale,
  screenPixelsToLogicalThreshold,
  screenToCanvas,
} from '@/components/video/preview/webcodecs/previewViewport';

describe('preview viewport geometry', () => {
  it('computes fit scale for the output frame inside a viewport', () => {
    expect(
      getFitScale({
        canvasHeight: 200,
        canvasWidth: 100,
        viewportHeight: 1000,
        viewportWidth: 800,
      }),
    ).toBe(5);
  });

  it('maps the output frame rectangle into viewport coordinates', () => {
    expect(
      frameRectInViewport({
        canvasHeight: 100,
        canvasWidth: 200,
        centerX: 100,
        centerY: 50,
        scale: 2,
        viewportHeight: 300,
        viewportWidth: 600,
      }),
    ).toEqual({ h: 200, w: 400, x: 100, y: 50 });
  });

  it('round-trips canvas and overlay coordinates', () => {
    const geometry = {
      canvasHeight: 100,
      canvasWidth: 200,
      centerX: 80,
      centerY: 40,
      scale: 1.5,
      viewportHeight: 240,
      viewportWidth: 320,
    };
    const canvasPoint = { x: 123, y: 45 };
    const overlayPoint = canvasToOverlay(geometry, canvasPoint);

    expect(screenToCanvas(geometry, overlayPoint).x).toBeCloseTo(
      canvasPoint.x,
      6,
    );
    expect(screenToCanvas(geometry, overlayPoint).y).toBeCloseTo(
      canvasPoint.y,
      6,
    );
  });

  it('clamps pan center only when the zoomed frame exceeds the viewport', () => {
    expect(
      clampCenter({
        canvasHeight: 1000,
        canvasWidth: 1000,
        centerX: 900,
        centerY: -100,
        scale: 1,
        viewportHeight: 500,
        viewportWidth: 500,
      }),
    ).toMatchObject({ centerX: 750, centerY: 250 });

    expect(
      clampCenter({
        canvasHeight: 1000,
        canvasWidth: 1000,
        centerX: 900,
        centerY: 100,
        scale: 0.25,
        viewportHeight: 500,
        viewportWidth: 500,
      }),
    ).toMatchObject({ centerX: 500, centerY: 500 });
  });

  it('converts screen-pixel snap tolerances into composition units', () => {
    expect(screenPixelsToLogicalThreshold({ scale: 4 }, 8)).toBe(2);
  });
});
