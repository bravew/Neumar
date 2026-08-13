import type { ClipPlayback } from './timeline-types.js';

export const DEFAULT_CLIP_PLAYBACK: ClipPlayback = {
  speed: 1,
  reverse: false,
};
export const MIN_CLIP_PLAYBACK_SPEED = 0.1;
export const MAX_CLIP_PLAYBACK_SPEED = 20;

export interface ClipPlaybackSourceRange {
  trimStartFrame: number;
  trimEndFrame: number;
}

export interface ClipPlaybackMappingInput extends ClipPlaybackSourceRange {
  playback?: ClipPlayback | null;
}

export function normalizeClipPlayback(
  playback: ClipPlayback | null | undefined,
  legacyParams?: Record<string, unknown>,
): ClipPlayback {
  const legacySpeed = legacyNumber(legacyParams?.speed);
  const legacyReverse =
    typeof legacyParams?.reversePlayback === 'boolean'
      ? legacyParams.reversePlayback
      : typeof legacyParams?.reversed === 'boolean'
        ? legacyParams.reversed
        : undefined;
  const speed = normalizePlaybackSpeed(playback?.speed ?? legacySpeed ?? 1);
  return {
    speed,
    reverse: playback?.reverse ?? legacyReverse ?? false,
    ...(playback?.pitchCorrection !== undefined
      ? { pitchCorrection: playback.pitchCorrection }
      : {}),
    ...(playback?.smoothSlowMo !== undefined
      ? { smoothSlowMo: playback.smoothSlowMo }
      : {}),
    ...(playback?.interpolationQuality !== undefined
      ? { interpolationQuality: playback.interpolationQuality }
      : {}),
  };
}

export function clipPlaybackFromFields(input: {
  playback?: ClipPlayback | null;
  params?: Record<string, unknown>;
}): ClipPlayback | undefined {
  const playback = normalizeClipPlayback(input.playback, input.params);
  return isDefaultClipPlayback(playback) ? undefined : playback;
}

export function isDefaultClipPlayback(playback: ClipPlayback): boolean {
  return (
    playback.speed === 1 &&
    playback.reverse === false &&
    playback.pitchCorrection === undefined &&
    playback.smoothSlowMo === undefined &&
    playback.interpolationQuality === undefined
  );
}

export function localFrameToSourceFrame(
  localFrame: number,
  input: ClipPlaybackMappingInput,
): number {
  const playback = normalizeClipPlayback(input.playback);
  const sourceFrameCount = sourceFrameCountForRange(input);
  if (sourceFrameCount <= 0) return Math.max(0, input.trimStartFrame);
  const local = Math.max(0, localFrame);
  const sourceOffset = Math.min(
    sourceFrameCount - 1,
    Math.floor(local * playback.speed),
  );
  return playback.reverse
    ? input.trimEndFrame - 1 - sourceOffset
    : input.trimStartFrame + sourceOffset;
}

export function sourceFrameToLocalFrame(
  sourceFrame: number,
  input: ClipPlaybackMappingInput,
): number {
  const playback = normalizeClipPlayback(input.playback);
  const sourceFrameCount = sourceFrameCountForRange(input);
  if (sourceFrameCount <= 0) return 0;
  const clampedSource = Math.min(
    Math.max(sourceFrame, input.trimStartFrame),
    input.trimEndFrame - 1,
  );
  const sourceOffset = playback.reverse
    ? input.trimEndFrame - 1 - clampedSource
    : clampedSource - input.trimStartFrame;
  return Math.floor(sourceOffset / playback.speed);
}

export function effectiveDurationFrames(
  sourceFrames: number,
  playback?: ClipPlayback | null,
): number {
  const playbackState = normalizeClipPlayback(playback);
  if (!Number.isFinite(sourceFrames) || sourceFrames <= 0) return 0;
  return Math.max(1, Math.round(sourceFrames / playbackState.speed));
}

function normalizePlaybackSpeed(speed: number): number {
  if (
    !Number.isFinite(speed) ||
    speed < MIN_CLIP_PLAYBACK_SPEED ||
    speed > MAX_CLIP_PLAYBACK_SPEED
  ) {
    throw new Error(
      `Clip playback speed must be between ${MIN_CLIP_PLAYBACK_SPEED} and ${MAX_CLIP_PLAYBACK_SPEED}`,
    );
  }
  return speed;
}

function sourceFrameCountForRange(input: ClipPlaybackSourceRange): number {
  return Math.max(0, input.trimEndFrame - input.trimStartFrame);
}

function legacyNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
