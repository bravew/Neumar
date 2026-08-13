import { describe, expect, it } from 'vitest';

import {
  buildVividOverlayEntries,
  instantiatedVividOverlayDocument,
  isVividOverlayActiveAtFrame,
  vividOverlayEntryAtLocalTime,
  vividOverlayLocalTimeMs,
} from '@/components/video/preview/overlays/vividOverlayPreviewModel';
import type { VideoTimeline } from '@/shared/types/video';

const FPS = 30;

function timelineFixture(
  params: Record<string, unknown> | undefined = {
    presetId: 'html.marker-highlight',
    backend: 'html',
    controls: { text: 'Hey' },
  },
): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: 6000,
    fps: FPS,
    tracks: [
      {
        id: 'track-overlay',
        kind: 'overlay',
        name: 'Overlay',
        muted: false,
        locked: false,
        order: 3,
        clips: [
          {
            id: 'fx-1',
            kind: 'effect',
            effectType: 'vivid-overlay',
            sourceRef: {
              kind: 'asset',
              assetId: 'vivid-overlay-preset:html.marker-highlight',
            },
            startMs: 1000,
            durationMs: 3000,
            trimStartMs: 0,
            trimEndMs: 3000,
            params,
            transforms: { opacity: 0.8 },
          },
        ],
      },
    ],
  } as VideoTimeline;
}

describe('buildVividOverlayEntries', () => {
  it('collects effect clips from overlay tracks with resolved controls', () => {
    const entries = buildVividOverlayEntries(timelineFixture(), FPS);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry).toMatchObject({
      clipId: 'fx-1',
      presetId: 'html.marker-highlight',
      backend: 'html',
      documentId: 'marker-highlight',
      fromFrame: 30,
      durationInFrames: 90,
      loop: 'hold',
      opacity: 0.8,
    });
    // stored control overlays defaults
    expect(entry.controls.text).toBe('Hey');
    expect(entry.controls.color).toBe('#ffd166');
    expect(entry.controls.fontSize).toBe(64);
  });

  it('skips unknown presets and unparseable params', () => {
    expect(
      buildVividOverlayEntries(
        timelineFixture({ presetId: 'nope', backend: 'html', controls: {} }),
        FPS,
      ),
    ).toEqual([]);
    expect(
      buildVividOverlayEntries(timelineFixture({ bogus: true }), FPS),
    ).toEqual([]);
  });

  it('skips hidden overlay tracks', () => {
    const timeline = timelineFixture();
    (timeline.tracks[0] as { hidden?: boolean }).hidden = true;
    expect(buildVividOverlayEntries(timeline, FPS)).toEqual([]);
  });

  it('carries effect clip transform tracks and resolves numeric control keyframes', () => {
    const timeline = timelineFixture({
      presetId: 'html.marker-highlight',
      backend: 'html',
      controls: { fontSize: 64 },
      controlKeyframes: [
        {
          controlId: 'fontSize',
          keys: [
            { atMs: 0, value: 48, interp: 'linear' },
            { atMs: 500, value: 96 },
          ],
        },
      ],
    });
    const clip = timeline.tracks[0]?.clips[0];
    if (!clip || clip.kind !== 'effect') {
      throw new Error('expected overlay effect clip');
    }
    clip.transforms = { opacity: 0.8, positionX: 0.25, positionY: 0.75 };
    clip.keyframes = [
      {
        property: 'positionX',
        keys: [
          { atMs: 0, value: 0.25 },
          { atMs: 500, value: 0.75 },
        ],
      },
    ];

    const entry = buildVividOverlayEntries(timeline, FPS)[0]!;
    expect(entry.transforms).toEqual({
      opacity: 0.8,
      positionX: 0.25,
      positionY: 0.75,
    });
    expect(entry.keyframes).toEqual(clip.keyframes);
    expect(entry.controlKeyframes).toEqual([
      {
        controlId: 'fontSize',
        keys: [
          { atMs: 0, value: 48, interp: 'linear' },
          { atMs: 500, value: 96 },
        ],
      },
    ]);

    const resolved = vividOverlayEntryAtLocalTime(entry, 250);
    expect(resolved.controls.fontSize).toBe(72);
    expect(entry.controls.fontSize).toBe(64);
  });
});

describe('vividOverlayLocalTimeMs', () => {
  const base = buildVividOverlayEntries(timelineFixture(), FPS)[0]!;
  // preset defaultDurationMs 2500 -> 75 frames

  it('is null outside the clip range', () => {
    expect(vividOverlayLocalTimeMs(base, 29, FPS)).toBeNull();
    expect(vividOverlayLocalTimeMs(base, 120, FPS)).toBeNull();
    expect(isVividOverlayActiveAtFrame(base, 29)).toBe(false);
    expect(isVividOverlayActiveAtFrame(base, 30)).toBe(true);
  });

  it('hold clamps at the preset end', () => {
    expect(vividOverlayLocalTimeMs(base, 40, FPS)).toBeCloseTo(
      (10 / FPS) * 1000,
    );
    // frame 30+80 = local 80 > preset 75 -> clamp to 74
    expect(vividOverlayLocalTimeMs(base, 110, FPS)).toBeCloseTo(
      (74 / FPS) * 1000,
    );
  });

  it('loop wraps at the preset duration', () => {
    const loop = { ...base, loop: 'loop' as const };
    expect(vividOverlayLocalTimeMs(loop, 110, FPS)).toBeCloseTo(
      (5 / FPS) * 1000,
    );
  });

  it('none hides after one play-through', () => {
    const none = { ...base, loop: 'none' as const };
    expect(vividOverlayLocalTimeMs(none, 40, FPS)).not.toBeNull();
    expect(vividOverlayLocalTimeMs(none, 110, FPS)).toBeNull();
  });
});

describe('instantiatedVividOverlayDocument', () => {
  const entry = buildVividOverlayEntries(timelineFixture(), FPS)[0]!;

  it('returns a compiled, instantiated document and caches by identity', () => {
    const a = instantiatedVividOverlayDocument(
      entry,
      { width: 1280, height: 720 },
      FPS,
    );
    const b = instantiatedVividOverlayDocument(
      entry,
      { width: 1280, height: 720 },
      FPS,
    );
    expect(a).toBeTruthy();
    expect(a).toBe(b);
    expect(a).toContain('__neumaOverlaySeek');
    expect(a).toContain('"text":"Hey"');
  });

  it('returns null for non-html backends', () => {
    expect(
      instantiatedVividOverlayDocument(
        { ...entry, backend: 'gif' },
        { width: 1280, height: 720 },
        FPS,
      ),
    ).toBeNull();
  });
});
