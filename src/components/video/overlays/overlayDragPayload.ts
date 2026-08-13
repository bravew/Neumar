import type {
  ImportedVividOverlayKind,
  KeyframeInterpolation,
  KeyframeTrack,
  KeyframeableProperty,
  VividOverlayStyleTransform,
} from '@neumar/video-ir';
import {
  findImportedVividOverlayPreset,
  importedVividOverlayPresetId,
} from '@neumar/video-ir';

import { findVividOverlayPreset } from '@/shared/video/overlays/registry';

export const OVERLAY_PRESET_DRAG_MIME =
  'application/x-neuma-video-overlay-preset';

export type OverlayPresetDragPayload =
  | VividOverlayPresetDragPayload
  | ImportedOverlayDragPayload;

export interface VividOverlayPresetDragPayload {
  type: 'vivid-overlay-preset';
  presetId: string;
  /** Suggested clip length on drop (NOT the preset's animation wrap length). */
  clipDurationMs: number;
  /** "My overlays": saved control values overriding the preset defaults. */
  controls?: Record<string, string | number | boolean>;
  loop?: 'loop' | 'hold' | 'none';
  transforms?: VividOverlayStyleTransform;
  keyframes?: KeyframeTrack[];
  /** Display name for the dropped clip (saved preset name). */
  name?: string;
  /** Source style id when dragging a saved overlay style. */
  styleId?: string;
}

export interface ImportedOverlayDragPayload {
  type: 'imported-overlay';
  importId: string;
  kind: ImportedVividOverlayKind;
  /** Suggested clip length on drop (NOT the animation wrap length). */
  clipDurationMs: number;
  /** Display name for the dropped clip. */
  name?: string;
}

export function writeOverlayPresetDrag(
  dataTransfer: DataTransfer,
  payload: OverlayPresetDragPayload,
) {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(OVERLAY_PRESET_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData(
    'text/plain',
    payload.type === 'imported-overlay'
      ? `imported-overlay:${payload.importId}`
      : `overlay-preset:${payload.presetId}`,
  );
}

export function hasOverlayPresetDragType(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(OVERLAY_PRESET_DRAG_MIME);
}

export function readOverlayPresetDrag(
  dataTransfer: DataTransfer,
): OverlayPresetDragPayload | null {
  const raw = dataTransfer.getData(OVERLAY_PRESET_DRAG_MIME);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<OverlayPresetDragPayload>;
      if (
        parsed.type === 'vivid-overlay-preset' &&
        typeof parsed.presetId === 'string' &&
        findVividOverlayPreset(parsed.presetId)
      ) {
        const transforms = parseStyleTransform(parsed.transforms);
        const keyframes = parseKeyframeTracks(parsed.keyframes);
        return {
          type: 'vivid-overlay-preset',
          presetId: parsed.presetId,
          clipDurationMs:
            typeof parsed.clipDurationMs === 'number' &&
            parsed.clipDurationMs > 0
              ? Math.round(parsed.clipDurationMs)
              : defaultOverlayClipDurationMs(parsed.presetId),
          ...(parsed.controls && typeof parsed.controls === 'object'
            ? { controls: parsed.controls }
            : {}),
          ...(parsed.loop === 'loop' ||
          parsed.loop === 'hold' ||
          parsed.loop === 'none'
            ? { loop: parsed.loop }
            : {}),
          ...(transforms ? { transforms } : {}),
          ...(keyframes ? { keyframes } : {}),
          ...(typeof parsed.name === 'string' && parsed.name
            ? { name: parsed.name }
            : {}),
          ...(typeof parsed.styleId === 'string' && parsed.styleId
            ? { styleId: parsed.styleId }
            : {}),
        };
      }
      if (
        parsed.type === 'imported-overlay' &&
        typeof parsed.importId === 'string' &&
        parsed.importId.startsWith('import:') &&
        isImportedOverlayKind(parsed.kind)
      ) {
        return {
          type: 'imported-overlay',
          importId: parsed.importId,
          kind: parsed.kind,
          clipDurationMs:
            typeof parsed.clipDurationMs === 'number' &&
            parsed.clipDurationMs > 0
              ? Math.round(parsed.clipDurationMs)
              : defaultOverlayClipDurationMs(
                  importedVividOverlayPresetId(parsed.kind),
                ),
          ...(typeof parsed.name === 'string' && parsed.name
            ? { name: parsed.name }
            : {}),
        };
      }
    } catch {
      // fall through to the plain-text form
    }
  }
  const plain = dataTransfer.getData('text/plain');
  if (!plain.startsWith('overlay-preset:')) return null;
  const presetId = plain.slice('overlay-preset:'.length);
  if (!findVividOverlayPreset(presetId)) return null;
  return {
    type: 'vivid-overlay-preset',
    presetId,
    clipDurationMs: defaultOverlayClipDurationMs(presetId),
  };
}

