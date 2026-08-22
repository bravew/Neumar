import {
  audioEnvelopeGainAtFrame,
  bookendAudioGainAtFrame,
  normalizeClipPlayback,
  type AudioFadeCurve,
  type ClipPlayback,
  type KeyframeTrack,
} from '@neumar/video-ir';

import type {
  RemotionAudioClip,
  RemotionPreviewData,
  RemotionVisualClip,
} from '../remotionPreviewData';

const PLAYBACK_START_LEAD_SEC = 0.03;
const DEFAULT_MAX_BUFFER_CACHE_BYTES = 64 * 1024 * 1024;

interface CachedAudioBuffer {
  byteSize: number;
  lastUsed: number;
  promise: Promise<AudioBuffer>;
  settled: boolean;
}

export interface WebCodecsAudioClip {
  id: string;
  durationInFrames: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;
  fromFrame: number;
  playback?: ClipPlayback;
  sourceEndFrame: number;
  sourceStartFrame: number;
  src: string;
  volume: number;
  gainDb?: number;
  trackVolumeDb?: number;
  keyframes?: KeyframeTrack[];
  muted?: boolean;
  trackMuted?: boolean;
  fadeInCurve?: AudioFadeCurve;
  fadeOutCurve?: AudioFadeCurve;
}

export interface AudioClipSchedule {
  contextDelaySec: number;
  durationSec: number;
  localStartFrame: number;
  sourceDurationSec: number;
  sourceOffsetSec: number;
  timelineStartFrame: number;
}

export interface AudioGainPoint {
  frame: number;
  gain: number;
}

export interface WebCodecsAudioEngineOptions {
  createAudioContext?: () => AudioContext;
  fetchFn?: typeof fetch;
  maxBufferCacheBytes?: number;
}

export class WebCodecsAudioEngine {
  private audioContext: AudioContext | null = null;
  private activeDecodeAbortController: AbortController | null = null;
  private readonly bufferCache = new Map<string, CachedAudioBuffer>();
  private bufferCacheAccessSequence = 0;
  private sessionId = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  /**
   * Sources that carry no decodable audio. A video clip's audio source is the
   * same URL as its picture, and the scrub proxy is generated with `-an`
   * (see `src-api/.../video/proxy.ts`) — so "this file has no audio track" is
   * the normal case, not a failure. Remember it so playback stays silent for
   * that source instead of refetching megabytes on every play.
   */
  private readonly silentSources = new Set<string>();

  constructor(private readonly options: WebCodecsAudioEngineOptions = {}) {}

  async play(
    data: RemotionPreviewData,
    startFrame: number,
    playbackRate = 1,
  ): Promise<void> {
    this.stopSources();
    const normalizedPlaybackRate = normalizePlaybackRate(playbackRate);
    const sessionId = this.sessionId;
    const clips = getWebCodecsAudioClips(data)
      .map((clip) => ({
        clip,
        schedule: getAudioClipSchedule({ clip, fps: data.fps, startFrame }),
      }))
      .filter(
        (
          item,
        ): item is { clip: WebCodecsAudioClip; schedule: AudioClipSchedule } =>
          item.schedule !== null,
      );
    if (clips.length === 0) return;

    const decodeAbortController = new AbortController();
    this.activeDecodeAbortController = decodeAbortController;
    const context = this.getAudioContext();
    if (context.state === 'suspended') {
      await context.resume();
    }
    const contextStartSec = context.currentTime + PLAYBACK_START_LEAD_SEC;
    await Promise.all(
      clips.map(async ({ clip, schedule }) => {
        if (this.silentSources.has(clip.src)) return;
        let buffer: AudioBuffer;
        try {
          buffer = await this.getAudioBuffer(
            clip.src,
            decodeAbortController.signal,
          );
        } catch (error) {
          if (sessionId !== this.sessionId) return;
          if (isAbortError(error)) throw error;
          // A source that will not decode is silent, not fatal. Throwing here
          // used to abort the whole play() call, which the preview treated as
          // "WebCodecs unsupported" and answered by tearing down the live
          // canvas renderer for the rest of the session.
          this.silentSources.add(clip.src);
          return;
        }
        if (sessionId !== this.sessionId) return;
        const playback = normalizeClipPlayback(clip.playback);
        const bufferForPlayback = playback.reverse
          ? reverseAudioBuffer(buffer, context)
          : buffer;
        const sourceOffsetSec = playback.reverse
          ? Math.max(0, buffer.duration - schedule.sourceOffsetSec)
          : schedule.sourceOffsetSec;
        const remainingBufferSec = Math.max(
          0,
          bufferForPlayback.duration - sourceOffsetSec,
        );
        const sourceDurationSec = Math.min(
          schedule.sourceDurationSec,
          remainingBufferSec,
        );
        if (sourceDurationSec <= 0) return;
        const source = context.createBufferSource();
        const gainNode = context.createGain();
        source.buffer = bufferForPlayback;
        source.playbackRate.value = normalizedPlaybackRate * playback.speed;
        source.connect(gainNode);
        gainNode.connect(context.destination);
        scheduleGainAutomation({
          clip,
          data,
          fps: data.fps,
          gain: gainNode.gain,
          playbackRate: normalizedPlaybackRate,
          schedule,
          startFrame,
          startTimeSec: contextStartSec,
        });
        source.onended = () => {
          this.sources.delete(source);
        };
        this.sources.add(source);
        source.start(
          contextStartSec + schedule.contextDelaySec / normalizedPlaybackRate,
          sourceOffsetSec,
          sourceDurationSec,
        );
      }),
    );
  }

