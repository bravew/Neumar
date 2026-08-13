import { resolveTimelineProperty } from './keyframes.js';
import type { AudioFadeCurve, KeyframeTrack } from './timeline-types.js';

export interface AudioEnvelopeInput {
  absoluteFrame: number;
  bookendGain?: number;
  clipGainDb?: number;
  clipMuted?: boolean;
  duckingGain?: number;
  durationInFrames: number;
  fadeInCurve?: AudioFadeCurve;
  fadeInFrames?: number;
  fadeOutCurve?: AudioFadeCurve;
  fadeOutFrames?: number;
  fps: number;
  keyframes?: KeyframeTrack[];
  localFrame: number;
  trackMuted?: boolean;
  trackVolumeDb?: number;
}

export type AudioFadeEdge = 'in' | 'out';

export function audioEnvelopeGainAtFrame(input: AudioEnvelopeInput): number {
  if (input.clipMuted || input.trackMuted) return 0;
  const localMs = frameToMs(input.localFrame, input.fps);
  // Clip gain is the static baseline; automation keys use the timeline-wide
  // `volumeDb` property name so visual and audio keyframes share one resolver.
  const clipGainDb = resolveTimelineProperty(
    {
      gainDb: input.clipGainDb ?? 0,
      keyframes: input.keyframes,
    },
    'volumeDb',
    localMs,
  );
  const staticGain = dbToLinearVolume((input.trackVolumeDb ?? 0) + clipGainDb);
  return (
    staticGain *
    audioFadeGainAtFrame({
      curve: input.fadeInCurve,
      edge: 'in',
      fadeFrames: input.fadeInFrames ?? 0,
      frame: input.localFrame,
      totalFrames: input.durationInFrames,
    }) *
    audioFadeGainAtFrame({
      curve: input.fadeOutCurve,
      edge: 'out',
      fadeFrames: input.fadeOutFrames ?? 0,
      frame: input.localFrame,
      totalFrames: input.durationInFrames,
    }) *
    (input.duckingGain ?? 1) *
    (input.bookendGain ?? 1)
  );
}

export function audioFadeGainAtFrame(input: {
  curve?: AudioFadeCurve;
  edge: AudioFadeEdge;
  fadeFrames: number;
  frame: number;
  totalFrames: number;
}): number {
  if (input.fadeFrames <= 0) return 1;
  if (input.edge === 'in') {
    if (input.fadeFrames === 1) return input.frame <= 0 ? 0 : 1;
    return fadeCurveGain(
      Math.min(1, Math.max(0, input.frame / (input.fadeFrames - 1))),
      input.curve,
    );
  }
  const fadeStartFrame = Math.max(0, input.totalFrames - input.fadeFrames);
  if (input.frame < fadeStartFrame) return 1;
  if (input.fadeFrames === 1) return 0;
  return fadeCurveGain(
    Math.min(
      1,
      Math.max(
        0,
        (input.totalFrames - 1 - input.frame) / (input.fadeFrames - 1),
      ),
    ),
    input.curve,
  );
}

export function bookendAudioGainAtFrame(input: {
  absoluteFrame: number;
  compositionDurationInFrames: number;
  introFrames?: number;
  outroFrames?: number;
}): number {
  return Math.min(
    audioFadeGainAtFrame({
      edge: 'in',
      fadeFrames: input.introFrames ?? 0,
      frame: input.absoluteFrame,
      totalFrames: input.compositionDurationInFrames,
    }),
    audioFadeGainAtFrame({
      edge: 'out',
      fadeFrames: input.outroFrames ?? 0,
      frame: input.absoluteFrame,
      totalFrames: input.compositionDurationInFrames,
    }),
  );
}

export function bookendOverlayOpacity(input: {
  absoluteFrame: number;
  compositionDurationInFrames: number;
  introFrames?: number;
  outroFrames?: number;
}): number {
  return 1 - bookendAudioGainAtFrame(input);
}

export function dbToLinearVolume(db: number): number {
  return Math.max(0, Math.min(2, 10 ** (db / 20)));
}

export function mapAudioFadeCurveToFfmpeg(
  curve: AudioFadeCurve | undefined,
  edge: AudioFadeEdge,
): 'tri' | 'qsin' | 'hsin' | 'esin' {
  if (curve === 'equal-power') return edge === 'in' ? 'qsin' : 'hsin';
  if (curve === 'ease-in-out') return 'esin';
  return 'tri';
}

function frameToMs(frame: number, fps: number): number {
  return Math.max(0, (Math.max(0, frame) / Math.max(1, fps)) * 1000);
}

function fadeCurveGain(
  progress: number,
  curve: AudioFadeCurve | undefined,
): number {
  if (curve === 'equal-power') {
    return Math.sin((Math.PI / 2) * progress);
  }
  if (curve === 'ease-in-out') {
    return 0.5 - Math.cos(Math.PI * progress) / 2;
  }
  return progress;
}
