import { describe, expect, it } from 'vitest';

import {
  initialManualEditState,
  manualEditReducer,
} from '@/components/design/edit/manual-edit-reducer';

describe('manualEditReducer', () => {
  it('selects a target and seeds the current property value', () => {
    const next = manualEditReducer(initialManualEditState, {
      type: 'pointerSelected',
      target: {
        kind: 'neuma-target',
        id: 'hero',
        tagName: 'H1',
        styles: { color: 'rgb(1, 2, 3)' },
      },
    });

    expect(next.selectedElementId).toBe('hero');
    expect(next.draft).toEqual({ property: 'color', value: 'rgb(1, 2, 3)' });
  });

  it('tracks property changes and append-only history', () => {
    const changed = manualEditReducer(initialManualEditState, {
      type: 'propertyChanged',
      property: 'fontSize',
      value: '22px',
    });
    const applied = manualEditReducer(changed, {
      type: 'editApplied',
      entry: {
        patchId: 'patch_1',
        appliedAt: '2026-05-15T00:00:00.000Z',
        sourcePath: 'artifacts/index.html',
        beforeContent: '<h1 data-neuma-id="hero">Old</h1>',
        patch: {
          type: 'set-style',
          sourcePath: 'artifacts/index.html',
          targetId: 'hero',
          styles: { fontSize: '22px' },
        },
      },
    });

    expect(changed.draft).toEqual({ property: 'fontSize', value: '22px' });
    expect(applied.entries).toHaveLength(1);
    expect(applied.entries[0]?.patchId).toBe('patch_1');
  });

  it('preserves selection through history changes and accepts cleared styles', () => {
    const selected = manualEditReducer(initialManualEditState, {
      type: 'pointerSelected',
      target: {
        kind: 'neuma-target',
        id: 'hero',
        tagName: 'H1',
        styles: { color: 'red' },
      },
    });
    const cleared = manualEditReducer(selected, {
      type: 'propertyChanged',
      property: 'color',
      value: '',
    });
    const applied = manualEditReducer(cleared, {
      type: 'editApplied',
      entry: {
        patchId: 'patch_clear',
        appliedAt: '2026-07-28T00:00:00.000Z',
        sourcePath: 'artifacts/index.html',
        beforeContent: '<h1 data-neuma-id="hero" style="color:red">Hero</h1>',
        patch: {
          type: 'set-style',
          sourcePath: 'artifacts/index.html',
          targetId: 'hero',
          styles: { color: '' },
        },
      },
    });

    expect(applied.selectedElementId).toBe('hero');
    expect(applied.draft.value).toBe('');
    expect(applied.entries).toHaveLength(1);
  });
});
