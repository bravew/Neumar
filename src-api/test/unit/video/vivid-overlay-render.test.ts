import { describe, expect, it, vi } from 'vitest';

import { buildOverlayBurnArgs } from '@/shared/video/overlay-pass';
import { buildVividOverlayRenderEntries } from '@/shared/video/overlays/render-entries';
import { selectFinalRenderer } from '@/shared/video/pipeline';
import type { VideoTimeline } from '@/shared/video/types';

vi.mock('@/shared/db/operations', () => ({
  getSetting: vi.fn(() => null),
  setSetting: vi.fn(),
}));

const FPS = 30;

function timelineFixture(): VideoTimeline {
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
            params: {
              presetId: 'html.marker-highlight',
              backend: 'html',
              controls: { text: 'Burn', fontSize: 72 },
              loop: 'loop',
            },
            transforms: { opacity: 0.9 },
          },
        ],
      },
    ],
  } as VideoTimeline;
}

describe('vivid overlay render entries', () => {
  // The builder itself is single-sourced in @neumar/video-ir; this exercises
  // the backend registry binding (the catalog parity test pins the catalogs).
  it('builds one entry per vivid overlay clip', () => {
    const backend = buildVividOverlayRenderEntries(timelineFixture(), FPS);
    expect(backend).toHaveLength(1);
    expect(backend[0]).toMatchObject({
      clipId: 'fx-1',
      fromFrame: 30,
      durationInFrames: 90,
      backend: 'html',
    });
  });

  it('resolves controls against the backend registry', () => {
    const [entry] = buildVividOverlayRenderEntries(timelineFixture(), FPS);
    expect(entry).toMatchObject({
      presetId: 'html.marker-highlight',
      documentId: 'marker-highlight',
      loop: 'loop',
      opacity: 0.9,
    });
    expect(entry!.controls).toMatchObject({
      text: 'Burn',
      fontSize: 72,
      color: '#ffd166', // preset default fills the gap
    });
  });
});

describe('selectFinalRenderer with vivid overlays', () => {
  it('prefers remotion when vivid overlays are present', () => {
    expect(selectFinalRenderer({ hasVividOverlays: true })).toBe('remotion');
  });

  it('explicit renderer option still wins', () => {
    expect(
      selectFinalRenderer({
        opts: { renderer: 'ffmpeg' },
        hasVividOverlays: true,
      }),
    ).toBe('ffmpeg');
  });

  it('keeps prior behavior without vivid overlays', () => {
    expect(selectFinalRenderer({})).toBe('ffmpeg');
  });
});

describe('buildOverlayBurnArgs', () => {
  it('burns the alpha overlay onto the base and preserves audio', () => {
    const args = buildOverlayBurnArgs(
      '/out/base.mp4',
      '/out/pass.mov',
      '/out/burned.mp4',
    );
    expect(args).toEqual([
      '-y',
      '-i',
      '/out/base.mp4',
      '-i',
      '/out/pass.mov',
      '-filter_complex',
      '[0:v][1:v]overlay=0:0:eof_action=pass:format=auto[vout]',
      '-map',
      '[vout]',
      '-map',
      '0:a?',
      '-c:a',
      'copy',
      '-c:v',
      'libx264',
      '-crf',
      '18',
      '-preset',
      'medium',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '/out/burned.mp4',
    ]);
  });
});
