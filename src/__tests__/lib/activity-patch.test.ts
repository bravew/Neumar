import { describe, expect, it } from 'vitest';

import {
  applyActivityPatch,
  decodeJsonPointer,
} from '@/shared/lib/activity-patch';

const base = {
  phase: 'running',
  goal: 'Ship it',
  steps: [
    { id: 's1', description: 'Write it', status: 'pending' },
    { id: 's2', description: 'Test it', status: 'pending' },
  ],
};

describe('decodeJsonPointer', () => {
  it('decodes RFC 6901 escapes and the root pointer', () => {
    expect(decodeJsonPointer('')).toEqual([]);
    expect(decodeJsonPointer('/steps/0/description')).toEqual([
      'steps',
      '0',
      'description',
    ]);
    expect(decodeJsonPointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
  });

  it('rejects a relative path and a malformed escape', () => {
    expect(decodeJsonPointer('steps/0')).toBeUndefined();
    expect(decodeJsonPointer('/a~2b')).toBeUndefined();
  });
});

describe('applyActivityPatch', () => {
  it('replaces the phase, the patch the emitter sends at the end', () => {
    const result = applyActivityPatch(base, [
      { op: 'replace', path: '/phase', value: 'done' },
    ]);

    expect(result).toEqual({ ...base, phase: 'done' });
  });

  it('does not mutate the source content', () => {
    applyActivityPatch(base, [
      { op: 'replace', path: '/phase', value: 'done' },
    ]);

    expect(base.phase).toBe('running');
  });

  it('applies array insert, remove, and replace', () => {
    const result = applyActivityPatch(base, [
      { op: 'replace', path: '/steps/0/status', value: 'completed' },
      { op: 'add', path: '/steps/1', value: { id: 's3', status: 'pending' } },
      { op: 'remove', path: '/steps/0' },
    ]);

    expect(result?.steps).toEqual([
      { id: 's3', status: 'pending' },
      { id: 's2', description: 'Test it', status: 'pending' },
    ]);
  });

  it('supports add at the end with "-", copy, move, and test', () => {
    const result = applyActivityPatch(base, [
      { op: 'test', path: '/phase', value: 'running' },
      { op: 'copy', from: '/goal', path: '/title' },
      { op: 'move', from: '/title', path: '/subtitle' },
      { op: 'add', path: '/steps/-', value: { id: 's3', status: 'pending' } },
    ]);

    expect(result).toMatchObject({
      subtitle: 'Ship it',
      steps: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
    });
    expect(result).not.toHaveProperty('title');
  });

  it.each([
    ['a non-array patch', {}],
    ['a non-object operation', ['replace']],
    ['an unknown op', [{ op: 'invert', path: '/phase', value: 'done' }]],
    ['a relative path', [{ op: 'replace', path: 'phase', value: 'done' }]],
    [
      'a missing replace target',
      [{ op: 'replace', path: '/missing', value: 1 }],
    ],
    ['a replace without a value', [{ op: 'replace', path: '/phase' }]],
    ['an out-of-range array index', [{ op: 'remove', path: '/steps/9' }]],
    ['a non-canonical array index', [{ op: 'remove', path: '/steps/01' }]],
    ['a failing test', [{ op: 'test', path: '/phase', value: 'done' }]],
    ['a remove of the document root', [{ op: 'remove', path: '' }]],
  ])('rejects %s', (_name, patch) => {
    expect(applyActivityPatch(base, patch)).toBeUndefined();
  });

  it('rejects a patch that reaches the object prototype', () => {
    const result = applyActivityPatch(base, [
      { op: 'add', path: '/__proto__/polluted', value: true },
    ]);

    expect(result).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
