import { describe, expect, it } from 'vitest';

import {
  applyOutputRangeToEdl,
  outputRangeFileSuffix,
  outputRangeFromFrames,
  resolveOutputRange,
} from '@/shared/video/output-range';
import type { EditDecisionList } from '@/shared/video/types';

const RATE_30 = { num: 30, den: 1 };
const RATE_2997 = { num: 30_000, den: 1001 };

function edlFixture(): EditDecisionList {
  return {
    schema: 'neuma.video.edl.v1',
    projectId: 'project-1',
    fps: 30,
    frameRate: RATE_30,
    durationMs: 10_000,
    segments: [
      {
        id: 'seg-a',
        trackId: 'track-video',
        clipId: 'clip-a',
        sourceRef: { kind: 'asset', assetId: 'asset-a' },
        timelineStartMs: 0,
        sourceStartMs: 0,
        durationMs: 4000,
        entranceMs: 250,
        transitionToNext: 'fade',
      },
      {
        id: 'seg-b',
        trackId: 'track-video',
        clipId: 'clip-b',
        sourceRef: { kind: 'asset', assetId: 'asset-b' },
        timelineStartMs: 4000,
        sourceStartMs: 1000,
        durationMs: 6000,
      },
    ],
    overlays: [],
    audioTracks: [
      {
        id: 'track-music',
        kind: 'audio-music',
        muted: false,
        clips: [
          {
            id: 'aud-a',
            clipId: 'clip-music',
            sourceRef: { kind: 'asset', assetId: 'asset-music' },
            timelineStartMs: 0,
            sourceStartMs: 0,
            durationMs: 10_000,
            fadeInMs: 500,
            fadeOutMs: 500,
          },
        ],
      },
    ],
    captions: [
      {
        id: 'cap-a',
        clipId: 'clip-cap-a',
        sourceRef: { kind: 'asset', assetId: 'asset-a' },
        startMs: 1000,
        endMs: 2000,
        text: 'Before the range',
      },
      {
        id: 'cap-b',
        clipId: 'clip-cap-b',
        sourceRef: { kind: 'asset', assetId: 'asset-b' },
        startMs: 4500,
        endMs: 6500,
        text: 'Across the range start',
      },
    ],
  };
}

describe('resolveOutputRange', () => {
  it('returns null when no range is set', () => {
    expect(resolveOutputRange({ durationMs: 10_000 }, RATE_30)).toBeNull();
  });

  it('returns null when the range already covers the whole timeline', () => {
    expect(
      resolveOutputRange(
        {
          durationMs: 10_000,
          outputRange: { inFrame: 0, outFrameExclusive: 300 },
        },
        RATE_30,
      ),
    ).toBeNull();
  });

  it('clamps a range that runs past the end of the timeline', () => {
    const resolved = resolveOutputRange(
      {
        durationMs: 10_000,
        outputRange: { inFrame: 60, outFrameExclusive: 9999 },
      },
      RATE_30,
    );

    expect(resolved).toMatchObject({ inFrame: 60, outFrameExclusive: 300 });
    expect(resolved?.durationFrames).toBe(240);
    expect(resolved?.durationMs).toBe(8000);
  });

  it('keeps a one-frame tail range representable', () => {
    const resolved = resolveOutputRange(
      {
        durationMs: 10_000,
        outputRange: { inFrame: 299, outFrameExclusive: 300 },
      },
      RATE_30,
    );

    expect(resolved?.durationFrames).toBe(1);
    expect(resolved?.inMs).toBeCloseTo(9966.67, 1);
  });

  it('computes fractional-rate bounds without rounding to whole seconds', () => {
    const resolved = resolveOutputRange(
      {
        durationMs: 10_000,
        outputRange: { inFrame: 30, outFrameExclusive: 60 },
      },
      RATE_2997,
    );

    // 30 frames at 30000/1001 is 1001ms, not 1000ms.
    expect(resolved?.inMs).toBeCloseTo(1001, 3);
    expect(resolved?.durationMs).toBeCloseTo(1001, 3);
  });
});

