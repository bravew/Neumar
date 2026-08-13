import { z } from 'zod';

import { KEYFRAMEABLE_PROPERTIES } from './keyframes.js';
import type {
  EffectTimelineClip,
  Keyframe,
  KeyframeableProperty,
  KeyframeTrack,
  TimelineClip,
  TimelineSourceRef,
} from './timeline-types.js';

// Vivid overlays are `effect`-kind clips on overlay tracks. The clip kind and
// `params` bag already exist in timeline.v1, so everything here is additive:
// `effectType` discriminates vivid overlays from future effect families, and
// the params payload is validated by the registry layer (not the timeline
// schema) exactly like transition params.
export const VIVID_OVERLAY_EFFECT_TYPE = 'vivid-overlay';

export const VIVID_OVERLAY_BACKENDS = [
  'html',
  'gif',
  'lottie',
  'text-motion',
] as const;

export type VividOverlayBackendId = (typeof VIVID_OVERLAY_BACKENDS)[number];

export type VividOverlayLoopMode = 'loop' | 'hold' | 'none';

export type VividOverlayControlValue = string | number | boolean;

export interface VividOverlayControlKeyframeTrack {
  controlId: string;
  keys: Keyframe[];
}

export const VIVID_OVERLAY_MOTION_TEMPLATE_IDS = [
  'entrance.fade-up',
  'entrance.scale-in',
  'emphasis.pulse',
  'emphasis.shake',
  'attention.ping',
  'exit.fade-out',
  'ambient.float',
] as const;

export type VividOverlayMotionTemplateId =
  (typeof VIVID_OVERLAY_MOTION_TEMPLATE_IDS)[number];

export const VIVID_OVERLAY_MOTION_TEMPLATE_STRENGTHS = [
  'subtle',
  'normal',
  'strong',
] as const;

export type VividOverlayMotionTemplateStrength =
  (typeof VIVID_OVERLAY_MOTION_TEMPLATE_STRENGTHS)[number];

export interface VividOverlayMotionTemplateProvenance {
  source: 'motion-template';
  templateId: VividOverlayMotionTemplateId;
  strength: VividOverlayMotionTemplateStrength;
  appliedAt: string;
  affectedProperties: KeyframeableProperty[];
}

export const VividOverlayMotionTemplateProvenanceSchema = z
  .object({
    source: z.literal('motion-template'),
    templateId: z.enum(VIVID_OVERLAY_MOTION_TEMPLATE_IDS),
    strength: z.enum(VIVID_OVERLAY_MOTION_TEMPLATE_STRENGTHS),
    appliedAt: z.string().min(1),
    affectedProperties: z.array(z.enum(KEYFRAMEABLE_PROPERTIES)).min(1),
  })
  .strict();

