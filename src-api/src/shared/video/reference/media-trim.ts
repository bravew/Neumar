import fs from 'node:fs/promises';

import { runFFmpeg } from '@/shared/services/ffmpeg';

/**
 * Upper bound on how much of a reference actually gets analyzed
 * (transcribed, sampled, read). Distinct from any import-time size guard —
 * a reference can be downloaded in full and still only have a bounded
 * window analyzed.
 */
export const REFERENCE_ANALYSIS_MAX_MS = 10 * 60 * 1000;

/** The default analysis window for a source of the given length. */
export function defaultAnalysisRange(sourceDurationMs: number): {
  startMs: number;
  endMs: number;
} {
  return {
    startMs: 0,
    endMs: Math.min(sourceDurationMs, REFERENCE_ANALYSIS_MAX_MS),
  };
}

/**
 * Cut [startMs, endMs) out of `sourceAbsolute` into `destAbsolute`.
 *
 * Re-encodes rather than stream-copying: `-c copy` can only cut on keyframe
 * boundaries, which would silently shift the in/out points the user picked.
 * `-ss` before `-i` still seeks quickly; modern ffmpeg decodes forward to
 * the exact requested time when the output is transcoded (not copied).
 */
export async function trimMediaFile(
  sourceAbsolute: string,
  destAbsolute: string,
  startMs: number,
  endMs: number,
): Promise<void> {
  await fs.rm(destAbsolute, { force: true });
  const { exitCode, stderr } = await runFFmpeg([
    '-ss',
    (startMs / 1000).toFixed(3),
    '-i',
    sourceAbsolute,
    '-t',
    ((endMs - startMs) / 1000).toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    destAbsolute,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Failed to trim reference media: ${stderr.slice(-500) || `ffmpeg exited with code ${exitCode}`}`,
    );
  }
}
