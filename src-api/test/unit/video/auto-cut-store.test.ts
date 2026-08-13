import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import {
  applyCutPlan,
  createProject,
  getProject,
  writeProject,
} from '@/shared/video/store';
import type {
  CutCandidate,
  MediaItem,
  SourceCutPlan,
  SourceMedia,
  SourceMediaAnalysis,
  VideoTimeline,
} from '@/shared/video/types';

describe('auto-cut store apply path', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-cut-store-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('applies an approved source cut plan to the timeline and records the op batch', async () => {
    const project = await createProject({
      name: 'Apply auto cut',
      template: 'explainer',
    });
    const asset = assetFixture();
    const source = sourceFixture(asset.id);
    const cutPlan = cutPlanFixture();
    await writeProject({
      ...project,
      assets: [asset],
      sources: [source],
      sourceAnalyses: [analysisFixture()],
      cutPlans: [cutPlan],
      analysisArtifacts: [],
      timeline: timelineFixture(),
    });
    insertSourceRow(project.id, source);

    const { cutPlan: applied } = await applyCutPlan(project.id, cutPlan.id);

    expect(applied.status).toBe('applied');
    const stored = await getProject(project.id);
    expect(stored.timeline?.durationMs).toBe(4000);
    expect(stored.timeline?.tracks[0]?.clips).toEqual([
      expect.objectContaining({ id: 'clip-video', durationMs: 1000 }),
      expect.objectContaining({
        startMs: 1000,
        durationMs: 3000,
        trimStartMs: 2000,
      }),
    ]);
    expect(stored.history?.entries[0]?.op).toMatchObject({
      kind: 'timeline.batch',
      ops: [expect.objectContaining({ kind: 'clip.removeTimeRange' })],
    });
    expect(stored.analysisArtifacts?.[0]).toMatchObject({
      kind: 'cut-candidates',
      ranges: [expect.objectContaining({ id: 'candidate-1' })],
      proposedActionBatch: {
        id: cutPlan.id,
        ops: [expect.objectContaining({ kind: 'clip.removeTimeRange' })],
      },
      metadata: expect.objectContaining({
        candidateIds: ['candidate-1'],
      }),
    });
    expect(stored.sourceAnalyses?.[0]?.artifactIds).toContain(
      `cut-plan-action-${cutPlan.id}`,
    );
  });
});

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
    id: 'asset-source',
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

function sourceFixture(mediaItemId: string): SourceMedia {
  return {
    id: 'source-1',
    mediaItemId,
    origin: 'upload',
    contentHash: 'hash1',
    analysisStatus: 'done',
    analysisId: 'analysis-1',
    createdAt: '2026-07-01T00:00:00.000Z',
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
        { text: 'hello', startMs: 0, endMs: 1000 },
        { text: 'world', startMs: 2000, endMs: 3000 },
      ],
      segments: [],
    },
    visualBeats: [],
    qualitySignals: [],
    duplicateCandidates: [],
    cutCandidates: [candidateFixture()],
    generatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function cutPlanFixture(): SourceCutPlan {
  return {
    id: 'cut-plan-1',
    sourceId: 'source-1',
    status: 'approved',
    keepRanges: [],
    cutCandidates: [
      candidateFixture(),
      {
        ...candidateFixture(),
        id: 'candidate-outside',
        startMs: 6000,
        endMs: 7000,
      },
    ],
    timeMap: { sourceId: 'source-1', keepRanges: [] },
    approvedAt: '2026-07-01T00:00:00.000Z',
  };
}

function candidateFixture(): CutCandidate {
  return {
    id: 'candidate-1',
    sourceId: 'source-1',
    startMs: 1000,
    endMs: 2000,
    reason: 'silence',
    confidence: 0.9,
    destructive: false,
    evidence: [{ kind: 'asr', summary: 'gap', score: 0.9 }],
    recommendation: 'cut',
  };
}

function timelineFixture(): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 5000,
    tracks: [
      {
        id: 'track-video',
        kind: 'video',
        name: 'Video',
        muted: false,
        locked: false,
        order: 0,
        clips: [
          {
            id: 'clip-video',
            kind: 'video',
            sourceRef: { kind: 'asset', assetId: 'asset-source' },
            startMs: 0,
            durationMs: 5000,
            trimStartMs: 0,
            trimEndMs: 5000,
            sourceDurationMs: 5000,
          },
        ],
      },
    ],
  };
}
