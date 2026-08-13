import { describe, expect, it } from 'vitest';

import { rippleShiftClipsStrict, type TimelineClip } from '../src';

describe('strict ripple', () => {
  it('reports negative starts without clipping the handle', () => {
    const clip = videoClip('clip-a', 100);
    const result = rippleShiftClipsStrict([clip], {
      fromMs: 0,
      deltaMs: -250,
    });

    expect(result.clips).toEqual([clip]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        clipId: 'clip-a',
        reason: 'negative-start',
      }),
    ]);
  });

  it('reports overlaps after a strict shift', () => {
    const result = rippleShiftClipsStrict(
      [videoClip('clip-a', 0), videoClip('clip-b', 1200)],
      {
        fromMs: 1000,
        deltaMs: -500,
      },
    );

    expect(result.conflicts).toEqual([
      expect.objectContaining({
        clipId: 'clip-b',
        reason: 'overlap',
      }),
    ]);
  });

  it('reports sync-lock conflicts instead of moving clips', () => {
    const clip = videoClip('clip-a', 1000);
    const result = rippleShiftClipsStrict([clip], {
      fromMs: 0,
      deltaMs: 250,
      syncLockedTrack: true,
    });

    expect(result.clips).toEqual([clip]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        clipId: 'clip-a',
        reason: 'sync-lock',
      }),
    ]);
  });
});

function videoClip(id: string, startMs: number): TimelineClip {
  return {
    id,
    kind: 'video',
    sourceRef: { kind: 'asset', assetId: id },
    startMs,
    durationMs: 1000,
    trimStartMs: 0,
    trimEndMs: 1000,
  };
}
