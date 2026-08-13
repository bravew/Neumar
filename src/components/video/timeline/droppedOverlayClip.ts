import {
  findImportedVividOverlayPreset,
  importedVividOverlayPresetId,
  vividOverlayControlDefaults,
  VIVID_OVERLAY_EFFECT_TYPE,
  vividOverlaySourceRef,
} from '@neumar/video-ir';

import type { VideoEffectTimelineClip } from '@/shared/types/video';
import { randomUUID } from '@/shared/utils/uuid';
import { findVividOverlayPreset } from '@/shared/video/overlays/registry';

import type { OverlayPresetDragPayload } from '../overlays/overlayDragPayload';

/**
 * Build the effect clip a dropped overlay preset becomes. Mirrors
 * video-ir's buildAddVividOverlayClipOps clip shape — the timeline store's
 * insertClip path issues the clip.insert op, which enforces overlay-track
 * placement at the ops layer.
 */
export function timelineClipFromOverlayPreset(
  payload: OverlayPresetDragPayload,
  startMs: number,
  name?: string,
): VideoEffectTimelineClip | null {
  if (payload.type === 'imported-overlay') {
    return timelineClipFromImportedOverlay(payload, startMs, name);
  }
  const preset = findVividOverlayPreset(payload.presetId);
  if (!preset) return null;
  const durationMs = Math.max(
    preset.minDurationMs,
    Math.round(payload.clipDurationMs),
  );
  const clipName = name ?? payload.name;
  return {
    id: randomUUID(),
    kind: 'effect',
    effectType: VIVID_OVERLAY_EFFECT_TYPE,
    ...(clipName ? { name: clipName } : {}),
    sourceRef: vividOverlaySourceRef(preset.id),
    startMs: Math.max(0, Math.round(startMs)),
    durationMs,
    trimStartMs: 0,
    trimEndMs: durationMs,
    ...(payload.transforms ? { transforms: payload.transforms } : {}),
    ...(payload.keyframes ? { keyframes: payload.keyframes } : {}),
    params: {
      presetId: preset.id,
      backend: preset.backend,
      // Saved "My overlays" payloads carry control values over the defaults.
      controls: {
        ...vividOverlayControlDefaults(preset.controls),
        ...(payload.controls ?? {}),
      },
      // Intrinsically-looping backends keep looping; authored animations
      // hold their final pose for the remainder of the clip.
      loop: payload.loop ?? 'hold',
    },
  };
}

function timelineClipFromImportedOverlay(
  payload: Extract<OverlayPresetDragPayload, { type: 'imported-overlay' }>,
  startMs: number,
  name?: string,
): VideoEffectTimelineClip | null {
  const preset = findImportedVividOverlayPreset(
    importedVividOverlayPresetId(payload.kind),
  );
  if (!preset) return null;
  const durationMs = Math.max(
    preset.minDurationMs,
    Math.round(payload.clipDurationMs),
  );
  const presetInstanceId = `${preset.id}:${payload.importId}`;
  const clipName = name ?? payload.name;
  return {
    id: randomUUID(),
    kind: 'effect',
    effectType: VIVID_OVERLAY_EFFECT_TYPE,
    ...(clipName ? { name: clipName } : {}),
    sourceRef: vividOverlaySourceRef(presetInstanceId),
    startMs: Math.max(0, Math.round(startMs)),
    durationMs,
    trimStartMs: 0,
    trimEndMs: durationMs,
    params: {
      presetId: preset.id,
      backend: preset.backend,
      controls: {},
      sourceAssetId: payload.importId,
      loop: 'loop',
    },
  };
}