  pause(): void {
    this.stopSources();
    if (this.audioContext?.state === 'running') {
      void this.audioContext.suspend();
    }
  }

  /** Sources found to carry no decodable audio, for diagnostics and tests. */
  getSilentSources(): string[] {
    return [...this.silentSources];
  }

  dispose(): void {
    this.stopSources();
    this.bufferCache.clear();
    this.silentSources.clear();
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }

  private stopSources(): void {
    this.sessionId += 1;
    this.activeDecodeAbortController?.abort();
    this.activeDecodeAbortController = null;
    this.clearPendingAudioBuffers();
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped sources throw InvalidStateError; the set cleanup below
        // is the authoritative state for this preview session.
      }
    }
    this.sources.clear();
  }

  private getAudioContext(): AudioContext {
    this.audioContext ??=
      this.options.createAudioContext?.() ?? createAudioContext();
    return this.audioContext;
  }

  private getAudioBuffer(
    src: string,
    signal: AbortSignal,
  ): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(src);
    if (cached) {
      cached.lastUsed = ++this.bufferCacheAccessSequence;
      return cached.promise;
    }
    let entry: CachedAudioBuffer;
    const promise = decodeAudioSource({
      audioContext: this.getAudioContext(),
      fetchFn: this.options.fetchFn ?? fetch,
      signal,
      src,
    })
      .then((buffer) => {
        entry.byteSize = estimateAudioBufferBytes(buffer);
        entry.lastUsed = ++this.bufferCacheAccessSequence;
        entry.settled = true;
        if (this.bufferCache.get(src) === entry) {
          this.evictAudioBufferCache();
        }
        return buffer;
      })
      .catch((error) => {
        if (this.bufferCache.get(src) === entry) {
          this.bufferCache.delete(src);
        }
        throw error;
      });
    entry = {
      byteSize: 0,
      lastUsed: ++this.bufferCacheAccessSequence,
      promise,
      settled: false,
    };
    this.bufferCache.set(src, entry);
    return promise;
  }

  private clearPendingAudioBuffers(): void {
    for (const [src, entry] of this.bufferCache) {
      if (!entry.settled) {
        this.bufferCache.delete(src);
      }
    }
  }

  private evictAudioBufferCache(): void {
    const maxBytes = Math.max(
      0,
      this.options.maxBufferCacheBytes ?? DEFAULT_MAX_BUFFER_CACHE_BYTES,
    );
    const settledEntries = [...this.bufferCache.entries()].filter(
      ([, entry]) => entry.settled,
    );
    let totalBytes = settledEntries.reduce(
      (total, [, entry]) => total + entry.byteSize,
      0,
    );
    if (totalBytes <= maxBytes) return;
    settledEntries.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [src, entry] of settledEntries) {
      if (totalBytes <= maxBytes) return;
      this.bufferCache.delete(src);
      totalBytes -= entry.byteSize;
    }
  }
}

export function getWebCodecsAudioClips(
  data: RemotionPreviewData,
): WebCodecsAudioClip[] {
  return [
    ...data.audioClips.flatMap(audioClipFromAudioTrack),
    ...data.visualClips.flatMap(audioClipFromVideoTrack),
  ].sort((a, b) => a.fromFrame - b.fromFrame || a.id.localeCompare(b.id));
}

