import { describe, expect, it } from 'vitest';

import { resolveTimelineProperty, type KeyframeTrack } from '../src';

describe('keyframe property resolver', () => {
  it('falls back to static clip properties when no keyframes exist', () => {
    expect(
      resolveTimelineProperty(
        { transforms: { opacity: 0.6, scale: 1.25 } },
        'opacity',
        500,
      ),
    ).toBe(0.6);
    expect(
      resolveTimelineProperty(
        { transforms: { opacity: 0.6, scale: 1.25 } },
        'scaleX',
        500,
      ),
    ).toBe(1.25);
  });

  it('holds values before the first key and after the last key', () => {
    const source = keyed('opacity', [
      { atMs: 250, value: 0.25 },
      { atMs: 750, value: 0.75 },
    ]);

    expect(resolveTimelineProperty(source, 'opacity', 0)).toBe(0.25);
    expect(resolveTimelineProperty(source, 'opacity', 1000)).toBe(0.75);
  });

  it('supports hold, linear, and smooth interpolation', () => {
    expect(
      resolveTimelineProperty(
        keyed('opacity', [
          { atMs: 0, value: 0, interp: 'hold' },
          { atMs: 1000, value: 1 },
        ]),
        'opacity',
        500,
      ),
    ).toBe(0);
    expect(
      resolveTimelineProperty(
        keyed('opacity', [
          { atMs: 0, value: 0, interp: 'linear' },
          { atMs: 1000, value: 1 },
        ]),
        'opacity',
        500,
      ),
    ).toBe(0.5);
    expect(
      resolveTimelineProperty(
        keyed('opacity', [
          { atMs: 0, value: 0, interp: 'smooth' },
          { atMs: 1000, value: 1 },
        ]),
        'opacity',
        250,
      ),
    ).toBeCloseTo(0.15625);
  });
});

function keyed(
  property: KeyframeTrack['property'],
  keys: KeyframeTrack['keys'],
): { keyframes: KeyframeTrack[] } {
  return { keyframes: [{ property, keys }] };
}
