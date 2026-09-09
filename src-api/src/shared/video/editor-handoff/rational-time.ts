import {
  frameRateToNumber,
  normalizeFrameRate,
  type FrameRate,
  type FrameRateLike,
} from '@neumar/video-ir';

export interface RationalTime {
  numerator: number;
  denominator: number;
}

// Every entry point takes a rate, not a rounded number. Handing these a 29.97
// decimal used to produce `frames / 29.97` — a rational with a fractional
// denominator, which is not a rational time at all.
function rateOf(rate: FrameRateLike): FrameRate {
  const normalized = normalizeFrameRate(rate);
  if (!Number.isFinite(frameRateToNumber(normalized))) {
    throw new Error('A positive timeline fps is required');
  }
  return normalized;
}

export function msToFrames(ms: number, fps: FrameRateLike): number {
  const rate = rateOf(fps);
  return Math.round((Math.max(0, ms) * rate.num) / (1000 * rate.den));
}

export function framesToMs(frames: number, fps: FrameRateLike): number {
  const rate = rateOf(fps);
  return Math.round((Math.max(0, frames) * 1000 * rate.den) / rate.num);
}

export function msToRationalSeconds(
  ms: number,
  fps: FrameRateLike,
): RationalTime {
  const rate = rateOf(fps);
  const frames = msToFrames(ms, rate);
  // Seconds, exactly: `frames * den / num`. At 30000/1001 that is
  // `frames * 1001 / 30000`, which OTIO and FCPXML both accept verbatim.
  return reduce({ numerator: frames * rate.den, denominator: rate.num });
}

export function formatFcpTime(ms: number, fps: FrameRateLike): string {
  const rational = msToRationalSeconds(ms, fps);
  if (rational.numerator === 0) return '0s';
  if (rational.denominator === 1) return `${rational.numerator}s`;
  return `${rational.numerator}/${rational.denominator}s`;
}

// Non-drop timecode: frames are counted at the rounded rate, which is the
// convention every NLE uses for NTSC. The frame *total* still comes from the
// exact rate, so the count does not drift from the real media.
export function formatEdlTimecode(ms: number, fps: FrameRateLike): string {
  const rate = rateOf(fps);
  const roundedFps = Math.round(frameRateToNumber(rate));
  const totalFrames = msToFrames(ms, rate);
  const frames = totalFrames % roundedFps;
  const totalSeconds = Math.floor(totalFrames / roundedFps);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return [pad2(hours), pad2(minutes), pad2(seconds), pad2(frames)].join(':');
}

export function formatSrtTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const milliseconds = clamped % 1000;
  const totalSeconds = Math.floor(clamped / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(milliseconds)}`;
}

function reduce(value: RationalTime): RationalTime {
  const divisor = gcd(Math.abs(value.numerator), Math.abs(value.denominator));
  return {
    numerator: value.numerator / divisor,
    denominator: value.denominator / divisor,
  };
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}
