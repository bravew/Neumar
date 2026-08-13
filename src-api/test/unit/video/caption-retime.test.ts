import { describe, expect, it } from 'vitest';

import {
  carryForwardSttCaptions,
  retimeTimelineCaptions,
} from '@/shared/video/caption-retime';
import type {
  CaptionTimelineClip,
  VideoTimeline,
  VisualTimelineClip,
} from '@/shared/video/types';

function videoClip(over: Partial<VisualTimelineClip> = {}): VisualTimelineClip {
  return {
    id: 'clip-video',
    kind: 'video',
    sourceRef: { kind: 'asset', assetId: 'asset-1' },
    startMs: 0,
    durationMs: 5000,
    trimStartMs: 0,
    trimEndMs: 5000,
    sourceDurationMs: 5000,
    ...over,
  };
}

function sttCue(over: Partial<CaptionTimelineClip> = {}): CaptionTimelineClip {
  return {
    id: 'cap-1',
    kind: 'caption',
    sourceRef: { kind: 'asset', assetId: 'asset-1' },
    startMs: 2000,
    durationMs: 500,
    trimStartMs: 2000,
    trimEndMs: 2500,
    text: 'world',
    words: [{ text: 'world', startMs: 2000, endMs: 2500 }],
    sourceAnchor: {
      sourceMediaId: 'asset-1',
      sourceElementId: 'source-1',
      sourceStartMs: 2000,
      sourceEndMs: 2500,
    },
    params: { origin: 'stt' },
    ...over,
  };
}

function timeline(
  videoClips: VisualTimelineClip[],
  captionClips: CaptionTimelineClip[],
): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 5000,
    tracks: [
      {
        id: 'track-video',
        kind: 'video',
        name: 'Video',
        muted: false,
        locked: false,
        order: 0,
        clips: videoClips,
      },
      {
        id: 'track-caption-main',
        kind: 'caption',
        name: 'Captions',
        muted: false,
        locked: false,
        order: 30,
        clips: captionClips,
      },
    ],
  };
}

describe('retimeTimelineCaptions', () => {
  it('moves a cue when its host clip is repositioned', () => {
    // Clip now starts at timeline 1000 but still shows source [0,5000).
    const tl = timeline([videoClip({ startMs: 1000 })], [sttCue()]);
    const next = retimeTimelineCaptions(tl);
    const cue = next.tracks.find((t) => t.kind === 'caption')!.clips[0]!;
    // source 2000 -> timeline 1000 + (2000 - 0) = 3000.
    expect(cue.startMs).toBe(3000);
    expect(cue.words?.[0]).toMatchObject({ startMs: 3000, endMs: 3500 });
  });

  it('rescales word timings when the host clip speed changes', () => {
    const cue = sttCue({
      startMs: 2000,
      durationMs: 500,
      words: [
        { text: 'a', startMs: 2000, endMs: 2250 },
        { text: 'b', startMs: 2250, endMs: 2500 },
      ],
    });
    // 2x speed: source [2000,2500) now plays back over half the timeline span.
    const tl = timeline([videoClip({ playback: { speed: 2 } })], [cue]);
    const next = retimeTimelineCaptions(tl);
    const out = next.tracks.find((t) => t.kind === 'caption')!
      .clips[0]! as typeof cue;
    expect(out.startMs).toBe(1000);
    expect(out.durationMs).toBe(250);
    // Words compress into the halved cue rather than keeping their old spacing.
    expect(out.words).toEqual([
      { text: 'a', startMs: 1000, endMs: 1125 },
      { text: 'b', startMs: 1125, endMs: 1250 },
    ]);
  });

  it('drops a cue whose speech was trimmed out of the timeline', () => {
    // Clip now only shows source [3000,5000); the cue's 2000ms speech is gone.
    const tl = timeline([videoClip({ trimStartMs: 3000 })], [sttCue()]);
    const next = retimeTimelineCaptions(tl);
    expect(next.tracks.find((t) => t.kind === 'caption')!.clips).toHaveLength(
      0,
    );
  });

  it('leaves non-STT caption clips untouched', () => {
    const manual = sttCue({ id: 'manual', params: { origin: 'capture' } });
    const tl = timeline([videoClip({ startMs: 1000 })], [manual]);
    const next = retimeTimelineCaptions(tl);
    expect(
      next.tracks.find((t) => t.kind === 'caption')!.clips[0]!.startMs,
    ).toBe(2000);
  });
});

describe('carryForwardSttCaptions', () => {
  it('moves STT cues onto a freshly rebuilt timeline', () => {
    const previous = timeline([videoClip()], [sttCue()]);
    const fresh = timeline([videoClip({ startMs: 500 })], []);
    const merged = carryForwardSttCaptions(previous, fresh);
    const captions = merged.tracks.find((t) => t.kind === 'caption')!.clips;
    expect(captions).toHaveLength(1);
    // source 2000 -> 500 + 2000 = 2500.
    expect(captions[0]!.startMs).toBe(2500);
  });

  it('is a no-op when there were no generated captions', () => {
    const fresh = timeline([videoClip()], []);
    expect(carryForwardSttCaptions(timeline([videoClip()], []), fresh)).toBe(
      fresh,
    );
  });
});
