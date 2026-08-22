import { z } from 'zod';

import { getClipEffectParameterDefinition } from './clip-effects.js';
import {
  KEYFRAMEABLE_PROPERTIES,
  KEYFRAME_INTERPOLATIONS,
  keyframeTrackValidationError,
  keyframeValueValidationError,
} from './keyframes.js';
import type {
  ClipEffect,
  ClipEffectKind,
  ClipEffectParameter,
  Keyframe,
  KeyframeableProperty,
} from './timeline-types.js';

export const TimelineTransitionKindSchema = z.enum([
  'cut',
  'fade',
  'slide',
  'wipe',
  'iris',
  'dissolve',
  'soft-wipe',
  'pixelize',
  'polygon-iris',
  'cover',
  'reveal',
  'flip',
  'clock-wipe',
  'cube',
  'zoom-blur',
  'zoom-in-out',
]);

export const TimelineTransitionDirectionSchema = z.enum([
  'from-left',
  'from-right',
  'from-top',
  'from-bottom',
]);

export const TimelineTransitionSchema = z.union([
  TimelineTransitionKindSchema,
  z
    .object({
      kind: TimelineTransitionKindSchema,
      durationMs: z.number().int().min(33).max(3000).optional(),
      direction: TimelineTransitionDirectionSchema.optional(),
      seam: z
        .object({
          timeMs: z.number().int().min(0).optional(),
          sourceClipId: z.string().min(1).optional(),
          targetClipId: z.string().min(1).optional(),
          label: z.string().min(1).optional(),
        })
        .strict()
        .optional(),
      params: z.record(z.string(), z.unknown()).optional(),
      source: z
        .discriminatedUnion('kind', [
          z
            .object({
              kind: z.literal('builtin'),
              id: z.string().min(1),
            })
            .strict(),
          z
            .object({
              kind: z.literal('glsl'),
              source: z.string().min(1),
            })
            .strict(),
        ])
        .optional(),
    })
    .strict(),
]);

export const AudioFadeCurveSchema = z.enum([
  'linear',
  'equal-power',
  'ease-in-out',
]);

export const AudioTransitionSpecSchema = z
  .object({
    kind: z.enum(['cut', 'crossfade']),
    durationMs: z.number().int().min(0),
    curve: AudioFadeCurveSchema.optional(),
  })
  .strict();

export const TimelineMarkerSchema = z
  .object({
    id: z.string().min(1),
    timeMs: z.number().int().min(0),
    label: z.string(),
    color: z
      .enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple'])
      .optional(),
    isChapter: z.boolean().optional(),
    comment: z.string().optional(),
  })
  .strict();

export const FrameRateSchema = z
  .object({
    num: z.number().int().positive(),
    den: z.number().int().positive(),
  })
  .strict();

export const TimelineSourceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('asset'), assetId: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('linked'),
      sourceId: z.string().min(1),
      externalId: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal('scene'), sceneId: z.string().min(1) }).strict(),
]);

export const KeyframeInterpolationSchema = z.enum(KEYFRAME_INTERPOLATIONS);

export const KeyframeablePropertySchema = z.enum(KEYFRAMEABLE_PROPERTIES);

export const KeyframeSchema = z
  .object({
    atMs: z.number().int().min(0),
    value: z.number(),
    interp: KeyframeInterpolationSchema.optional(),
  })
  .strict();

export const KeyframeTrackSchema = z
  .object({
    property: KeyframeablePropertySchema,
    keys: z.array(KeyframeSchema).min(1),
  })
  .strict()
  .superRefine((track, ctx) => {
    const error = keyframeTrackValidationError(track);
    if (error) ctx.addIssue({ code: 'custom', message: error, path: ['keys'] });
  });

function addKeyframeValueIssue(
  ctx: z.core.$RefinementCtx,
  property: KeyframeableProperty,
  key: Keyframe,
  path: (string | number)[],
): void {
  const error = keyframeValueValidationError(property, key.value);
  if (error) ctx.addIssue({ code: 'custom', message: error, path });
}

