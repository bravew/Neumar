import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import { deleteProjectAsset, writeProject } from '@/shared/video/store';
import type { VideoProject, VideoTimeline } from '@/shared/video/types';

let workDir: string;

beforeEach(async () => {
  closeDatabase();
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-delete-asset-'));
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
});

afterEach(async () => {
  closeDatabase();
  vi.unstubAllEnvs();
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('deleteProjectAsset timeline cleanup', () => {
  it('drops timeline clips that source the deleted asset and recomputes duration', async () => {
    await writeProject(projectFixture());

    const next = await deleteProjectAsset('project-1', 'asset-1');

    expect(next.assets.map((asset) => asset.id)).toEqual(['asset-2']);
    const clips = next.timeline?.tracks[0]?.clips ?? [];
    // Only the scene clip and the asset-2 clip survive; the asset-1 clip is gone.
    expect(clips.map((clip) => clip.id)).toEqual([
      'clip-scene',
      'clip-asset-2',
    ]);
    // Duration collapses to the last surviving clip's end (2000 + 1000).
    expect(next.timeline?.durationMs).toBe(3000);
  });

  it('leaves the timeline unchanged when the asset is not on it', async () => {
    await writeProject(projectFixture());

    const next = await deleteProjectAsset('project-1', 'asset-2');

    const clips = next.timeline?.tracks[0]?.clips ?? [];
    expect(clips.map((clip) => clip.id)).toEqual([
      'clip-scene',
      'clip-asset-1',
    ]);
    expect(next.timeline?.durationMs).toBe(2000);
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Delete asset',
    template: 'explainer',
    prompt: '',
    assets: [
      {
        id: 'asset-1',
        kind: 'video',
        path: 'assets/asset-1.mp4',
        metadata: {},
      },
      {
        id: 'asset-2',
        kind: 'image',
        path: 'assets/asset-2.png',
        metadata: {},
      },
    ] as VideoProject['assets'],
    timeline: timelineFixture(),
    render: { status: 'idle' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-06-19T00:00:00.000Z',
    updatedAt: '2026-06-19T00:00:00.000Z',
  };
}

function timelineFixture(): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: 3000,
    fps: 30,
    tracks: [
      {
        id: 'track-video-main',
        kind: 'video',
        name: 'Video 1',
        muted: false,
        locked: false,
        hidden: false,
        order: 0,
        clips: [
          clipFixture('clip-scene', { kind: 'scene', sceneId: 'scene-1' }, 0),
          clipFixture(
            'clip-asset-1',
            { kind: 'asset', assetId: 'asset-1' },
            1000,
          ),
          clipFixture(
            'clip-asset-2',
            { kind: 'asset', assetId: 'asset-2' },
            2000,
          ),
        ],
      },
    ],
  };
}

function clipFixture(
  id: string,
  sourceRef: VideoTimeline['tracks'][number]['clips'][number]['sourceRef'],
  startMs: number,
): VideoTimeline['tracks'][number]['clips'][number] {
  return {
    id,
    kind: 'video',
    name: id,
    sourceRef,
    sceneId: id,
    startMs,
    durationMs: 1000,
    trimStartMs: 0,
    trimEndMs: 1000,
    sourceDurationMs: 1000,
  } as VideoTimeline['tracks'][number]['clips'][number];
}
