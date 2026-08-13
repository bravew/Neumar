import { describe, expect, it } from 'vitest';

import {
  buildTimelineLassoCandidates,
  getClipIdsInLasso,
} from '@/components/video/timeline/useTimelineLassoSelection';
import type {
  VideoTimelineTrack,
  VideoVisualTimelineClip,
  VideoVisualTimelineTrack,
} from '@/shared/types/video';

describe('timeline lasso selection', () => {
  it('selects unlocked visible clips whose bounds intersect the lasso rect', () => {
    const candidates = buildTimelineLassoCandidates({
      rows: [
        { index: 0, start: 32, size: 64 },
        { index: 1, start: 96, size: 64 },
      ],
      tracks: [videoTrackFixture, lockedTrackFixture],
      pixelsPerSecond: 10,
    });

    expect(
      getClipIdsInLasso(candidates, {
        left: 140,
        top: 30,
        width: 15,
        height: 74,
      }),
    ).toEqual(['clip-a']);
    expect(candidates.map((candidate) => candidate.clipId)).toEqual([
      'clip-a',
      'clip-b',
    ]);
  });

  it('keeps very short clips selectable by using the rendered minimum width', () => {
    const candidates = buildTimelineLassoCandidates({
      rows: [{ index: 0, start: 32, size: 64 }],
      tracks: [
        {
          ...videoTrackFixture,
          clips: [{ ...clipAFixture, durationMs: 100 }],
        },
      ],
      pixelsPerSecond: 10,
    });

    expect(
      getClipIdsInLasso(candidates, {
        left: 160,
        top: 36,
        width: 8,
        height: 20,
      }),
    ).toEqual(['clip-a']);
  });
});

const clipAFixture: VideoVisualTimelineClip = {
  id: 'clip-a',
  kind: 'video',
  name: 'A',
  sourceRef: { kind: 'scene', sceneId: 'scene-a' },
  sceneId: 'scene-a',
  startMs: 0,
  durationMs: 1000,
  trimStartMs: 0,
  trimEndMs: 1000,
  sourceDurationMs: 1000,
};

const videoTrackFixture: VideoVisualTimelineTrack = {
  id: 'track-video',
  kind: 'video',
  name: 'Video',
  muted: false,
  locked: false,
  hidden: false,
  order: 0,
  clips: [
    clipAFixture,
    {
      id: 'clip-b',
      kind: 'video',
      name: 'B',
      sourceRef: { kind: 'scene', sceneId: 'scene-b' },
      sceneId: 'scene-b',
      startMs: 2000,
      durationMs: 1000,
      trimStartMs: 0,
      trimEndMs: 1000,
      sourceDurationMs: 1000,
    },
  ],
};

const lockedTrackFixture: VideoTimelineTrack = {
  ...videoTrackFixture,
  id: 'track-locked',
  locked: true,
  clips: [
    {
      ...videoTrackFixture.clips[0]!,
      id: 'clip-locked',
      sceneId: 'scene-locked',
      sourceRef: { kind: 'scene', sceneId: 'scene-locked' },
    },
  ],
};
