import { describe, expect, it } from 'vitest';

import {
  compatibilityFps,
  deriveProjectTimebase,
  resolveTimebase,
} from '@/shared/video/timebase';
import type { MediaItem } from '@/shared/video/types';

function asset(id: string, frameRate?: number): MediaItem {
  return {
    id,
    kind: 'video',
    source: 'user',
    path: `assets/${id}.mp4`,
    metadata: { durationMs: 1000, ...(frameRate ? { frameRate } : {}) },
  } as MediaItem;
}

describe('project timebase derivation', () => {
  it('keeps NTSC sources rational instead of rounding them', () => {
    const derived = deriveProjectTimebase([asset('a', 23.976)]);

    expect(derived.rate).toEqual({ num: 24_000, den: 1001 });
    expect(derived.reason).toBe('single-rate');
    // The old deriveTimelineFps returned Math.round(23.976) === 24.
    expect(derived.rate.den).not.toBe(1);
  });

  it('snaps 29.97 to the exact broadcast fraction', () => {
    expect(deriveProjectTimebase([asset('a', 29.97)]).rate).toEqual({
      num: 30_000,
      den: 1001,
    });
  });

  it('surveys every asset rather than the first one with a rate', () => {
    // The old implementation returned 24 here, because asset-a came first.
    const derived = deriveProjectTimebase([
      asset('a', 24),
      asset('b', 30),
      asset('c', 30),
    ]);

    expect(derived.rate).toEqual({ num: 30, den: 1 });
    expect(derived.reason).toBe('majority-rate');
    expect(derived.observations).toHaveLength(3);
    expect(derived.conflicts).toEqual([
      { rate: { num: 24, den: 1 }, assetIds: ['a'] },
    ]);
  });

  it('reports a tie as a conflict and names the losing rate', () => {
    const derived = deriveProjectTimebase([asset('a', 24), asset('b', 30)]);

    expect(derived.reason).toBe('conflicting-rates');
    // Ties break upward: conforming down loses frames conforming up does not.
    expect(derived.rate).toEqual({ num: 30, den: 1 });
    expect(derived.conflicts).toEqual([
      { rate: { num: 24, den: 1 }, assetIds: ['a'] },
    ]);
  });

  it('groups unreduced duplicates of the same rate', () => {
    const derived = deriveProjectTimebase([
      asset('a', 29.97),
      asset('b', 29.97),
    ]);

    expect(derived.reason).toBe('single-rate');
    expect(derived.conflicts).toEqual([]);
  });

  it('falls back to 30 with a reason when no asset carries a rate', () => {
    const derived = deriveProjectTimebase([asset('a'), asset('b')]);

    expect(derived.rate).toEqual({ num: 30, den: 1 });
    expect(derived.reason).toBe('no-sources');
    expect(derived.observations).toEqual([]);
  });

  it('ignores zero and non-finite rates', () => {
    const derived = deriveProjectTimebase([
      asset('a', 0),
      asset('b', Number.NaN),
      asset('c', 25),
    ]);

    expect(derived.rate).toEqual({ num: 25, den: 1 });
    expect(derived.observations.map((entry) => entry.assetId)).toEqual(['c']);
  });
});

describe('resolveTimebase', () => {
  it('prefers a stored user choice over anything derived', () => {
    expect(
      resolveTimebase({
        stored: {
          rate: { num: 24_000, den: 1001 },
          source: 'user',
          locked: true,
        },
        timeline: { fps: 30 },
        assets: [asset('a', 60)],
      }),
    ).toEqual({
      rate: { num: 24_000, den: 1001 },
      source: 'user',
      locked: true,
    });
  });

  it('reads a legacy project through its numeric fps without rewriting it', () => {
    expect(resolveTimebase({ timeline: { fps: 30 } })).toEqual({
      rate: { num: 30, den: 1 },
      source: 'derived',
      locked: false,
    });
  });

  it('prefers a timeline rational rate over the numeric compatibility field', () => {
    expect(
      resolveTimebase({
        timeline: { fps: 29.97, frameRate: { num: 30_000, den: 1001 } },
      }).rate,
    ).toEqual({ num: 30_000, den: 1001 });
  });

  it('derives from assets when the project has no timeline yet', () => {
    expect(resolveTimebase({ assets: [asset('a', 25)] }).rate).toEqual({
      num: 25,
      den: 1,
    });
  });
});

describe('compatibilityFps', () => {
  it('emits the decimal older builds expect', () => {
    expect(compatibilityFps({ num: 30_000, den: 1001 })).toBe(29.97);
    expect(compatibilityFps({ num: 24_000, den: 1001 })).toBe(23.976);
    expect(compatibilityFps({ num: 25, den: 1 })).toBe(25);
  });
});
