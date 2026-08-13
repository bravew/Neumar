export interface RationalTime {
  numerator: number;
  denominator: number;
}

export function msToFrames(ms: number, fps: number): number {
  assertPositiveFps(fps);
  return Math.round((Math.max(0, ms) * fps) / 1000);
}

export function framesToMs(frames: number, fps: number): number {
  assertPositiveFps(fps);
  return Math.round((Math.max(0, frames) * 1000) / fps);
}

export function msToRationalSeconds(ms: number, fps: number): RationalTime {
  const frames = msToFrames(ms, fps);
  return reduce({ numerator: frames, denominator: fps });
}

export function formatFcpTime(ms: number, fps: number): string {
  const rational = msToRationalSeconds(ms, fps);
  if (rational.numerator === 0) return '0s';
  if (rational.denominator === 1) return `${rational.numerator}s`;
  return `${rational.numerator}/${rational.denominator}s`;
}

export function formatEdlTimecode(ms: number, fps: number): string {
  assertPositiveFps(fps);
  const roundedFps = Math.round(fps);
  const totalFrames = msToFrames(ms, roundedFps);
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

function assertPositiveFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error('A positive timeline fps is required');
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}
