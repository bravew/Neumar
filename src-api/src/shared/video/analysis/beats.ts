import { createHash } from 'node:crypto';

import type { BeatGridArtifact, BeatGridPoint } from '@neumar/video-ir';

import { getPeaks, type PeaksResult } from '../asset-thumbs';
import type { AnalysisArtifact, MediaItem, SourceMedia } from '../types';

const DEFAULT_BINS = 2_048;
const MIN_BEAT_GAP_MS = 180;

export interface BeatGridAnalysis {
  grid: BeatGridArtifact;
  artifact: AnalysisArtifact;
}

export async function analyzeSourceBeats(input: {
  source: SourceMedia;
  asset: MediaItem;
  workspaceRoot: string;
  bins?: number;
  now?: string;
  readPeaks?: typeof getPeaks;
}): Promise<BeatGridAnalysis> {
  const peaks = await (input.readPeaks ?? getPeaks)(
    input.asset.path,
    input.bins ?? DEFAULT_BINS,
    input.workspaceRoot,
  );
  const points = detectBeatPoints(peaks);
  const grid: BeatGridArtifact = {
    schema: 'neuma.video.beat-grid.v1',
    sourceMediaId: input.source.id,
    contentHash: input.source.contentHash,
    tempoBpm: estimateTempoBpm(points),
    points,
  };
  const generatedAt = input.now ?? new Date().toISOString();
  return {
    grid,
    artifact: {
      id: beatGridArtifactId(input.source),
      kind: 'beat-markers',
      sourceMediaId: input.source.id,
      contentHash: input.source.contentHash,
      summary: `${points.length} detected beats`,
      ranges: points.map((point, index) => ({
        id: `beat-${index + 1}`,
        startMs: point.sourceMs,
        endMs: point.sourceMs,
        confidence: point.confidence,
      })),
      metadata: { beatGrid: grid },
      generatedAt,
    },
  };
}

export function detectBeatPoints(peaks: PeaksResult): BeatGridPoint[] {
  if (peaks.peaks.length < 3 || peaks.durationMs <= 0) return [];
  const sorted = [...peaks.peaks].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const upper = sorted[Math.floor(sorted.length * 0.8)] ?? median;
  const threshold = median + Math.max(0.04, (upper - median) * 0.55);
  const binMs = peaks.durationMs / peaks.peaks.length;
  const candidates: BeatGridPoint[] = [];
  for (let index = 1; index < peaks.peaks.length - 1; index += 1) {
    const value = peaks.peaks[index] ?? 0;
    if (
      value < threshold ||
      value < (peaks.peaks[index - 1] ?? 0) ||
      value <= (peaks.peaks[index + 1] ?? 0)
    ) {
      continue;
    }
    const sourceMs = Math.round((index + 0.5) * binMs);
    const previous = candidates.at(-1);
    if (previous && sourceMs - previous.sourceMs < MIN_BEAT_GAP_MS) {
      if (value > previous.confidence) {
        candidates[candidates.length - 1] = {
          sourceMs,
          confidence: roundConfidence(value),
        };
      }
      continue;
    }
    candidates.push({ sourceMs, confidence: roundConfidence(value) });
  }
  return candidates.map((point, index) => ({
    ...point,
    bar: Math.floor(index / 4) + 1,
    beat: (index % 4) + 1,
  }));
}

function estimateTempoBpm(points: BeatGridPoint[]): number | undefined {
  if (points.length < 3) return undefined;
  const intervals = points
    .slice(1)
    .map((point, index) => point.sourceMs - points[index]!.sourceMs)
    .filter((value) => value >= MIN_BEAT_GAP_MS)
    .sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  if (!median) return undefined;
  let tempo = 60_000 / median;
  while (tempo < 70) tempo *= 2;
  while (tempo > 180) tempo /= 2;
  return Math.round(tempo * 10) / 10;
}

function roundConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000) / 1_000;
}

function beatGridArtifactId(source: SourceMedia): string {
  return `beat-grid-${createHash('sha256')
    .update(source.id)
    .update(source.contentHash)
    .digest('hex')
    .slice(0, 20)}`;
}