describe('applyOutputRangeToEdl', () => {
  it('leaves the EDL untouched when there is no range', () => {
    const edl = edlFixture();
    expect(applyOutputRangeToEdl(edl, null)).toBe(edl);
  });

  it('shifts render-local time to zero and records project provenance', () => {
    const range = resolveOutputRange(
      {
        durationMs: 10_000,
        outputRange: { inFrame: 60, outFrameExclusive: 180 },
      },
      RATE_30,
    );
    const applied = applyOutputRangeToEdl(edlFixture(), range);

    expect(applied.durationMs).toBe(4000);
    expect(applied.outputRange).toEqual({
      inFrame: 60,
      outFrameExclusive: 180,
      projectStartMs: 2000,
      projectEndMs: 6000,
    });
    expect(applied.segments[0]).toMatchObject({
      id: 'seg-a',
      timelineStartMs: 0,
      // Two seconds of the clip fell before the range, so the source has to
      // advance by the same two seconds.
      sourceStartMs: 2000,
      durationMs: 2000,
    });
    expect(applied.segments[1]).toMatchObject({
      id: 'seg-b',
      timelineStartMs: 2000,
      sourceStartMs: 1000,
      durationMs: 2000,
    });
  });

  it('drops clips that fall entirely outside the range', () => {
    const range = resolveOutputRange(
      {
        durationMs: 10_000,
        outputRange: { inFrame: 150, outFrameExclusive: 300 },
      },
      RATE_30,
    );
    const applied = applyOutputRangeToEdl(edlFixture(), range);

    expect(applied.segments.map((segment) => segment.id)).toEqual(['seg-b']);
    // cap-a ends at 2000ms, well before the range starts at 5000ms; cap-b
    // straddles the boundary and survives trimmed.
    expect(applied.captions.map((caption) => caption.id)).toEqual(['cap-b']);
  });

  it('trims a caption that straddles the range start', () => {
    const range = resolveOutputRange(
      {
        durationMs: 10_000,
        outputRange: { inFrame: 150, outFrameExclusive: 240 },
      },
      RATE_30,
    );
    const applied = applyOutputRangeToEdl(edlFixture(), range);

    expect(applied.captions).toHaveLength(1);
    expect(applied.captions[0]).toMatchObject({
      id: 'cap-b',
      startMs: 0,
      endMs: 1500,
    });
  });

  it('drops fades and transitions the range cut through', () => {
    const range = resolveOutputRange(
      {
        durationMs: 10_000,
        outputRange: { inFrame: 30, outFrameExclusive: 90 },
      },
      RATE_30,
    );
    const applied = applyOutputRangeToEdl(edlFixture(), range);

    // seg-a is cut at both ends: its entrance and its transition out are gone.
    expect(applied.segments[0]?.entranceMs).toBeUndefined();
    expect(applied.segments[0]?.transitionToNext).toBeUndefined();
    const music = applied.audioTracks[0]?.clips[0];
    expect(music?.fadeInMs).toBeUndefined();
    expect(music?.fadeOutMs).toBeUndefined();
    expect(music?.durationMs).toBe(2000);
  });

  it('advances a sped-up clip by the scaled source amount', () => {
    const edl = edlFixture();
    edl.segments[0] = {
      ...edl.segments[0]!,
      playback: { speed: 2, preservePitch: true },
    };
    const range = resolveOutputRange(
      {
        durationMs: 10_000,
        outputRange: { inFrame: 30, outFrameExclusive: 90 },
      },
      RATE_30,
    );
    const applied = applyOutputRangeToEdl(edl, range);

    // One second of timeline at 2x consumed two seconds of source.
    expect(applied.segments[0]?.sourceStartMs).toBe(2000);
  });

  it('renders the whole timeline duration when the range is the tail', () => {
    const range = resolveOutputRange(
      {
        durationMs: 10_000,
        outputRange: { inFrame: 270, outFrameExclusive: 300 },
      },
      RATE_30,
    );
    const applied = applyOutputRangeToEdl(edlFixture(), range);

    expect(applied.durationMs).toBe(1000);
    expect(applied.segments).toHaveLength(1);
    expect(applied.segments[0]?.timelineStartMs).toBe(0);
  });
});

describe('output range helpers', () => {
  it('names ranged output so it cannot overwrite a full export', () => {
    const range = resolveOutputRange(
      {
        durationMs: 10_000,
        outputRange: { inFrame: 60, outFrameExclusive: 180 },
      },
      RATE_30,
    );

    expect(outputRangeFileSuffix(range)).toBe('-f60-180');
    expect(outputRangeFileSuffix(null)).toBe('');
  });

  it('rejects empty and fractional ranges at construction', () => {
    expect(outputRangeFromFrames(0, 1)).toEqual({
      inFrame: 0,
      outFrameExclusive: 1,
    });
    expect(() => outputRangeFromFrames(10, 10)).toThrow('must end after');
    expect(() => outputRangeFromFrames(1.5, 10)).toThrow('whole frames');
    expect(() => outputRangeFromFrames(-1, 10)).toThrow('at or after 0');
  });
});
