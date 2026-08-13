import { describe, expect, it } from 'vitest';

import {
  inspectCatalogPlugin,
  parseEvals,
  skillDirsFromManifest,
  workflowFromManifest,
} from '@/shared/plugins/inspect';

describe('skillDirsFromManifest', () => {
  it('derives skill dirs from Open Design compat.agentSkills', () => {
    expect(
      skillDirsFromManifest({
        compat: {
          agentSkills: [{ path: './SKILL.md' }, { path: 'sub/SKILL.md' }],
        },
      }),
    ).toEqual(['.', 'sub']);
  });

  it('always probes the root and tolerates a missing manifest', () => {
    expect(skillDirsFromManifest(null)).toEqual(['.']);
    expect(skillDirsFromManifest({})).toEqual(['.']);
  });
});

describe('parseEvals', () => {
  it('reads a { cases: [...] } object', () => {
    expect(
      parseEvals({ cases: [{ name: 'happy-path' }, { id: 'edge' }] }),
    ).toEqual({ count: 2, cases: ['happy-path', 'edge'] });
  });

  it('reads a bare array and a plain object', () => {
    expect(parseEvals(['a', 'b', 'c'])).toEqual({
      count: 3,
      cases: ['a', 'b', 'c'],
    });
    expect(parseEvals({ 'happy-path': {}, perf: {} })).toEqual({
      count: 2,
      cases: ['happy-path', 'perf'],
    });
  });

  it('returns undefined for empty / missing evals', () => {
    expect(parseEvals(null)).toBeUndefined();
    expect(parseEvals(undefined)).toBeUndefined();
  });
});

describe('workflowFromManifest', () => {
  it('extracts Open Design od workflow fields', () => {
    expect(
      workflowFromManifest({
        od: {
          mode: 'video',
          scenario: 'video',
          kind: 'scenario',
          inputs: [{ label: 'Format' }, { name: 'duration' }],
          pipeline: { stages: [{ id: 'generate' }, { id: 'critique' }] },
          capabilities: ['prompt:inject', 'fs:write'],
        },
      }),
    ).toEqual({
      mode: 'video',
      scenario: 'video',
      kind: 'scenario',
      inputs: ['Format', 'duration'],
      pipeline: ['generate', 'critique'],
      capabilities: ['prompt:inject', 'fs:write'],
    });
  });

  it('returns undefined without an od block', () => {
    expect(workflowFromManifest({ name: 'x' })).toBeUndefined();
  });
});

describe('inspectCatalogPlugin', () => {
  it('is not inspectable for non-github sources (no network)', async () => {
    const inspection = await inspectCatalogPlugin(
      { source: 'url', url: 'https://example.com/plugin.zip' },
      'https://raw.githubusercontent.com/o/r/main/m.json',
    );
    expect(inspection).toEqual({ inspectable: false, skills: [] });
  });
});
