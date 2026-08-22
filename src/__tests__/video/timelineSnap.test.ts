import { describe, expect, it } from 'vitest';

import {
  buildTimelineSnapTargets,
  computeTimelineSnap,
  getTimelineSnapToleranceMs,
} from '@/components/video/timeline/timelineSnap';
import type { VideoTimelineTrack } from '@/shared/types/video';

describe('timeline snap helpers', () => {
  it('snaps the nearest clip edge inside the tolerance', () => {
    const snap = computeTimelineSnap({
      candidateStartMs: 940,
      durationMs: 500,
      toleranceMs: 80,
      targets: [{ timeMs: 1000, kind: 'clip-start' }],
    });

    expect(snap).toMatchObject({
      edge: 'start',
      deltaMs: 60,
      target: { timeMs: 1000 },
    });
  });

  it('does not snap beyond tolerance', () => {
    expect(
      computeTimelineSnap({
        candidateStartMs: 850,
        durationMs: 500,
        toleranceMs: 80,
        targets: [{ timeMs: 1000, kind: 'clip-start' }],
      }),
    ).toBeNull();
  });

  it('builds targets from clip edges, playhead, markers, and timeline bounds', () => {
    const targets = buildTimelineSnapTargets({
      tracks: timelineTracks(),
      movingClipIds: new Set(['clip-1']),
      playheadMs: 750,
      durationMs: 2500,
      markers: [{ id: 'marker-1', timeMs: 1250, label: 'Beat' }],
      beatTimesMs: [1000],
    });

    expect(targets).toEqual(
      expect.arrayContaining([
        { timeMs: 0, kind: 'timeline-start' },
        { timeMs: 2500, kind: 'timeline-end' },
        { timeMs: 750, kind: 'playhead' },
        { timeMs: 1250, kind: 'marker' },
        { timeMs: 1000, kind: 'beat' },
        { timeMs: 1500, kind: 'clip-start' },
        { timeMs: 2000, kind: 'clip-end' },
      ]),
    );
    expect(targets).not.toEqual(
      expect.arrayContaining([{ timeMs: 0, kind: 'clip-start' }]),
    );
  });

  it('converts pixel tolerance to timeline time', () => {
    expect(getTimelineSnapToleranceMs(8, 80)).toBe(100);
  });
});

function timelineTracks(): VideoTimelineTrack[] {
  return [
    {
      id: 'track-video-main',
      kind: 'video',
      name: 'Video',
      muted: false,
      locked: false,
      hidden: false,
      order: 0,
      clips: [
        {
          id: 'clip-1',
          kind: 'video',
          name: 'Scene 1',
          sourceRef: { kind: 'scene', sceneId: 'scene-1' },
          startMs: 0,
          durationMs: 1000,
          trimStartMs: 0,
          trimEndMs: 1000,
        },
        {
          id: 'clip-2',
          kind: 'video',
          name: 'Scene 2',
          sourceRef: { kind: 'scene', sceneId: 'scene-2' },
          startMs: 1500,
          durationMs: 500,
          trimStartMs: 0,
          trimEndMs: 500,
        },
      ],
    },
  ];
}
