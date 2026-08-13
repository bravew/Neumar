import { ContentGraphSchema, TRANSITION_EASINGS } from '@neumar/video-ir';
import { z } from 'zod';

import {
  VIDEO_TRANSITION_KINDS,
  VIDEO_TRANSITION_REGISTRY,
  type TransitionDirection,
  type TransitionKind,
} from '../types';

const aspectRatioSchema = z.enum(['16:9', '9:16', '1:1', '4:5']);
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
const providerIdSchema = z.enum([
  'seedream-5-0',
  'seedream-5-0-lite',
  'seedream-4-5',
  'veo-3-1-generate',
  'veo-3-1-fast-generate',
  'seedance-2-0',
  'seedance-2-0-fast',
  'seedance-1-0-pro-fast',
  'kling-2-1',
  'kling-3',
  'wan-2-7',
  'pika-mcp',
  'mochi-v1',
  'kokoro',
  'elevenlabs',
  'cartesia',
  'openai-tts',
  'gemini-tts',
  'hume-octave',
  'indextts',
  'whisperx-local',
  'auto-subs-local',
  'pexels',
  'pixabay',
  'storyblocks',
  'elevenlabs-music',
  'stable-audio',
]);
const ttsProviderSchema = z.enum([
  'kokoro',
  'elevenlabs',
  'cartesia',
  'openai-tts',
  'gemini-tts',
  'hume-octave',
  'indextts',
]);
const assetKeySchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/);
const htmlFrameKeySchema = z.string().regex(/^[\w][\w.-]*$/);
const rectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

const safeString = z
  .string()
  .max(4000)
  .refine((value) => !/(<script|javascript:|data:text\/html)/i.test(value), {
    message: 'Template text may not contain executable content',
  });
const safeHtmlSource = z
  .string()
  .max(2 * 1024 * 1024)
  .refine((value) => !/(javascript:|data:text\/html)/i.test(value), {
    message: 'Template HTML may not contain executable URL content',
  });

const subtitleStyleSchema = z.object({
  fontFamily: z.string().max(100).optional(),
  fontSize: z.number().int().min(8).max(160).optional(),
  color: z.string().max(40).optional(),
  background: z.string().max(40).optional(),
  position: z.enum(['top', 'middle', 'bottom']).optional(),
  animation: z
    .enum(['none', 'tiktok-word', 'hormozi-bold', 'classic', 'karaoke'])
    .optional(),
});

const timelineBookendSchema = z
  .object({
    kind: z.literal('fade'),
    durationMs: z.number().int().min(33).max(3000),
  })
  .strict();

const transitionSpecSchema = z
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

function supportsTransitionDirection(
  directions: readonly string[],
  direction: TransitionDirection,
): boolean {
  return directions.some((item) => item === direction);
}

const templateInputSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/),
  kind: z.enum(['text', 'longText', 'number', 'enum', 'asset', 'color']),
  label: z.string().min(1).max(120),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  enum: z.array(z.string().min(1).max(120)).max(20).optional(),
  assetKind: z.enum(['image', 'video', 'audio']).optional(),
});

const reframeOverrideSchema = z
  .object({
    aspect: aspectRatioSchema,
    anchor: z.enum(['left', 'center', 'right', 'top', 'bottom', 'top-third']),
    offsetPx: z.number().int().min(-5000).max(5000).optional(),
  })
  .strict();

const assetPlanSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('existing'),
    assetKey: assetKeySchema,
    trimMs: z
      .tuple([z.number().int().min(0), z.number().int().min(0)])
      .optional(),
  }),
  z.object({
    kind: z.literal('ai-image'),
    prompt: safeString.min(1),
    provider: providerIdSchema.optional(),
    aspectRatio: aspectRatioSchema.optional(),
    size: z.string().max(40).optional(),
    seed: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal('ai-clip'),
    prompt: safeString.min(1),
    refImageId: z.string().max(200).optional(),
    refImageTailId: z.string().max(200).optional(),
    provider: providerIdSchema.optional(),
    aspectRatio: aspectRatioSchema.optional(),
    durationMs: z.number().int().min(500).max(120000).optional(),
    seed: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal('broll-search'),
    query: safeString.min(1).max(400),
    provider: z.enum(['pexels', 'pixabay', 'storyblocks', 'linked']).optional(),
    pinnedHitId: z.string().max(200).optional(),
    sourceIds: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    kind: z.literal('tts-narration'),
    text: safeString.min(1),
    voiceId: z.string().max(200).optional(),
    provider: ttsProviderSchema.optional(),
  }),
  z.object({
    kind: z.literal('image-pan'),
    assetKey: assetKeySchema,
    kenBurns: z
      .object({
        from: rectSchema,
        to: rectSchema,
      })
      .optional(),
  }),
]);

