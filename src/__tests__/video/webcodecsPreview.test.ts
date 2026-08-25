import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RemotionPreviewData } from '@/components/video/preview/remotionPreviewData';
import {
  getCaptionOpacity,
  getKenBurnsRect,
  getObjectFitRect,
} from '@/components/video/preview/webcodecs/Compositor';
import { normalizeRenderHostInput } from '@/components/video/preview/webcodecs/exportVideo';
import {
  getActiveWebCodecsVisualLayers,
  getTransitionSeamAtFrame,
  getWebCodecsPreviewUnsupportedReason,
  transitionFramesForWebCodecsClip,
} from '@/components/video/preview/webcodecs/sceneModel';
import {
  getVideoFrameCacheKey,
  normalizeTimeSec,
  VideoFrameCache,
  WebCodecsPreviewDecodeError,
} from '@/components/video/preview/webcodecs/VideoFrameCache';
import { resolveWebCodecsRenderTransition } from '@/components/video/preview/WebCodecsFrameRenderer';

interface MockVideoTrack {
  canDecode: () => Promise<boolean>;
}

const mediabunnyMockState = vi.hoisted(() => ({
  batchTimestamps: [] as number[][],
  canvasesFps: 30,
  canvasesStarts: [] as number[],
  disposedInputs: [] as Array<{ disposed: boolean }>,
  primaryTrackResolvers: [] as Array<(track: MockVideoTrack | null) => void>,
}));

vi.mock('mediabunny', () => {
  class MockInput {
    disposed = false;

    getPrimaryVideoTrack(): Promise<MockVideoTrack | null> {
      return new Promise((resolve) => {
        mediabunnyMockState.primaryTrackResolvers.push(resolve);
      });
    }

    dispose(): void {
      this.disposed = true;
      mediabunnyMockState.disposedInputs.push(this);
    }
  }

  class MockUrlSource {
    constructor(
      public readonly src: string,
      public readonly options: unknown,
    ) {}
  }

  class MockCanvasSink {
    async getCanvas(timestamp: number): Promise<{ canvas: HTMLCanvasElement }> {
      const canvas = document.createElement('canvas');
      canvas.dataset.timestamp = String(timestamp);
      return { canvas };
    }

    async *canvasesAtTimestamps(
      timestamps: Iterable<number> | AsyncIterable<number>,
    ): AsyncGenerator<{ canvas: HTMLCanvasElement } | null> {
      const seen: number[] = [];
      for await (const timestamp of timestamps) {
        seen.push(timestamp);
        const canvas = document.createElement('canvas');
        canvas.dataset.timestamp = String(timestamp);
        yield { canvas };
      }
      mediabunnyMockState.batchTimestamps.push(seen);
    }

    // A synthetic 30fps forward stream, matching the real CanvasSink.canvases
    // contract: an open-ended generator of frames from startTimestamp onward.
    async *canvases(startTimestamp = 0): AsyncGenerator<{
      canvas: HTMLCanvasElement;
      timestamp: number;
      duration: number;
    }> {
      mediabunnyMockState.canvasesStarts.push(startTimestamp);
      const frameDuration = 1 / mediabunnyMockState.canvasesFps;
      let timestamp = startTimestamp;
      for (;;) {
        const canvas = document.createElement('canvas');
        canvas.dataset.timestamp = String(timestamp);
        yield { canvas, duration: frameDuration, timestamp };
        timestamp += frameDuration;
      }
    }
  }

  return {
    ALL_FORMATS: {},
    BufferTarget: class MockBufferTarget {},
    CanvasSink: MockCanvasSink,
    CanvasSource: class MockCanvasSource {},
    Input: MockInput,
    Mp4OutputFormat: class MockMp4OutputFormat {},
    Output: class MockOutput {},
    QUALITY_HIGH: 1,
    QUALITY_LOW: 1,
    QUALITY_MEDIUM: 1,
    QUALITY_VERY_HIGH: 1,
    StreamTarget: class MockStreamTarget {},
    UrlSource: MockUrlSource,
  };
});

