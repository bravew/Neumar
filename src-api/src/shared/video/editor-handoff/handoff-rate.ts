import {
  frameRateToNumber,
  normalizeFrameRate,
  type FrameRate,
} from '@neumar/video-ir';

import type { EditorHandoffModel } from './types';

/**
 * The exact rate an interchange writer should conform to.
 *
 * Models built before the timebase contract carry only the numeric `fps`, so
 * fall back to it; anything written after carries the rational rate and this
 * returns it unrounded. Every writer goes through here rather than reading
 * `model.fps` directly, which is how a 29.97 project stops being exported as 30.
 */
export function handoffRate(
  model: Pick<EditorHandoffModel, 'fps' | 'frameRate'>,
): FrameRate {
  return normalizeFrameRate(model.frameRate ?? model.fps);
}

/** The integer timebase NLE formats display, e.g. 30 for a 30000/1001 project. */
export function handoffTimebase(rate: FrameRate): number {
  return Math.round(frameRateToNumber(rate));
}

/** True for the NTSC pulldown rates, which several formats flag explicitly. */
export function isNtscRate(rate: FrameRate): boolean {
  return rate.den !== 1;
}
