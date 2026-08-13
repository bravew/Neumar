import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import type { SourceTranscriptResult } from '@/shared/video/analysis/transcript';
import {
  analyzeSource,
  createProject,
  getPackedTranscript,
  getProject,
  writeProject,
} from '@/shared/video/store';
import type { MediaItem, SourceMedia } from '@/shared/video/types';

const transcribeSourceMediaMock = vi.hoisted(() => vi.fn());

vi.mock('@/shared/video/analysis/transcript', () => ({
  transcribeSourceMedia: transcribeSourceMediaMock,
}));

describe('source analysis transcript store integration', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    transcribeSourceMediaMock.mockReset();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-store-asr-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('stores source transcript and packed transcript artifacts from analyzeSource', async () => {
    const project = await createProject({
      name: 'Analysis transcript',
      template: 'explainer',
    });
    const asset = assetFixture();
    const source = sourceFixture(asset.id);
    await writeProject({
      ...project,
      assets: [asset],
      sources: [source],
      analysisArtifacts: [],
    });
    insertSourceRow(project.id, source);
    transcribeSourceMediaMock.mockResolvedValue(
      transcriptResultFixture(source.id),
    );

    const { analysis } = await analyzeSource(project.id, source.id);

    expect(transcribeSourceMediaMock).toHaveBeenCalledTimes(1);
    expect(analysis.transcript?.words).toHaveLength(3);
    expect(analysis.speechRanges).toEqual([
      { startMs: 100, endMs: 1200, source: 'asr' },
    ]);
    expect(analysis.artifactIds).toEqual([
      'transcript-artifact',
      expect.stringMatching(/^packed-transcript-/),
    ]);

    const stored = await getProject(project.id);
    expect(stored.analysisArtifacts?.map((artifact) => artifact.kind)).toEqual([
      'transcript-ranges',
      'packed-transcript',
    ]);

    const packed = await getPackedTranscript(project.id, source.id);
    expect(packed.artifacts).toHaveLength(1);
    expect(packed.artifacts[0]?.payload).toMatchObject({
      version: 1,
      sourceMediaId: source.id,
      phrases: [{ text: 'hello brave world', startMs: 100, endMs: 1200 }],
    });
  });
});

function transcriptResultFixture(sourceId: string): SourceTranscriptResult {
  return {
    transcript: {
      engine: 'Local:mock-whisper',
      language: 'en',
      words: [
        { text: 'hello', startMs: 100, endMs: 300 },
        { text: 'brave', startMs: 350, endMs: 700 },
        { text: 'world', startMs: 800, endMs: 1200 },
      ],
      segments: [
        {
          id: 'asr-1',
          text: 'hello brave world',
          startMs: 100,
          endMs: 1200,
        },
      ],
    },
    artifact: {
      id: 'transcript-artifact',
      kind: 'transcript-ranges',
      sourceMediaId: sourceId,
      contentHash: 'hash1',
      summary: '3 word-level transcript ranges available.',
      ranges: [],
      metadata: {
        provider: 'Local',
        model: 'mock-whisper',
        dataEgress: 'local',
        degraded: false,
        wordTimestampsAvailable: true,
      },
      generatedAt: '2026-07-01T15:20:00.000Z',
    },
    provider: 'Local',
    providerKey: 'local',
    model: 'mock-whisper',
    dataEgress: 'local',
    degraded: false,
    cacheHit: false,
    estimatedCostCents: 0,
  };
}

function sourceFixture(mediaItemId: string): SourceMedia {
  return {
    id: `source-${randomUUID()}`,
    mediaItemId,
    origin: 'upload',
    contentHash: 'hash1',
    analysisStatus: 'idle',
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
      durationMs: 6000,
      width: 1920,
      height: 1080,
      audioTrackCount: 1,
    },
  };
}
