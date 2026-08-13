import { describe, expect, it } from 'vitest';

import { clockWipeLayerStyles } from '@/shared/video/remotion-clock-wipe-presentation';
import {
  transitionPresentation,
  transitionFramesForClip,
  transitionTiming,
} from '@/shared/video/remotion-transition-presentations';

describe('remotion transition presentations', () => {
  it('uses preset defaults and max durations when computing transition frames', () => {
    expect(
      transitionFramesForClip(
        {
          durationInFrames: 120,
          fromFrame: 0,
          transitionToNext: 'fade',
        },
        { durationInFrames: 120, fromFrame: 120 },
        60,
      ),
    ).toBe(30);

    expect(
      transitionFramesForClip(
        {
          durationInFrames: 120,
          fromFrame: 0,
          transitionToNext: { kind: 'cube', durationMs: 5000 },
        },
        { durationInFrames: 120, fromFrame: 120 },
        30,
      ),
    ).toBe(45);
  });

  it('uses eased timing while preserving deterministic duration', () => {
    const timing = transitionTiming({ kind: 'slide' }, 20);

    expect(timing.getDurationInFrames({ fps: 30 })).toBe(20);
    expect(timing.getProgress({ fps: 30, frame: 5 })).toBeGreaterThan(0.25);
  });

  it('provides presentations for new parametric transition kinds', () => {
    const size = { height: 1080, width: 1920 };

    expect(
      transitionPresentation(
        { kind: 'soft-wipe', params: { angle: 45 } },
        size,
      ),
    ).toBeTruthy();
    expect(
      transitionPresentation({ kind: 'pixelize', params: { steps: 12 } }, size),
    ).toBeTruthy();
    expect(
      transitionPresentation(
        { kind: 'polygon-iris', params: { sides: 5 } },
        size,
      ),
    ).toBeTruthy();
  });

  it('passes clock wipe params into the backend Remotion presentation', () => {
    const presentation = transitionPresentation(
      {
        kind: 'clock-wipe',
        params: {
          center: [0.25, 0.75],
          edgeColor: [0.8, 0.1, 0.2, 0.7],
          feather: 0.13,
          sectors: 6,
          startAngle: 128,
          sweep: 'counterclockwise',
        },
      },
      { height: 1080, width: 1920 },
    );

    expect(presentation.props).toMatchObject({
      center: [0.25, 0.75],
      counterClockwise: true,
      edgeColor: [0.8, 0.1, 0.2, 0.7],
      feather: 0.13,
      height: 1080,
      sectors: 6,
      startAngleDeg: 128,
      width: 1920,
    });
  });

  it('masks the Remotion exiting layer for backend clock wipe', () => {
    const base = {
      center: [0.5, 0.5] as const,
      counterClockwise: true,
      edgeColor: [0.8, 0.1, 0.2, 1] as const,
      feather: 0.13,
      height: 1080,
      progress: 0.4,
      sectors: 1,
      startAngleDeg: 128,
      width: 1920,
    };

    const entering = clockWipeLayerStyles({
      ...base,
      presentationDirection: 'entering',
    });
    const exiting = clockWipeLayerStyles({
      ...base,
      presentationDirection: 'exiting',
    });

    expect(exiting.outerStyle.zIndex).toBeGreaterThan(
      Number(entering.outerStyle.zIndex),
    );
    expect(exiting.innerStyle.clipPath).toContain('polygon(');
    expect(exiting.edgeStyle).toMatchObject({
      backgroundColor: 'rgba(204, 26, 51, 1)',
    });
    expect(entering.innerStyle.clipPath).toBeUndefined();
  });

  it('uses a headless-safe backend dissolve presentation', () => {
    expect(
      transitionPresentation(
        { kind: 'dissolve' },
        { height: 1080, width: 1920 },
      ).props,
    ).toMatchObject({ mode: 'dissolve' });
    expect(
      transitionPresentation(
        { kind: 'pixelize' },
        { height: 1080, width: 1920 },
      ).props,
    ).toMatchObject({ mode: 'pixelize-fallback' });
  });
});
