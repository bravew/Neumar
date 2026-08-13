import { z } from 'zod';

const GenUIMediaKindSchema = z.enum(['image', 'video', 'audio']);
const GenUIStatusToneSchema = z.enum([
  'pending',
  'running',
  'success',
  'error',
  'warning',
  'info',
]);
const GenUIHttpUrlSchema = z
  .string()
  .url()
  .regex(/^https?:\/\//i);

const GenUITableColumnSchema = z.union([
  z.string(),
  z.object({ key: z.string(), label: z.string().optional() }),
]);
const GenUITableRowSchema = z.union([
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

export const GenUIMediaCardSchema = z.object({
  $genui: z.literal('MediaCard'),
  props: z.object({
    title: z.string().optional(),
    path: z.string().optional(),
    url: z.string().optional(),
    mime: z.string().optional(),
    kind: GenUIMediaKindSchema.optional(),
    caption: z.string().optional(),
  }),
});

export const GenUIFileCardSchema = z.object({
  $genui: z.literal('FileCard'),
  props: z.object({
    title: z.string().optional(),
    path: z.string().optional(),
    url: GenUIHttpUrlSchema.optional(),
    mime: z.string().optional(),
    description: z.string().optional(),
    sizeBytes: z.number().finite().nonnegative().optional(),
  }),
});

export const GenUILinkCardSchema = z.object({
  $genui: z.literal('LinkCard'),
  props: z.object({
    title: z.string().optional(),
    href: GenUIHttpUrlSchema,
    description: z.string().optional(),
  }),
});

export const GenUIStatusCardSchema = z.object({
  $genui: z.literal('StatusCard'),
  props: z.object({
    title: z.string().optional(),
    status: GenUIStatusToneSchema.optional(),
    detail: z.string().optional(),
  }),
});

export const GenUITableCardSchema = z.object({
  $genui: z.literal('TableCard'),
  props: z.object({
    title: z.string().optional(),
    columns: z.array(GenUITableColumnSchema).min(1),
    rows: z.array(GenUITableRowSchema),
    caption: z.string().optional(),
  }),
});

export const GenUIEnvelopeSchema = z.discriminatedUnion('$genui', [
  GenUIMediaCardSchema,
  GenUIFileCardSchema,
  GenUILinkCardSchema,
  GenUIStatusCardSchema,
  GenUITableCardSchema,
]);

export type GenUIEnvelope = z.infer<typeof GenUIEnvelopeSchema>;
export type GenUIMediaCard = z.infer<typeof GenUIMediaCardSchema>;
export type GenUIFileCard = z.infer<typeof GenUIFileCardSchema>;
export type GenUILinkCard = z.infer<typeof GenUILinkCardSchema>;
export type GenUIStatusCard = z.infer<typeof GenUIStatusCardSchema>;
export type GenUITableCard = z.infer<typeof GenUITableCardSchema>;
export type GenUITableColumn = z.infer<typeof GenUITableColumnSchema>;
export type GenUITableRow = z.infer<typeof GenUITableRowSchema>;

export function parseGenUIEnvelope(value: unknown): GenUIEnvelope | null {
  const candidate = typeof value === 'string' ? parseJsonObject(value) : value;
  const parsed = GenUIEnvelopeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function parseJsonObject(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try {
    return JSON.parse(fenced?.[1] ?? trimmed);
  } catch {
    return null;
  }
}