/**
 * Sensible on-drop clip length. The preset's defaultDurationMs is the
 * animation wrap point, which for intrinsically-looping backends (gif) is a
 * huge sentinel — clamp to something a user would actually drop.
 */
export function defaultOverlayClipDurationMs(presetId: string): number {
  const preset =
    findVividOverlayPreset(presetId) ??
    findImportedVividOverlayPreset(presetId);
  if (!preset) return 3000;
  return Math.max(
    preset.minDurationMs,
    Math.min(preset.defaultDurationMs, 4000),
  );
}

function isImportedOverlayKind(
  value: unknown,
): value is ImportedVividOverlayKind {
  return value === 'gif' || value === 'lottie';
}

function parseStyleTransform(
  value: unknown,
): VividOverlayStyleTransform | undefined {
  if (!isRecord(value)) return undefined;
  const out: VividOverlayStyleTransform = {};
  for (const field of [
    'scale',
    'scaleX',
    'scaleY',
    'positionX',
    'positionY',
    'opacity',
    'rotation',
  ] as const) {
    const next = value[field];
    if (typeof next === 'number' && Number.isFinite(next)) out[field] = next;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseKeyframeTracks(value: unknown): KeyframeTrack[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tracks: KeyframeTrack[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || !isKeyframeableProperty(candidate.property)) {
      return undefined;
    }
    if (!Array.isArray(candidate.keys) || candidate.keys.length === 0) {
      return undefined;
    }
    const keys = candidate.keys.map((key) => {
      if (!isRecord(key)) return null;
      const interp = keyframeInterpolation(key.interp);
      if (
        typeof key.atMs !== 'number' ||
        !Number.isInteger(key.atMs) ||
        key.atMs < 0 ||
        typeof key.value !== 'number' ||
        !Number.isFinite(key.value)
      ) {
        return null;
      }
      return {
        atMs: key.atMs,
        value: key.value,
        ...(interp ? { interp } : {}),
      };
    });
    if (keys.some((key) => key === null)) return undefined;
    tracks.push({
      property: candidate.property,
      keys: keys.filter((key) => key !== null),
    });
  }
  return tracks.length > 0 ? tracks : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKeyframeableProperty(value: unknown): value is KeyframeableProperty {
  switch (value) {
    case 'opacity':
    case 'scale':
    case 'scaleX':
    case 'scaleY':
    case 'positionX':
    case 'positionY':
    case 'rotation':
    case 'cropTop':
    case 'cropRight':
    case 'cropBottom':
    case 'cropLeft':
    case 'volumeDb':
    case 'textOpacity':
    case 'textScale':
      return true;
    default:
      return false;
  }
}

function keyframeInterpolation(
  value: unknown,
): KeyframeInterpolation | undefined {
  switch (value) {
    case 'hold':
    case 'linear':
    case 'smooth':
      return value;
    default:
      return undefined;
  }
}
