import { z } from 'zod';

import { REFERENCE_READING_PROMPT_VERSION } from '@/shared/video/types';

const occurrenceSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    variation: z.string().max(500).optional(),
  })
  .strict();

export const referenceSystemSchema = z
  .object({
    id: z.string().min(1).max(80),
    role: z.string().min(1).max(80),
    content: z.string().min(1).max(2000),
    appearance: z.string().min(1).max(2000),
    spatial: z.string().min(1).max(2000),
    entry: z.string().min(1).max(2000),
    behavior: z.string().min(1).max(2000),
    persistence: z.string().min(1).max(2000),
    exit: z.string().min(1).max(2000),
    function: z.string().min(1).max(2000),
    occurrences: z.array(occurrenceSchema).min(1).max(40),
    evidenceIds: z.array(z.string().min(1)).min(1).max(40),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const referenceAnalysisSchema = z
  .object({
    intent: z.string().min(1).max(4000),
    arc: z.string().min(1).max(4000),
    thesis: z.string().min(1).max(4000),
    systems: z.array(referenceSystemSchema).min(1).max(16),
    openQuestions: z
      .array(
        z
          .object({
            question: z.string().min(1).max(500),
            atMs: z.number().int().nonnegative().optional(),
            note: z.string().max(500).optional(),
          })
          .strict(),
      )
      .max(24),
    observed: z.array(z.string().min(1).max(500)).max(40),
    inferred: z.array(z.string().min(1).max(500)).max(40),
    promptVersion: z
      .string()
      .min(1)
      .max(80)
      .default(REFERENCE_READING_PROMPT_VERSION),
  })
  .strict();

export const referenceTimelineSectionSchema = z
  .object({
    id: z.string().min(1).max(80),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    phase: z.string().min(1).max(200),
    anchor: z.string().max(500).optional(),
    activeSystems: z
      .array(
        z
          .object({
            systemId: z.string().min(1).max(80),
            note: z.string().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    effect: z.string().min(1).max(2000),
    evidenceIds: z.array(z.string().min(1)).min(1).max(40),
    confidence: z.number().min(0).max(1),
    overlapsWith: z.array(z.string().min(1).max(80)).max(16).optional(),
  })
  .strict();

export const referenceTimelineArtifactSchema = z
  .object({
    sections: z.array(referenceTimelineSectionSchema).min(1).max(24),
    coverage: z
      .object({
        totalMs: z.number().int().positive(),
        sampleCount: z.number().int().nonnegative(),
        maxGapMs: z.number().int().nonnegative(),
        thinRanges: z.array(
          z
            .object({
              startMs: z.number().int().nonnegative(),
              endMs: z.number().int().positive(),
            })
            .strict(),
        ),
        transcriptCoveredMs: z.number().int().nonnegative().optional(),
      })
      .strict(),
    promptVersion: z
      .string()
      .min(1)
      .max(80)
      .default(REFERENCE_READING_PROMPT_VERSION),
  })
  .strict();
