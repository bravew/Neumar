import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getSetting } from '@/shared/db/operations';
import {
  probeFile,
  runFFmpeg,
  validateInputFile,
} from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('VideoAssetThumbs');

const FILMSTRIP_MIN_COUNT = 1;
const FILMSTRIP_MAX_COUNT = 60;
const FILMSTRIP_FRAME_WIDTH = 160;
const PEAKS_MIN_BINS = 32;
const PEAKS_MAX_BINS = 2048;

export interface FilmstripResult {
  /** Absolute path to the cached PNG sprite strip. */
  stripPath: string;
  /** Width in pixels of a single frame in the strip. */
  frameWidth: number;
  /** Height in pixels of every frame. */
  frameHeight: number;
  /** Number of frames in the strip (== count requested, clamped). */
  frameCount: number;
}

export interface PeaksResult {
  /** Number of bins (== requested, clamped). */
  bins: number;
  /**
   * Per-bin peak amplitude in 0..1, mono-mixed. Index 0 is the start of the
   * file. Computed via ffmpeg `astats` on a downsampled mono mix.
   */
  peaks: number[];
  /** Duration in milliseconds the peaks span. */
  durationMs: number;
}

export interface AssetThumbCacheOptions {
  /**
   * Directory to write cached derivatives into. Defaults to writing a hidden
   * file beside the source, which is only appropriate when the source is
   * inside a directory this app owns.
   */
  cacheDir?: string;
  /**
   * Pre-resolved absolute source path. Callers that already validated the file
   * against a per-project rule (an external master, say) pass it here so this
   * module doesn't re-check it against the workspace root and reject it.
   */
  resolvedPath?: string;
}

export interface PeaksRange {
  startMs: number;
  durationMs: number;
  reverse?: boolean;
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 8;
  return Math.max(
    FILMSTRIP_MIN_COUNT,
    Math.min(FILMSTRIP_MAX_COUNT, Math.floor(value)),
  );
}

