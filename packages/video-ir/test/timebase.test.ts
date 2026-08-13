import { describe, expect, it } from 'vitest';

import {
  deriveTimelineClipFrameFields,
  durationFramesToMs,
  durationMsToFrames,
  frameRateToNumber,
  frameToMs,
  msToFrame,
  normalizeFrameRate,
} from '../src/timebase.js';

describe('timebase helpers', () => {
  it('converts exact NTSC frame rates without one-frame drift', () => {
    const rate = { num: 30_000, den: 1001 };

    expect(normalizeFrameRate(rate)).toEqual(rate);
    expect(frameRateToNumber(rate)).toBeCloseTo(29.97002997);
    expect(msToFrame(1001, rate)).toBe(30);
    expect(durationMsToFrames(1001, rate)).toBe(30);
    expect(frameToMs(30, rate)).toBe(1001);
    expect(durationFramesToMs(30, rate)).toBe(1001);
  });

  it('supports explicit snap policies for compatibility millisecond inputs', () => {
    const rate = { num: 24_000, den: 1001 };

    expect(msToFrame(42, rate, 'floor')).toBe(1);
    expect(msToFrame(42, rate, 'ceil')).toBe(2);
    expect(msToFrame(42, rate, 'nearest')).toBe(1);
  });

  it('derives frame-rich timing fields from v1 millisecond clips', () => {
    expect(
      deriveTimelineClipFrameFields(
        {
          startMs: 1001,
          durationMs: 2002,
          trimStartMs: 0,
          trimEndMs: 2002,
        },
        { num: 30_000, den: 1001 },
      ),
    ).toEqual({
      startFrame: 30,
      durationFrames: 60,
      endFrame: 90,
      trimStartFrame: 0,
      trimEndFrame: 60,
    });
  });

  it('keeps legacy numeric fps accepted as a reduced rational', () => {
    expect(normalizeFrameRate(29.97)).toEqual({ num: 2997, den: 100 });
    expect(msToFrame(1000, 29.97)).toBe(30);
  });

  it('rejects invalid rates and negative times at the boundary', () => {
    expect(() => normalizeFrameRate({ num: 0, den: 1 })).toThrow(
      'Frame rate numerator',
    );
    expect(() => msToFrame(-1, 24)).toThrow('Timeline milliseconds');
  });
});
