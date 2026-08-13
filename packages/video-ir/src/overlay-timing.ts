import {
  parseVividOverlayParams,
  VIVID_OVERLAY_EFFECT_TYPE,
  type VividOverlayBackendId,
  type VividOverlayControlKeyframeTrack,
  type VividOverlayControlValue,
  type VividOverlayLoopMode,
  type VividOverlayParams,
} from './overlay-types.js';
import { durationMsToFrames } from './timebase.js';
import type { ClipTransform, KeyframeTrack } from './timeline-types.js';

// Frame-domain runtime shape + timing math for vivid overlays, shared by the
// frontend preview paths and the backend Remotion render/overlay pass so
// every surface resolves the same document-local time for a timeline frame.

export interface VividOverlayRenderEntry {
  clipId: string;
  fromFrame: number;
  durationInFrames: number;
  presetId: string;
  backend: VividOverlayBackendId;
  documentId?: string;
  controls: Record<string, VividOverlayControlValue>;
  controlKeyframes?: VividOverlayControlKeyframeTrack[];
  loop: VividOverlayLoopMode;
  /** Authored animation length — the loop/hold wrap point. */
  presetDurationFrames: number;
  /** gif/local-lottie backend: the user asset the generated document embeds. */
  sourceAssetId?: string;
  /**
   * Source-asset backends, server-side render path: asset bytes embedded by the
   * backend input builder so the headless composition resolves documents
   * synchronously (inputProps are JSON — no loader callbacks there).
   */
  sourceAsset?: { base64: string; mimeType?: string };
  opacity?: number;
  transforms?: ClipTransform;
  keyframes?: KeyframeTrack[];
  layer: number;
}

// Structural view of a timeline — satisfied by video-ir's Timeline and by
// both app mirrors without casts, so the ONE builder below serves the
// frontend preview and the backend render pass (the registries stay
// app-local; resolution is injected).
export interface VividOverlayTimelineLike {
  tracks: ReadonlyArray<{
    kind: string;
    hidden?: boolean;
    order: number;
    clips: ReadonlyArray<VividOverlayClipLike>;
  }>;
}

export interface VividOverlayClipLike {
  id: string;
  kind: string;
  effectType?: string;
  startMs: number;
  durationMs: number;
  params?: Record<string, unknown>;
  transforms?: ClipTransform;
  keyframes?: KeyframeTrack[];
}

export interface VividOverlayPresetResolution {
  preset: {
    id: string;
    backend: VividOverlayBackendId;
    documentId?: string;
    defaultDurationMs: number;
  };
  controls: Record<string, VividOverlayControlValue>;
}

export type VividOverlayPresetResolver = (
  params: VividOverlayParams,
) => VividOverlayPresetResolution | null;

export function buildVividOverlayRenderEntries(
  timeline: VividOverlayTimelineLike | undefined,
  fps: number,
  resolvePreset: VividOverlayPresetResolver,
): VividOverlayRenderEntry[] {
  if (!timeline) return [];
  const entries: VividOverlayRenderEntry[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'overlay' || track.hidden) continue;
    for (const clip of track.clips) {
      if (
        clip.kind !== 'effect' ||
        clip.effectType !== VIVID_OVERLAY_EFFECT_TYPE
      ) {
        continue;
      }
      const params = parseVividOverlayParams(clip.params);
      if (!params) continue;
      const resolved = resolvePreset(params);
      if (!resolved) continue;
      entries.push({
        clipId: clip.id,
        fromFrame: durationMsToFrames(clip.startMs, fps),
        durationInFrames: Math.max(1, durationMsToFrames(clip.durationMs, fps)),
        presetId: resolved.preset.id,
        backend: resolved.preset.backend,
        documentId: resolved.preset.documentId,
        controls: resolved.controls,
        controlKeyframes: params.controlKeyframes,
        loop: params.loop ?? 'hold',
        presetDurationFrames: Math.max(
          1,
          durationMsToFrames(resolved.preset.defaultDurationMs, fps),
        ),
        sourceAssetId: params.sourceAssetId,
        opacity: clip.transforms?.opacity,
        transforms: clip.transforms,
        keyframes: clip.keyframes,
        layer: track.order,
      });
    }
  }
  return entries.sort(
    (a, b) =>
      a.layer - b.layer ||
      a.fromFrame - b.fromFrame ||
      a.clipId.localeCompare(b.clipId),
  );
}

export function isVividOverlayActiveAtFrame(
  entry: VividOverlayRenderEntry,
  frame: number,
): boolean {
  return (
    frame >= entry.fromFrame && frame < entry.fromFrame + entry.durationInFrames
  );
}

/**
 * Timeline frame → the overlay document's local time in ms, applying the
 * clip's loop mode against the preset's authored duration. Returns null when
 * the overlay should not be visible (outside the clip, or loop mode 'none'
 * past its single play-through).
 */
export function vividOverlayLocalTimeMs(
  entry: VividOverlayRenderEntry,
  frame: number,
  fps: number,
): number | null {
  const localFrame = frame - entry.fromFrame;
  if (localFrame < 0 || localFrame >= entry.durationInFrames) return null;
  const wrap = entry.presetDurationFrames;
  let effectiveFrame: number;
  switch (entry.loop) {
    case 'loop':
      effectiveFrame = localFrame % wrap;
      break;
    case 'none':
      if (localFrame >= wrap) return null;
      effectiveFrame = localFrame;
      break;
    case 'hold':
    default:
      effectiveFrame = Math.min(localFrame, wrap - 1);
      break;
  }
  return (effectiveFrame / fps) * 1000;
}

export function vividOverlayControlsAtLocalTime(
  entry: Pick<VividOverlayRenderEntry, 'controls' | 'controlKeyframes'>,
  localMs: number | null,
): Record<string, VividOverlayControlValue> {
  if (localMs === null || !entry.controlKeyframes?.length) {
    return entry.controls;
  }
  let next = entry.controls;
  for (const track of entry.controlKeyframes) {
    const fallback = entry.controls[track.controlId];
    const value = resolveControlKeyframeValue(track, fallback, localMs);
    if (value === fallback) continue;
    if (next === entry.controls) next = { ...entry.controls };
    next[track.controlId] = value;
  }
  return next;
}

function resolveControlKeyframeValue(
  track: VividOverlayControlKeyframeTrack,
  fallback: VividOverlayControlValue | undefined,
  localMs: number,
): number {
  const keys = [...track.keys].sort((left, right) => left.atMs - right.atMs);
  const first = keys[0]!;
  const fallbackNumber = typeof fallback === 'number' ? fallback : first.value;
  if (localMs <= first.atMs) return first.value;
  const last = keys[keys.length - 1]!;
  if (localMs >= last.atMs) return last.value;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const left = keys[index]!;
    const right = keys[index + 1]!;
    if (localMs < left.atMs || localMs > right.atMs) continue;
    const spanMs = right.atMs - left.atMs;
    if (spanMs <= 0) return right.value;
    if ((left.interp ?? 'linear') === 'hold') return left.value;
    const rawT = (localMs - left.atMs) / spanMs;
    const t = left.interp === 'smooth' ? rawT * rawT * (3 - 2 * rawT) : rawT;
    return left.value + (right.value - left.value) * t;
  }
  return fallbackNumber;
}