function clampBins(value: number): number {
  if (!Number.isFinite(value)) return 256;
  return Math.max(PEAKS_MIN_BINS, Math.min(PEAKS_MAX_BINS, Math.floor(value)));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function cacheKey(
  absPath: string,
  suffix: string,
  cacheDir?: string,
): Promise<string> {
  const stat = await fs.stat(absPath);
  const hash = createHash('sha1')
    .update(absPath)
    .update(String(stat.size))
    .update(String(Math.floor(stat.mtimeMs)))
    .update(suffix)
    .digest('hex')
    .slice(0, 12);
  const base = path.basename(absPath);
  if (cacheDir) {
    await fs.mkdir(cacheDir, { recursive: true });
    // The hash already carries the absolute source path, so two masters with
    // the same basename can share this directory without colliding.
    return path.join(cacheDir, `${base}.${suffix}-${hash}`);
  }
  return path.join(path.dirname(absPath), `.${base}.${suffix}-${hash}`);
}

/**
 * Generate (or fetch from cache) a horizontal sprite-strip PNG with `count`
 * frames evenly spaced across the asset's duration. Cached forever next to
 * the source file, keyed by (mtime, size, count) so it auto-rebuilds when
 * the asset changes.
 */
export async function getFilmstrip(
  assetPath: string,
  count: number,
  validationRoot?: string,
  options: AssetThumbCacheOptions = {},
): Promise<FilmstripResult> {
  const workDir = validationRoot ?? getSetting('workDir') ?? process.cwd();
  const absPath = options.resolvedPath ?? validateInputFile(assetPath, workDir);
  const clampedCount = clampCount(count);

  const probe = await probeFile(absPath, workDir);
  const durationSec = probe.duration ?? 0;
  const videoStream = probe.streams.find(
    (s) => s.width != null && s.height != null,
  );
  // Still images probe with duration=0 but have width/height. Only require a
  // positive duration when we actually need it for evenly-spaced sampling
  // (`fps=N/duration` below). One-frame strips work either way.
  const needsDuration = clampedCount > 1;
  if (needsDuration && durationSec <= 0) {
    throw new Error('Asset has no detectable duration');
  }
  const srcW = videoStream?.width ?? FILMSTRIP_FRAME_WIDTH;
  const srcH = videoStream?.height ?? 90;
  const aspect = srcW / Math.max(srcH, 1);
  const frameHeight = Math.max(2, Math.round(FILMSTRIP_FRAME_WIDTH / aspect));

  const cachePath = `${await cacheKey(absPath, `strip-${clampedCount}-${FILMSTRIP_FRAME_WIDTH}`, options.cacheDir)}.png`;
  if (await pathExists(cachePath)) {
    return {
      stripPath: cachePath,
      frameWidth: FILMSTRIP_FRAME_WIDTH,
      frameHeight,
      frameCount: clampedCount,
    };
  }

  // For images, ffmpeg "video" path still works (still images are 1-frame
  // videos), but it is wasteful. Just decode once and stretch into a strip
  // of width `count`. Cheaper: a single frame is fine since every cell is
  // identical for a still — but we keep it consistent by tiling once.
  // For movies, the select expression below picks N evenly-spaced frames.
  const isStill = durationSec < 0.1 || clampedCount === 1;
  const args: string[] = isStill
    ? [
        '-i',
        absPath,
        '-frames:v',
        '1',
        '-vf',
        `scale=${FILMSTRIP_FRAME_WIDTH}:${frameHeight}`,
        cachePath,
      ]
    : [
        '-i',
        absPath,
        '-vf',
        // Sample N frames using fps filter, scale, then tile horizontally
        // into a 1xN sprite. fps=N/duration picks evenly across the clip.
        `fps=${clampedCount}/${durationSec},scale=${FILMSTRIP_FRAME_WIDTH}:${frameHeight}:force_original_aspect_ratio=disable,tile=${clampedCount}x1`,
        '-frames:v',
        '1',
        '-an',
        cachePath,
      ];

  const result = await runFFmpeg(args);
  if (result.exitCode !== 0) {
    logger.warn('asset-thumb.filmstrip.failed', {
      asset: assetPath,
      exit: result.exitCode,
      stderr: result.stderr.slice(0, 500),
    });
    throw new Error(`Filmstrip generation failed (exit ${result.exitCode})`);
  }

  return {
    stripPath: cachePath,
    frameWidth: FILMSTRIP_FRAME_WIDTH,
    frameHeight,
    frameCount: clampedCount,
  };
}

/**
 * Generate (or fetch from cache) a peaks-per-bin JSON file for an audio (or
 * video-with-audio) asset. Uses ffmpeg `astats` with a per-window peak
 * accumulator. Cached forever next to the source file.
 */
export async function getPeaks(
  assetPath: string,
  bins: number,
  validationRoot?: string,
  range?: PeaksRange,
  options: AssetThumbCacheOptions = {},
): Promise<PeaksResult> {
  const workDir = validationRoot ?? getSetting('workDir') ?? process.cwd();
  const absPath = options.resolvedPath ?? validateInputFile(assetPath, workDir);
  const clampedBins = clampBins(bins);

  const probe = await probeFile(absPath, workDir);
  const durationSec = probe.duration ?? 0;
  if (durationSec <= 0) {
    throw new Error('Asset has no detectable duration');
  }
  const sourceDurationMs = Math.round(durationSec * 1000);
  const normalizedRange = normalizePeaksRange(range, sourceDurationMs);
  const spanDurationMs = normalizedRange?.durationMs ?? sourceDurationMs;
  const spanDurationSec = spanDurationMs / 1000;

  const cacheSuffix = normalizedRange
    ? `peaks-${clampedBins}-${normalizedRange.startMs}-${normalizedRange.durationMs}-${normalizedRange.reverse === true ? 'reverse' : 'forward'}`
    : `peaks-${clampedBins}`;
  const cachePath = `${await cacheKey(absPath, cacheSuffix, options.cacheDir)}.json`;
  if (await pathExists(cachePath)) {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as PeaksResult;
    return parsed;
  }

  // Window-based peak extraction:
  //   - Mono-mix and resample to a small rate; smaller rate = faster + more
  //     uniform per-bin sample counts.
  //   - astats with -reset prints the max peak per window of N samples.
  //   - We pick samplesPerWindow so we get exactly `clampedBins` rows.
  const samplePerBinRate = 4000; // Hz — plenty for visual peaks, fast to compute.
  const totalSamples = Math.max(
    clampedBins,
    Math.floor(spanDurationSec * samplePerBinRate),
  );
  const samplesPerWindow = Math.max(1, Math.floor(totalSamples / clampedBins));

  const inputArgs = normalizedRange
    ? [
        '-ss',
        (normalizedRange.startMs / 1000).toFixed(3),
        '-t',
        (normalizedRange.durationMs / 1000).toFixed(3),
        '-i',
        absPath,
      ]
    : ['-i', absPath];
  const args = [
    ...inputArgs,
    '-vn',
    '-af',
    `aformat=channel_layouts=mono,aresample=${samplePerBinRate},astats=metadata=1:reset=${samplesPerWindow},ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file=-`,
    '-f',
    'null',
    '-',
  ];
  const result = await runFFmpeg(args);
  if (result.exitCode !== 0) {
    logger.warn('asset-thumb.peaks.failed', {
      asset: assetPath,
      exit: result.exitCode,
      stderr: result.stderr.slice(0, 500),
    });
    throw new Error(`Peaks generation failed (exit ${result.exitCode})`);
  }

  // Peak_level prints in dBFS (negative; -inf for silence). Convert to
  // 0..1 amplitude: amp = 10^(db/20). Clamp -inf-ish to 0.
  const peaks: number[] = [];
  const lineRe = /lavfi\.astats\.Overall\.Peak_level=(-?\d+(?:\.\d+)?|-inf)/g;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(result.stderr)) !== null) {
    const raw = match[1];
    if (!raw || raw === '-inf') {
      peaks.push(0);
    } else {
      const db = Number.parseFloat(raw);
      const amp = Math.pow(10, db / 20);
      peaks.push(Number.isFinite(amp) ? Math.max(0, Math.min(1, amp)) : 0);
    }
  }

  // Pad / trim to exactly `clampedBins` so the client can rely on length.
  while (peaks.length < clampedBins) peaks.push(0);
  if (peaks.length > clampedBins) peaks.length = clampedBins;
  if (normalizedRange?.reverse) peaks.reverse();

  const payload: PeaksResult = {
    bins: clampedBins,
    peaks,
    durationMs: spanDurationMs,
  };
  await fs.writeFile(cachePath, JSON.stringify(payload), 'utf8');
  return payload;
}

function normalizePeaksRange(
  range: PeaksRange | undefined,
  sourceDurationMs: number,
): PeaksRange | null {
  if (!range) return null;
  const startMs = Math.max(
    0,
    Math.min(sourceDurationMs - 1, Math.round(range.startMs)),
  );
  const durationMs = Math.max(
    1,
    Math.min(Math.round(range.durationMs), sourceDurationMs - startMs),
  );
  return {
    startMs,
    durationMs,
    reverse: range.reverse === true,
  };
}