describe('WebCodecs preview foundations', () => {
  beforeEach(() => {
    mediabunnyMockState.batchTimestamps.length = 0;
    mediabunnyMockState.canvasesFps = 30;
    mediabunnyMockState.canvasesStarts.length = 0;
    mediabunnyMockState.disposedInputs.length = 0;
    mediabunnyMockState.primaryTrackResolvers.length = 0;
  });

  it('normalizes frame cache keys and timestamps', () => {
    expect(
      getVideoFrameCacheKey({
        maxOutputHeight: 360,
        maxOutputWidth: 640,
        src: '/asset.mp4',
      }),
    ).toBe('/asset.mp4|640x360');
    expect(
      getVideoFrameCacheKey({
        cacheKey: 'clip-a',
        src: '/asset.mp4',
      }),
    ).toBe('clip-a');
    expect(normalizeTimeSec(-1)).toBe(0);
    expect(normalizeTimeSec(Number.NaN)).toBe(0);
    expect(normalizeTimeSec(2.5)).toBe(2.5);
  });

  it('disposes video sources that finish opening after cache disposal', async () => {
    const cache = new VideoFrameCache();
    const framePromise = cache.getFrameAt({
      src: '/slow.mp4',
      timeSec: 0,
    });

    expect(mediabunnyMockState.primaryTrackResolvers).toHaveLength(1);
    cache.dispose();
    mediabunnyMockState.primaryTrackResolvers[0]?.({
      canDecode: async () => true,
    });

    await expect(framePromise).rejects.toBeInstanceOf(
      WebCodecsPreviewDecodeError,
    );
    await expect(framePromise).rejects.toMatchObject({ code: 'disposed' });
    expect(mediabunnyMockState.disposedInputs).toHaveLength(1);
    expect(mediabunnyMockState.disposedInputs[0]?.disposed).toBe(true);
  });

  it('fetches batched video timestamps through the optimized sink iterator', async () => {
    const cache = new VideoFrameCache();
    const framesPromise = cache.getFramesAt([
      { id: 'later', src: '/batch.mp4', timeSec: 2 },
      { id: 'earlier', src: '/batch.mp4', timeSec: 1 },
    ]);

    expect(mediabunnyMockState.primaryTrackResolvers).toHaveLength(1);
    mediabunnyMockState.primaryTrackResolvers[0]?.({
      canDecode: async () => true,
    });

    const frames = await framesPromise;

    expect(mediabunnyMockState.batchTimestamps).toEqual([[1, 2]]);
    expect(
      (frames.get('earlier')?.canvas as HTMLCanvasElement | undefined)?.dataset
        .timestamp,
    ).toBe('1');
    expect(
      (frames.get('later')?.canvas as HTMLCanvasElement | undefined)?.dataset
        .timestamp,
    ).toBe('2');
  });

  it('reuses one sequential cursor across consecutive forward playback frames instead of a sparse lookup per frame', async () => {
    const cache = new VideoFrameCache();
    const first = cache.getFramesAt([
      { id: 'frame', src: '/seq.mp4', timeSec: 0 },
    ]);
    mediabunnyMockState.primaryTrackResolvers[0]?.({
      canDecode: async () => true,
    });
    await first;

    await cache.getFramesAt([
      { id: 'frame', src: '/seq.mp4', timeSec: 1 / 30 },
    ]);
    await cache.getFramesAt([
      { id: 'frame', src: '/seq.mp4', timeSec: 2 / 30 },
    ]);

    // One cursor opened for the whole run — not one sparse lookup per frame.
    expect(mediabunnyMockState.canvasesStarts).toHaveLength(1);
    expect(mediabunnyMockState.batchTimestamps).toHaveLength(0);
  });

  it('starts a fresh cursor instead of walking frame-by-frame on a seek', async () => {
    const cache = new VideoFrameCache();
    const first = cache.getFramesAt([
      { id: 'frame', src: '/seek.mp4', timeSec: 0 },
    ]);
    mediabunnyMockState.primaryTrackResolvers[0]?.({
      canDecode: async () => true,
    });
    await first;

    // Far beyond MAX_SEQUENTIAL_GAP_SEC — a scrub, not a continuing frame.
    await cache.getFramesAt([{ id: 'frame', src: '/seek.mp4', timeSec: 10 }]);

    expect(mediabunnyMockState.canvasesStarts).toEqual([0, 10]);
  });

  it('does not claim a guard-limited cursor caught up on a high-fps source', async () => {
    mediabunnyMockState.canvasesFps = 120;
    const cache = new VideoFrameCache();
    const first = cache.getFramesAt([
      { id: 'frame', src: '/hifps.mp4', timeSec: 0 },
    ]);
    mediabunnyMockState.primaryTrackResolvers[0]?.({
      canDecode: async () => true,
    });
    await first;

    // 1.5s at 120fps needs ~180 advances, but a single call is capped at
    // SEQUENTIAL_ADVANCE_GUARD (90) — this reuse can only walk the cursor
    // to roughly 0.75s, not all the way to 1.5s.
    await cache.getFramesAt([{ id: 'frame', src: '/hifps.mp4', timeSec: 1.5 }]);

    // Requesting far beyond the cursor's *actual* position (~0.75s) must
    // fall back to a fresh cursor. Reusing it here (as if it had really
    // reached 1.5s) would silently skip ~2.25s of frames.
    await cache.getFramesAt([{ id: 'frame', src: '/hifps.mp4', timeSec: 3 }]);

    expect(mediabunnyMockState.canvasesStarts).toEqual([0, 3]);
  });

  it('falls back to the sparse lookup for a multi-timestamp batch on one source', async () => {
    const cache = new VideoFrameCache();
    const framesPromise = cache.getFramesAt([
      { id: 'from', src: '/transition.mp4', timeSec: 0 },
      { id: 'to', src: '/transition.mp4', timeSec: 5 },
    ]);
    mediabunnyMockState.primaryTrackResolvers[0]?.({
      canDecode: async () => true,
    });
    await framesPromise;

    expect(mediabunnyMockState.canvasesStarts).toHaveLength(0);
    expect(mediabunnyMockState.batchTimestamps).toEqual([[0, 5]]);
  });

  it('selects active visual layers with source timestamps and z-order', () => {
    const layers = getActiveWebCodecsVisualLayers(previewData(), 45);

    expect(layers.map((layer) => layer.clip.id)).toEqual([
      'image',
      'lower',
      'upper',
    ]);
    expect(layers[0]).toMatchObject({
      kind: 'image',
      timelineFrame: 45,
    });
    expect(layers[1]).toMatchObject({
      sourceTimeSec: 1.5,
      timelineFrame: 45,
    });
    expect(layers[2]).toMatchObject({
      sourceTimeSec: 2,
      timelineFrame: 45,
    });
  });

  it('maps speed and reverse playback to source timestamps', () => {
    const layers = getActiveWebCodecsVisualLayers(
      {
        ...previewData(),
        visualClips: [
          clip({
            id: 'fast-reverse',
            playback: { speed: 2, reverse: true },
            sourceEndFrame: 160,
            sourceStartFrame: 100,
          }),
        ],
      },
      10,
    );

    expect(layers[0]).toMatchObject({
      kind: 'video',
      sourceTimeSec: 139 / 30,
      timelineFrame: 10,
    });
  });

  it('excludes placeholders, missing sources, and inactive clips', () => {
    const layers = getActiveWebCodecsVisualLayers(previewData(), 90);

    expect(layers.map((layer) => layer.clip.id)).toEqual(['late']);
  });

  it('supports transition projects in the WebCodecs preview path', () => {
    expect(
      getWebCodecsPreviewUnsupportedReason({
        ...previewData(),
        visualClips: [
          clip({
            id: 'transitioning',
            transitionToNext: { kind: 'fade', durationMs: 500 },
          }),
          clip({ id: 'next', fromFrame: 60 }),
        ],
      }),
    ).toBeNull();
  });

  it('maps transition seams to outgoing and incoming clip stacks', () => {
    const data = {
      ...previewData(),
      visualClips: [
        clip({
          id: 'outgoing',
          sourceEndFrame: 60,
          transitionToNext: {
            kind: 'clock-wipe',
            durationMs: 500,
            params: { extra: 1, startAngle: 180 },
          },
        }),
        clip({ id: 'incoming', fromFrame: 60, sourceStartFrame: 30 }),
      ],
    };

    expect(
      transitionFramesForWebCodecsClip(
        data.visualClips[0]!,
        data.visualClips[1],
        data.fps,
      ),
    ).toBe(15);

    expect(getTransitionSeamAtFrame(data, 52)).toBeNull();
    expect(getTransitionSeamAtFrame(data, 68)).toBeNull();

    const seam = getTransitionSeamAtFrame(data, 60);

    expect(seam).toMatchObject({
      kind: 'clock-wipe',
      params: { startAngle: 180 },
      progress: 0.5,
    });
    expect(seam?.fromClips.map((layer) => layer.clip.id)).toEqual(['outgoing']);
    expect(seam?.toClips.map((layer) => layer.clip.id)).toEqual(['incoming']);
    expect(seam?.fromClips[0]).toMatchObject({
      kind: 'video',
      sourceTimeSec: 60 / 30,
    });
    expect(seam?.toClips[0]).toMatchObject({
      kind: 'video',
      sourceTimeSec: 30 / 30,
    });

    const earlySeam = getTransitionSeamAtFrame(data, 53);
    expect(earlySeam?.toClips[0]).toMatchObject({
      kind: 'video',
      sourceTimeSec: 23 / 30,
    });
  });

  it('preserves transition params and timing for the WebCodecs renderer', () => {
    const transition = resolveWebCodecsRenderTransition({
      fromLayers: [],
      seam: {
        direction: 'from-left',
        kind: 'clock-wipe',
        params: { startAngle: 180, sweep: 'counterclockwise' },
        progress: 0.5,
        timing: { easing: 'ease-in-out', holdPct: 0.2 },
      },
      toLayers: [],
    });

    expect(transition).toMatchObject({
      direction: 'from-left',
      kind: 'clock-wipe',
      params: { startAngle: 180, sweep: 'counterclockwise' },
      progress: 0.5,
      timing: { easing: 'ease-in-out', holdPct: 0.2 },
    });
  });

  it('normalizes render-host input without dropping transition parameters', () => {
    const data = normalizeRenderHostInput({
      audioClips: [],
      captions: [
        {
          durationInFrames: 30,
          fromFrame: 0,
          id: 'caption',
          style: {
            color: '#ffffff',
            position: 'top',
          },
          text: 'Opening beat',
        },
      ],
      compositionHeight: 720,
      compositionWidth: 1280,
      durationInFrames: 120,
      fps: 30,
      visualClips: [
        {
          ...clip({
            transitionToNext: {
              kind: 'clock-wipe',
              params: {
                feather: 0.13,
                sectors: 6,
                sweep: 'counterclockwise',
              },
            },
          }),
          sourcePath: '/workspace/clip.mp4',
          transforms: { fit: 'blur-pad' },
        },
      ],
    });

    expect(data.visualClips[0]?.transform).toEqual({ fit: 'blur-pad' });
    expect(data.visualClips[0]?.transitionToNext).toMatchObject({
      kind: 'clock-wipe',
      params: {
        feather: 0.13,
        sectors: 6,
        sweep: 'counterclockwise',
      },
    });
    expect(data.captions[0]).toMatchObject({
      color: '#ffffff',
      position: 'top',
    });
  });

  it('uses preset transition defaults and max durations for preview seams', () => {
    expect(
      transitionFramesForWebCodecsClip(
        clip({
          durationInFrames: 120,
          transitionToNext: 'fade',
        }),
        clip({ durationInFrames: 120, fromFrame: 120 }),
        60,
      ),
    ).toBe(30);

    expect(
      transitionFramesForWebCodecsClip(
        clip({
          durationInFrames: 120,
          transitionToNext: { kind: 'cube', durationMs: 5000 },
        }),
        clip({ durationInFrames: 120, fromFrame: 120 }),
        30,
      ),
    ).toBe(45);
  });

  it('matches object-fit layout math used by the Canvas2D compositor', () => {
    expect(
      getObjectFitRect({
        fit: 'fill',
        sourceHeight: 1080,
        sourceWidth: 1920,
        targetHeight: 1000,
        targetWidth: 1000,
      }),
    ).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });

    expect(
      getObjectFitRect({
        fit: 'contain',
        sourceHeight: 1080,
        sourceWidth: 1920,
        targetHeight: 1000,
        targetWidth: 1000,
      }),
    ).toEqual({ x: 0, y: 218.75, width: 1000, height: 562.5 });

    const coverTopThird = getObjectFitRect({
      fit: 'cover',
      reframeAnchor: 'top-third',
      sourceHeight: 1920,
      sourceWidth: 1080,
      targetHeight: 1000,
      targetWidth: 1000,
    });
    expect(coverTopThird.x).toBe(0);
    expect(coverTopThird.y).toBeCloseTo(-259.259, 3);
    expect(coverTopThird.width).toBe(1000);
    expect(coverTopThird.height).toBeCloseTo(1777.778, 3);
  });

  it('computes caption entrance, exit, and inactive opacity', () => {
    const caption = {
      id: 'caption',
      durationInFrames: 30,
      entranceFrames: 10,
      exitFrames: 10,
      fromFrame: 100,
      position: 'bottom',
      text: 'Hello world',
    } satisfies RemotionPreviewData['captions'][number];

    expect(getCaptionOpacity({ caption, frame: 99 })).toBe(0);
    expect(getCaptionOpacity({ caption, frame: 105 })).toBe(0.5);
    expect(getCaptionOpacity({ caption, frame: 115 })).toBe(1);
    expect(getCaptionOpacity({ caption, frame: 125 })).toBe(0.5);
    expect(getCaptionOpacity({ caption, frame: 130 })).toBe(0);
  });

  it('normalizes and interpolates Ken Burns crop rectangles', () => {
    const rect = getKenBurnsRect({
      durationInFrames: 11,
      imagePan: {
        from: { x: -1, y: 0.2, width: 0.01, height: 0.5 },
        to: { x: 0.8, y: 0.8, width: 0.4, height: 2 },
      },
      localFrame: 5,
    });

    expect(rect.x).toBeCloseTo(0.3, 6);
    expect(rect.y).toBeCloseTo(0.1, 6);
    expect(rect.width).toBeCloseTo(0.225, 6);
    expect(rect.height).toBeCloseTo(0.75, 6);
  });
});

