import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import {
  createProject,
  getProject,
  inspectSourceRange,
  writeProject,
} from '@/shared/video/store';
import type {
  MediaItem,
  SourceMedia,
  SourceMediaAnalysis,
} from '@/shared/video/types';

describe('source range evidence store integration', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-range-store-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('persists evidence artifacts and links them to the source analysis', async () => {
    const project = await createProject({
      name: 'Range evidence',
      template: 'explainer',
    });
    const asset = assetFixture();
    const source = sourceFixture(asset.id, randomUUID());
    await writeProject({
      ...project,
      assets: [asset],
      sources: [source],
      sourceAnalyses: [analysisFixture(source.id)],
      analysisArtifacts: [],
    });
    insertSourceRow(project.id, source);

    const result = await inspectSourceRange(
      project.id,
      source.id,
      { startMs: 100, endMs: 1200, frameCount: 3, waveformBins: 64 },
      {
        buildFilmstrip: vi.fn(async () => ({
          path: path.join(workDir, '.cache', 'range.png'),
          frameWidth: 160,
          frameHeight: 90,
          frameCount: 3,
        })),
        getPeaks: vi.fn(async () => ({
          bins: 64,
          peaks: [0.1, 0.2],
          durationMs: 1100,
        })),
      },
    );

    expect(result.artifact.kind).toBe('source-range-evidence');
    expect(result.payload.words).toEqual([
      {
        text: 'hello',
        startMs: 100,
        endMs: 300,
        relativeStartMs: 0,
        relativeEndMs: 200,
      },
      {
        text: 'world',
        startMs: 500,
        endMs: 900,
        relativeStartMs: 400,
        relativeEndMs: 800,
      },
    ]);

    const stored = await getProject(project.id);
    expect(stored.analysisArtifacts).toHaveLength(1);
    expect(stored.analysisArtifacts?.[0]).toMatchObject({
      id: result.artifact.id,
      kind: 'source-range-evidence',
    });
    expect(stored.sourceAnalyses?.[0]?.artifactIds).toContain(
      result.artifact.id,
    );
  });
});

function sourceFixture(mediaItemId: string, sourceId: string): SourceMedia {
  return {
    id: sourceId,
    mediaItemId,
    origin: 'upload',
    contentHash: 'hash1',
    analysisStatus: 'done',
    analysisId: 'analysis-1',
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

function insertSourceRow(projectId: string, source: SourceMedia): void {
  getDatabase()
    .prepare(
      `INSERT INTO video_sources
        (id, project_id, media_item_id, origin, source_url, content_hash,
         analysis_status, provenance_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      source.id,
      projectId,
      source.mediaItemId,
      source.origin,
      source.sourceUrl ?? null,
      source.contentHash,
      source.analysisStatus,
      JSON.stringify({ rights: source.rights }),
      source.createdAt,
    );
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

function analysisFixture(sourceId: string): SourceMediaAnalysis {
  return {
    id: 'analysis-1',
    sourceId,
    contentHash: 'hash1',
    durationMs: 5000,
    streams: assetFixture().metadata,
    scenes: [],
    speechRanges: [],
    transcript: {
      engine: 'Local:mock',
      words: [
        { text: 'hello', startMs: 100, endMs: 300 },
        { text: 'world', startMs: 500, endMs: 900 },
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
