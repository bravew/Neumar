import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  runFFmpeg,
  validatePath,
  type ProbeResult,
} from '@/shared/services/ffmpeg';

import type { LoudnessTargetLufs } from './types';

const TRUE_PEAK_DB = -1.5;
const LOUDNESS_RANGE_LU = 11;

export interface LoudnormMeasurement {
  inputI: number;
  inputTruePeak: number;
  inputLra: number;
  inputThreshold: number;
  targetOffset: number;
  outputI?: number;
  outputTruePeak?: number;
  outputLra?: number;
  outputThreshold?: number;
}

export interface LoudnessMetadata {
  loudnessTargetLufs: LoudnessTargetLufs;
  loudnessLufs: number;
  peakDbfs: number;
}

export function buildLoudnormFilter(
  targetLufs: LoudnessTargetLufs,
  measurement?: LoudnormMeasurement,
  opts: { printJson?: boolean } = {},
): string {
  const parts = [
    `I=${formatLoudnormNumber(targetLufs)}`,
    `TP=${formatLoudnormNumber(TRUE_PEAK_DB)}`,
    `LRA=${formatLoudnormNumber(LOUDNESS_RANGE_LU)}`,
  ];

  if (measurement) {
    parts.push(
      `measured_I=${formatLoudnormNumber(measurement.inputI)}`,
      `measured_TP=${formatLoudnormNumber(measurement.inputTruePeak)}`,
      `measured_LRA=${formatLoudnormNumber(measurement.inputLra)}`,
      `measured_thresh=${formatLoudnormNumber(measurement.inputThreshold)}`,
      `offset=${formatLoudnormNumber(measurement.targetOffset)}`,
      'linear=true',
    );
  }

  if (opts.printJson) parts.push('print_format=json');

  return `loudnorm=${parts.join(':')}`;
}

export function buildLoudnessMeasurementArgs(
  inputPath: string,
  targetLufs: LoudnessTargetLufs,
): string[] {
  return [
    '-nostats',
    '-i',
    inputPath,
    '-map',
    '0:a:0',
    '-vn',
    '-af',
    buildLoudnormFilter(targetLufs, undefined, { printJson: true }),
    '-f',
    'null',
    nullMuxerOutputPath(),
  ];
}

export function buildLoudnessNormalizeArgs(
  inputPath: string,
  outputPath: string,
  targetLufs: LoudnessTargetLufs,
  measurement: LoudnormMeasurement,
): string[] {
  return [
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-map_metadata',
    '0',
    '-map_chapters',
    '0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-af',
    buildLoudnormFilter(targetLufs, measurement),
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

export function parseLoudnormJson(stderr: string): LoudnormMeasurement | null {
  const start = stderr.indexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stderr.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }

  const inputI = parseLoudnessNumber(parsed.input_i);
  const inputTruePeak = parseLoudnessNumber(parsed.input_tp);
  const inputLra = parseLoudnessNumber(parsed.input_lra);
  const inputThreshold = parseLoudnessNumber(parsed.input_thresh);
  const targetOffset = parseLoudnessNumber(parsed.target_offset);
  if (
    inputI === null ||
    inputTruePeak === null ||
    inputLra === null ||
    inputThreshold === null ||
    targetOffset === null
  ) {
    return null;
  }

  return {
    inputI,
    inputTruePeak,
    inputLra,
    inputThreshold,
    targetOffset,
    outputI: parseOptionalLoudnessNumber(parsed.output_i),
    outputTruePeak: parseOptionalLoudnessNumber(parsed.output_tp),
    outputLra: parseOptionalLoudnessNumber(parsed.output_lra),
    outputThreshold: parseOptionalLoudnessNumber(parsed.output_thresh),
  };
}

export async function measureLoudness(input: {
  inputPath: string;
  targetLufs: LoudnessTargetLufs;
  signal?: AbortSignal;
}): Promise<LoudnormMeasurement> {
  const result = await runFFmpeg(
    buildLoudnessMeasurementArgs(input.inputPath, input.targetLufs),
    { abortSignal: input.signal },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Loudness measurement failed: ${result.stderr.slice(0, 500)}`,
    );
  }
  const measurement = parseLoudnormJson(result.stderr);
  if (!measurement) {
    throw new Error('Loudness measurement did not return valid JSON');
  }
  return measurement;
}

export async function normalizeRenderedAudio(input: {
  root: string;
  outputPath: string;
  probe: ProbeResult;
  targetLufs: LoudnessTargetLufs;
  signal?: AbortSignal;
}): Promise<LoudnessMetadata | undefined> {
  if (!hasAudioStream(input.probe)) return undefined;

  const outputPath = validatePath(input.outputPath, input.root, 'write');
  const tempPath = validatePath(
    temporaryNormalizedPath(outputPath),
    input.root,
    'write',
  );

  try {
    const pass1 = await measureLoudness({
      inputPath: outputPath,
      targetLufs: input.targetLufs,
      signal: input.signal,
    });
    const result = await runFFmpeg(
      buildLoudnessNormalizeArgs(outputPath, tempPath, input.targetLufs, pass1),
      {
        inputDuration: input.probe.duration,
        abortSignal: input.signal,
      },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `Loudness normalization failed: ${result.stderr.slice(0, 500)}`,
      );
    }

    const verified = await measureLoudness({
      inputPath: tempPath,
      targetLufs: input.targetLufs,
      signal: input.signal,
    });
    await fs.rename(tempPath, outputPath);
    return {
      loudnessTargetLufs: input.targetLufs,
      loudnessLufs: roundAudioDb(verified.inputI),
      peakDbfs: roundAudioDb(verified.inputTruePeak),
    };
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function hasAudioStream(probe: ProbeResult): boolean {
  return probe.streams.some((stream) => stream.codecType === 'audio');
}

function temporaryNormalizedPath(outputPath: string): string {
  const parsed = path.parse(outputPath);
  return path.join(
    parsed.dir,
    `${parsed.name}.loudnorm-${randomUUID()}${parsed.ext || '.mp4'}`,
  );
}

function nullMuxerOutputPath(): string {
  return process.platform === 'win32' ? 'NUL' : '/dev/null';
}

function parseOptionalLoudnessNumber(value: unknown): number | undefined {
  return parseLoudnessNumber(value) ?? undefined;
}

function parseLoudnessNumber(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function formatLoudnormNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/\.?0+$/, '');
}

function roundAudioDb(value: number): number {
  return Math.round(value * 100) / 100;
}
