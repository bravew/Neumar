type Brand<T, B extends string> = T & { readonly __brand: B };

export type TimelineMs = Brand<number, 'TimelineMs'>;
export type SourceMs = Brand<number, 'SourceMs'>;
export type TimelineFrame = Brand<number, 'TimelineFrame'>;
export type SourceFrame = Brand<number, 'SourceFrame'>;
export type FrameCount = Brand<number, 'FrameCount'>;
export type AudioSample = Brand<number, 'AudioSample'>;

export interface FrameRate {
  num: number;
  den: number;
}

export type FrameRateLike = number | FrameRate;
export type SnapPolicy = 'floor' | 'ceil' | 'nearest';

export interface TimelineClipTimingInput {
  startMs: number;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
}

export interface TimelineClipFrameFields {
  startFrame: number;
  durationFrames: number;
  endFrame: number;
  trimStartFrame: number;
  trimEndFrame: number;
}

const MS_PER_SECOND = 1000;
const MAX_DECIMAL_DENOMINATOR = 1_000_000;

export function normalizeFrameRate(rate: FrameRateLike): FrameRate {
  if (typeof rate === 'number') return frameRateFromNumber(rate);
  assertPositiveInteger(rate.num, 'Frame rate numerator');
  assertPositiveInteger(rate.den, 'Frame rate denominator');
  return reduceFrameRate({ num: rate.num, den: rate.den });
}

export function frameRateToNumber(rate: FrameRateLike): number {
  const normalized = normalizeFrameRate(rate);
  return normalized.num / normalized.den;
}

export function msToFrame(
  ms: number,
  rate: FrameRateLike,
  snap: SnapPolicy = 'nearest',
): TimelineFrame {
  assertNonNegativeFinite(ms, 'Timeline milliseconds');
  const normalized = normalizeFrameRate(rate);
  return brandTimelineFrame(
    snapNumber((ms * normalized.num) / (MS_PER_SECOND * normalized.den), snap),
  );
}

export function durationMsToFrames(
  ms: number,
  rate: FrameRateLike,
  snap: SnapPolicy = 'nearest',
): FrameCount {
  assertNonNegativeFinite(ms, 'Duration milliseconds');
  const normalized = normalizeFrameRate(rate);
  return brandFrameCount(
    snapNumber((ms * normalized.num) / (MS_PER_SECOND * normalized.den), snap),
  );
}

export function frameToMs(frame: number, rate: FrameRateLike): TimelineMs {
  assertNonNegativeFinite(frame, 'Timeline frame');
  const normalized = normalizeFrameRate(rate);
  return brandTimelineMs(
    (frame * MS_PER_SECOND * normalized.den) / normalized.num,
  );
}

export function durationFramesToMs(
  frames: number,
  rate: FrameRateLike,
): TimelineMs {
  assertNonNegativeFinite(frames, 'Frame duration');
  const normalized = normalizeFrameRate(rate);
  return brandTimelineMs(
    (frames * MS_PER_SECOND * normalized.den) / normalized.num,
  );
}

export function deriveTimelineClipFrameFields(
  clip: TimelineClipTimingInput,
  rate: FrameRateLike,
): TimelineClipFrameFields {
  const startFrame = msToFrame(clip.startMs, rate);
  const durationFrames = durationMsToFrames(clip.durationMs, rate);
  return {
    startFrame,
    durationFrames,
    endFrame: startFrame + durationFrames,
    trimStartFrame: msToFrame(clip.trimStartMs, rate),
    trimEndFrame: msToFrame(clip.trimEndMs, rate),
  };
}

function frameRateFromNumber(rate: number): FrameRate {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Frame rate must be a positive finite number');
  }
  if (Number.isInteger(rate)) return { num: rate, den: 1 };
  const decimalText = rate.toString();
  if (!decimalText.includes('.') || decimalText.includes('e')) {
    return reduceFrameRate({
      num: Math.round(rate * MAX_DECIMAL_DENOMINATOR),
      den: MAX_DECIMAL_DENOMINATOR,
    });
  }
  const decimals = Math.min(
    decimalText.slice(decimalText.indexOf('.') + 1).length,
    6,
  );
  const den = 10 ** decimals;
  return reduceFrameRate({ num: Math.round(rate * den), den });
}

function reduceFrameRate(rate: FrameRate): FrameRate {
  const divisor = gcd(rate.num, rate.den);
  return { num: rate.num / divisor, den: rate.den / divisor };
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
}

function snapNumber(value: number, policy: SnapPolicy): number {
  switch (policy) {
    case 'floor':
      return Math.floor(value);
    case 'ceil':
      return Math.ceil(value);
    case 'nearest':
      return Math.round(value);
    default: {
      const exhaustive: never = policy;
      return exhaustive;
    }
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
}

function brandTimelineMs(value: number): TimelineMs {
  return value as TimelineMs;
}

function brandTimelineFrame(value: number): TimelineFrame {
  return value as TimelineFrame;
}

function brandFrameCount(value: number): FrameCount {
  return value as FrameCount;
}