export const ClipTransformSchema = z
  .object({
    scale: z.number().optional(),
    scaleX: z.number().optional(),
    scaleY: z.number().optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
    opacity: z.number().optional(),
    rotation: z.number().optional(),
    fit: z.enum(['cover', 'contain', 'fill', 'blur-pad']).optional(),
    background: z.string().min(1).optional(),
    crop: z
      .object({
        top: z.number(),
        right: z.number(),
        bottom: z.number(),
        left: z.number(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ClipFiltersSchema = z
  .object({
    brightness: z.number().optional(),
    contrast: z.number().optional(),
    saturation: z.number().optional(),
    hueRotateDeg: z.number().optional(),
    blurPx: z.number().optional(),
    grayscale: z.number().optional(),
    sepia: z.number().optional(),
  })
  .strict();

export const ClipEffectParameterSchema = z.enum([
  'amount',
  'temperature',
  'tint',
  'radius',
]);

const ClipEffectBaseSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  disabled: z.boolean().optional(),
});

// Ranges come from CLIP_EFFECT_CATALOG so the schema, the MCP input contract,
// and the inspector sliders can never disagree about a parameter's bounds.
function effectParam(kind: ClipEffectKind, key: ClipEffectParameter) {
  const definition = getClipEffectParameterDefinition(kind, key);
  if (!definition) throw new Error(`${key} is not valid for ${kind}`);
  return z.number().min(definition.min).max(definition.max);
}

const CLIP_EFFECT_PARAMS = {
  brightness: z
    .object({ amount: effectParam('brightness', 'amount') })
    .strict(),
  contrast: z.object({ amount: effectParam('contrast', 'amount') }).strict(),
  saturation: z
    .object({ amount: effectParam('saturation', 'amount') })
    .strict(),
  'white-balance': z
    .object({
      temperature: effectParam('white-balance', 'temperature'),
      tint: effectParam('white-balance', 'tint'),
    })
    .strict(),
  blur: z
    .object({
      radius: effectParam('blur', 'radius'),
      horizontal: z.boolean(),
      vertical: z.boolean(),
    })
    .strict(),
} as const;

export const ClipEffectSchema = z.discriminatedUnion('kind', [
  ClipEffectBaseSchema.extend({
    kind: z.literal('brightness'),
    params: CLIP_EFFECT_PARAMS.brightness,
  }).strict(),
  ClipEffectBaseSchema.extend({
    kind: z.literal('contrast'),
    params: CLIP_EFFECT_PARAMS.contrast,
  }).strict(),
  ClipEffectBaseSchema.extend({
    kind: z.literal('saturation'),
    params: CLIP_EFFECT_PARAMS.saturation,
  }).strict(),
  ClipEffectBaseSchema.extend({
    kind: z.literal('white-balance'),
    params: CLIP_EFFECT_PARAMS['white-balance'],
  }).strict(),
  ClipEffectBaseSchema.extend({
    kind: z.literal('blur'),
    params: CLIP_EFFECT_PARAMS.blur,
  }).strict(),
]);

const ClipEffectInputBaseSchema = z.object({
  id: z.string().uuid().optional(),
  disabled: z.boolean().optional(),
});

/**
 * Agent-facing shape of a clip effect: same parameter bounds as
 * `ClipEffectSchema`, but `id` is optional and `version` is supplied by
 * `clipEffectFromInput` rather than the caller.
 */
export const ClipEffectInputSchema = z.discriminatedUnion('kind', [
  ClipEffectInputBaseSchema.extend({
    kind: z.literal('brightness'),
    params: CLIP_EFFECT_PARAMS.brightness,
  }).strict(),
  ClipEffectInputBaseSchema.extend({
    kind: z.literal('contrast'),
    params: CLIP_EFFECT_PARAMS.contrast,
  }).strict(),
  ClipEffectInputBaseSchema.extend({
    kind: z.literal('saturation'),
    params: CLIP_EFFECT_PARAMS.saturation,
  }).strict(),
  ClipEffectInputBaseSchema.extend({
    kind: z.literal('white-balance'),
    params: CLIP_EFFECT_PARAMS['white-balance'],
  }).strict(),
  ClipEffectInputBaseSchema.extend({
    kind: z.literal('blur'),
    params: z
      .object({
        radius: effectParam('blur', 'radius'),
        horizontal: z.boolean().default(true),
        vertical: z.boolean().default(true),
      })
      .strict(),
  }).strict(),
]);

export type ClipEffectInput = z.infer<typeof ClipEffectInputSchema>;

export function clipEffectFromInput(input: ClipEffectInput): ClipEffect {
  return {
    id: input.id ?? crypto.randomUUID(),
    version: 1,
    ...(input.disabled === undefined ? {} : { disabled: input.disabled }),
    kind: input.kind,
    params: input.params,
  } as ClipEffect;
}

export const EffectParameterKeyframeTrackSchema = z
  .object({
    effectId: z.string().uuid(),
    parameter: ClipEffectParameterSchema,
    keys: z.array(KeyframeSchema).min(1),
  })
  .strict()
  // Only the timing invariants are checked here. Value bounds are effect-kind
  // specific and are enforced against the catalog in `ClipEffectStackSchema`;
  // borrowing another property's bounds would abort this loop early and let
  // duplicate or descending `atMs` through.
  .superRefine((track, ctx) => {
    let previousAtMs = -1;
    for (const [index, key] of track.keys.entries()) {
      if (!Number.isInteger(key.atMs) || key.atMs < 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Keyframe atMs must be a non-negative integer',
          path: ['keys', index, 'atMs'],
        });
      } else if (key.atMs <= previousAtMs) {
        ctx.addIssue({
          code: 'custom',
          message: 'Keyframe keys must be strictly sorted and unique by atMs',
          path: ['keys', index, 'atMs'],
        });
      }
      previousAtMs = key.atMs;
    }
  });

export const ClipEffectStackSchema = z
  .object({
    schema: z.literal('neuma.video.clip-effects.v1'),
    effects: z.array(ClipEffectSchema),
    keyframes: z.array(EffectParameterKeyframeTrackSchema).optional(),
  })
  .strict()
  .superRefine((stack, ctx) => {
    const effectsById = new Map<string, (typeof stack.effects)[number]>();
    for (const [index, effect] of stack.effects.entries()) {
      if (effectsById.has(effect.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate effect id: ${effect.id}`,
          path: ['effects', index, 'id'],
        });
      }
      effectsById.set(effect.id, effect);
    }

    const targets = new Set<string>();
    for (const [index, track] of (stack.keyframes ?? []).entries()) {
      const effect = effectsById.get(track.effectId);
      if (!effect) {
        ctx.addIssue({
          code: 'custom',
          message: `Effect keyframe target does not exist: ${track.effectId}`,
          path: ['keyframes', index, 'effectId'],
        });
        continue;
      }
      const definition = getClipEffectParameterDefinition(
        effect.kind,
        track.parameter,
      );
      if (!definition) {
        ctx.addIssue({
          code: 'custom',
          message: `${track.parameter} is not valid for ${effect.kind}`,
          path: ['keyframes', index, 'parameter'],
        });
        continue;
      }
      const target = `${track.effectId}:${track.parameter}`;
      if (targets.has(target)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate effect keyframe target: ${target}`,
          path: ['keyframes', index],
        });
      }
      targets.add(target);
      for (const [keyIndex, key] of track.keys.entries()) {
        if (key.value < definition.min || key.value > definition.max) {
          ctx.addIssue({
            code: 'custom',
            message: `${track.parameter} must be between ${definition.min} and ${definition.max}`,
            path: ['keyframes', index, 'keys', keyIndex, 'value'],
          });
        }
      }
    }
  });

