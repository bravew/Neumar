import {
  runFFmpeg,
  validatePath,
  type ProbeResult,
} from '@/shared/services/ffmpeg';

import type {
  TransitionDegradation,
  VideoQaAudioClipping,
  VideoQaBlackFrame,
  VideoQaCutBoundary,
  VideoQaCutBoundaryIssue,
  VideoQaMissingMedia,
  VideoQaReport,
  VideoQaSilentGap,
} from './types';

const BLACKDETECT_FILTER = 'blackdetect=d=0.5:pic_th=0.95';
const ASTATS_FILTER =
  'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.Peak_level';
const SILENCEDETECT_FILTER = 'silencedetect=noise=-50dB:duration=2';
const CLIPPING_THRESHOLD_DBFS = -0.1;
const CLIPPING_FALLBACK_WINDOW_MS = 1000;
const CLIPPING_GROUP_GAP_MS = 250;
const DEFAULT_BOUNDARY_WINDOW_MS = 1500;
const DURATION_MISMATCH_TOLERANCE_MS = 250;

type FfmpegRunner = typeof runFFmpeg;

interface VideoQaDeps {
  runFFmpeg?: FfmpegRunner;
  now?: () => Date;
}

export interface RunVideoQaReportInput {
  root: string;
  outputPath: string;
  probe: ProbeResult;
  missingMedia?: VideoQaMissingMedia[];
  transitionDegradations?: TransitionDegradation[];
  cutBoundariesMs?: number[];
  expectedDurationMs?: number;
  boundaryWindowMs?: number;
  signal?: AbortSignal;
}

interface AstatsPeakSample {
  timeMs?: number;
  peakDbfs: number;
}

export async function runVideoQaReport(
  input: RunVideoQaReportInput,
  deps: VideoQaDeps = {},
): Promise<VideoQaReport> {
  const inputPath = validatePath(input.outputPath, input.root, 'read');
  const runner = deps.runFFmpeg ?? runFFmpeg;
  const generatedAt = (deps.now ?? (() => new Date()))().toISOString();
  const durationSec = input.probe.duration;
  const report: VideoQaReport = {
    generatedAt,
    blackFrames: [],
    audioClipping: [],
    silentGaps: [],
    missingMedia: input.missingMedia ?? [],
    cutBoundaries: [],
    ...(input.transitionDegradations?.length
      ? { transitionDegradations: input.transitionDegradations }
      : {}),
  };

  const blackdetect = await runner(buildBlackdetectArgs(inputPath), {
    inputDuration: durationSec,
    abortSignal: input.signal,
  });
  if (blackdetect.exitCode !== 0) {
    throw new Error(
      `Black-frame QA failed: ${blackdetect.stderr.slice(0, 500)}`,
    );
  }
  report.blackFrames = parseBlackdetectOutput(blackdetect.stderr);

  if (hasAudioStream(input.probe)) {
    const astats = await runner(buildAstatsArgs(inputPath), {
      inputDuration: durationSec,
      abortSignal: input.signal,
    });
    if (astats.exitCode !== 0) {
      throw new Error(`Audio peak QA failed: ${astats.stderr.slice(0, 500)}`);
    }
    report.audioClipping = parseAstatsClippingOutput(
      astats.stderr,
      durationSec,
    );

    const silence = await runner(buildSilencedetectArgs(inputPath), {
      inputDuration: durationSec,
      abortSignal: input.signal,
    });
    if (silence.exitCode !== 0) {
      throw new Error(`Silence QA failed: ${silence.stderr.slice(0, 500)}`);
    }
    report.silentGaps = parseSilencedetectOutput(silence.stderr, durationSec);
  }

  return finalizeQaReport(report, input, secondsToMs(durationSec));
}

export function buildBlackdetectArgs(inputPath: string): string[] {
  return [
    '-nostats',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-vf',
    BLACKDETECT_FILTER,
    '-an',
    '-f',
    'null',
    nullMuxerOutputPath(),
  ];
}

export function buildAstatsArgs(inputPath: string): string[] {
  return [
    '-nostats',
    '-i',
    inputPath,
    '-map',
    '0:a:0',
    '-vn',
    '-af',
    ASTATS_FILTER,
    '-f',
    'null',
    nullMuxerOutputPath(),
  ];
}

export function buildSilencedetectArgs(inputPath: string): string[] {
  return [
    '-nostats',
    '-i',
    inputPath,
    '-map',
    '0:a:0',
    '-vn',
    '-af',
    SILENCEDETECT_FILTER,
    '-f',
    'null',
    nullMuxerOutputPath(),
  ];
}

