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

// The eight rates the project settings offer. NTSC entries are stored as the
// exact broadcast fractions, never as 23.976 / 29.97 / 59.94 decimals: rounding
// those to 24 / 30 / 60 is precisely the drift this contract exists to stop.
export const FRAME_RATE_PRESETS = [
  {
    id: '23.976',
    label: '23.976 (NTSC film)',
    rate: { num: 24_000, den: 1001 },
  },
  { id: '24', label: '24', rate: { num: 24, den: 1 } },
  { id: '25', label: '25 (PAL)', rate: { num: 25, den: 1 } },
  { id: '29.97', label: '29.97 (NTSC)', rate: { num: 30_000, den: 1001 } },
  { id: '30', label: '30', rate: { num: 30, den: 1 } },
  { id: '50', label: '50 (PAL)', rate: { num: 50, den: 1 } },
  { id: '59.94', label: '59.94 (NTSC)', rate: { num: 60_000, den: 1001 } },
  { id: '60', label: '60', rate: { num: 60, den: 1 } },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  rate: FrameRate;
}>;

export type FrameRatePresetId = (typeof FRAME_RATE_PRESETS)[number]['id'];

export interface FrameRatePreset {
  id: FrameRatePresetId;
  label: string;
  rate: FrameRate;
}

export function frameRatePresets(): FrameRatePreset[] {
  return FRAME_RATE_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    rate: { ...preset.rate },
  }));
}

export function frameRatePresetById(id: string): FrameRatePreset | undefined {
  const preset = FRAME_RATE_PRESETS.find((entry) => entry.id === id);
  return preset
    ? { id: preset.id, label: preset.label, rate: { ...preset.rate } }
    : undefined;
}

// A rate matches a preset when the reduced fractions are equal, so a caller
// that hands us `{num: 48000, den: 2002}` still lands on 23.976.
export function frameRatePresetFor(
  rate: FrameRateLike,
): FrameRatePreset | undefined {
  const normalized = normalizeFrameRate(rate);
  const preset = FRAME_RATE_PRESETS.find((entry) => {
    const candidate = normalizeFrameRate(entry.rate);
    return candidate.num === normalized.num && candidate.den === normalized.den;
  });
  return preset
    ? { id: preset.id, label: preset.label, rate: { ...preset.rate } }
    : undefined;
}

// Accepts a preset id, a decimal string, or a `num/den` pair as text. Decimals
// that are within half a frame of an NTSC preset snap to the exact fraction —
// `29.97` typed by a user means 30000/1001, not 2997/100.
export function parseFrameRate(input: string | FrameRateLike): FrameRate {
  if (typeof input !== 'string') return normalizeFrameRate(input);
  const text = input.trim();
  if (!text) throw new Error('Frame rate must not be empty');

  const preset = frameRatePresetById(text);
  if (preset) return { ...preset.rate };

  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (fraction) {
    return normalizeFrameRate({
      num: Number(fraction[1]),
      den: Number(fraction[2]),
    });
  }

  const decimal = Number(text);
  if (!Number.isFinite(decimal) || decimal <= 0) {
    throw new Error(`Unrecognized frame rate: ${input}`);
  }
  const near = FRAME_RATE_PRESETS.find(
    (entry) =>
      Math.abs(entry.rate.num / entry.rate.den - decimal) < 0.005 &&
      entry.rate.den !== 1,
  );
  if (near) return { ...near.rate };
  return normalizeFrameRate(decimal);
}

// A rate read off a container. Probes report NTSC rates as 23.976 / 29.97 /
// 59.94 decimals, so snap those to the exact fraction; anything else is taken
// literally. Without this, a 29.97 source normalizes to 2997/100 and every
// frame boundary derived from it drifts against the real broadcast rate.
export function snapObservedFrameRate(rate: number): FrameRate {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Observed frame rate must be a positive finite number');
  }
  const near = FRAME_RATE_PRESETS.find(
    (entry) =>
      entry.rate.den !== 1 &&
      Math.abs(entry.rate.num / entry.rate.den - rate) < 0.005,
  );
  return near ? { ...near.rate } : normalizeFrameRate(rate);
}

// Display form. NTSC rates print as their familiar decimals rather than as the
// fraction, because that is what editors label them.
export function formatFrameRate(rate: FrameRateLike): string {
  const preset = frameRatePresetFor(rate);
  if (preset) return preset.id;
  const normalized = normalizeFrameRate(rate);
  if (normalized.den === 1) return String(normalized.num);
  return (normalized.num / normalized.den).toFixed(3).replace(/\.?0+$/, '');
}

export function frameRatesEqual(
  left: FrameRateLike,
  right: FrameRateLike,
): boolean {
  const a = normalizeFrameRate(left);
  const b = normalizeFrameRate(right);
  return a.num === b.num && a.den === b.den;
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
