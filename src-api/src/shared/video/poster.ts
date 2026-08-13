import fs from 'node:fs/promises';
import path from 'node:path';

import { runFFmpeg, validatePath } from '@/shared/services/ffmpeg';

export const POSTER_WIDTH_PX = 1280;
export const POSTER_JPEG_QUALITY = 4;

const BLACKFRAME_AMOUNT = 95;
const BLACKFRAME_THRESHOLD = 32;
const RETRY_RATIOS = [0.25, 0.5] as const;

export interface GeneratePosterFrameInput {
  root: string;
  outputPath: string;
  durationSec: number;
  posterAtMs?: number;
  signal?: AbortSignal;
}

export interface GeneratePosterFrameResult {
  posterPath: string;
  posterAtMs: number;
  blackRetries: number;
}

interface PosterFrameDeps {
  extractFrame: (input: PosterFrameOperationInput) => Promise<void>;
  isBlackFrame: (input: PosterBlackFrameInput) => Promise<boolean>;
}

interface PosterFrameOperationInput {
  inputPath: string;
  outputPath: string;
  atMs: number;
  signal?: AbortSignal;
}

interface PosterBlackFrameInput {
  posterPath: string;
  signal?: AbortSignal;
}

export async function generatePosterFrame(
  input: GeneratePosterFrameInput,
  deps: Partial<PosterFrameDeps> = {},
): Promise<GeneratePosterFrameResult> {
  const inputPath = validatePath(input.outputPath, input.root, 'read');
  const posterPath = posterPathForOutput(inputPath, input.root);
  const extractFrame = deps.extractFrame ?? extractPosterFrame;
  const isBlackFrame = deps.isBlackFrame ?? isPosterBlackFrame;
  const candidateTimesMs = posterCandidateTimesMs(
    input.durationSec,
    input.posterAtMs,
  );

  await fs.mkdir(path.dirname(posterPath), { recursive: true });

  let lastPosterAtMs = candidateTimesMs[0] ?? 0;
  let blackRetries = 0;
  for (const [index, atMs] of candidateTimesMs.entries()) {
    lastPosterAtMs = atMs;
    await extractFrame({
      inputPath,
      outputPath: posterPath,
      atMs,
      signal: input.signal,
    });
    const black = await isBlackFrame({
      posterPath,
      signal: input.signal,
    });
    if (!black) break;
    if (index < candidateTimesMs.length - 1) {
      blackRetries += 1;
    }
  }

  return {
    posterPath: path.relative(input.root, posterPath),
    posterAtMs: lastPosterAtMs,
    blackRetries,
  };
}

export function posterCandidateTimesMs(
  durationSec: number,
  posterAtMs?: number,
): number[] {
  const durationMs = Math.max(0, Math.round(durationSec * 1000));
  const maxMs = Math.max(0, durationMs - 100);
  const firstMs =
    typeof posterAtMs === 'number' && Number.isFinite(posterAtMs)
      ? posterAtMs
      : Math.round(durationMs * 0.1);
  return uniqueNumbers([
    clampPosterMs(firstMs, maxMs),
    ...RETRY_RATIOS.map((ratio) => clampPosterMs(durationMs * ratio, maxMs)),
  ]);
}

export function buildPosterFrameArgs(
  inputPath: string,
  outputPath: string,
  atMs: number,
): string[] {
  return [
    '-ss',
    formatSeconds(atMs / 1000),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-vf',
    `scale=${POSTER_WIDTH_PX}:-2:flags=lanczos`,
    '-q:v',
    String(POSTER_JPEG_QUALITY),
    outputPath,
  ];
}

export function parseBlackFramePercent(stderr: string): number | null {
  const matches = [...stderr.matchAll(/pblack:\s*([0-9]+(?:\.[0-9]+)?)/g)];
  if (matches.length === 0) return null;
  return Math.max(...matches.map((match) => Number(match[1])));
}

function posterPathForOutput(outputPath: string, root: string): string {
  const parsed = path.parse(outputPath);
  return validatePath(
    path.join(parsed.dir, `${parsed.name}.poster.jpg`),
    root,
    'write',
  );
}

async function extractPosterFrame(
  input: PosterFrameOperationInput,
): Promise<void> {
  const result = await runFFmpeg(
    buildPosterFrameArgs(input.inputPath, input.outputPath, input.atMs),
    { abortSignal: input.signal },
  );
  if (result.exitCode !== 0) {
    throw new Error(`Poster frame extraction failed: ${result.stderr}`);
  }
}

async function isPosterBlackFrame(
  input: PosterBlackFrameInput,
): Promise<boolean> {
  const result = await runFFmpeg(
    [
      '-i',
      input.posterPath,
      '-vf',
      `blackframe=amount=${BLACKFRAME_AMOUNT}:threshold=${BLACKFRAME_THRESHOLD}`,
      '-frames:v',
      '1',
      '-f',
      'null',
      nullOutputPath(),
    ],
    { abortSignal: input.signal },
  );
  if (result.exitCode !== 0) {
    throw new Error(`Poster black-frame check failed: ${result.stderr}`);
  }
  return (parseBlackFramePercent(result.stderr) ?? 0) >= BLACKFRAME_AMOUNT;
}

function clampPosterMs(value: number, maxMs: number): number {
  return Math.max(0, Math.min(Math.round(value), maxMs));
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function formatSeconds(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, '');
}

function nullOutputPath(): string {
  return process.platform === 'win32' ? 'NUL' : '/dev/null';
}
