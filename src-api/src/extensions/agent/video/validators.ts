import { TRANSITION_EASINGS } from '@neumar/video-ir';
import { z } from 'zod';

import {
  VIDEO_TRANSITION_KINDS,
  VIDEO_TRANSITION_REGISTRY,
  type TransitionDirection,
  type TransitionKind,
} from '@/shared/video/types';

const transitionKindSchema = z.enum(
  VIDEO_TRANSITION_KINDS as [TransitionKind, ...TransitionKind[]],
);
const transitionDirectionSchema = z.enum([
  'from-left',
  'from-right',
  'from-top',
  'from-bottom',
] satisfies [TransitionDirection, ...TransitionDirection[]]);
const transitionParamValueSchema = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
]);
const transitionTimingSchema = z
  .object({
    durationMs: z.number().int().min(33).max(3000).optional(),
    easing: z.enum(TRANSITION_EASINGS).optional(),
    holdPct: z.number().min(0).max(1).optional(),
  })
  .strict();
const transitionSchema = z
  .union([
    transitionKindSchema,
    z
      .object({
        kind: transitionKindSchema,
        durationMs: z.number().int().min(33).max(3000).optional(),
        direction: transitionDirectionSchema.optional(),
        timing: transitionTimingSchema.optional(),
        params: z.record(z.string(), transitionParamValueSchema).optional(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (typeof value === 'string' || !value.direction) return;
    const entry = VIDEO_TRANSITION_REGISTRY.find(
      (item) => item.kind === value.kind,
    );
    if (
      !entry ||
      !supportsTransitionDirection(entry.directions, value.direction)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `Transition ${value.kind} does not support direction ${value.direction}`,
        path: ['direction'],
      });
    }
  });

const reframeOverrideSchema = z
  .object({
    aspect: z.enum(['16:9', '9:16', '1:1', '4:5']),
    anchor: z.enum(['left', 'center', 'right', 'top', 'bottom', 'top-third']),
    offsetPx: z.number().int().min(-5000).max(5000).optional(),
  })
  .strict();

function supportsTransitionDirection(
  directions: readonly string[],
  direction: TransitionDirection,
): boolean {
  return directions.some((item) => item === direction);
}

// Normalized 0..1 sub-rectangle of an image, used as a Ken Burns keyframe.
const kenBurnsRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.05).max(1),
  height: z.number().min(0.05).max(1),
});

export const assetPlanSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('existing'),
    assetId: z.string().min(1),
    trimMs: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
  }),
  z.object({
    kind: z.literal('ai-image'),
    prompt: z.string().min(1).max(1024),
    refImageIds: z.array(z.string()).optional(),
    provider: z.string().optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:5']).optional(),
    size: z.string().optional(),
    seed: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal('ai-clip'),
    prompt: z.string().min(1).max(1024),
    refImageId: z.string().optional(),
    refImageTailId: z.string().optional(),
    provider: z.string().optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:5']).optional(),
    durationMs: z.number().int().min(1000).max(60000).optional(),
    seed: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal('broll-search'),
    query: z.string().min(1).max(200),
    provider: z.enum(['pexels', 'pixabay', 'storyblocks', 'linked']).optional(),
    sourceIds: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    kind: z.literal('image-pan'),
    assetId: z.string().min(1),
    // Ken Burns keyframes: animate from `from` rect to `to` rect over the
    // scene. Omit for a static frame.
    kenBurns: z
      .object({ from: kenBurnsRectSchema, to: kenBurnsRectSchema })
      .optional(),
  }),
  z.object({
    kind: z.literal('tts-narration'),
    text: z.string().min(1).max(4000),
    voiceId: z.string().optional(),
    provider: z.string().optional(),
  }),
  z.object({
    kind: z.literal('lipsync'),
    text: z.string().min(1).max(4000),
    voiceId: z.string().optional(),
    voiceProvider: z.string().optional(),
    referenceImageAssetId: z.string().min(1),
    lipsyncProvider: z
      .enum([
        'auto',
        'hedra',
        'heygen',
        'veed-fabric',
        'synthesia',
        'omnihuman',
        'pika',
      ])
      .optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:5']).optional(),
    motionScale: z.number().min(0).max(1).optional(),
    background: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('transparent') }),
        z.object({ kind: z.literal('color'), color: z.string().optional() }),
        z.object({ kind: z.literal('image'), assetId: z.string().min(1) }),
      ])
      .optional(),
    egressConfirmed: z.boolean().optional(),
  }),
]);

export const storyboardSceneSchema = z.object({
  id: z.string().min(1),
  durationMs: z.number().int().min(500).max(120000),
  intent: z.string().min(1).max(1024),
  caption: z
    .object({
      text: z.string().min(1).max(1000),
      style: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  transition: transitionSchema.optional(),
  muteAudio: z.boolean().optional(),
  reframe: reframeOverrideSchema.optional(),
  assetPlan: assetPlanSchema,
});

const narrationSegmentSchema = z.object({
  id: z.string().min(1),
  sceneId: z.string().min(1),
  text: z.string().min(1).max(4000),
  voiceId: z.string().max(200).optional(),
  provider: z.string().max(100).optional(),
});

export const storyboardSchema = z.object({
  status: z.enum(['draft', 'approved', 'edited']),
  intent: z.string().min(1).max(1000),
  totalDurationMs: z.number().int().min(500),
  costEstimateUsd: z.object({
    low: z.number().min(0),
    high: z.number().min(0),
  }),
  scenes: z.array(storyboardSceneSchema).min(1).max(40),
  approvedAt: z.string().optional(),
  approvedBy: z.enum(['user', 'auto']).optional(),
  music: z
    .object({
      prompt: z.string().min(1).max(1000),
      durationMs: z.number().int().min(1000).max(600000),
      provider: z.enum(['elevenlabs-music', 'stable-audio']).optional(),
      tempoBpm: z.number().int().min(40).max(240).optional(),
      mood: z.string().max(100).optional(),
      assetId: z.string().min(1).optional(),
    })
    .optional(),
  narration: z
    .object({
      segments: z.array(narrationSegmentSchema).max(80),
      voiceId: z.string().max(200).optional(),
      provider: z.string().max(100).optional(),
      assetId: z.string().min(1).optional(),
    })
    .optional(),
});
