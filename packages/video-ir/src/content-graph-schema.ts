import { z } from 'zod';

// Zod schemas for the content-graph IR. The IR is permissive about node
// payloads (entity props are free-form, data nodes carry unknown JSON) but
// strict about structure (ids, edges, intent enum).

export const ContentGraphNodeIdSchema = z
  .string()
  .min(1)
  .regex(/^[\w][\w.-]*$/, 'Node ids must be slug-safe: ^[\\w][\\w.-]*$');

const BaseNodeShape = {
  id: ContentGraphNodeIdSchema,
  label: z.string().optional(),
  frameIntent: z.string().optional(),
  durationSec: z.number().positive().max(600).optional(),
};

export const ContentGraphEntityNodeSchema = z
  .object({
    ...BaseNodeShape,
    kind: z.literal('entity'),
    props: z.record(z.string(), z.unknown()),
  })
  .strict();

export const ContentGraphDataNodeSchema = z
  .object({
    ...BaseNodeShape,
    kind: z.literal('data'),
    data: z.unknown(),
  })
  .strict();

export const ContentGraphTextNodeSchema = z
  .object({
    ...BaseNodeShape,
    kind: z.literal('text'),
    text: z.string(),
  })
  .strict();

export const ContentGraphNodeSchema = z.discriminatedUnion('kind', [
  ContentGraphEntityNodeSchema,
  ContentGraphDataNodeSchema,
  ContentGraphTextNodeSchema,
]);

export const ContentGraphEdgeKindSchema = z.enum([
  'sequence',
  'contrast',
  'dependency',
]);

export const ContentGraphEdgeSchema = z
  .object({
    from: ContentGraphNodeIdSchema,
    to: ContentGraphNodeIdSchema,
    kind: ContentGraphEdgeKindSchema,
    reason: z.string().optional(),
  })
  .strict();

export const ContentGraphIntentSchema = z.enum([
  'single-frame',
  'explainer',
  'data-viz',
  'promo',
  'comparison',
  'other',
]);

export const ContentGraphSchema = z
  .object({
    schemaVersion: z.literal(1),
    intent: ContentGraphIntentSchema,
    synopsis: z.string().optional(),
    nodes: z.array(ContentGraphNodeSchema),
    edges: z.array(ContentGraphEdgeSchema),
  })
  .strict();
