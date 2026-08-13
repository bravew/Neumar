import { describe, expect, it } from 'vitest';

import type { GalleryTemplate } from '@/shared/video/templates/gallery-loader';
import {
  inspectTemplate,
  searchTemplates,
} from '@/shared/video/templates/search';

function template(
  id: string,
  overrides: Partial<GalleryTemplate['metadata']> = {},
): GalleryTemplate {
  const meta: GalleryTemplate['metadata'] = {
    spec_version: 1 as const,
    id,
    name: id,
    description: `${id} description`,
    engine: 'html',
    source_entry: 'source/index.html',
    category: 'data-viz',
    tags: ['chart'],
    output: {
      formats: ['mp4'],
      default_format: 'mp4',
      resolution: {
        default: { width: 1920, height: 1080 },
        supported_aspects: ['16:9'],
      },
      fps: { default: 30, supported: [30] },
      duration: { type: 'variable', min_sec: 3, max_sec: 60 },
      alpha: false,
      audio: { supported: false },
    },
    inputs: { schema: { type: 'object' } },
    license: {
      spdx: 'Apache-2.0',
      attribution_required: false,
      redistribution_allowed: true,
      commercial_use: true,
    },
    version: '0.1.0',
    ...overrides,
  };
  return {
    id,
    rootKind: 'branding',
    rootDir: '/tmp',
    metadataPath: `/tmp/${id}/template.video.yaml`,
    warnings: [],
    metadata: meta,
  };
}

describe('searchTemplates', () => {
  const ts = [
    template('frame-data-bars', {
      category: 'data-viz',
      tags: ['chart', 'bar'],
    }),
    template('frame-bullet-list', {
      category: 'explainer',
      tags: ['list', 'bullets'],
    }),
    template('frame-bold-title', {
      category: 'intro-outro',
      tags: ['title'],
      license: {
        spdx: 'CC-BY-NC-4.0',
        attribution_required: true,
        redistribution_allowed: true,
        commercial_use: false,
      },
    }),
  ];

  it('returns all templates with no filters + score reasons', () => {
    const result = searchTemplates(ts);
    expect(result.templates.map((t) => t.id).sort()).toEqual([
      'frame-bold-title',
      'frame-bullet-list',
      'frame-data-bars',
    ]);
    expect(result.filteredOut).toEqual([]);
    expect(result.templates[0]?.scoreReason).toMatch(/all filters passed/);
  });

  it('filters by category', () => {
    const result = searchTemplates(ts, { category: 'explainer' });
    expect(result.templates.map((t) => t.id)).toEqual(['frame-bullet-list']);
    expect(result.filteredOut).toHaveLength(2);
  });

  it('requires ALL tags to match', () => {
    const result = searchTemplates(ts, { tags: ['chart', 'bar'] });
    expect(result.templates.map((t) => t.id)).toEqual(['frame-data-bars']);
    const bulletOut = result.filteredOut.find(
      (f) => f.id === 'frame-bullet-list',
    );
    expect(bulletOut?.reason).toMatch(/missing required tag/);
  });

  it('substring search across name + description + tags (case-insensitive)', () => {
    const result = searchTemplates(ts, { search: 'BULLET' });
    expect(result.templates.map((t) => t.id)).toEqual(['frame-bullet-list']);
    expect(result.templates[0]?.scoreReason).toMatch(/matches "BULLET"/);
  });

  it('license gate filters non-commercial when requireCommercialUse=true', () => {
    const result = searchTemplates(ts, { requireCommercialUse: true });
    expect(result.templates.map((t) => t.id).sort()).toEqual([
      'frame-bullet-list',
      'frame-data-bars',
    ]);
    const boldOut = result.filteredOut.find((f) => f.id === 'frame-bold-title');
    expect(boldOut?.reason).toMatch(/does not permit commercial use/);
  });

  it('combines filters (engine + tags + commercial)', () => {
    const result = searchTemplates(ts, {
      engine: 'html',
      tags: ['chart'],
      requireCommercialUse: true,
    });
    expect(result.templates.map((t) => t.id)).toEqual(['frame-data-bars']);
  });

  it('produces a single filteredOut entry per template (no double-rejection)', () => {
    const result = searchTemplates(ts, {
      category: 'intro-outro',
      requireCommercialUse: true,
    });
    expect(
      result.filteredOut.find((f) => f.id === 'frame-bold-title'),
    ).toBeDefined();
    expect(
      result.filteredOut.filter((f) => f.id === 'frame-bold-title'),
    ).toHaveLength(1);
  });
});

describe('inspectTemplate', () => {
  it('returns metadata + formSpec + classified provenance + examples', () => {
    const t = template('frame-data-bars', {
      inputs: {
        schema: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', maxLength: 100 },
          },
        },
        examples: [{ title: 'Demo' }],
      },
      provenance: {
        origin: { kind: 'in-house' },
        transformation: 'original design',
      },
    });
    const result = inspectTemplate(t);
    expect(result.metadata.id).toBe('frame-data-bars');
    expect(result.formSpec.fields[0]?.kind).toBe('text');
    expect(result.provenanceStatus).toBe('in-house');
    expect(result.examples).toEqual([{ title: 'Demo' }]);
  });

  it('classifies derived templates: verified when via_skill is present', () => {
    const t = template('frame-derived', {
      provenance: {
        origin: { kind: 'design-studio', name: 'Studio' },
        via_skill: {
          name: 'open-source-skill',
          author: 'contrib',
          url: 'https://example.com/skill',
          license: 'MIT',
        },
        transformation: 're-typed, re-coloured',
      },
    });
    expect(inspectTemplate(t).provenanceStatus).toBe('derived-verified');
  });

  it('classifies missing provenance as derived-unverified', () => {
    const t = template('frame-naked');
    expect(inspectTemplate(t).provenanceStatus).toBe('derived-unverified');
  });
});
