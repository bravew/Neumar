import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { QuestionFormArtifact } from '@/components/artifacts/discovery/QuestionForm';

import { renderWithProviders } from './helpers/render-with-providers';

describe('QuestionForm options', () => {
  it('renders object labels but submits stable option values', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    const { rerender } = renderWithProviders(
      <QuestionFormArtifact
        fields={[
          {
            name: 'tone',
            label: 'Tone',
            type: 'select',
            options: [
              { value: 'calm', label: 'Calm and focused' },
              { value: 'bold', label: 'Bold' },
            ],
          },
        ]}
        onSubmit={onSubmit}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox'), ['calm']);
    rerender(
      <QuestionFormArtifact
        fields={[
          {
            name: 'tone',
            label: 'Tone',
            type: 'select',
            options: [
              { value: 'calm', label: 'Calm and concise' },
              { value: 'bold', label: 'Bold' },
            ],
          },
        ]}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByRole('combobox')).toHaveValue('calm');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith({ tone: 'calm' });
  });

  it('keeps string options backwards compatible', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(
      <QuestionFormArtifact
        fields={[
          {
            name: 'size',
            label: 'Size',
            type: 'radio',
            options: ['small', 'large'],
          },
        ]}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByLabelText('large'));
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith({ size: 'large' });
  });
});