export const ClipPlaybackSchema = z
  .object({
    speed: z.number().min(0.1).max(20),
    reverse: z.boolean(),
    pitchCorrection: z.boolean().optional(),
    smoothSlowMo: z.boolean().optional(),
    interpolationQuality: z.enum(['low', 'medium', 'high']).optional(),
  })
  .strict();

export const SubtitleStyleSchema = z
  .object({
    fontFamily: z.string().min(1).optional(),
    fontSize: z.number().int().min(8).max(128).optional(),
    color: z.string().min(1).optional(),
    background: z.string().min(1).optional(),
    position: z.enum(['top', 'middle', 'bottom']).optional(),
    animation: z
      .enum(['none', 'tiktok-word', 'hormozi-bold', 'classic', 'karaoke'])
      .optional(),
  })
  .strict();

export const CaptionTokenSchema = z
  .object({
    id: z.string().min(1),
    text: z.string(),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict()
  .refine((token) => token.endMs > token.startMs, {
    message: 'Caption token endMs must be greater than startMs',
    path: ['endMs'],
  });

const BaseClipSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  sourceRef: TimelineSourceRefSchema,
  sceneId: z.string().optional(),
  linkGroupId: z.string().min(1).optional(),
  startMs: z.number().int().min(0),
  durationMs: z.number().int().positive(),
  trimStartMs: z.number().int().min(0),
  trimEndMs: z.number().int().min(0),
  sourceDurationMs: z.number().int().min(0).optional(),
  playback: ClipPlaybackSchema.optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  keyframes: z.array(KeyframeTrackSchema).optional(),
});