export function getAudioClipSchedule({
  clip,
  fps,
  startFrame,
}: {
  clip: WebCodecsAudioClip;
  fps: number;
  startFrame: number;
}): AudioClipSchedule | null {
  const clipEndFrame = clip.fromFrame + clip.durationInFrames;
  if (startFrame >= clipEndFrame) return null;
  const timelineStartFrame = Math.max(startFrame, clip.fromFrame);
  const localStartFrame = timelineStartFrame - clip.fromFrame;
  const durationFrames = clip.durationInFrames - localStartFrame;
  if (durationFrames <= 0) return null;
  const playback = normalizeClipPlayback(clip.playback);
  const sourceOffsetFrames = playback.reverse
    ? Math.max(
        clip.sourceStartFrame,
        clip.sourceEndFrame - localStartFrame * playback.speed,
      )
    : Math.min(
        clip.sourceEndFrame,
        clip.sourceStartFrame + localStartFrame * playback.speed,
      );
  const availableSourceFrames = playback.reverse
    ? sourceOffsetFrames - clip.sourceStartFrame
    : clip.sourceEndFrame - sourceOffsetFrames;
  const sourceDurationFrames = Math.min(
    Math.max(0, clip.sourceEndFrame - clip.sourceStartFrame),
    Math.max(0, availableSourceFrames),
    Math.max(1, durationFrames * playback.speed),
  );
  return {
    contextDelaySec: Math.max(0, clip.fromFrame - startFrame) / fps,
    durationSec: durationFrames / fps,
    localStartFrame,
    sourceDurationSec: sourceDurationFrames / fps,
    sourceOffsetSec: sourceOffsetFrames / fps,
    timelineStartFrame,
  };
}

export function getAudioGainAtFrame({
  clip,
  data,
  frame,
}: {
  clip: WebCodecsAudioClip;
  data: Pick<
    RemotionPreviewData,
    'durationInFrames' | 'fps' | 'introFrames' | 'outroFrames'
  >;
  frame: number;
}): number {
  const localFrame = frame - clip.fromFrame;
  return (
    legacyVolumeFallback(clip) *
    audioEnvelopeGainAtFrame({
      absoluteFrame: frame,
      bookendGain: bookendAudioGainAtFrame({
        absoluteFrame: frame,
        compositionDurationInFrames: data.durationInFrames,
        introFrames: data.introFrames,
        outroFrames: data.outroFrames,
      }),
      clipGainDb: clip.gainDb,
      clipMuted: clip.muted,
      durationInFrames: clip.durationInFrames,
      fadeInCurve: clip.fadeInCurve,
      fadeInFrames: clip.fadeInFrames,
      fadeOutCurve: clip.fadeOutCurve,
      fadeOutFrames: clip.fadeOutFrames,
      fps: data.fps,
      keyframes: clip.keyframes,
      localFrame,
      trackMuted: clip.trackMuted,
      trackVolumeDb: clip.trackVolumeDb,
    })
  );
}

export function getAudioGainAutomationPoints({
  clip,
  data,
  schedule,
}: {
  clip: WebCodecsAudioClip;
  data: Pick<
    RemotionPreviewData,
    'durationInFrames' | 'fps' | 'introFrames' | 'outroFrames'
  >;
  schedule: AudioClipSchedule;
}): AudioGainPoint[] {
  const firstFrame = schedule.timelineStartFrame;
  const lastFrame = clip.fromFrame + clip.durationInFrames - 1;
  const candidates = new Set<number>([
    firstFrame,
    lastFrame,
    clip.fromFrame,
    clip.fromFrame + Math.max(0, (clip.fadeInFrames ?? 0) - 1),
    clip.fromFrame + clip.durationInFrames - (clip.fadeOutFrames ?? 0),
  ]);
  if (data.introFrames) {
    candidates.add(data.introFrames - 1);
  }
  if (data.outroFrames) {
    candidates.add(data.durationInFrames - data.outroFrames);
  }
  addFadeSampleFrames(candidates, clip.fromFrame, clip.fadeInFrames);
  addFadeSampleFrames(
    candidates,
    clip.fromFrame + clip.durationInFrames - (clip.fadeOutFrames ?? 0),
    clip.fadeOutFrames,
  );
  for (const key of volumeKeyframes(clip.keyframes)) {
    candidates.add(clip.fromFrame + msToFrame(key.atMs, data.fps));
  }
  const points = [...candidates]
    .filter((frame) => frame >= firstFrame && frame <= lastFrame)
    .sort((a, b) => a - b)
    .map((frame) => ({
      frame,
      gain: getAudioGainAtFrame({ clip, data, frame }),
    }));
  if (points.length === 0) {
    return [
      {
        frame: firstFrame,
        gain: getAudioGainAtFrame({ clip, data, frame: firstFrame }),
      },
    ];
  }
  if (points[0]?.frame !== firstFrame) {
    points.unshift({
      frame: firstFrame,
      gain: getAudioGainAtFrame({ clip, data, frame: firstFrame }),
    });
  }
  return points;
}