function previewData(): RemotionPreviewData {
  return {
    vividOverlays: [],
    audioClips: [],
    captions: [],
    compositionHeight: 720,
    compositionWidth: 1280,
    durationInFrames: 120,
    fps: 30,
    visualClips: [
      clip({
        id: 'upper',
        fromFrame: 30,
        layer: 2,
        sourceEndFrame: 120,
        sourceStartFrame: 45,
      }),
      clip({ id: 'lower', fromFrame: 0, layer: 1 }),
      clip({ id: 'image', mediaKind: 'image' }),
      clip({ id: 'image-missing', mediaKind: 'image', src: undefined }),
      clip({ id: 'placeholder', mediaKind: 'placeholder', src: undefined }),
      clip({ id: 'late', fromFrame: 80 }),
    ],
  };
}

function clip(
  overrides: Partial<RemotionPreviewData['visualClips'][number]> = {},
): RemotionPreviewData['visualClips'][number] {
  return {
    durationInFrames: 60,
    fromFrame: 0,
    id: 'clip',
    label: 'clip.mp4',
    layer: 0,
    mediaKind: 'video',
    sourceEndFrame: 60,
    sourceStartFrame: 0,
    src: '/clip.mp4',
    trackId: 'track',
    trackKind: 'video',
    ...overrides,
  };
}
