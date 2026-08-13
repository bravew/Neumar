import { describe, expect, it } from 'vitest';

import {
  commonAudioSeamValue,
  commonFilterValue,
  commonTransitionValue,
  findSelectedVisualClips,
  selectedTracksAreLocked,
} from '@/components/video/timeline/timelineClipAdjustmentState';
import type {
  VideoTimelineTrack,
  VideoVisualTimelineClip,
} from '@/shared/types/video';

describe('timelineClipAdjustmentState', () => {
  it('collects selected visual clips and skips non-visual clips', () => {
    const selected = findSelectedVisualClips(
      [videoTrackFixture, audioTrackFixture],
      new Set(['clip-video-a', 'clip-audio']),
    );

    expect(selected.map((item) => item.clip.id)).toEqual(['clip-video-a']);
    expect(selectedTracksAreLocked(selected)).toBe(false);
  });

  it('reports common and mixed adjustment values', () => {
    const selected = findSelectedVisualClips(
      [videoTrackFixture],
      new Set(['clip-video-a', 'clip-video-b']),
    );

    expect(commonTransitionValue(selected)).toEqual({
      value: 'fade',
      mixed: true,
    });
    expect(commonAudioSeamValue(selected)).toEqual({
      value: 'cut',
      mixed: false,
    });
    expect(commonFilterValue(selected, 'brightness', 1)).toEqual({
      value: 1.2,
      mixed: true,
    });
  });
});

const clipA: VideoVisualTimelineClip = {
  id: 'clip-video-a',
  kind: 'video',
  name: 'A',
  sourceRef: { kind: 'scene', sceneId: 'scene-a' },
  sceneId: 'scene-a',
  startMs: 0,
  durationMs: 1000,
  trimStartMs: 0,
  trimEndMs: 1000,
  sourceDurationMs: 1000,
  transitionToNext: 'fade',
  audioSeamToNext: 'cut',
  filters: { brightness: 1.2 },
};

const clipB: VideoVisualTimelineClip = {
  ...clipA,
  id: 'clip-video-b',
  sceneId: 'scene-b',
  sourceRef: { kind: 'scene', sceneId: 'scene-b' },
  startMs: 1000,
  transitionToNext: 'wipe',
  filters: { brightness: 1.4 },
};

const videoTrackFixture: VideoTimelineTrack = {
  id: 'track-video',
  kind: 'video',
  name: 'Video',
  muted: false,
  locked: false,
  hidden: false,
  order: 0,
  clips: [clipA, clipB],
};

const audioTrackFixture: VideoTimelineTrack = {
  id: 'track-audio',
  kind: 'audio-music',
  name: 'Music',
  muted: false,
  locked: false,
  order: 10,
  clips: [
    {
      id: 'clip-audio',
      kind: 'audio',
      sourceRef: { kind: 'asset', assetId: 'asset-audio' },
      startMs: 0,
      durationMs: 1000,
      trimStartMs: 0,
      trimEndMs: 1000,
      sourceDurationMs: 1000,
    },
  ],
};
