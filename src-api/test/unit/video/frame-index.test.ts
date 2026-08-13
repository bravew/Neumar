import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';
import {
  indexProjectFrames,
  searchProjectFrames,
} from '@/shared/video/analysis/frame-index';
import type { VideoProject } from '@/shared/video/types';

let homeDir: string;
let workDir: string;

describe('video frame search index', () => {
  beforeEach(async () => {
    closeDatabase();
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-search-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-search-work-'));
    process.env.HOME = homeDir;
    process.env.NEUMA_VIDEO_WORKDIR = workDir;
    setSetting('workDir', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    delete process.env.NEUMA_VIDEO_WORKDIR;
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('stays disabled until video.frameSearch is explicitly enabled', async () => {
    const project = projectFixture();

    await expect(indexProjectFrames(project)).resolves.toEqual({
      indexed: 0,
      embedded: 0,
      skippedVector: 0,
    });
    await expect(
      searchProjectFrames(project.id, { query: 'product demo' }),
    ).resolves.toMatchObject({
      results: [],
      capability: {
        enabled: false,
        degraded: true,
        reason: 'video.frameSearch disabled',
      },
    });
  });

  it('indexes visual beats and searches frame captions with metadata fallback', async () => {
    setSetting('video.frameSearch', 'true');
    const project = projectFixture();

    const index = await indexProjectFrames(project);
    const result = await searchProjectFrames(project.id, {
      query: 'dashboard metrics',
      limit: 5,
    });

    expect(index.indexed).toBeGreaterThanOrEqual(2);
    expect(result.capability).toMatchObject({
      enabled: true,
      fts: true,
      degraded: true,
    });
    expect(result.results[0]).toMatchObject({
      sourceId: 'source-1',
      assetId: 'asset-video',
      caption: 'Presenter points at dashboard metrics.',
      matchedOn: 'metadata',
      thumbBase64: '',
    });
  });

  it('replaces stale frame captions when re-indexing a project', async () => {
    setSetting('video.frameSearch', 'true');
    const project = projectFixture();
    await indexProjectFrames(project);

    const updatedProject: VideoProject = {
      ...project,
      sourceAnalyses: project.sourceAnalyses?.map((analysis) => ({
        ...analysis,
        visualBeats: analysis.visualBeats.map((beat) => ({
          ...beat,
          caption: 'Replacement frame shows a product close-up.',
          tags: ['replacement', 'close-up'],
        })),
      })),
    };

    await indexProjectFrames(updatedProject);

    const oldResult = await searchProjectFrames(project.id, {
      query: 'dashboard metrics',
      limit: 5,
    });
    const newResult = await searchProjectFrames(project.id, {
      query: 'replacement close-up',
      limit: 5,
    });

    expect(oldResult.results).toEqual([]);
    expect(newResult.results[0]).toMatchObject({
      sourceId: 'source-1',
      assetId: 'asset-video',
      caption: 'Replacement frame shows a product close-up.',
      matchedOn: 'metadata',
    });
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Frame search',
    template: 'explainer',
    prompt: '',
    assets: [
      {
        id: 'asset-video',
        kind: 'video',
        source: 'user',
        path: 'videos/project-1/source.mp4',
        metadata: {
          durationMs: 6000,
          width: 1280,
          height: 720,
          audioTrackCount: 1,
        },
      },
      {
        id: 'asset-generated',
        kind: 'image',
        source: 'ai-image',
        path: 'videos/project-1/generated.png',
        metadata: { durationMs: 3000, width: 1024, height: 1024 },
        provenance: {
          provider: 'seedream-5-0',
          prompt: 'Close-up product hero on a clean tabletop',
        },
      },
    ],
    sources: [
      {
        id: 'source-1',
        mediaItemId: 'asset-video',
        origin: 'upload',
        contentHash: 'hash-1',
        analysisStatus: 'done',
        analysisId: 'analysis-1',
        createdAt: '2026-06-18T00:00:00.000Z',
      },
    ],
    sourceAnalyses: [
      {
        id: 'analysis-1',
        sourceId: 'source-1',
        contentHash: 'hash-1',
        durationMs: 6000,
        streams: {
          durationMs: 6000,
          width: 1280,
          height: 720,
          audioTrackCount: 1,
        },
        scenes: [],
        speechRanges: [],
        visualBeats: [
          {
            startMs: 1000,
            endMs: 2500,
            caption: 'Presenter points at dashboard metrics.',
            tags: ['dashboard', 'metrics'],
            source: 'vlm',
          },
        ],
        qualitySignals: [],
        duplicateCandidates: [],
        cutCandidates: [],
        generatedAt: '2026-06-18T00:00:00.000Z',
      },
    ],
    render: { status: 'idle', updatedAt: '2026-06-18T00:00:00.000Z' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z',
  };
}
