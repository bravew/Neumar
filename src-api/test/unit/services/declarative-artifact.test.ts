import { describe, expect, it } from 'vitest';

import {
  A2UI_VERSION,
  validateDeclarativeArtifact,
} from '@/shared/services/ag-ui/declarative-artifact';

describe('declarative artifact validator', () => {
  it('accepts the pinned A2UI subset', () => {
    const result = validateDeclarativeArtifact({
      version: A2UI_VERSION,
      root: {
        type: 'Card',
        children: [
          { type: 'Heading', text: 'Review request' },
          {
            type: 'Form',
            children: [
              { type: 'TextField', props: { label: 'Summary' } },
              { type: 'Button', text: 'Submit', props: { action: 'submit' } },
            ],
          },
        ],
      },
      actions: [{ id: 'submit', label: 'Submit', variant: 'primary' }],
    });

    expect(result).toEqual({ ok: true, issues: [] });
  });

  it('rejects unknown nodes with a path', () => {
    const result = validateDeclarativeArtifact({
      version: A2UI_VERSION,
      root: { type: 'RawHtml', text: '<script />' },
    });

    expect(result.ok).toBe(false);
    expect(result.issues.join('\n')).toContain('root.type');
  });
});
