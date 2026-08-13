import { describe, expect, it } from 'vitest';

import { applyCaptureToTimeline } from '@/components/video/timeline/captureTimeline';
import type {
  VideoMediaItem,
  VideoProject,
  VideoSourceMedia,
  VideoTimeline,
} from '@/shared/types/video';

describe('applyCaptureToTimeline', () => {
  it('inserts a capture clip at the playhead on the target video track', () => {
    const result = applyCaptureToTimeline({
      project: projectFixture(),
      source: captureSourceFixture(),
      asset: captureAssetFixture(),
      atMs: 1250,
      targetTrackId: 'track-video-main',
      clipId: 'clip-capture-test',
    });

    expect(result).toMatchObject({
      trackId: 'track-video-main',
      clipId: 'clip-capture-test',
      mode: 'insert',
    });
    expect(result.timeline.tracks[0]?.clips.at(-1)).toMatchObject({
      id: 'clip-capture-test',
      kind: 'video',
      sourceRef: { kind: 'asset', assetId: 'asset-capture-1' },
      startMs: 1250,
      durationMs: 2600,
      trimEndMs: 2600,
      params: { captureId: 'capture-1', origin: 'capture' },
    });
    expect(result.timeline.durationMs).toBe(3850);
  });

  it('replaces the selected clip while preserving its timeline start', () => {
    const result = applyCaptureToTimeline({
      project: projectFixture(),
      source: captureSourceFixture(),
      asset: captureAssetFixture({ durationMs: 4100 }),
      atMs: 0,
      replaceClipId: 'clip-scene-1',
      clipId: 'clip-capture-replace',
    });

    expect(result).toMatchObject({
      trackId: 'track-video-main',
      clipId: 'clip-capture-replace',
      mode: 'replace',
    });
    expect(result.timeline.tracks[0]?.clips).toHaveLength(1);
    expect(result.timeline.tracks[0]?.clips[0]).toMatchObject({
      id: 'clip-capture-replace',
      startMs: 500,
      durationMs: 4100,
      sceneId: 'scene-1',
      sourceRef: { kind: 'asset', assetId: 'asset-capture-1' },
    });
    expect(result.timeline.durationMs).toBe(4600);
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Capture test',
    template: 'custom',
    prompt: 'test',
    assets: [captureAssetFixture()],
    timeline: timelineFixture(),
    render: { status: 'idle', updatedAt: '2026-05-25T00:00:00.000Z' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
  };
}

function timelineFixture(): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: 2500,
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
          {
            id: 'clip-scene-1',
            kind: 'video',
            name: 'Scene 1',
            sourceRef: { kind: 'scene', sceneId: 'scene-1' },
            sceneId: 'scene-1',
            startMs: 500,
            durationMs: 2000,
            trimStartMs: 0,
            trimEndMs: 2000,
            sourceDurationMs: 2000,
          },
        ],
      },
    ],
  };
}

function captureSourceFixture(): VideoSourceMedia {
  return {
    id: 'capture-1',
    mediaItemId: 'asset-capture-1',
    origin: 'capture',
    contentHash: 'hash-capture',
    rights: { userConfirmed: true },
    analysisStatus: 'idle',
    createdAt: '2026-05-25T00:00:00.000Z',
  };
}

function captureAssetFixture(
  metadata: Partial<VideoMediaItem['metadata']> = {},
): VideoMediaItem {
  return {
    id: 'asset-capture-1',
    kind: 'video',
    source: 'capture',
    path: '/workspace/capture.mp4',
    metadata: {
      durationMs: 2600,
      width: 1920,
      height: 1080,
      frameRate: 30,
      audioTrackCount: 1,
      ...metadata,
    },
  };
}
