import { describe, expect, it } from 'vitest';

import {
  coverScaleForAspect,
  fillFrameTransform,
  framePositionForFocus,
  nudgeFrameTransform,
} from './frameControls';

describe('frameControls', () => {
  it('computes cover zoom for landscape media in a vertical frame', () => {
    expect(coverScaleForAspect({ width: 4000, height: 3000 }, '9:16')).toBe(
      2.37,
    );
  });

  it('computes cover zoom for portrait media in a landscape frame', () => {
    expect(coverScaleForAspect({ width: 1080, height: 1920 }, '16:9')).toBe(
      3.16,
    );
  });

  it('falls back to neutral zoom without source dimensions', () => {
    expect(coverScaleForAspect(undefined, '9:16')).toBe(1);
  });

  it('maps left focus to a safe right-shifted media center', () => {
    const transform = fillFrameTransform(
      { width: 4000, height: 3000 },
      '9:16',
      { focusX: 0.2, focusY: 0.5 },
    );

    expect(transform.scale).toBe(2.37);
    expect(transform.positionX).toBe(1.185);
    expect(transform.positionY).toBe(0.5);
  });

  it('maps right focus to a safe left-shifted media center', () => {
    const transform = framePositionForFocus(
      { width: 4000, height: 3000 },
      '9:16',
      { scale: 2.37 },
      { focusX: 0.8, focusY: 0.5 },
    );

    expect(transform.positionX).toBe(-0.185);
    expect(transform.positionY).toBe(0.5);
  });

  it('clamps nudges to the safe covered-media bounds', () => {
    const transform = nudgeFrameTransform(
      { fit: 'contain', scale: 2.37, positionX: 1.18, positionY: 0.5 },
      { x: 0.2 },
      { width: 4000, height: 3000 },
      '9:16',
    );

    expect(transform.positionX).toBe(1.185);
    expect(transform.positionY).toBe(0.5);
  });
});