export const VisualTimelineClipSchema = BaseClipSchema.extend({
  kind: z.enum(['video', 'image', 'overlay']),
  transforms: ClipTransformSchema.optional(),
  transitionToNext: TimelineTransitionSchema.optional(),
  audioSeamToNext: z.enum(['follow', 'cut']).optional(),
  filters: ClipFiltersSchema.optional(),
  effects: ClipEffectStackSchema.optional(),
  muted: z.boolean().optional(),
}).strict();

export const AudioTimelineClipSchema = BaseClipSchema.extend({
  kind: z.literal('audio'),
  gainDb: z.number().optional(),
  muted: z.boolean().optional(),
  fadeInMs: z.number().int().min(0).optional(),
  fadeOutMs: z.number().int().min(0).optional(),
  fadeInCurve: AudioFadeCurveSchema.optional(),
  fadeOutCurve: AudioFadeCurveSchema.optional(),
  audioTransitionToNext: AudioTransitionSpecSchema.optional(),
  transcriptText: z.string().optional(),
}).strict();

export const CaptionTimelineClipSchema = BaseClipSchema.extend({
  kind: z.literal('caption'),
  captionGroupId: z.string().min(1).optional(),
  text: z.string(),
  tokens: z.array(CaptionTokenSchema).optional(),
  style: SubtitleStyleSchema.optional(),
}).strict();

export const EffectTimelineClipSchema = BaseClipSchema.extend({
  kind: z.literal('effect'),
  effectType: z.string().min(1),
  transforms: ClipTransformSchema.optional(),
}).strict();

export const TimelineClipSchema = z.discriminatedUnion('kind', [
  VisualTimelineClipSchema,
  AudioTimelineClipSchema,
  CaptionTimelineClipSchema,
  EffectTimelineClipSchema,
]);

const BaseTrackSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  muted: z.boolean(),
  locked: z.boolean(),
  syncLocked: z.boolean().optional(),
  order: z.number().int(),
});

export const TimelineTrackSchema = z.discriminatedUnion('kind', [
  // Visual tracks also parse `effect` clips (vivid overlays) so the schema
  // stays additive within timeline.v1; the ops layer restricts *placement* to
  // overlay tracks (assertClipKindFitsTrack), mirroring how transition params
  // are schema-permissive but registry-validated.
  BaseTrackSchema.extend({
    kind: z.enum(['video', 'broll', 'overlay']),
    hidden: z.boolean().optional(),
    clips: z.array(
      z.discriminatedUnion('kind', [
        VisualTimelineClipSchema,
        EffectTimelineClipSchema,
      ]),
    ),
  }).strict(),
  BaseTrackSchema.extend({
    kind: z.enum(['audio-vo', 'audio-music', 'audio-sfx']),
    volumeDb: z.number().optional(),
    duckUnderTrackId: z.string().optional(),
    clips: z.array(AudioTimelineClipSchema),
  }).strict(),
  BaseTrackSchema.extend({
    kind: z.literal('caption'),
    clips: z.array(CaptionTimelineClipSchema),
  }).strict(),
]);

export const TimelineBookendSchema = z
  .object({
    kind: z.literal('fade'),
    durationMs: z.number().int().min(33).max(3000),
  })
  .strict();

