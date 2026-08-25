import { describe, expect, it, vi } from 'vitest';

import type { RemotionPreviewData } from '@/components/video/preview/remotionPreviewData';
import {
  getAudioClipSchedule,
  getAudioGainAtFrame,
  getAudioGainAutomationPoints,
  getWebCodecsAudioClips,
  WebCodecsAudioEngine,
  type WebCodecsAudioClip,
} from '@/components/video/preview/webcodecs/AudioEngine';

describe('WebCodecs AudioEngine foundations', () => {
  it('derives audio tracks and unmuted primary video audio', () => {
    const clips = getWebCodecsAudioClips(previewData());

    expect(clips.map((clip) => clip.id)).toEqual(['main:video-audio', 'voice']);
  });

  it('schedules future and already-active clips from a timeline frame', () => {
    const clip = audioClip();

    expect(
      getAudioClipSchedule({ clip, fps: 30, startFrame: 15 }),
    ).toMatchObject({
      contextDelaySec: 0.5,
      durationSec: 2,
      localStartFrame: 0,
      sourceDurationSec: 2,
      sourceOffsetSec: 1,
      timelineStartFrame: 30,
    });

    expect(
      getAudioClipSchedule({ clip, fps: 30, startFrame: 45 }),
    ).toMatchObject({
      contextDelaySec: 0,
      durationSec: 1.5,
      localStartFrame: 15,
      sourceDurationSec: 1.5,
      sourceOffsetSec: 1.5,
      timelineStartFrame: 45,
    });

    expect(getAudioClipSchedule({ clip, fps: 30, startFrame: 90 })).toBeNull();
  });

  it('schedules clip speed and reverse against the source range', () => {
    expect(
      getAudioClipSchedule({
        clip: audioClip({
          playback: { speed: 2, reverse: false },
          sourceEndFrame: 150,
        }),
        fps: 30,
        startFrame: 45,
      }),
    ).toMatchObject({
      durationSec: 1.5,
      localStartFrame: 15,
      sourceDurationSec: 3,
      sourceOffsetSec: 2,
    });

    expect(
      getAudioClipSchedule({
        clip: audioClip({
          playback: { speed: 2, reverse: true },
          sourceEndFrame: 150,
        }),
        fps: 30,
        startFrame: 45,
      }),
    ).toMatchObject({
      durationSec: 1.5,
      localStartFrame: 15,
      sourceDurationSec: 3,
      sourceOffsetSec: 4,
    });

    expect(
      getAudioClipSchedule({
        clip: audioClip({
          playback: { speed: 2, reverse: false },
          sourceEndFrame: 70,
        }),
        fps: 30,
        startFrame: 45,
      }),
    ).toMatchObject({
      sourceDurationSec: 10 / 30,
      sourceOffsetSec: 2,
    });
  });

  it('combines clip fade and bookend gain', () => {
    const data = previewData();
    const clip = audioClip({
      fadeInFrames: 10,
      fadeOutFrames: 10,
      volume: 0.5,
    });

    expect(getAudioGainAtFrame({ clip, data, frame: 30 })).toBe(0);
    expect(getAudioGainAtFrame({ clip, data, frame: 39 })).toBe(0.5);
    expect(getAudioGainAtFrame({ clip, data, frame: 84 })).toBeCloseTo(
      0.277778,
      6,
    );
  });

  it('applies keyframed dB gain and mute gates in preview gain', () => {
    const data = previewData();
    const clip = audioClip({
      fadeInCurve: 'equal-power',
      fadeInFrames: 30,
      gainDb: -12,
      keyframes: [
        {
          property: 'volumeDb',
          keys: [
            { atMs: 0, value: -12 },
            { atMs: 1000, value: 0 },
          ],
        },
      ],
      trackVolumeDb: -6,
      volume: 0.1,
    });

    expect(getAudioGainAtFrame({ clip, data, frame: 45 })).toBeCloseTo(
      0.182362,
      6,
    );
    expect(
      getAudioGainAtFrame({ clip: { ...clip, muted: true }, data, frame: 45 }),
    ).toBe(0);
  });

  it('builds deterministic gain automation points for fades and bookends', () => {
    const data = previewData();
    const clip = audioClip({ fadeInFrames: 10, fadeOutFrames: 10 });
    const schedule = getAudioClipSchedule({ clip, fps: 30, startFrame: 30 });

    expect(schedule).not.toBeNull();
    expect(
      getAudioGainAutomationPoints({
        clip,
        data,
        schedule: schedule!,
      }),
    ).toEqual([
      { frame: 30, gain: 0 },
      { frame: 31, gain: 1 / 9 },
      { frame: 32, gain: 2 / 9 },
      { frame: 33, gain: 1 / 3 },
      { frame: 34, gain: 4 / 9 },
      { frame: 35, gain: 5 / 9 },
      { frame: 36, gain: 2 / 3 },
      { frame: 37, gain: 7 / 9 },
      { frame: 38, gain: 8 / 9 },
      { frame: 39, gain: 1 },
      { frame: 80, gain: 1 },
      { frame: 81, gain: 8 / 9 },
      { frame: 82, gain: 7 / 9 },
      { frame: 83, gain: 2 / 3 },
      { frame: 84, gain: 5 / 9 },
      { frame: 85, gain: 4 / 9 },
      { frame: 86, gain: 1 / 3 },
      { frame: 87, gain: 2 / 9 },
      { frame: 88, gain: 1 / 9 },
      { frame: 89, gain: 0 },
    ]);
  });

  it('aborts pending audio fetches when playback stops', async () => {
    const abortSignals: AbortSignal[] = [];
    const fetchFn = vi.fn<typeof fetch>(
      (_src: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!(signal instanceof AbortSignal)) {
            reject(new Error('Expected audio fetch abort signal'));
            return;
          }
          abortSignals.push(signal);
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const engine = new WebCodecsAudioEngine({
      createAudioContext: createMockAudioContext,
      fetchFn,
    });

    const playPromise = engine.play(audioOnlyPreviewData(), 0);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    engine.pause();

    expect(abortSignals[0]?.aborted).toBe(true);
    await expect(playPromise).resolves.toBeUndefined();
  });

  it('evicts decoded audio buffers when they exceed the cache budget', async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(new ArrayBuffer(8)),
    );
    const audioContext = createMockAudioContext([
      mockAudioBuffer({ length: 48_000, numberOfChannels: 2 }),
      mockAudioBuffer({ length: 48_000, numberOfChannels: 2 }),
    ]);
    const engine = new WebCodecsAudioEngine({
      createAudioContext: () => audioContext,
      fetchFn,
      maxBufferCacheBytes: 1,
    });

    await engine.play(audioOnlyPreviewData('/voice.mp3'), 0);
    await engine.play(audioOnlyPreviewData('/voice.mp3'), 0);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('treats an undecodable source as silent instead of failing playback', async () => {
    // The scrub proxy is generated with `-an`, so a video clip's audio source
    // routinely has no audio track. decodeAudioData rejects for those. That
    // used to reject play(), which the preview read as "WebCodecs
    // unsupported" and answered by retiring the live canvas renderer.
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(new ArrayBuffer(8)),
    );
    const audioContext = createMockAudioContext();
    vi.mocked(audioContext.decodeAudioData).mockRejectedValue(
      new Error('Unable to decode audio data'),
    );
    const engine = new WebCodecsAudioEngine({
      createAudioContext: () => audioContext,
      fetchFn,
    });

    await expect(
      engine.play(audioOnlyPreviewData('/silent.mp4'), 0),
    ).resolves.toBeUndefined();
    expect(engine.getSilentSources()).toEqual(['/silent.mp4']);
  });

  it('does not refetch a source already known to be silent', async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(new ArrayBuffer(8)),
    );
    const audioContext = createMockAudioContext();
    vi.mocked(audioContext.decodeAudioData).mockRejectedValue(
      new Error('Unable to decode audio data'),
    );
    const engine = new WebCodecsAudioEngine({
      createAudioContext: () => audioContext,
      fetchFn,
    });

    await engine.play(audioOnlyPreviewData('/silent.mp4'), 0);
    await engine.play(audioOnlyPreviewData('/silent.mp4'), 0);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('still surfaces an abort so a stopped playback does not look silent', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw abortError;
    });
    const engine = new WebCodecsAudioEngine({
      createAudioContext: createMockAudioContext,
      fetchFn,
    });

    await expect(
      engine.play(audioOnlyPreviewData('/voice.mp3'), 0),
    ).rejects.toBe(abortError);
    expect(engine.getSilentSources()).toEqual([]);
  });

  it('applies playback rate to source speed and timeline timing', async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(new ArrayBuffer(8)),
    );
    const audioContext = createMockAudioContext();
    const engine = new WebCodecsAudioEngine({
      createAudioContext: () => audioContext,
      fetchFn,
    });

    await engine.play(audioOnlyPreviewData('/voice.mp3'), 30, 2);

    const source = vi.mocked(audioContext.createBufferSource).mock.results[0]!
      .value as AudioBufferSourceNode;
    expect(source.playbackRate.value).toBe(2);
    expect(source.start).toHaveBeenCalledWith(0.03, 1, 1);
  });
});