export const VividOverlayControlKeyframeTrackSchema = z
  .object({
    controlId: z.string().min(1),
    keys: z
      .array(
        z
          .object({
            atMs: z.number().int().min(0),
            value: z.number().finite(),
            interp: z.enum(['hold', 'linear', 'smooth']).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((track, ctx) => {
    let previousAtMs = -1;
    for (const key of track.keys) {
      if (key.atMs <= previousAtMs) {
        ctx.addIssue({
          code: 'custom',
          message: 'Control keyframes must be sorted and unique by atMs',
          path: ['keys'],
        });
        return;
      }
      previousAtMs = key.atMs;
    }
  });

export interface VividOverlayParams {
  presetId: string;
  backend: VividOverlayBackendId;
  controls: Record<string, VividOverlayControlValue>;
  sourceAssetId?: string;
  loop?: VividOverlayLoopMode;
  controlKeyframes?: VividOverlayControlKeyframeTrack[];
  motionTemplate?: VividOverlayMotionTemplateProvenance;
}

export const VividOverlayParamsSchema = z
  .object({
    presetId: z.string().min(1),
    backend: z.enum(VIVID_OVERLAY_BACKENDS),
    controls: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]),
    ),
    sourceAssetId: z.string().min(1).optional(),
    loop: z.enum(['loop', 'hold', 'none']).optional(),
    controlKeyframes: z
      .array(VividOverlayControlKeyframeTrackSchema)
      .optional(),
    motionTemplate: VividOverlayMotionTemplateProvenanceSchema.optional(),
  })
  .strict();

export type VividOverlayControlType =
  | 'number'
  | 'color'
  | 'text'
  | 'select'
  | 'toggle';

export interface VividOverlayControlDef {
  id: string;
  type: VividOverlayControlType;
  labelKey: string;
  defaultValue: VividOverlayControlValue;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
}

export type VividOverlayCategory =
  | 'caption'
  | 'sticker'
  | 'title'
  | 'callout'
  | 'ambient'
  | 'social'
  | 'progress'
  | 'frame'
  | 'badge'
  | 'reaction'
  | 'screen'
  | 'widget';

/** Which video orientation a preset is designed for; 'any' fits both. */
export type VividOverlayAspectAffinity = 'landscape' | 'portrait' | 'any';

/** Canvas region the preset is authored to occupy; 'full' covers the frame. */
export type VividOverlayAnchor =
  | 'top'
  | 'bottom'
  | 'corner-tl'
  | 'corner-tr'
  | 'corner-bl'
  | 'corner-br'
  | 'center'
  | 'full';

/** Card backdrop that keeps the preset's poster legible in the library rail. */
export type VividOverlayPreviewBackground = 'dark' | 'light' | 'photo';

export type VividOverlayMotionIntent =
  | 'annotation'
  | 'ambient'
  | 'emphasis'
  | 'entrance'
  | 'feedback'
  | 'frame'
  | 'progress'
  | 'text-kinetic';

export type VividOverlayMotionTarget =
  | 'background'
  | 'button'
  | 'frame'
  | 'section'
  | 'screen'
  | 'stat'
  | 'text';

export type VividOverlayReducedMotionFallback =
  | 'crossfade'
  | 'none'
  | 'poster'
  | 'scale-only';

export type VividOverlayDurationToken = 'fast' | 'base' | 'slow' | 'deliberate';

export type VividOverlayEasingToken =
  | 'ease-out'
  | 'ease-in-out'
  | 'linear'
  | 'spring-soft'
  | 'spring-snappy';

export interface VividOverlayMotionTokens {
  duration?: VividOverlayDurationToken;
  easing?: VividOverlayEasingToken;
}

export interface VividOverlayRestraint {
  maxPerScene?: number;
  maxSimultaneous?: number;
  loopPolicy?: 'none' | 'single-ambient' | 'manual';
}

export interface VividOverlayTasteMetadata {
  /** Primary reason a router or agent should choose this preset. */
  intent: VividOverlayMotionIntent;
  /** UI/content surface the motion is authored to act on. */
  targets: readonly VividOverlayMotionTarget[];
  /** Positive fit cues phrased for agent/router matching. */
  bestFor: readonly string[];
  /** Negative fit cues that should veto or demote the preset. */
  avoidWhen: readonly string[];
  restraint?: VividOverlayRestraint;
  reducedMotion?: VividOverlayReducedMotionFallback;
  motionTokens?: VividOverlayMotionTokens;
}

export interface VividOverlayStyleTransform {
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  positionX?: number;
  positionY?: number;
  opacity?: number;
  rotation?: number;
}

export type VividOverlayStyleProvenanceKind =
  | 'saved-from-timeline'
  | 'agent'
  | 'import'
  | 'video-to-template';

export interface VividOverlayStyleProvenance {
  kind: VividOverlayStyleProvenanceKind;
  sourceId?: string;
  createdAt: string;
}

export interface VividOverlayStyle {
  id: string;
  name: string;
  basePresetId: string;
  controls: Record<string, VividOverlayControlValue>;
  loop?: VividOverlayLoopMode;
  transform?: VividOverlayStyleTransform;
  keyframes?: KeyframeTrack[];
  tags?: readonly string[];
  taste?: VividOverlayTasteMetadata;
  provenance: VividOverlayStyleProvenance;
}

/**
 * One catalog entry. Defined here so the frontend and backend registries share
 * the exact shape; the two registry copies are pinned by a parity test like
 * the transition registry.
 */
export interface VividOverlayPresetDef {
  id: string;
  backend: VividOverlayBackendId;
  category: VividOverlayCategory;
  labelKey: string;
  descriptionKey: string;
  controls: readonly VividOverlayControlDef[];
  /** 'native' renders on every path; 'remotion-only' forces the Remotion final renderer. */
  capability: 'native' | 'remotion-only';
  /** html/text-motion: authored document id; lottie: `lottie:<asset>`. */
  documentId?: string;
  /** gif backend: the clip must carry params.sourceAssetId (user asset). */
  requiresSourceAsset?: boolean;
  /**
   * Authored animation length — the loop/hold wrap point for clip-local
   * time. Backends that loop intrinsically inside their document (gif) use a
   * huge value so clip-level 'hold' never clamps.
   */
  defaultDurationMs: number;
  minDurationMs: number;
  license?: { source: string; license: string };
  /** Search keywords beyond label/description; doubles as the video-to-template classifier label space. */
  tags?: readonly string[];
  /** Poster frame time for library cards; defaults to 0.6 * defaultDurationMs. */
  previewPosterMs?: number;
  previewBackground?: VividOverlayPreviewBackground;
  aspectAffinity?: VividOverlayAspectAffinity;
  anchor?: VividOverlayAnchor;
  taste?: VividOverlayTasteMetadata;
}

/** Poster time for library cards — after entrance animations settle. */
export function vividOverlayPreviewPosterMs(
  preset: Pick<VividOverlayPresetDef, 'previewPosterMs' | 'defaultDurationMs'>,
): number {
  return preset.previewPosterMs ?? Math.round(preset.defaultDurationMs * 0.6);
}

export type ImportedVividOverlayKind = 'gif' | 'lottie';

const IMPORTED_GIF_SENTINEL_DURATION_MS = 36_000_000;

export const IMPORTED_VIVID_OVERLAY_PRESET_IDS: Record<
  ImportedVividOverlayKind,
  string
> = {
  gif: 'imported.gif',
  lottie: 'imported.lottie',
};

const IMPORTED_VIVID_OVERLAY_PRESETS: Record<
  ImportedVividOverlayKind,
  VividOverlayPresetDef
> = {
  gif: {
    id: IMPORTED_VIVID_OVERLAY_PRESET_IDS.gif,
    backend: 'gif',
    category: 'sticker',
    labelKey: 'overlays.localGif',
    descriptionKey: 'overlays.localGifDescription',
    controls: [],
    capability: 'native',
    requiresSourceAsset: true,
    defaultDurationMs: IMPORTED_GIF_SENTINEL_DURATION_MS,
    minDurationMs: 250,
    tags: ['imported', 'local', 'gif', 'sticker'],
    previewBackground: 'dark',
  },
  lottie: {
    id: IMPORTED_VIVID_OVERLAY_PRESET_IDS.lottie,
    backend: 'lottie',
    category: 'ambient',
    labelKey: 'overlays.localLottie',
    descriptionKey: 'overlays.localLottieDescription',
    controls: [],
    capability: 'native',
    requiresSourceAsset: true,
    defaultDurationMs: 4000,
    minDurationMs: 250,
    tags: ['imported', 'local', 'lottie', 'animation'],
    previewBackground: 'dark',
  },
};

export function importedVividOverlayPresetId(
  kind: ImportedVividOverlayKind,
): string {
  return IMPORTED_VIVID_OVERLAY_PRESET_IDS[kind];
}

export function importedVividOverlayPreset(
  kind: ImportedVividOverlayKind,
): VividOverlayPresetDef {
  return IMPORTED_VIVID_OVERLAY_PRESETS[kind];
}

export function findImportedVividOverlayPreset(
  presetId: string,
): VividOverlayPresetDef | undefined {
  return Object.values(IMPORTED_VIVID_OVERLAY_PRESETS).find(
    (preset) => preset.id === presetId,
  );
}

// Vivid overlay clips are preset instances, not media, so their sourceRef is a
// synthetic asset id. Old builds resolve it to "asset missing" for a clip kind
// they never render — harmless by construction.
export const VIVID_OVERLAY_SOURCE_PREFIX = 'vivid-overlay-preset:';

export function vividOverlaySourceRef(presetId: string): TimelineSourceRef {
  return {
    kind: 'asset',
    assetId: `${VIVID_OVERLAY_SOURCE_PREFIX}${presetId}`,
  };
}

export function isVividOverlayClip(
  clip: TimelineClip,
): clip is EffectTimelineClip {
  return (
    clip.kind === 'effect' && clip.effectType === VIVID_OVERLAY_EFFECT_TYPE
  );
}

export function parseVividOverlayParams(
  params: unknown,
): VividOverlayParams | null {
  const result = VividOverlayParamsSchema.safeParse(params);
  return result.success ? result.data : null;
}

export function vividOverlayControlDefaults(
  controls: readonly VividOverlayControlDef[],
): Record<string, VividOverlayControlValue> {
  return Object.fromEntries(
    controls.map((control) => [control.id, control.defaultValue]),
  );
}

const CONTROL_VALUE_TYPES: Record<
  VividOverlayControlType,
  'string' | 'number' | 'boolean'
> = {
  number: 'number',
  color: 'string',
  text: 'string',
  select: 'string',
  toggle: 'boolean',
};

/**
 * Validate a controls payload against a preset's control definitions.
 * Returns human-readable problems; empty array means valid.
 */
export function vividOverlayControlErrors(
  controls: Record<string, VividOverlayControlValue>,
  defs: readonly VividOverlayControlDef[],
): string[] {
  const errors: string[] = [];
  const byId = new Map(defs.map((def) => [def.id, def]));
  for (const [id, value] of Object.entries(controls)) {
    const def = byId.get(id);
    if (!def) {
      errors.push(`Unknown control: ${id}`);
      continue;
    }
    if (typeof value !== CONTROL_VALUE_TYPES[def.type]) {
      errors.push(
        `Control ${id} expects ${CONTROL_VALUE_TYPES[def.type]}, got ${typeof value}`,
      );
      continue;
    }
    if (def.type === 'number' && typeof value === 'number') {
      if (def.min !== undefined && value < def.min) {
        errors.push(`Control ${id} below min ${def.min}`);
      }
      if (def.max !== undefined && value > def.max) {
        errors.push(`Control ${id} above max ${def.max}`);
      }
    }
    if (
      def.type === 'select' &&
      typeof value === 'string' &&
      def.options &&
      !def.options.includes(value)
    ) {
      errors.push(`Control ${id} has unknown option: ${value}`);
    }
  }
  return errors;
}

export function vividOverlayControlKeyframeErrors(
  tracks: readonly VividOverlayControlKeyframeTrack[],
  defs: readonly VividOverlayControlDef[],
  durationMs?: number,
): string[] {
  const errors: string[] = [];
  const byId = new Map(defs.map((def) => [def.id, def]));
  const seen = new Set<string>();
  for (const track of tracks) {
    const def = byId.get(track.controlId);
    if (!def) {
      errors.push(`Unknown keyframed control: ${track.controlId}`);
      continue;
    }
    if (def.type !== 'number') {
      errors.push(`Control ${track.controlId} does not support keyframes`);
      continue;
    }
    if (seen.has(track.controlId)) {
      errors.push(`Duplicate keyframe track: ${track.controlId}`);
      continue;
    }
    seen.add(track.controlId);
    if (track.keys.length === 0) {
      errors.push(`Control ${track.controlId} keyframe track is empty`);
      continue;
    }
    let previousAtMs = -1;
    for (const key of track.keys) {
      if (!Number.isInteger(key.atMs) || key.atMs < 0) {
        errors.push(`Control ${track.controlId} keyframe atMs must be >= 0`);
      }
      if (key.atMs <= previousAtMs) {
        errors.push(
          `Control ${track.controlId} keyframes must be sorted and unique`,
        );
      }
      if (durationMs !== undefined && key.atMs > durationMs) {
        errors.push(
          `Control ${track.controlId} keyframe exceeds clip duration ${durationMs}`,
        );
      }
      if (!Number.isFinite(key.value)) {
        errors.push(`Control ${track.controlId} keyframe value must be finite`);
      }
      if (def.min !== undefined && key.value < def.min) {
        errors.push(`Control ${track.controlId} keyframe below min ${def.min}`);
      }
      if (def.max !== undefined && key.value > def.max) {
        errors.push(`Control ${track.controlId} keyframe above max ${def.max}`);
      }
      previousAtMs = key.atMs;
    }
  }
  return errors;
}