const templateHtmlPayloadSchema = z
  .object({
    engine: z.enum(['html', 'remotion']),
    aspectRatio: aspectRatioSchema,
    durationSec: z.number().positive().max(900),
    contentGraph: ContentGraphSchema,
    frameHtml: z.record(htmlFrameKeySchema, safeHtmlSource),
    provenance: z
      .object({
        templateId: z.string().min(1).max(200).optional(),
        sourceUrls: z.array(z.string().url()).max(20).optional(),
        agentModel: z.string().min(1).max(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const VideoTemplateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,100}$/),
    displayName: safeString.min(1).max(120),
    category: z.enum([
      'shorts',
      'explainer',
      'ad',
      'tutorial',
      'product',
      'podcast',
      'testimonial',
      'recap',
      'announcement',
      'other',
      'custom',
    ]),
    thumbnailUrl: safeString.max(1000),
    durationSec: z.object({
      typical: z.number().int().min(1).max(900),
      min: z.number().int().min(1).max(900),
      max: z.number().int().min(1).max(900),
    }),
    aspectRatios: z.array(aspectRatioSchema).min(1).max(4),
    renderer: z.enum(['auto', 'ffmpeg', 'remotion', 'webcodecs']).optional(),
    compositionId: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,100}$/)
      .optional(),
    hook: z.enum([
      'punch-in',
      'question',
      'reveal',
      'pattern-interrupt',
      'cold-open',
    ]),
    pace: z.enum(['slow', 'medium', 'fast', 'extreme']),
    pricingHint: z.object({
      low: z.number().min(0).max(1000),
      high: z.number().min(0).max(1000),
    }),
    inputs: z.array(templateInputSchema).max(20),
    storyboardSeed: z.object({
      intent: safeString.min(1),
      scenes: z
        .array(
          z.object({
            durationMs: z.number().int().min(500).max(120000),
            intent: safeString.min(1),
            assetPlan: assetPlanSchema,
            caption: z
              .object({
                text: safeString.min(1),
                style: subtitleStyleSchema.optional(),
              })
              .optional(),
            transition: transitionSpecSchema.optional(),
            reframe: reframeOverrideSchema.optional(),
          }),
        )
        .min(1)
        .max(24),
      music: z
        .object({
          prompt: safeString.min(1),
          durationMs: z.number().int().min(1000).max(600000),
          provider: z.enum(['elevenlabs-music', 'stable-audio']).optional(),
          model: z.string().min(1).max(120).optional(),
          tempoBpm: z.number().int().min(40).max(240).optional(),
          mood: z.string().max(100).optional(),
          seed: z.number().int().optional(),
        })
        .optional(),
      intro: timelineBookendSchema.optional(),
      outro: timelineBookendSchema.optional(),
    }),
    html: templateHtmlPayloadSchema.optional(),
    styleDefaults: z.object({
      primaryColor: z.string().max(40).optional(),
      fontFamily: z.string().max(100).optional(),
      captionStyle: subtitleStyleSchema.optional(),
    }),
    providerHints: z.object({
      aiClip: providerIdSchema.optional(),
      aiImage: providerIdSchema.optional(),
      tts: providerIdSchema.optional(),
      lipsync: providerIdSchema.optional(),
    }),
    version: z.number().int().min(1).max(1000),
    source: z.enum(['builtin', 'community', 'custom']),
    authorHandle: z.string().max(120).optional(),
    license: z.enum(['CC0', 'CC-BY', 'proprietary']),
    projectTemplateId: z
      .enum([
        'product-reel',
        'explainer',
        'slideshow',
        'podcast',
        'ugc-ad',
        'custom',
      ])
      .optional(),
  })
  .refine(
    (template) => template.durationSec.min <= template.durationSec.typical,
  )
  .refine(
    (template) => template.durationSec.typical <= template.durationSec.max,
  )
  .refine((template) => template.pricingHint.low <= template.pricingHint.high)
  .refine(
    (template) =>
      template.renderer !== 'remotion' || Boolean(template.compositionId),
    'Remotion templates require a compositionId',
  );

export const TemplateInputValuesSchema = z.record(z.string(), z.unknown());

export const FromTemplateSchema = z.object({
  templateId: z.string().min(1),
  inputs: TemplateInputValuesSchema.default({}),
  name: z.string().min(1).max(120).optional(),
});

export const SaveAsTemplateSchema = z.object({
  displayName: z.string().min(1).max(120),
  category: z
    .enum([
      'shorts',
      'explainer',
      'ad',
      'tutorial',
      'product',
      'podcast',
      'testimonial',
      'recap',
      'announcement',
      'other',
      'custom',
    ])
    .default('custom'),
  license: z.enum(['CC0', 'CC-BY', 'proprietary']).default('proprietary'),
});