function audioOnlyPreviewData(src = '/voice.mp3'): RemotionPreviewData {
  return {
    ...previewData(),
    audioClips: [
      {
        id: 'voice',
        durationInFrames: 60,
        fromFrame: 0,
        sourceStartFrame: 0,
        sourceEndFrame: 60,
        src,
        volume: 0.8,
      },
    ],
    visualClips: [],
  };
}

function createMockAudioContext(
  decodedBuffers = [mockAudioBuffer()],
): AudioContext {
  const decodeQueue = [...decodedBuffers];
  return {
    close: vi.fn(async () => undefined),
    createBufferSource: vi.fn(
      () =>
        ({
          connect: vi.fn(),
          playbackRate: { value: 1 },
          start: vi.fn(),
          stop: vi.fn(),
        }) as unknown as AudioBufferSourceNode,
    ),
    createGain: vi.fn(
      () =>
        ({
          connect: vi.fn(),
          gain: {
            cancelScheduledValues: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            setValueAtTime: vi.fn(),
          },
        }) as unknown as GainNode,
    ),
    currentTime: 0,
    decodeAudioData: vi.fn(
      async () => decodeQueue.shift() ?? mockAudioBuffer(),
    ),
    destination: {} as AudioDestinationNode,
    resume: vi.fn(async () => undefined),
    state: 'running',
    suspend: vi.fn(async () => undefined),
  } as unknown as AudioContext;
}