export const TimelineSchema = z
  .object({
    schema: z.literal('neuma.video.timeline.v1'),
    tracks: z.array(TimelineTrackSchema),
    durationMs: z.number().int().min(0),
    fps: z.number().positive(),
    frameRate: FrameRateSchema.optional(),
    markers: z.array(TimelineMarkerSchema).optional(),
    intro: TimelineBookendSchema.optional(),
    outro: TimelineBookendSchema.optional(),
    migration: z
      .object({
        from: z.literal('storyboard'),
        version: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();

const ClipTimingStateSchema = z
  .object({
    startMs: z.number().int().min(0),
    durationMs: z.number().int().positive(),
    trimStartMs: z.number().int().min(0),
    trimEndMs: z.number().int().min(0),
  })
  .strict();

const ClipLinkStateSchema = z
  .object({
    clipId: z.string().min(1),
    linkGroupId: z.string().min(1).optional(),
  })
  .strict();

const AudioClipAudioPatchSchema = z
  .object({
    gainDb: z.number().nullable().optional(),
    muted: z.boolean().nullable().optional(),
    fadeInMs: z.number().int().min(0).nullable().optional(),
    fadeOutMs: z.number().int().min(0).nullable().optional(),
    fadeInCurve: AudioFadeCurveSchema.nullable().optional(),
    fadeOutCurve: AudioFadeCurveSchema.nullable().optional(),
  })
  .strict();

const TrackUpdatePatchSchema = z
  .object({
    name: z.string().optional(),
    muted: z.boolean().optional(),
    locked: z.boolean().optional(),
    syncLocked: z.boolean().nullable().optional(),
    order: z.number().int().optional(),
    volumeDb: z.number().nullable().optional(),
    duckUnderTrackId: z.string().min(1).nullable().optional(),
  })
  .strict();

export const TimelineOpSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('clip.insert'),
      trackId: z.string().min(1),
      clip: TimelineClipSchema,
      at: z.number().int().min(0),
      magnetic: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.remove'),
      clipId: z.string().min(1),
      snapshot: TimelineClipSchema.optional(),
      magnetic: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.removeTimeRange'),
      trackId: z.string().min(1).optional(),
      startMs: z.number().int().min(0),
      endMs: z.number().int().min(0),
      magnetic: z.boolean().optional(),
      before: z.array(TimelineClipSchema).optional(),
      after: z.array(TimelineClipSchema).optional(),
    })
    .strict()
    .refine((op) => op.endMs > op.startMs, {
      message: 'endMs must be greater than startMs',
      path: ['endMs'],
    }),
  z
    .object({
      kind: z.literal('clip.link'),
      clipIds: z.array(z.string().min(1)).min(2),
      linkGroupId: z.string().min(1),
      before: z.array(ClipLinkStateSchema).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.unlink'),
      linkGroupId: z.string().min(1),
      before: z
        .array(
          z
            .object({
              clipId: z.string().min(1),
              linkGroupId: z.string().min(1),
            })
            .strict(),
        )
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.setLinkGroup'),
      assignments: z.array(ClipLinkStateSchema).min(1),
      before: z.array(ClipLinkStateSchema).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.move'),
      clipId: z.string().min(1),
      from: z
        .object({
          trackId: z.string().min(1),
          startMs: z.number().int().min(0),
        })
        .strict(),
      to: z
        .object({
          trackId: z.string().min(1),
          startMs: z.number().int().min(0),
        })
        .strict(),
      magnetic: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.trim'),
      clipId: z.string().min(1),
      from: ClipTimingStateSchema,
      to: ClipTimingStateSchema,
      magnetic: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.extend'),
      clipId: z.string().min(1),
      deltaMs: z.number().int(),
      magnetic: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.split'),
      clipId: z.string().min(1),
      at: z.number().int().positive(),
      before: TimelineClipSchema,
      after: z.tuple([TimelineClipSchema, TimelineClipSchema]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.merge'),
      removeClipIds: z.tuple([z.string().min(1), z.string().min(1)]),
      clip: TimelineClipSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.setTransition'),
      clipId: z.string().min(1),
      before: TimelineTransitionSchema.nullable(),
      after: TimelineTransitionSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.setAudio'),
      clipId: z.string().min(1),
      before: AudioClipAudioPatchSchema,
      after: AudioClipAudioPatchSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.setAudioTransition'),
      clipId: z.string().min(1),
      before: AudioTransitionSpecSchema.nullable(),
      after: AudioTransitionSpecSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.setTransform'),
      clipId: z.string().min(1),
      before: ClipTransformSchema.nullable(),
      after: ClipTransformSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.setFilters'),
      clipId: z.string().min(1),
      before: ClipFiltersSchema.nullable(),
      after: ClipFiltersSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.setEffects'),
      clipId: z.string().min(1),
      before: ClipEffectStackSchema.nullable(),
      after: ClipEffectStackSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.setParams'),
      clipId: z.string().min(1),
      before: z.record(z.string(), z.unknown()).nullable(),
      after: z.record(z.string(), z.unknown()).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('clip.setPlayback'),
      clipId: z.string().min(1),
      before: ClipPlaybackSchema.nullable(),
      after: ClipPlaybackSchema.nullable(),
      timingPolicy: z
        .enum(['preserve-source-span', 'preserve-timeline-duration'])
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('keyframe.upsert'),
      clipId: z.string().min(1),
      property: KeyframeablePropertySchema,
      key: KeyframeSchema,
      before: KeyframeSchema.nullable().optional(),
    })
    .strict()
    .superRefine((op, ctx) => {
      addKeyframeValueIssue(ctx, op.property, op.key, ['key', 'value']);
      if (op.before) {
        addKeyframeValueIssue(ctx, op.property, op.before, ['before', 'value']);
      }
    }),
  z
    .object({
      kind: z.literal('keyframe.remove'),
      clipId: z.string().min(1),
      property: KeyframeablePropertySchema,
      atMs: z.number().int().min(0),
      snapshot: KeyframeSchema,
    })
    .strict()
    .superRefine((op, ctx) => {
      addKeyframeValueIssue(ctx, op.property, op.snapshot, [
        'snapshot',
        'value',
      ]);
    }),
  z
    .object({
      kind: z.literal('keyframe.setTrack'),
      clipId: z.string().min(1),
      property: KeyframeablePropertySchema,
      before: KeyframeTrackSchema.nullable(),
      after: KeyframeTrackSchema.nullable(),
    })
    .strict()
    .superRefine((op, ctx) => {
      if (op.before && op.before.property !== op.property) {
        ctx.addIssue({
          code: 'custom',
          message: 'before track property must match op property',
          path: ['before', 'property'],
        });
      }
      if (op.after && op.after.property !== op.property) {
        ctx.addIssue({
          code: 'custom',
          message: 'after track property must match op property',
          path: ['after', 'property'],
        });
      }
    }),
  z
    .object({
      kind: z.literal('effectKeyframe.upsert'),
      clipId: z.string().min(1),
      effectId: z.string().uuid(),
      parameter: ClipEffectParameterSchema,
      key: KeyframeSchema,
      before: KeyframeSchema.nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('effectKeyframe.remove'),
      clipId: z.string().min(1),
      effectId: z.string().uuid(),
      parameter: ClipEffectParameterSchema,
      atMs: z.number().int().min(0),
      snapshot: KeyframeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('effectKeyframe.setTrack'),
      clipId: z.string().min(1),
      effectId: z.string().uuid(),
      parameter: ClipEffectParameterSchema,
      before: EffectParameterKeyframeTrackSchema.nullable(),
      after: EffectParameterKeyframeTrackSchema.nullable(),
    })
    .strict()
    .superRefine((op, ctx) => {
      for (const side of ['before', 'after'] as const) {
        const track = op[side];
        if (!track) continue;
        if (
          track.effectId !== op.effectId ||
          track.parameter !== op.parameter
        ) {
          ctx.addIssue({
            code: 'custom',
            message: `${side} track target must match the operation target`,
            path: [side],
          });
        }
      }
    }),
  z
    .object({
      kind: z.literal('caption.splitAtTime'),
      clipId: z.string().min(1),
      at: z.number().int().positive(),
      before: CaptionTimelineClipSchema,
      after: z.tuple([CaptionTimelineClipSchema, CaptionTimelineClipSchema]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('caption.mergeSibling'),
      removeClipIds: z.tuple([z.string().min(1), z.string().min(1)]),
      clip: CaptionTimelineClipSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('caption.regroup'),
      trackId: z.string().min(1),
      before: z.array(CaptionTimelineClipSchema),
      after: z.array(CaptionTimelineClipSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal('caption.setTokenText'),
      clipId: z.string().min(1),
      tokenId: z.string().min(1),
      before: z.string(),
      after: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('track.insert'),
      track: TimelineTrackSchema,
      index: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal('track.remove'),
      trackId: z.string().min(1),
      snapshot: TimelineTrackSchema.optional(),
      index: z.number().int().min(0).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('track.update'),
      trackId: z.string().min(1),
      before: TrackUpdatePatchSchema,
      after: TrackUpdatePatchSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('marker.upsert'),
      marker: TimelineMarkerSchema,
      before: TimelineMarkerSchema.nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('marker.remove'),
      markerId: z.string().min(1),
      snapshot: TimelineMarkerSchema.optional(),
    })
    .strict(),
]);
