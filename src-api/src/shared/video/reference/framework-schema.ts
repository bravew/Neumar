import { z } from 'zod';

import { FRAMEWORK_SECTION_ROLES } from '@/shared/video/types';

const aspectSchema = z.enum(['16:9', '9:16', '1:1', '4:5']);

const fallbackSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('ai-image'),
      promptTemplate: z.string().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('ai-clip'),
      promptTemplate: z.string().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('broll-search'),
      queryTemplate: z.string().min(1).max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tts-narration'),
      textTemplate: z.string().min(1).max(2000),
    })
    .strict(),
  z.object({ kind: z.literal('ask-user') }).strict(),
]);

export const frameworkSlotSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.string().min(1).max(80),
    constraints: z
      .object({
        minDurationMs: z.number().int().positive().optional(),
        aspect: z.array(aspectSchema).max(4).optional(),
        requiresSpeech: z.boolean().optional(),
        requiresMotion: z.boolean().optional(),
        subject: z.string().max(200).optional(),
      })
      .strict(),
    fallback: fallbackSchema,
    required: z.boolean(),
  })
  .strict();

export const frameworkSectionSchema = z
  .object({
    id: z.string().min(1).max(80),
    role: z.enum(FRAMEWORK_SECTION_ROLES),
    purpose: z.string().min(1).max(2000),
    timing: z
      .object({
        proportion: z.number().min(0).max(1),
        minMs: z.number().int().nonnegative(),
        maxMs: z.number().int().positive(),
        observedMs: z.number().int().nonnegative(),
      })
      .strict(),
    slots: z.array(frameworkSlotSchema).min(1).max(4),
    systemIds: z.array(z.string().min(1).max(80)).max(16),
    pacing: z
      .object({
        cutsPerMinute: z.number().min(0),
        shortestHoldMs: z.number().int().nonnegative(),
        longestHoldMs: z.number().int().nonnegative(),
      })
      .strict(),
    confidence: z.number().min(0).max(1),
    derivedFromSectionIds: z.array(z.string().min(1).max(80)).min(1).max(24),
  })
  .strict();

export const frameworkSystemSchema = z
  .object({
    id: z.string().min(1).max(80),
    role: z.string().min(1).max(80),
    behavior: z
      .object({
        entry: z.string().min(1).max(500),
        active: z.string().min(1).max(500),
        exit: z.string().min(1).max(500),
      })
      .strict(),
    style: z
      .object({
        fontFamily: z.string().max(80).optional(),
        palette: z.array(z.string().max(40)).max(8).optional(),
      })
      .strict()
      .optional(),
    spans: z.array(z.string().min(1).max(80)).min(1).max(24),
  })
  .strict();

export const videoFrameworkSchema = z
  .object({
    id: z.string().min(1).max(80),
    version: z.literal(1),
    displayName: z.string().min(1).max(120),
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
    hook: z.enum([
      'punch-in',
      'question',
      'reveal',
      'pattern-interrupt',
      'cold-open',
    ]),
    pace: z.enum(['slow', 'medium', 'fast', 'extreme']),
    aspectRatios: z.array(aspectSchema).min(1).max(4),
    totalDuration: z
      .object({
        typicalMs: z.number().int().positive(),
        minMs: z.number().int().positive(),
        maxMs: z.number().int().positive(),
      })
      .strict(),
    sections: z.array(frameworkSectionSchema).min(1).max(16),
    systems: z.array(frameworkSystemSchema).max(16),
    audio: z
      .object({
        bedCharacter: z.string().min(1).max(200),
        duckingUnderSpeech: z.boolean(),
        tempoBpm: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    provenance: z
      .object({
        referenceId: z.string().min(1).max(100),
        referenceUrl: z.string().max(2000).optional(),
        derivedFromArtifacts: z.array(z.string().min(1)).max(24),
        extractedBy: z.string().min(1).max(80),
        extractedAt: z.string().min(1).max(40),
      })
      .strict(),
    confidence: z.number().min(0).max(1),
  })
  .strict();