function mockAudioBuffer(overrides: Partial<AudioBuffer> = {}): AudioBuffer {
  return {
    duration: 60,
    length: 48_000,
    numberOfChannels: 2,
    ...overrides,
  } as AudioBuffer;
}

function previewData(): RemotionPreviewData {
  return {
    vividOverlays: [],
    audioClips: [
      {
        id: 'voice',
        durationInFrames: 60,
        fadeInFrames: 10,
        fadeOutFrames: 10,
        fromFrame: 30,
        sourceStartFrame: 30,
        sourceEndFrame: 90,
        src: '/voice.mp3',
        volume: 0.8,
      },
      {
        id: 'missing-src',
        durationInFrames: 60,
        fromFrame: 0,
        sourceStartFrame: 0,
        sourceEndFrame: 60,
        volume: 1,
      },
    ],
    captions: [],
    compositionHeight: 720,
    compositionWidth: 1280,
    durationInFrames: 120,
    fps: 30,
    introFrames: 30,
    outroFrames: 30,
    visualClips: [
      {
        id: 'main',
        durationInFrames: 60,
        fromFrame: 0,
        label: 'main.mp4',
        layer: 0,
        mediaKind: 'video',
        sourceEndFrame: 60,
        sourceStartFrame: 0,
        src: '/main.mp4',
        trackId: 'video',
        trackKind: 'video',
      },
      {
        id: 'muted',
        durationInFrames: 60,
        fromFrame: 0,
        label: 'muted.mp4',
        layer: 1,
        mediaKind: 'video',
        muted: true,
        sourceEndFrame: 60,
        sourceStartFrame: 0,
        src: '/muted.mp4',
        trackId: 'video',
        trackKind: 'video',
      },
      {
        id: 'broll',
        durationInFrames: 60,
        fromFrame: 0,
        label: 'broll.mp4',
        layer: 2,
        mediaKind: 'video',
        sourceEndFrame: 60,
        sourceStartFrame: 0,
        src: '/broll.mp4',
        trackId: 'broll',
        trackKind: 'broll',
      },
    ],
  };
}

function audioClip(
  overrides: Partial<WebCodecsAudioClip> = {},
): WebCodecsAudioClip {
  return {
    id: 'clip',
    durationInFrames: 60,
    fromFrame: 30,
    sourceEndFrame: 90,
    sourceStartFrame: 30,
    src: '/clip.mp3',
    volume: 1,
    ...overrides,
  };
}
