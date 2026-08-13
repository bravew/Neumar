import { describe, expect, it } from 'vitest';

import {
  clipsTouchWithinFrame,
  deriveTimelineTransitionSeams,
  timelineTransitionEffectiveMaxMs,
} from '@/components/video/timeline/timelineTransitions';
import type {
  VideoTimelineTrack,
  VideoVisualTimelineClip,
} from '@/shared/types/video';

describe('timeline transition seams', () => {
  it('derives deterministic seam IDs from visual clips sorted by start time', () => {
    const seams = deriveTimelineTransitionSeams(
      [
        visualTrack([
          videoClip('clip-b', 1000),
          videoClip('clip-a', 0, { transitionToNext: 'fade' }),
        ]),
      ],
      30,
    );

    expect(seams).toEqual([
      expect.objectContaining({
        seamId: 'seam:track-video:clip-a:clip-b',
        fromClipId: 'clip-a',
        toClipId: 'clip-b',
        startMs: 1000,
        transition: 'fade',
        canAcceptTransition: true,
      }),
    ]);
  });

  it('uses the same one-frame gap tolerance as WebCodecs preview seams', () => {
    expect(
      clipsTouchWithinFrame(
        videoClip('clip-a', 0),
        videoClip('clip-b', 1033),
        30,
      ),
    ).toBe(true);
    expect(
      clipsTouchWithinFrame(
        videoClip('clip-a', 0),
        videoClip('clip-b', 1100),
        30,
      ),
    ).toBe(false);
  });

  it('reports blocked seam reasons without exposing broken-gap transitions', () => {
    const gapSeam = deriveTimelineTransitionSeams(
      [
        visualTrack([
          videoClip('clip-a', 0, { transitionToNext: 'fade' }),
          videoClip('clip-b', 1500),
        ]),
      ],
      30,
    )[0];
    const lockedSeam = deriveTimelineTransitionSeams(
      [
        visualTrack(
          [
            videoClip('clip-a', 0, { transitionToNext: 'fade' }),
            videoClip('clip-b', 1000),
          ],
          { locked: true },
        ),
      ],
      30,
    )[0];

    expect(gapSeam).toMatchObject({
      blockedReason: 'gap',
      canAcceptTransition: false,
      transition: null,
    });
    expect(lockedSeam).toMatchObject({
      blockedReason: 'locked-track',
      canAcceptTransition: false,
      transition: 'fade',
    });
  });

  it('computes the neighbor-half duration ceiling with preset max bounds', () => {
    expect(
      timelineTransitionEffectiveMaxMs(
        videoClip('clip-a', 0, {
          durationMs: 4000,
          transitionToNext: { kind: 'cube', durationMs: 3000 },
        }),
        videoClip('clip-b', 4000, { durationMs: 5000 }),
      ),
    ).toBe(1500);
    expect(
      timelineTransitionEffectiveMaxMs(
        videoClip('clip-a', 0, {
          durationMs: 800,
          transitionToNext: { kind: 'fade', durationMs: 3000 },
        }),
        videoClip('clip-b', 800, { durationMs: 700 }),
      ),
    ).toBe(350);
  });
});

function visualTrack(
  clips: VideoVisualTimelineClip[],
  options: { locked?: boolean } = {},
): VideoTimelineTrack {
  return {
    id: 'track-video',
    kind: 'video',
    name: 'Video',
    muted: false,
    locked: options.locked ?? false,
    order: 0,
    clips,
  };
}

function videoClip(
  id: string,
  startMs: number,
  options: Partial<VideoVisualTimelineClip> = {},
): VideoVisualTimelineClip {
  return {
    id,
    kind: 'video',
    sourceRef: { kind: 'asset', assetId: id },
    startMs,
    durationMs: options.durationMs ?? 1000,
    trimStartMs: 0,
    trimEndMs: options.durationMs ?? 1000,
    ...options,
  };
}