function scheduleGainAutomation({
  clip,
  data,
  fps,
  gain,
  playbackRate,
  schedule,
  startFrame,
  startTimeSec,
}: {
  clip: WebCodecsAudioClip;
  data: RemotionPreviewData;
  fps: number;
  gain: AudioParam;
  playbackRate: number;
  schedule: AudioClipSchedule;
  startFrame: number;
  startTimeSec: number;
}): void {
  const points = getAudioGainAutomationPoints({ clip, data, schedule });
  gain.cancelScheduledValues(startTimeSec);
  for (const [index, point] of points.entries()) {
    const timeSec =
      startTimeSec +
      Math.max(0, point.frame - startFrame) / (fps * playbackRate);
    if (index === 0) {
      gain.setValueAtTime(point.gain, timeSec);
    } else {
      gain.linearRampToValueAtTime(point.gain, timeSec);
    }
  }
}

async function decodeAudioSource({
  audioContext,
  fetchFn,
  signal,
  src,
}: {
  audioContext: AudioContext;
  fetchFn: typeof fetch;
  signal: AbortSignal;
  src: string;
}): Promise<AudioBuffer> {
  throwIfAborted(signal);
  const response = await fetchFn(src, { signal });
  if (!response.ok) {
    throw new Error(`Audio fetch failed: ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  throwIfAborted(signal);
  return audioContext.decodeAudioData(bytes.slice(0));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new DOMException('Audio decode aborted', 'AbortError');
}

function estimateAudioBufferBytes(buffer: AudioBuffer): number {
  const bytes =
    buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
  return Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
}

function normalizePlaybackRate(playbackRate: number): number {
  return Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
}

function reverseAudioBuffer(
  buffer: AudioBuffer,
  context: AudioContext,
): AudioBuffer {
  const reversed = context.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
  );
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel);
    const target = reversed.getChannelData(channel);
    for (let index = 0; index < source.length; index++) {
      target[index] = source[source.length - 1 - index] ?? 0;
    }
  }
  return reversed;
}

function audioClipFromAudioTrack(
  clip: RemotionAudioClip,
): WebCodecsAudioClip[] {
  if (!clip.src) return [];
  return [
    {
      id: clip.id,
      durationInFrames: clip.durationInFrames,
      fadeInFrames: clip.fadeInFrames,
      fadeOutFrames: clip.fadeOutFrames,
      fadeInCurve: clip.fadeInCurve,
      fadeOutCurve: clip.fadeOutCurve,
      fromFrame: clip.fromFrame,
      gainDb: clip.gainDb,
      keyframes: clip.keyframes,
      muted: clip.muted,
      playback: clip.playback,
      sourceEndFrame: clip.sourceEndFrame,
      sourceStartFrame: clip.sourceStartFrame,
      src: clip.src,
      trackMuted: clip.trackMuted,
      trackVolumeDb: clip.trackVolumeDb,
      volume: clip.volume,
    },
  ];
}

function audioClipFromVideoTrack(
  clip: RemotionVisualClip,
): WebCodecsAudioClip[] {
  if (clip.mediaKind !== 'video' || !clip.src) return [];
  if (clip.trackKind !== 'video' || clip.muted === true) return [];
  return [
    {
      id: `${clip.id}:video-audio`,
      durationInFrames: clip.durationInFrames,
      fromFrame: clip.fromFrame,
      playback: clip.playback,
      sourceEndFrame: clip.sourceEndFrame,
      sourceStartFrame: clip.sourceStartFrame,
      src: clip.src,
      volume: 1,
    },
  ];
}

function legacyVolumeFallback(clip: WebCodecsAudioClip): number {
  // Keep in sync with RemotionTimelineAudio and backend remotion-composition
  // until legacy `volume` payloads are fully migrated to gainDb/keyframes.
  return clip.gainDb === undefined &&
    clip.trackVolumeDb === undefined &&
    !clip.keyframes
    ? clip.volume
    : 1;
}

function addFadeSampleFrames(
  candidates: Set<number>,
  startFrame: number,
  fadeFrames: number | undefined,
): void {
  if (!fadeFrames || fadeFrames <= 2) return;
  const step = Math.max(1, Math.floor(fadeFrames / 8));
  for (let offset = 0; offset < fadeFrames; offset += step) {
    candidates.add(startFrame + offset);
  }
  candidates.add(startFrame + fadeFrames - 1);
}

function volumeKeyframes(keyframes: KeyframeTrack[] | undefined) {
  return keyframes?.find((track) => track.property === 'volumeDb')?.keys ?? [];
}

function msToFrame(ms: number, fps: number): number {
  return Math.max(0, Math.round((ms / 1000) * fps));
}

function createAudioContext(): AudioContext {
  const audioWindow = window as Window &
    typeof globalThis & {
      webkitAudioContext?: typeof AudioContext;
    };
  const AudioContextCtor =
    audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('Web Audio unavailable');
  }
  return new AudioContextCtor();
}
