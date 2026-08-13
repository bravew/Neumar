import { describe, expect, it } from 'vitest';

import { findNextOpenClipStartMs } from '@/components/video/timeline/timelinePlacement';
import type {
  VideoVisualTimelineClip,
  VideoVisualTimelineTrack,
} from '@/shared/types/video';

describe('timeline placement', () => {
  it('uses the desired start when the clip fits before the next clip', () => {
    const track = trackFixture([clipFixture('later', 10_000, 1000)]);

    expect(findNextOpenClipStartMs(track, 5000, 3000)).toBe(5000);
  });

  it('moves repeated placements after overlapping clips', () => {
    const track = trackFixture([
      clipFixture('first', 0, 37_314),
      clipFixture('second', 37_314, 37_314),
    ]);

    expect(findNextOpenClipStartMs(track, 0, 37_314)).toBe(74_628);
  });

  it('fills a later gap large enough for the full duration', () => {
    const track = trackFixture([
      clipFixture('first', 0, 5000),
      clipFixture('third', 20_000, 5000),
    ]);

    expect(findNextOpenClipStartMs(track, 2500, 7000)).toBe(5000);
  });
});

function trackFixture(
  clips: VideoVisualTimelineClip[],
): VideoVisualTimelineTrack {
  return {
    id: 'track-video-main',
    kind: 'video',
    name: 'Video 1',
    muted: false,
    locked: false,
    order: 0,
    clips,
  };
}

function clipFixture(
  id: string,
  startMs: number,
  durationMs: number,
): VideoVisualTimelineClip {
  return {
    id,
    kind: 'video',
    sourceRef: { kind: 'asset', assetId: id },
    startMs,
    durationMs,
    trimStartMs: 0,
    trimEndMs: durationMs,
    sourceDurationMs: durationMs,
  };
}
