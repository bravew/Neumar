import type {
  VideoRenderPath,
  VideoTransitionDirection,
  VideoTransitionKind,
  VideoTransitionParamValue,
  VideoTransitionTiming,
} from '@/shared/types/video';

import type { TimelineTransitionMutation } from '../timeline/useTimelineEditorStore';
import type { ClipInspectorLabels } from './types';

export function clipLabel(clip: { name?: string; id: string }): string {
  return clip.name?.trim() || clip.id;
}

export function transitionMutation(
  kind: VideoTransitionKind,
  durationMs?: number,
  direction?: VideoTransitionDirection,
  params?: Record<string, VideoTransitionParamValue>,
  timing?: VideoTransitionTiming,
): TimelineTransitionMutation {
  return {
    kind,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(direction ? { direction } : {}),
    ...(params && Object.keys(params).length > 0 ? { params } : {}),
    ...(timing ? { timing } : {}),
  };
}

export function transitionBlockedReasonLabel(
  reason: string | undefined,
  labels: ClipInspectorLabels,
): string {
  if (reason === 'gap') return labels.transitionBlockedGap;
  if (reason === 'locked-track') return labels.transitionBlockedLocked;
  if (reason === 'too-short') return labels.transitionBlockedTooShort;
  return labels.transitionNoAdjacent;
}

export function transitionRenderNote(
  native: readonly VideoRenderPath[],
  remotionOnly: string,
  ffmpegOnly: string,
): string {
  if (!supportsFfmpeg(native)) return remotionOnly;
  if (!supportsRemotion(native)) return ffmpegOnly;
  return '';
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function transitionPreviewSeekMs(seamStartMs: number): number {
  return Math.round(seamStartMs);
}

function supportsFfmpeg(native: readonly VideoRenderPath[]): boolean {
  return native.some((path) => path === 'ffmpeg');
}

function supportsRemotion(native: readonly VideoRenderPath[]): boolean {
  return native.some((path) => path === 'remotion');
}
