import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { VariableForm } from '@/components/video/VariableForm';
import type { FormSpec } from '@/shared/video/useFormSpec';

import { renderWithProviders } from '../helpers/render-with-providers';

// Slice K — tagList control add/remove + numeric coercion, exercised through
// the VariableForm dispatcher.

function spec(itemType: 'string' | 'number'): FormSpec {
  return {
    type: 'object',
    warnings: [],
    fields: [
      {
        kind: 'tagList',
        key: 'tags',
        label: 'Tags',
        required: false,
        warnings: [],
        itemType,
      },
    ],
  };
}

describe('ControlTagList (via VariableForm)', () => {
  it('adds a string tag on Enter and removes it', () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <VariableForm
        formSpec={spec('string')}
        values={{ tags: [] }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText('Tags');
    fireEvent.change(input, { target: { value: 'intro' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ tags: ['intro'] });

    rerender(
      <VariableForm
        formSpec={spec('string')}
        values={{ tags: ['intro'] }}
        onChange={onChange}
      />,
    );
    fireEvent.mouseDown(screen.getByLabelText('remove intro'));
    expect(onChange).toHaveBeenLastCalledWith({ tags: [] });
  });

  it('coerces numeric items and rejects non-numbers', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <VariableForm
        formSpec={spec('number')}
        values={{ tags: [] }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText('Tags');
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ tags: [42] });
  });
});
