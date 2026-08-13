import { describe, expect, it } from 'vitest';

import {
  clockWipeClipPath,
  clockWipeLayerStyles,
} from '@/components/video/preview/remotionClockWipePresentation';
import {
  transitionPresentation,
  transitionFramesForClip,
  transitionTiming,
} from '@/components/video/preview/remotionTransitionPresentations';

describe('remotionTransitionPresentations', () => {
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

  it('passes clock wipe params into the Remotion presentation', () => {
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

  it('builds different Remotion clock wipe masks for sweep direction', () => {
    const base = {
      center: [0.5, 0.5] as const,
      edgeColor: [1, 1, 1, 1] as const,
      feather: 0.015,
      height: 1080,
      progress: 0.25,
      sectors: 1,
      startAngleDeg: 90,
      width: 1920,
    };

    expect(clockWipeClipPath({ ...base, counterClockwise: true })).not.toEqual(
      clockWipeClipPath({ ...base, counterClockwise: false }),
    );
  });

  it('masks the Remotion exiting layer for clock wipe', () => {
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
});
