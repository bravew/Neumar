import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FormSpec } from '@/shared/video/useFormSpec';

import { renderWithProviders as render } from '../../../__tests__/helpers/render-with-providers';
import { VariableForm } from '../VariableForm';

function spec(...fields: FormSpec['fields']): FormSpec {
  return { type: 'object', fields, warnings: [] };
}

describe('VariableForm', () => {
  it('renders a text control and propagates changes', () => {
    const onChange = vi.fn();
    render(
      <VariableForm
        formSpec={spec({
          key: 'title',
          kind: 'text',
          label: 'Title',
          required: true,
          warnings: [],
        })}
        values={{ title: 'Hi' }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText('Title') as HTMLInputElement;
    expect(input.value).toBe('Hi');
    fireEvent.change(input, { target: { value: 'Hello' } });
    expect(onChange).toHaveBeenCalledWith({ title: 'Hello' });
  });

  it('renders a textarea', () => {
    render(
      <VariableForm
        formSpec={spec({
          key: 'body',
          kind: 'textarea',
          label: 'Body',
          required: false,
          warnings: [],
        })}
        values={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText('Body').tagName).toBe('TEXTAREA');
  });

  it('renders a select with options', () => {
    const onChange = vi.fn();
    render(
      <VariableForm
        formSpec={spec({
          key: 'theme',
          kind: 'select',
          label: 'Theme',
          required: true,
          warnings: [],
          options: ['light', 'dark'],
        })}
        values={{ theme: 'light' }}
        onChange={onChange}
      />,
    );
    const select = screen.getByLabelText('Theme') as HTMLSelectElement;
    expect(select.value).toBe('light');
    fireEvent.change(select, { target: { value: 'dark' } });
    expect(onChange).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('parses integer number input and emits null on clear', () => {
    const onChange = vi.fn();
    render(
      <VariableForm
        formSpec={spec({
          key: 'n',
          kind: 'number',
          label: 'Count',
          required: false,
          warnings: [],
          integer: true,
        })}
        values={{ n: 3 }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText('Count') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).toHaveBeenLastCalledWith({ n: 5 });
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ n: null });
  });

  it('renders a checkbox toggle', () => {
    const onChange = vi.fn();
    render(
      <VariableForm
        formSpec={spec({
          key: 'on',
          kind: 'toggle',
          label: 'Enabled',
          required: false,
          warnings: [],
        })}
        values={{ on: false }}
        onChange={onChange}
      />,
    );
    const cb = screen.getByLabelText('Enabled') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith({ on: true });
  });

  it('renders a date input', () => {
    render(
      <VariableForm
        formSpec={spec({
          key: 'd',
          kind: 'date',
          label: 'When',
          required: false,
          warnings: [],
        })}
        values={{ d: '2026-06-06' }}
        onChange={() => {}}
      />,
    );
    const input = screen.getByLabelText('When') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-06-06');
  });

  it('surfaces field warnings', () => {
    render(
      <VariableForm
        formSpec={spec({
          key: 't',
          kind: 'text',
          label: 'T',
          required: false,
          warnings: ['mapper warning'],
        })}
        values={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('mapper warning')).toBeInTheDocument();
  });

  it('surfaces top-level spec warnings', () => {
    render(
      <VariableForm
        formSpec={{
          type: 'object',
          fields: [],
          warnings: ['root warn'],
        }}
        values={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/root warn/)).toBeInTheDocument();
  });

  it('renders an assetPicker reference input', () => {
    const onChange = vi.fn();
    render(
      <VariableForm
        formSpec={spec({
          key: 'avatar',
          kind: 'assetPicker',
          label: 'Avatar',
          required: false,
          warnings: [],
          assetKind: 'image',
        })}
        values={{}}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText('Avatar') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'catalog:abc' } });
    expect(onChange).toHaveBeenCalledWith({ avatar: 'catalog:abc' });
  });

  it('renders a fieldset and updates a nested field', () => {
    const onChange = vi.fn();
    render(
      <VariableForm
        formSpec={spec({
          key: 'cta',
          kind: 'fieldset',
          label: 'CTA',
          required: false,
          warnings: [],
          fields: [
            {
              key: 'label',
              kind: 'text',
              label: 'Label',
              required: false,
              warnings: [],
            },
          ],
        })}
        values={{ cta: { label: 'Go' } }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Click' },
    });
    expect(onChange).toHaveBeenCalledWith({ cta: { label: 'Click' } });
  });

  it('adds and edits a table row', () => {
    const onChange = vi.fn();
    const tableSpec = spec({
      key: 'stats',
      kind: 'table',
      label: 'Stats',
      required: false,
      warnings: [],
      columns: [
        {
          key: 'name',
          kind: 'text',
          label: 'Name',
          required: false,
          warnings: [],
        },
      ],
    });
    const { rerender } = render(
      <VariableForm
        formSpec={tableSpec}
        values={{ stats: [] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('Add row'));
    expect(onChange).toHaveBeenCalledWith({ stats: [{}] });

    rerender(
      <VariableForm
        formSpec={tableSpec}
        values={{ stats: [{}] }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'row1' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ stats: [{ name: 'row1' }] });
  });

  it('preserves existing values when one field changes', () => {
    const onChange = vi.fn();
    render(
      <VariableForm
        formSpec={spec(
          {
            key: 'a',
            kind: 'text',
            label: 'A',
            required: false,
            warnings: [],
          },
          {
            key: 'b',
            kind: 'text',
            label: 'B',
            required: false,
            warnings: [],
          },
        )}
        values={{ a: 'one', b: 'two' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('A'), { target: { value: 'X' } });
    expect(onChange).toHaveBeenCalledWith({ a: 'X', b: 'two' });
  });
});
