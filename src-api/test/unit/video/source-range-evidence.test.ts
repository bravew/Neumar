import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSourceRangeEvidenceArtifact,
  normalizeSourceRange,
} from '@/shared/video/analysis/source-range-evidence';
import type {
  MediaItem,
  SourceMedia,
  SourceMediaAnalysis,
} from '@/shared/video/types';

describe('source range evidence artifacts', () => {
  let workDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-evidence-'));
    cacheDir = path.join(workDir, '.cache', 'videos', 'project-1', 'analysis');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('builds compact range evidence with filmstrip, waveform, and word labels', async () => {
    const buildFilmstrip = vi.fn(async () => ({
      path: path.join(cacheDir, 'filmstrip.png'),
      frameWidth: 160,
      frameHeight: 90,
      frameCount: 4,
    }));
    const getPeaks = vi.fn(async () => ({
      bins: 32,
      peaks: Array.from({ length: 32 }, (_, index) => index / 31),
      durationMs: 2000,
    }));

    const result = await buildSourceRangeEvidenceArtifact({
      source: sourceFixture(),
      asset: assetFixture(),
      analysis: analysisFixture(),
      workspaceRoot: workDir,
      cacheDir,
      startMs: 1000,
      endMs: 3000,
      frameCount: 4,
      waveformBins: 4,
      dependencies: { buildFilmstrip, getPeaks },
      now: '2026-07-01T15:40:00.000Z',
    });

    expect(buildFilmstrip).toHaveBeenCalledWith(
      expect.objectContaining({
        startMs: 1000,
        durationMs: 2000,
        frameCount: 4,
      }),
    );
    expect(getPeaks).toHaveBeenCalledWith(
      'videos/project-1/sources/source.mp4',
      32,
      workDir,
      { startMs: 1000, durationMs: 2000 },
    );
    expect(result.artifact).toMatchObject({
      kind: 'source-range-evidence',
      sourceMediaId: 'source-1',
      generatedAt: '2026-07-01T15:40:00.000Z',
      metadata: {
        startMs: 1000,
        endMs: 3000,
        durationMs: 2000,
        wordCount: 2,
        filmstrip: { frameCount: 4 },
        waveform: { bins: 32, peakCount: 32 },
      },
    });
    expect(result.payload.words).toEqual([
      {
        text: 'first',
        startMs: 900,
        endMs: 1200,
        relativeStartMs: 0,
        relativeEndMs: 200,
      },
      {
        text: 'inside',
        startMs: 1500,
        endMs: 1800,
        relativeStartMs: 500,
        relativeEndMs: 800,
      },
    ]);
    await expect(fs.stat(result.artifact.cachePath!)).resolves.toBeTruthy();
  });

  it('rejects non-finite source ranges before cache paths are built', () => {
    expect(() =>
      normalizeSourceRange({
        startMs: Number.NaN,
        endMs: 1000,
        durationMs: 5000,
      }),
    ).toThrow('Invalid source range');
  });
});

function sourceFixture(): SourceMedia {
  return {
    id: 'source-1',
    mediaItemId: 'asset-1',
    origin: 'upload',
    contentHash: 'hash1',
    analysisStatus: 'done',
    analysisId: 'analysis-1',
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

function assetFixture(): MediaItem {
  return {
    id: 'asset-1',
    kind: 'video',
    source: 'user',
    path: 'videos/project-1/sources/source.mp4',
    metadata: {
      durationMs: 5000,
      width: 1920,
      height: 1080,
      audioTrackCount: 1,
    },
  };
}

function analysisFixture(): SourceMediaAnalysis {
  return {
    id: 'analysis-1',
    sourceId: 'source-1',
    contentHash: 'hash1',
    durationMs: 5000,
    streams: assetFixture().metadata,
    scenes: [],
    speechRanges: [],
    transcript: {
      engine: 'Local:mock',
      words: [
        { text: 'first', startMs: 900, endMs: 1200 },
        { text: 'inside', startMs: 1500, endMs: 1800 },
        { text: 'after', startMs: 3200, endMs: 3500 },
      ],
      segments: [],
    },
    visualBeats: [],
    qualitySignals: [],
    duplicateCandidates: [],
    cutCandidates: [],
    generatedAt: '2026-07-01T00:00:00.000Z',
  };
}
