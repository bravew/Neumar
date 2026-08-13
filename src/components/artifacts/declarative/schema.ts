import { z } from 'zod';

export const A2UI_VERSION = 'neuma/a2ui-v0.9-subset';

const PrimitiveSchema = z.union([z.string(), z.number(), z.boolean()]);

export const DeclarativeActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  variant: z.enum(['primary', 'secondary', 'destructive']).optional(),
});

export type DeclarativeNodeType =
  | 'Card'
  | 'Stack'
  | 'Heading'
  | 'Text'
  | 'Code'
  | 'Link'
  | 'List'
  | 'Form'
  | 'TextField'
  | 'TextArea'
  | 'Select'
  | 'Checkbox'
  | 'RadioGroup'
  | 'Tabs'
  | 'Button';

export interface DeclarativeNode {
  type: DeclarativeNodeType;
  props?: Record<string, unknown> & {
    items?: Array<z.infer<typeof PrimitiveSchema>>;
  };
  text?: string;
  children?: DeclarativeNode[];
}

const DeclarativeNodeSchema: z.ZodType<DeclarativeNode> = z.lazy(() =>
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
  actions: z.array(DeclarativeActionSchema).optional(),
});

export type DeclarativeArtifactSpec = z.infer<typeof DeclarativeArtifactSchema>;

export function parseDeclarativeArtifact(
  content: string,
): DeclarativeArtifactSpec {
  return DeclarativeArtifactSchema.parse(JSON.parse(content));
}
