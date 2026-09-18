import { describe, expect, it } from 'vitest';

import {
  frameworkToTemplate,
  searchVideoTemplates,
} from '@/shared/video/reference/materialize';
import { videoTemplateInputsToFormSpec } from '@/shared/video/templates/form-mapper';
import { VideoTemplateSchema } from '@/shared/video/templates/validator';
import type { VideoFramework } from '@/shared/video/types';

const FRAMEWORK: VideoFramework = {
  id: 'fw-1',
  version: 1,
  displayName: 'Explainer spine',
  category: 'explainer',
  hook: 'cold-open',
  pace: 'medium',
  aspectRatios: ['16:9'],
  totalDuration: { typicalMs: 4000, minMs: 2400, maxMs: 7200 },
  sections: [
    {
      id: 'fw-hook',
      role: 'hook',
      purpose: 'Orient the viewer.',
      timing: {
        proportion: 0.25,
        minMs: 600,
        maxMs: 1800,
        observedMs: 1000,
      },
      slots: [
        {
          id: 'slot-hook',
          kind: 'a-roll',
          constraints: {},
          fallback: { kind: 'ask-user' },
          required: true,
        },
      ],
      systemIds: [],
      pacing: { cutsPerMinute: 0, shortestHoldMs: 1000, longestHoldMs: 1000 },
      confidence: 0.8,
      derivedFromSectionIds: ['sec-1'],
    },
    {
      id: 'fw-proof',
      role: 'demonstration',
      purpose: 'Show the method.',
      timing: {
        proportion: 0.75,
        minMs: 1800,
        maxMs: 5400,
        observedMs: 3000,
      },
      slots: [
        {
          id: 'slot-broll',
          kind: 'b-roll',
          constraints: {},
          fallback: {
            kind: 'ai-clip',
            promptTemplate: 'screen recording of the workflow',
          },
          required: false,
        },
      ],
      systemIds: [],
      pacing: { cutsPerMinute: 4, shortestHoldMs: 400, longestHoldMs: 1200 },
      confidence: 0.7,
      derivedFromSectionIds: ['sec-2'],
    },
  ],
  systems: [],
  provenance: {
    referenceId: 'ref-read1',
    derivedFromArtifacts: ['analysis', 'timeline'],
    extractedBy: 'test',
    extractedAt: '2026-09-15T00:00:00.000Z',
  },
  confidence: 0.7,
};

describe('frameworkToTemplate', () => {
  it('maps sections, durations, slots, and ask-user inputs', () => {
    const template = frameworkToTemplate(FRAMEWORK, {
      targetMs: 8000,
      thumbnailUrl: 'templates/thumbnails/x.svg',
    });
    expect(template.source).toBe('custom');
    expect(template.storyboardSeed.scenes).toHaveLength(2);
    expect(template.storyboardSeed.scenes[0]?.durationMs).toBe(2000);
    expect(template.storyboardSeed.scenes[1]?.durationMs).toBe(6000);
    expect(template.storyboardSeed.scenes[0]?.role).toBe('hook');
    expect(template.storyboardSeed.scenes[0]?.assetPlan.kind).toBe('existing');
    expect(template.storyboardSeed.scenes[1]?.assetPlan).toMatchObject({
      kind: 'ai-clip',
      prompt: 'screen recording of the workflow',
    });
    const required = template.inputs.filter((item) => item.required);
    expect(required.length).toBeGreaterThan(0);
    expect(required[0]?.kind).toBe('asset');
    expect(template.frameworkProvenance?.referenceId).toBe('ref-read1');
    const spec = videoTemplateInputsToFormSpec(template.inputs);
    expect(spec.fields.some((field) => field.kind === 'assetPicker')).toBe(
      true,
    );
    expect(VideoTemplateSchema.parse(template).id).toBe(template.id);
  });

  it('filters templates by role and source reference', () => {
    const template = frameworkToTemplate(FRAMEWORK, {
      thumbnailUrl: 'templates/thumbnails/x.svg',
    });
    expect(searchVideoTemplates([template], { role: 'hook' })).toEqual([
      template,
    ]);
    expect(searchVideoTemplates([template], { role: 'cta' })).toEqual([]);
    expect(
      searchVideoTemplates([template], { referenceId: 'ref-read1' }),
    ).toEqual([template]);
    expect(searchVideoTemplates([template], { referenceId: 'other' })).toEqual(
      [],
    );
  });
});
