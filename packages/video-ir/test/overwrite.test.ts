import { describe, expect, it } from 'vitest';

import {
  applyTimelineOps,
  planOverwrite,
  type Timeline,
  type VisualTimelineTrack,
  type VisualTimelineClip,
} from '../src';

describe('overwrite planning', () => {
  it('clears an arbitrary region and round-trips through inverses', () => {
    const timeline = timelineFixture();
    const track = timeline.tracks[0]!;
    const incoming = videoClip('incoming', 0, 1000);
    const plan = planOverwrite(track, { startMs: 750, endMs: 1750 }, incoming);

    expect(plan.conflicts).toEqual([]);
    expect(plan.ops.map((op) => op.kind)).toEqual([
      'clip.trim',
      'clip.trim',
      'clip.insert',
    ]);

    const applied = applyTimelineOps(timeline, plan.ops);
    expect(applied.timeline.tracks[0]?.clips).toEqual([
      expect.objectContaining({
        id: 'clip-a',
        startMs: 0,
        durationMs: 750,
      }),
      expect.objectContaining({
        id: 'incoming',
        startMs: 750,
        durationMs: 1000,
      }),
      expect.objectContaining({
        id: 'clip-b',
        startMs: 1750,
        durationMs: 250,
        trimStartMs: 750,
      }),
    ]);

    const restored = applyTimelineOps(applied.timeline, applied.inverses);

    expect(restored.timeline).toEqual(timeline);
  });

  it('splits a clip around a middle overwrite with a non-colliding id', () => {
    const track: VisualTimelineTrack = {
      ...trackFixture(),
      clips: [
        videoClip('clip-a', 0, 2000),
        videoClip('clip-a-after-overwrite', 2500, 250),
      ],
    };
    const timeline: Timeline = {
      schema: 'neuma.video.timeline.v1',
      fps: 30,
      durationMs: 2750,
      tracks: [track],
    };
    const plan = planOverwrite(
      track,
      { startMs: 500, endMs: 1500 },
      videoClip('incoming', 0, 1000),
    );

    expect(plan.ops[0]).toMatchObject({
      kind: 'clip.split',
      after: [
        { id: 'clip-a', startMs: 0, durationMs: 500 },
        {
          id: 'clip-a-after-overwrite-2',
          startMs: 1500,
          durationMs: 500,
          trimStartMs: 1500,
        },
      ],
    });

    const applied = applyTimelineOps(timeline, plan.ops);
    const restored = applyTimelineOps(applied.timeline, applied.inverses);

    expect(restored.timeline).toEqual(timeline);
  });
});

function timelineFixture(): Timeline {
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 2000,
    tracks: [trackFixture()],
  };
}

function trackFixture(): VisualTimelineTrack {
  return {
    id: 'track-video',
    kind: 'video',
    name: 'Video',
    muted: false,
    locked: false,
    order: 0,
    clips: [videoClip('clip-a', 0, 1000), videoClip('clip-b', 1000, 1000)],
  };
}

function videoClip(
  id: string,
  startMs: number,
  durationMs: number,
): VisualTimelineClip {
  return {
    id,
    kind: 'video',
    sourceRef: { kind: 'asset', assetId: id },
    startMs,
    durationMs,
    trimStartMs: 0,
    trimEndMs: durationMs,
    sourceDurationMs: 2000,
  };
}
