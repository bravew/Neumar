import { describe, expect, it } from 'vitest';

import {
  deriveTimelineClipFrameFields,
  durationFramesToMs,
  durationMsToFrames,
  formatFrameRate,
  frameRatePresetById,
  frameRatePresetFor,
  frameRatePresets,
  frameRatesEqual,
  frameRateToNumber,
  frameToMs,
  msToFrame,
  normalizeFrameRate,
  parseFrameRate,
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

describe('frame rate presets', () => {
  it('stores NTSC presets as exact broadcast fractions', () => {
    expect(frameRatePresetById('23.976')?.rate).toEqual({
      num: 24_000,
      den: 1001,
    });
    expect(frameRatePresetById('29.97')?.rate).toEqual({
      num: 30_000,
      den: 1001,
    });
    expect(frameRatePresetById('59.94')?.rate).toEqual({
      num: 60_000,
      den: 1001,
    });
  });

  it('offers exactly the eight supported rates', () => {
    expect(frameRatePresets().map((preset) => preset.id)).toEqual([
      '23.976',
      '24',
      '25',
      '29.97',
      '30',
      '50',
      '59.94',
      '60',
    ]);
  });

  it('matches a preset through an unreduced fraction', () => {
    expect(frameRatePresetFor({ num: 60_000, den: 2002 })?.id).toBe('29.97');
  });

  it('snaps a typed NTSC decimal to the exact fraction', () => {
    expect(parseFrameRate('29.97')).toEqual({ num: 30_000, den: 1001 });
    expect(parseFrameRate('23.976')).toEqual({ num: 24_000, den: 1001 });
    // A plain integer is not an NTSC rate and must stay exact.
    expect(parseFrameRate('30')).toEqual({ num: 30, den: 1 });
  });

  it('parses explicit fractions and rejects nonsense', () => {
    expect(parseFrameRate('30000/1001')).toEqual({ num: 30_000, den: 1001 });
    expect(() => parseFrameRate('')).toThrow('must not be empty');
    expect(() => parseFrameRate('soon')).toThrow('Unrecognized frame rate');
  });

  it('formats rates the way editors label them', () => {
    expect(formatFrameRate({ num: 30_000, den: 1001 })).toBe('29.97');
    expect(formatFrameRate({ num: 24, den: 1 })).toBe('24');
  });

  it('compares rates by reduced value', () => {
    expect(
      frameRatesEqual({ num: 48_000, den: 2002 }, { num: 24_000, den: 1001 }),
    ).toBe(true);
    expect(frameRatesEqual({ num: 24_000, den: 1001 }, 24)).toBe(false);
  });
});
