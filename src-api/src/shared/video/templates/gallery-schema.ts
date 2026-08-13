import { z } from 'zod';

// Neuma port of html-video's `template.html-video.yaml` schema (RFC-02 + RFC-07
// provenance). Named `template.video.yaml` here. Keep field names verbatim
// (`spec_version`, `engine`, `source_entry`, snake_case nested keys) so future
// syncs against `_sample/html-video/templates/*` diff cleanly.
//
// See dev-doc/html-video/06-05/03-template-gallery-and-provenance.md.

const SlugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w][\w.-]*$/, 'Template ids must be slug-safe: ^[\\w][\\w.-]*$');

const ResolutionSchema = z
  .object({
    width: z.number().int().positive().max(7680),
    height: z.number().int().positive().max(4320),
  })
  .strict();

const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1', '4:5', '4:3', '21:9']);

const TemplateOutputSchema = z
  .object({
    formats: z
      .array(z.enum(['mp4', 'webm', 'webm-alpha', 'png-sequence']))
      .min(1),
    default_format: z.enum(['mp4', 'webm', 'webm-alpha', 'png-sequence']),
    resolution: z
      .object({
        default: ResolutionSchema,
        supported_aspects: z.array(AspectRatioSchema).min(1),
      })
      .strict(),
    fps: z
      .object({
        default: z.number().int().positive().max(120),
        supported: z.array(z.number().int().positive().max(120)).min(1),
      })
      .strict(),
    duration: z
      .object({
        type: z.enum(['variable', 'fixed']),
        min_sec: z.number().positive().optional(),
        max_sec: z.number().positive().optional(),
        fixed_sec: z.number().positive().optional(),
      })
      .strict(),
    alpha: z.boolean(),
    audio: z
      .object({
        supported: z.boolean(),
        expected_inputs: z
          .array(z.enum(['bgm', 'narration', 'sfx']))
          .optional(),
      })
      .strict(),
  })
  .strict()
  .refine((o) => o.formats.includes(o.default_format), {
    message: 'output.default_format must be listed in output.formats',
    path: ['default_format'],
  })
  .refine((o) => o.fps.supported.includes(o.fps.default), {
    message: 'output.fps.default must be listed in output.fps.supported',
    path: ['fps', 'default'],
  });

/**
 * JSON Schema (Draft 2020-12) lives untyped here on purpose: it is consumed
 * by a separate validator (Phase 3 M3 form-spec mapper) and validated at the
 * boundary. The Zod schema only asserts the wrapper shape.
 */
const TemplateInputsSchema = z
  .object({
    schema: z.record(z.string(), z.unknown()),
    examples: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .strict();

const TemplateNativeSchema = z
  .object({
    compositionId: z.string().min(1),
  })
  .strict();

export const TemplateLicenseSchema = z
  .object({
    /**
     * SPDX identifier. Required so the agent/gallery can filter at selection
     * time rather than at deploy time (RFC-07 § license drift).
     */
    spdx: z.string().min(1),
    attribution_required: z.boolean(),
    redistribution_allowed: z.boolean(),
    commercial_use: z.boolean(),
  })
  .strict();

const ProvenanceOriginSchema = z
  .object({
    name: z.string().optional(),
    kind: z.enum([
      'design-studio',
      'designer',
      'studio',
      'person',
      'movement',
      'in-house',
      'none',
      'unknown',
    ]),
    reference: z.string().optional(),
  })
  .strict();

const ProvenanceViaSkillSchema = z
  .object({
    name: z.string(),
    author: z.string(),
    url: z.string().url(),
    license: z.string(),
    source_file: z.string().optional(),
  })
  .strict();

export const TemplateProvenanceSchema = z
  .object({
    origin: ProvenanceOriginSchema,
    via_skill: ProvenanceViaSkillSchema.optional(),
    transformation: z.string().min(1),
  })
  .strict();

const TemplateAuthorSchema = z
  .object({
    name: z.string(),
    url: z.string().url().optional(),
    contact: z.string().optional(),
  })
  .strict();

export const TemplateMetadataSchema = z
  .object({
    spec_version: z.literal(1),
    id: SlugSchema,
    name: z.string().min(1),
    description: z.string().optional(),
    engine: z.string().min(1),
    engine_version: z.string().optional(),
    source_entry: z.string().min(1),
    native: TemplateNativeSchema.optional(),
    category: z.string().min(1),
    subcategory: z.string().optional(),
    tags: z.array(z.string()).default([]),
    best_for: z.array(z.string()).optional(),
    not_for: z.array(z.string()).optional(),
    output: TemplateOutputSchema,
    inputs: TemplateInputsSchema,
    license: TemplateLicenseSchema,
    provenance: TemplateProvenanceSchema.optional(),
    author: TemplateAuthorSchema.optional(),
    version: z.string().min(1),
    changelog: z
      .union([
        z.string(),
        z.array(
          z
            .object({
              version: z.string().min(1),
              date: z.string().min(1),
              notes: z.string().min(1),
            })
            .strict(),
        ),
      ])
      .optional(),
    preview: z
      .union([
        z.string(),
        z
          .object({
            poster: z.string().optional(),
            loop: z.string().optional(),
            thumbnail: z.string().optional(),
          })
          .strict(),
      ])
      .optional(),
    performance: z
      .object({
        reference_render: z
          .object({
            duration_sec: z.number().positive().optional(),
            wallclock_sec: z.number().positive().optional(),
            render_wall_clock_sec: z.number().positive().optional(),
            host: z.string().optional(),
            machine: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type TemplateMetadata = z.infer<typeof TemplateMetadataSchema>;
export type TemplateLicense = z.infer<typeof TemplateLicenseSchema>;
export type TemplateProvenance = z.infer<typeof TemplateProvenanceSchema>;
