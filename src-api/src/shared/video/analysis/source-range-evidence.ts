import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { runFFmpeg, validateInputFile } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';

import { resolveProjectAssetPath } from '../asset-files';
import { getPeaks, type PeaksResult } from '../asset-thumbs';
import type {
  AnalysisArtifact,
  MediaItem,
  SourceMedia,
  SourceMediaAnalysis,
  SubtitleWord,
} from '../types';

const logger = createLogger('SourceRangeEvidence');

const FILMSTRIP_FRAME_WIDTH = 160;
const MIN_FRAME_COUNT = 1;
const MAX_FRAME_COUNT = 8;
const MIN_WAVEFORM_BINS = 32;
const MAX_WAVEFORM_BINS = 512;

export interface SourceRangeWordLabel {
  text: string;
  startMs: number;
  endMs: number;
  relativeStartMs: number;
  relativeEndMs: number;
}

export interface SourceRangeFilmstrip {
  path: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
}

export interface SourceRangeEvidencePayload {
  version: 1;
  sourceMediaId: string;
  contentHash: string;
  range: {
    startMs: number;
    endMs: number;
    durationMs: number;
  };
  filmstrip?: SourceRangeFilmstrip;
  waveform?: PeaksResult;
  words: SourceRangeWordLabel[];
  warnings: string[];
}

export interface SourceRangeEvidenceResult {
  artifact: AnalysisArtifact;
  payload: SourceRangeEvidencePayload;
}

export interface BuildFilmstripInput {
  asset: MediaItem;
  workspaceRoot: string;
  cacheDir: string;
  startMs: number;
  durationMs: number;
  frameCount: number;
}

export interface SourceRangeEvidenceDependencies {
  buildFilmstrip?: (
    input: BuildFilmstripInput,
  ) => Promise<SourceRangeFilmstrip>;
  getPeaks?: typeof getPeaks;
}