export function parseBlackdetectOutput(stderr: string): VideoQaBlackFrame[] {
  const matches = stderr.matchAll(
    /black_start:\s*([-+]?\d+(?:\.\d+)?)\s+black_end:\s*([-+]?\d+(?:\.\d+)?)\s+black_duration:\s*([-+]?\d+(?:\.\d+)?)/g,
  );
  return [...matches]
    .map((match) => {
      const startMs = secondsToMs(Number(match[1]));
      const endMs = secondsToMs(Number(match[2]));
      const durationMs = secondsToMs(Number(match[3]));
      return { startMs, endMs, durationMs };
    })
    .filter((entry) => entry.endMs > entry.startMs);
}

export function parseAstatsClippingOutput(
  stderr: string,
  durationSec: number,
): VideoQaAudioClipping[] {
  const durationMs = secondsToMs(durationSec);
  const samples = parseAstatsPeakSamples(stderr);
  const clippingSamples = samples.filter(
    (sample) => sample.peakDbfs > CLIPPING_THRESHOLD_DBFS,
  );
  if (clippingSamples.length === 0) return [];

  if (clippingSamples.every((sample) => sample.timeMs === undefined)) {
    return [
      {
        startMs: 0,
        endMs: durationMs,
        peakDbfs: roundDb(
          Math.max(...clippingSamples.map((sample) => sample.peakDbfs)),
        ),
      },
    ];
  }

  const timedSamples = samples.filter(
    (sample): sample is Required<AstatsPeakSample> =>
      sample.timeMs !== undefined,
  );
  return mergeClippingSamples(timedSamples, durationMs);
}

export function parseSilencedetectOutput(
  stderr: string,
  durationSec: number,
): VideoQaSilentGap[] {
  const gaps: VideoQaSilentGap[] = [];
  let currentStartMs: number | undefined;

  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([-+]?\d+(?:\.\d+)?)/);
    if (startMatch?.[1]) {
      currentStartMs = secondsToMs(Number(startMatch[1]));
    }

    const endMatch = line.match(/silence_end:\s*([-+]?\d+(?:\.\d+)?)/);
    if (endMatch?.[1] && currentStartMs !== undefined) {
      const endMs = secondsToMs(Number(endMatch[1]));
      if (endMs > currentStartMs) {
        gaps.push({
          startMs: currentStartMs,
          endMs,
          durationMs: endMs - currentStartMs,
        });
      }
      currentStartMs = undefined;
    }
  }

  if (currentStartMs !== undefined) {
    const endMs = secondsToMs(durationSec);
    if (endMs > currentStartMs) {
      gaps.push({
        startMs: currentStartMs,
        endMs,
        durationMs: endMs - currentStartMs,
      });
    }
  }

  return gaps;
}

export function buildCutBoundaryFindings(input: {
  boundariesMs: readonly number[];
  durationMs: number;
  windowMs?: number;
  blackFrames?: readonly VideoQaBlackFrame[];
  audioClipping?: readonly VideoQaAudioClipping[];
  silentGaps?: readonly VideoQaSilentGap[];
}): VideoQaCutBoundary[] {
  const windowMs = normalizeBoundaryWindow(input.windowMs);
  const durationMs = Math.max(0, Math.round(input.durationMs));
  return [...new Set(input.boundariesMs.map(normalizeMs))]
    .filter((timeMs) => timeMs >= 0 && timeMs <= durationMs)
    .sort((left, right) => left - right)
    .map((timeMs) => {
      const windowStartMs = Math.max(0, timeMs - windowMs);
      const windowEndMs = Math.min(durationMs, timeMs + windowMs);
      const issues: VideoQaCutBoundaryIssue[] = [
        ...(input.blackFrames ?? [])
          .filter((range) => overlaps(range, windowStartMs, windowEndMs))
          .map((range) => ({
            kind: 'black-frame' as const,
            severity: 'warning' as const,
            startMs: range.startMs,
            endMs: range.endMs,
            summary: 'Black frames overlap the cut-boundary QA window.',
          })),
        ...(input.audioClipping ?? [])
          .filter((range) => overlaps(range, windowStartMs, windowEndMs))
          .map((range) => ({
            kind: 'audio-clipping' as const,
            severity: 'warning' as const,
            startMs: range.startMs,
            endMs: range.endMs,
            summary: 'Audio clipping overlaps the cut-boundary QA window.',
          })),
        ...(input.silentGaps ?? [])
          .filter((range) => overlaps(range, windowStartMs, windowEndMs))
          .map((range) => ({
            kind: 'silent-gap' as const,
            severity: 'warning' as const,
            startMs: range.startMs,
            endMs: range.endMs,
            summary: 'Silence overlaps the cut-boundary QA window.',
          })),
      ];
      return { timeMs, windowStartMs, windowEndMs, issues };
    });
}

