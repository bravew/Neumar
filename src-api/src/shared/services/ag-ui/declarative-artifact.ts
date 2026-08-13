import { z } from 'zod';

export const A2UI_VERSION = 'neuma/a2ui-v0.9-subset';

const DeclarativeNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    type: z.enum([
      'Card',
      'Stack',
      'Heading',
      'Text',
      'Code',
      'Link',
      'List',
      'Form',
      'TextField',
      'TextArea',
      'Select',
      'Checkbox',
      'RadioGroup',
      'Tabs',
      'Button',
    ]),
    text: z.string().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(DeclarativeNodeSchema).optional(),
  }),
);

export const DeclarativeArtifactSchema = z.object({
  version: z.literal(A2UI_VERSION),
  root: DeclarativeNodeSchema,
  actions: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        variant: z.enum(['primary', 'secondary', 'destructive']).optional(),
      }),
    )
    .optional(),
});

export function validateDeclarativeArtifact(value: unknown): {
  ok: boolean;
  issues: string[];
} {
  const result = DeclarativeArtifactSchema.safeParse(value);
  if (result.success) return { ok: true, issues: [] };
  return {
    ok: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
    ),
  };
}
