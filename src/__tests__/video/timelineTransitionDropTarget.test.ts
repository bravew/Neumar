import { describe, expect, it } from 'vitest';

import { resolveTimelineTransitionDropTarget } from '@/components/video/timeline/timelineTransitionDropTarget';
import { deriveTimelineTransitionSeams } from '@/components/video/timeline/timelineTransitions';
import type {
  VideoTimelineTrack,
  VideoVisualTimelineClip,
} from '@/shared/types/video';

describe('resolveTimelineTransitionDropTarget', () => {
  it('targets the nearest seam within the pixel radius', () => {
    const track = visualTrackFixture();
    const seams = deriveTimelineTransitionSeams([track], 30);

    const target = resolveTimelineTransitionDropTarget({
      clips: track.clips,
      seams,
      pointerMs: 1080,
      pixelsPerSecond: 100,
    });

    expect(target?.seamId).toBe('seam:track-video:clip-1:clip-2');
  });

  it('uses clip edge zones when the pointer is away from the seam line', () => {
    const track = visualTrackFixture();
    const seams = deriveTimelineTransitionSeams([track], 30);

    const target = resolveTimelineTransitionDropTarget({
      clips: track.clips,
      seams,
      pointerMs: 1800,
      pixelsPerSecond: 400,
    });

    expect(target?.seamId).toBe('seam:track-video:clip-2:clip-3');
  });

  it('returns blocked seam targets so callers can explain invalid drops', () => {
    const track = visualTrackFixture({ locked: true });
    const seams = deriveTimelineTransitionSeams([track], 30);

    const target = resolveTimelineTransitionDropTarget({
      clips: track.clips,
      seams,
      pointerMs: 1000,
      pixelsPerSecond: 100,
    });

    expect(target).toMatchObject({
      seamId: 'seam:track-video:clip-1:clip-2',
      canAcceptTransition: false,
      blockedReason: 'locked-track',
    });
  });
});

function visualTrackFixture(options?: {
  locked?: boolean;
}): VideoTimelineTrack & { clips: VideoVisualTimelineClip[] } {
  return {
    id: 'track-video',
    kind: 'video',
    name: 'Video',
    muted: false,
    locked: options?.locked ?? false,
    hidden: false,
    order: 0,
    clips: [
      visualClipFixture('clip-1', 0),
      visualClipFixture('clip-2', 1000),
      visualClipFixture('clip-3', 2000),
    ],
  };
}

function visualClipFixture(
  id: string,
  startMs: number,
): VideoVisualTimelineClip {
  return {
    id,
    kind: 'video',
    name: id,
    sourceRef: { kind: 'scene', sceneId: id },
    sceneId: id,
    startMs,
    durationMs: 1000,
    trimStartMs: 0,
    trimEndMs: 1000,
    sourceDurationMs: 1000,
  };
}
