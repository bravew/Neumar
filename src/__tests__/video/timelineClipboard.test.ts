import { describe, expect, it } from 'vitest';

import {
  buildTimelineClipboardPayload,
  decodeTimelineClipboardPayload,
  encodeTimelineClipboardPayload,
  pasteTimelineClipboardPayload,
} from '@/components/video/timeline/timelineClipboard';
import type { VideoTimeline } from '@/shared/types/video';

describe('timeline clipboard helpers', () => {
  it('serializes selected clips with relative offsets', () => {
    const payload = buildTimelineClipboardPayload(
      timelineFixture(),
      new Set(['clip-2', 'clip-1']),
    );

    expect(payload?.clips.map((item) => item.clip.id)).toEqual([
      'clip-1',
      'clip-2',
    ]);
    expect(payload?.clips.map((item) => item.offsetMs)).toEqual([0, 1000]);
  });

  it('round-trips the system clipboard sentinel payload', () => {
    const payload = buildTimelineClipboardPayload(
      timelineFixture(),
      new Set(['clip-1']),
    );
    if (!payload) throw new Error('Expected clipboard payload');

    expect(
      decodeTimelineClipboardPayload(encodeTimelineClipboardPayload(payload)),
    ).toEqual(payload);
    expect(decodeTimelineClipboardPayload('plain text')).toBeNull();
  });

  it('pastes clips onto compatible tracks at the requested playhead', () => {
    const timeline = timelineFixture();
    const payload = buildTimelineClipboardPayload(
      timeline,
      new Set(['clip-1', 'clip-2']),
    );
    if (!payload) throw new Error('Expected clipboard payload');

    const result = pasteTimelineClipboardPayload({
      timeline,
      payload,
      startMs: 5000,
    });

    expect(result?.insertedClipIds).toHaveLength(2);
    const pastedClips = result?.timeline.tracks[0]?.clips.slice(2) ?? [];
    expect(pastedClips[0]).toMatchObject({ startMs: 5000, durationMs: 1000 });
    expect(pastedClips[1]).toMatchObject({ startMs: 6000, durationMs: 500 });
    expect(pastedClips[0]?.id).not.toBe('clip-1');
    expect(result?.timeline.durationMs).toBe(6500);
  });
});

function timelineFixture(): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: 1500,
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
            id: 'clip-1',
            kind: 'video',
            name: 'Scene 1',
            sourceRef: { kind: 'scene', sceneId: 'scene-1' },
            sceneId: 'scene-1',
            startMs: 0,
            durationMs: 1000,
            trimStartMs: 0,
            trimEndMs: 1000,
            sourceDurationMs: 1000,
          },
          {
            id: 'clip-2',
            kind: 'video',
            name: 'Scene 2',
            sourceRef: { kind: 'scene', sceneId: 'scene-2' },
            sceneId: 'scene-2',
            startMs: 1000,
            durationMs: 500,
            trimStartMs: 0,
            trimEndMs: 500,
            sourceDurationMs: 500,
          },
        ],
      },
    ],
  };
}