function parseAstatsPeakSamples(stderr: string): AstatsPeakSample[] {
  const samples: AstatsPeakSample[] = [];
  let currentTimeMs: number | undefined;

  for (const line of stderr.split(/\r?\n/)) {
    const timeMatch = line.match(/pts_time:\s*([-+]?\d+(?:\.\d+)?)/);
    if (timeMatch?.[1]) {
      currentTimeMs = secondsToMs(Number(timeMatch[1]));
      continue;
    }

    const metadataPeakMatch = line.match(
      /lavfi\.astats\.Overall\.Peak_level=([-+]?(?:\d+(?:\.\d+)?|inf))/i,
    );
    if (metadataPeakMatch?.[1]) {
      const peakDbfs = parseDb(metadataPeakMatch[1]);
      if (peakDbfs !== undefined) {
        samples.push({ timeMs: currentTimeMs, peakDbfs });
      }
      continue;
    }

    const logPeakMatch = line.match(
      /(?:Overall\s+)?Peak level dB:\s*([-+]?(?:\d+(?:\.\d+)?|inf))/i,
    );
    if (logPeakMatch?.[1]) {
      const peakDbfs = parseDb(logPeakMatch[1]);
      if (peakDbfs !== undefined) {
        samples.push({ peakDbfs });
      }
    }
  }

  return samples;
}

function mergeClippingSamples(
  samples: Required<AstatsPeakSample>[],
  durationMs: number,
): VideoQaAudioClipping[] {
  const sorted = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  const findings: VideoQaAudioClipping[] = [];

  for (let index = 0; index < sorted.length; index++) {
    const sample = sorted[index]!;
    if (sample.peakDbfs <= CLIPPING_THRESHOLD_DBFS) continue;
    const nextTimeMs = sorted[index + 1]?.timeMs;
    const sampleEndMs = Math.min(
      durationMs,
      nextTimeMs ?? sample.timeMs + CLIPPING_FALLBACK_WINDOW_MS,
      sample.timeMs + CLIPPING_FALLBACK_WINDOW_MS,
    );
    const previous = findings.at(-1);

    if (previous && sample.timeMs <= previous.endMs + CLIPPING_GROUP_GAP_MS) {
      previous.endMs = Math.max(previous.endMs, sampleEndMs);
      previous.peakDbfs = roundDb(Math.max(previous.peakDbfs, sample.peakDbfs));
      continue;
    }

    findings.push({
      startMs: sample.timeMs,
      endMs: Math.max(sampleEndMs, sample.timeMs),
      peakDbfs: roundDb(sample.peakDbfs),
    });
  }

  return findings;
}

function hasAudioStream(probe: ProbeResult): boolean {
  return probe.streams.some((stream) => stream.codecType === 'audio');
}

function finalizeQaReport(
  report: VideoQaReport,
  input: RunVideoQaReportInput,
  renderedDurationMs: number,
): VideoQaReport {
  const cutBoundaries = buildCutBoundaryFindings({
    boundariesMs: input.cutBoundariesMs ?? [],
    durationMs: renderedDurationMs,
    windowMs: input.boundaryWindowMs,
    blackFrames: report.blackFrames,
    audioClipping: report.audioClipping,
    silentGaps: report.silentGaps,
  });
  const expectedDurationMs =
    input.expectedDurationMs === undefined
      ? undefined
      : normalizeMs(input.expectedDurationMs);
  const deltaMs =
    expectedDurationMs === undefined
      ? 0
      : renderedDurationMs - expectedDurationMs;
  return {
    ...report,
    cutBoundaries,
    ...(expectedDurationMs !== undefined &&
    Math.abs(deltaMs) > DURATION_MISMATCH_TOLERANCE_MS
      ? {
          durationMismatch: {
            expectedMs: expectedDurationMs,
            renderedMs: renderedDurationMs,
            deltaMs,
            toleranceMs: DURATION_MISMATCH_TOLERANCE_MS,
          },
        }
      : {}),
  };
}

function overlaps(
  range: { startMs: number; endMs: number },
  startMs: number,
  endMs: number,
): boolean {
  return range.startMs < endMs && range.endMs > startMs;
}

function normalizeBoundaryWindow(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_BOUNDARY_WINDOW_MS;
  }
  return Math.max(250, Math.min(5000, Math.round(value)));
}

function parseDb(value: string): number | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === '-inf') return Number.NEGATIVE_INFINITY;
  if (normalized === 'inf' || normalized === '+inf') {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function secondsToMs(value: number): number {
  return Math.max(0, Math.round(value * 1000));
}

function normalizeMs(value: number): number {
  return Math.max(0, Math.round(value));
}

function roundDb(value: number): number {
  return Math.round(value * 100) / 100;
}

function nullMuxerOutputPath(): string {
  return process.platform === 'win32' ? 'NUL' : '/dev/null';
}
