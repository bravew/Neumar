import { describe, expect, it } from 'vitest';

import { TemplateMetadataSchema } from '@/shared/video/templates/gallery-schema';
import { lintTemplateProvenance } from '@/shared/video/templates/provenance-lint';

const sampleMeta = {
  spec_version: 1 as const,
  id: 'frame-editorial-anchor',
  name: 'Editorial Anchor',
  description: 'Bold editorial frame',
  engine: 'html',
  engine_version: '^0.4.0',
  source_entry: 'source/index.html',
  category: 'data-viz',
  tags: ['editorial'],
  output: {
    formats: ['mp4' as const],
    default_format: 'mp4' as const,
    resolution: {
      default: { width: 1920, height: 1080 },
      supported_aspects: ['16:9' as const],
    },
    fps: { default: 30, supported: [30, 60] },
    duration: { type: 'variable' as const, min_sec: 5, max_sec: 20 },
    alpha: false,
    audio: { supported: true, expected_inputs: ['bgm' as const] },
  },
  inputs: {
    schema: {
      type: 'object',
      required: ['title'],
      properties: { title: { type: 'string', maxLength: 100 } },
    },
  },
  license: {
    spdx: 'Apache-2.0',
    attribution_required: false,
    redistribution_allowed: true,
    commercial_use: true,
  },
  provenance: {
    origin: { kind: 'in-house' as const },
    transformation: 'Original design.',
  },
  version: '0.1.0',
};

describe('template gallery schema', () => {
  it('accepts a minimal in-house template', () => {
    const parsed = TemplateMetadataSchema.safeParse(sampleMeta);
    expect(parsed.success).toBe(true);
  });

  it('accepts a native Remotion template with sample-compatible metadata', () => {
    const parsed = TemplateMetadataSchema.safeParse({
      ...sampleMeta,
      id: 'frame-data-rollup',
      name: 'Data Rollup',
      engine: 'remotion',
      source_entry: 'source/entry.ts',
      native: { compositionId: 'DataRollup' },
      inputs: {
        schema: {
          type: 'object',
          required: ['data'],
          properties: {
            data: {
              type: 'object',
              required: ['items'],
              properties: {
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['label', 'value'],
                    properties: {
                      label: { type: 'string' },
                      value: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
        examples: [
          {
            data: {
              title: 'This week',
              items: [{ label: 'Mon', value: 1200 }],
            },
          },
        ],
      },
      provenance: {
        origin: { name: 'none', kind: 'none' as const },
        via_skill: {
          name: 'none',
          author: 'nexu-io',
          url: 'https://github.com/nexu-io/html-video',
          license: 'Apache-2.0',
          source_file: '(original)',
        },
        transformation: 'Original Remotion React-tsx composition.',
      },
      changelog: [
        {
          version: '0.1.0',
          date: '2026-06-07',
          notes: 'First native Remotion template.',
        },
      ],
      preview: { poster: 'preview.png' },
      performance: {
        reference_render: {
          duration_sec: 5,
          render_wall_clock_sec: 45,
          machine: 'M2 MacBook Air',
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unsafe template ids', () => {
    const bad = { ...sampleMeta, id: '../escape' };
    const parsed = TemplateMetadataSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it('rejects output.default_format that is not in output.formats', () => {
    const bad = {
      ...sampleMeta,
      output: {
        ...sampleMeta.output,
        formats: ['mp4' as const],
        default_format: 'webm' as const,
      },
    };
    const parsed = TemplateMetadataSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });
});

describe('provenance lint', () => {
  it('passes a clean in-house template', () => {
    const result = lintTemplateProvenance(sampleMeta);
    expect(result.ok).toBe(true);
  });

  it('flags derived templates without via_skill', () => {
    const derived = {
      ...sampleMeta,
      provenance: {
        origin: { kind: 'design-studio' as const, name: 'Anon' },
        transformation: 'derived',
      },
    };
    const result = lintTemplateProvenance(derived);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('derived-template-missing-via-skill');
  });

  it('flags reserved studio names in the id', () => {
    const bad = { ...sampleMeta, id: 'frame-pentagram-stat' };
    const result = lintTemplateProvenance(bad);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'studio-name-in-id')).toBe(
      true,
    );
  });
});
