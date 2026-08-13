import { describe, expect, it } from 'vitest';

import { timelineClipFromOverlayPreset } from '@/components/video/timeline/droppedOverlayClip';

describe('timelineClipFromOverlayPreset', () => {
  it('applies saved controls, loop, and name from a "My overlays" drag payload', () => {
    const clip = timelineClipFromOverlayPreset(
      {
        type: 'vivid-overlay-preset',
        presetId: 'html.marker-highlight',
        clipDurationMs: 2500,
        controls: { color: '#008000' },
        loop: 'loop',
        name: 'Green highlight',
      },
      1000,
    );
    expect(clip).toMatchObject({
      kind: 'effect',
      name: 'Green highlight',
      params: {
        presetId: 'html.marker-highlight',
        backend: 'html',
        // saved value overrides the default; untouched controls keep defaults
        controls: {
          text: 'Highlight this',
          color: '#008000',
          fontSize: 64,
        },
        loop: 'loop',
      },
    });
  });

  it('falls back to preset defaults without payload overrides', () => {
    const clip = timelineClipFromOverlayPreset(
      {
        type: 'vivid-overlay-preset',
        presetId: 'html.marker-highlight',
        clipDurationMs: 2500,
      },
      0,
    );
    expect(clip?.params).toMatchObject({
      controls: { color: '#ffd166' },
      loop: 'hold',
    });
    expect(clip?.name).toBeUndefined();
  });

  it('applies transform and keyframes from a saved style drag payload', () => {
    const clip = timelineClipFromOverlayPreset(
      {
        type: 'vivid-overlay-preset',
        presetId: 'html.marker-highlight',
        clipDurationMs: 2500,
        controls: { text: 'Pinned', color: '#008000' },
        transforms: { positionX: 0.2, positionY: 0.7, scale: 1.15 },
        keyframes: [
          {
            property: 'positionX',
            keys: [
              { atMs: 0, value: 0.2 },
              { atMs: 600, value: 0.5, interp: 'smooth' },
            ],
          },
        ],
        styleId: 'style:abc',
        name: 'Pinned style',
      },
      1000,
    );
    expect(clip).toMatchObject({
      kind: 'effect',
      name: 'Pinned style',
      transforms: { positionX: 0.2, positionY: 0.7, scale: 1.15 },
      keyframes: [
        {
          property: 'positionX',
          keys: [
            { atMs: 0, value: 0.2 },
            { atMs: 600, value: 0.5, interp: 'smooth' },
          ],
        },
      ],
    });
  });
});