export async function buildSourceRangeEvidenceArtifact(input: {
  source: SourceMedia;
  asset: MediaItem;
  analysis?: SourceMediaAnalysis | null;
  workspaceRoot: string;
  cacheDir: string;
  startMs: number;
  endMs: number;
  frameCount?: number;
  waveformBins?: number;
  dependencies?: SourceRangeEvidenceDependencies;
  now?: string;
}): Promise<SourceRangeEvidenceResult> {
  const range = normalizeSourceRange({
    startMs: input.startMs,
    endMs: input.endMs,
    durationMs: input.asset.metadata.durationMs,
  });
  const frameCount = clampInt(
    input.frameCount ?? 5,
    MIN_FRAME_COUNT,
    MAX_FRAME_COUNT,
  );
  const waveformBins = clampInt(
    input.waveformBins ?? 128,
    MIN_WAVEFORM_BINS,
    MAX_WAVEFORM_BINS,
  );
  const warnings: string[] = [];
  const buildFilmstrip =
    input.dependencies?.buildFilmstrip ?? buildSourceRangeFilmstrip;
  const peaksReader = input.dependencies?.getPeaks ?? getPeaks;

  let filmstrip: SourceRangeFilmstrip | undefined;
  try {
    if (input.asset.kind === 'video' || input.asset.kind === 'image') {
      filmstrip = await buildFilmstrip({
        asset: input.asset,
        workspaceRoot: input.workspaceRoot,
        cacheDir: input.cacheDir,
        startMs: range.startMs,
        durationMs: range.durationMs,
        frameCount,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`filmstrip-unavailable: ${message}`);
    logger.warn('source_range.filmstrip_failed', {
      source_id: input.source.id,
      error: message,
    });
  }

  let waveform: PeaksResult | undefined;
  try {
    if (input.asset.metadata.audioTrackCount) {
      waveform = await peaksReader(
        input.asset.path,
        waveformBins,
        input.workspaceRoot,
        {
          startMs: range.startMs,
          durationMs: range.durationMs,
        },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`waveform-unavailable: ${message}`);
    logger.warn('source_range.waveform_failed', {
      source_id: input.source.id,
      error: message,
    });
  }

  const words = wordLabelsForRange(
    input.analysis?.transcript?.words ?? [],
    range.startMs,
    range.endMs,
  );
  const payload: SourceRangeEvidencePayload = {
    version: 1,
    sourceMediaId: input.source.id,
    contentHash: input.source.contentHash,
    range,
    filmstrip,
    waveform,
    words,
    warnings,
  };
  await fs.mkdir(input.cacheDir, { recursive: true });
  const cachePath = path.join(
    input.cacheDir,
    `source-range-evidence-${input.source.id}-${range.startMs}-${range.endMs}.json`,
  );
  await fs.writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`);

  const generatedAt = input.now ?? new Date().toISOString();
  const artifact: AnalysisArtifact = {
    id: stableEvidenceArtifactId(input.source, range.startMs, range.endMs),
    kind: 'source-range-evidence',
    sourceMediaId: input.source.id,
    contentHash: input.source.contentHash,
    cachePath,
    summary: `Source range ${range.startMs}-${range.endMs}ms evidence with ${words.length} word labels.`,
    ranges: [
      {
        id: `${input.source.id}:range:${range.startMs}-${range.endMs}`,
        startMs: range.startMs,
        endMs: range.endMs,
        label: 'source-range',
      },
      ...words.map((word, index) => ({
        id: `${input.source.id}:range-word:${range.startMs}-${index + 1}`,
        startMs: word.startMs,
        endMs: word.endMs,
        label: word.text,
      })),
    ],
    metadata: {
      version: payload.version,
      startMs: range.startMs,
      endMs: range.endMs,
      durationMs: range.durationMs,
      filmstrip: filmstrip
        ? {
            path: filmstrip.path,
            frameWidth: filmstrip.frameWidth,
            frameHeight: filmstrip.frameHeight,
            frameCount: filmstrip.frameCount,
          }
        : undefined,
      waveform: waveform
        ? {
            bins: waveform.bins,
            durationMs: waveform.durationMs,
            peakCount: waveform.peaks.length,
          }
        : undefined,
      wordCount: words.length,
      warnings,
    },
    generatedAt,
  };
  return { artifact, payload };
}

export async function buildSourceRangeFilmstrip(
  input: BuildFilmstripInput,
): Promise<SourceRangeFilmstrip> {
  const absPath = resolveProjectAssetPath(input.asset, input.workspaceRoot);
  const frameHeight = filmstripFrameHeight(input.asset);
  const cachePath = path.join(
    input.cacheDir,
    `source-range-filmstrip-${rangeCacheSegment(input.startMs)}-${rangeCacheSegment(input.durationMs)}-${input.frameCount}.png`,
  );
  await fs.mkdir(input.cacheDir, { recursive: true });
  if (!existsSync(cachePath)) {
    const durationSec = Math.max(0.001, input.durationMs / 1000);
    const args =
      input.frameCount === 1
        ? [
            '-ss',
            (input.startMs / 1000).toFixed(3),
            '-i',
            absPath,
            '-frames:v',
            '1',
            '-vf',
            `scale=${FILMSTRIP_FRAME_WIDTH}:${frameHeight}:force_original_aspect_ratio=disable`,
            '-an',
            cachePath,
          ]
        : [
            '-ss',
            (input.startMs / 1000).toFixed(3),
            '-t',
            durationSec.toFixed(3),
            '-i',
            absPath,
            '-vf',
            `fps=${input.frameCount}/${durationSec},scale=${FILMSTRIP_FRAME_WIDTH}:${frameHeight}:force_original_aspect_ratio=disable,tile=${input.frameCount}x1`,
            '-frames:v',
            '1',
            '-an',
            cachePath,
          ];
    const result = await runFFmpeg(args, { inputDuration: durationSec });
    if (result.exitCode !== 0) {
      throw new Error(`FFmpeg filmstrip failed: ${result.stderr.slice(-500)}`);
    }
  }
  return {
    path: cachePath,
    frameWidth: FILMSTRIP_FRAME_WIDTH,
    frameHeight,
    frameCount: input.frameCount,
  };
}

export function normalizeSourceRange(input: {
  startMs: number;
  endMs: number;
  durationMs: number;
}): { startMs: number; endMs: number; durationMs: number } {
  if (!Number.isFinite(input.startMs) || !Number.isFinite(input.endMs)) {
    throw new Error('Invalid source range');
  }
  const durationMs = Math.max(
    1,
    Math.round(Number.isFinite(input.durationMs) ? input.durationMs : 1),
  );
  const startMs = Math.max(
    0,
    Math.min(durationMs - 1, Math.round(input.startMs)),
  );
  const endMs = Math.max(
    startMs + 1,
    Math.min(durationMs, Math.round(input.endMs)),
  );
  return {
    startMs,
    endMs,
    durationMs: endMs - startMs,
  };
}

function wordLabelsForRange(
  words: SubtitleWord[],
  startMs: number,
  endMs: number,
): SourceRangeWordLabel[] {
  return words
    .filter((word) => word.endMs > startMs && word.startMs < endMs)
    .map((word) => ({
      text: word.text,
      startMs: word.startMs,
      endMs: word.endMs,
      relativeStartMs: Math.max(0, word.startMs - startMs),
      relativeEndMs: Math.min(endMs - startMs, word.endMs - startMs),
    }));
}

function filmstripFrameHeight(asset: MediaItem): number {
  const width = asset.metadata.width ?? 16;
  const height = asset.metadata.height ?? 9;
  const aspect = width / Math.max(1, height);
  return Math.max(2, Math.round(FILMSTRIP_FRAME_WIDTH / aspect));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function rangeCacheSegment(value: number): string {
  return String(Math.max(0, Math.round(value)));
}

function stableEvidenceArtifactId(
  source: SourceMedia,
  startMs: number,
  endMs: number,
): string {
  const digest = createHash('sha1')
    .update(
      `source-range-evidence:${source.id}:${source.contentHash}:${startMs}:${endMs}`,
    )
    .digest('hex')
    .slice(0, 16);
  return `source-range-evidence-${digest}`;
}
