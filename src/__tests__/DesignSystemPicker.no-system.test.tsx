import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DesignSystemPicker } from '@/components/design/DesignSystemPicker';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

describe('DesignSystemPicker no-system option', () => {
  it('shows an explicit no-system trigger state', () => {
    renderWithProviders(
      <DesignSystemPicker
        systems={[system('neutral', 'Neutral System')]}
        value={null}
        inspirations={[]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('No design system')).toBeVisible();
    expect(
      screen.getByText('Use the agent’s judgment without a selected system.'),
    ).toBeVisible();
  });

  it('is searchable and clears primary plus inspiration selections', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <DesignSystemPicker
        systems={[
          system('neutral', 'Neutral System'),
          system('brutalist', 'Brutalist System'),
        ]}
        value="neutral"
        inspirations={['brutalist']}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByTestId('design-system-picker'));
    await user.type(screen.getByPlaceholderText('Search systems'), 'no design');
    expect(
      screen.queryByRole('option', { name: /Neutral System/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /No design system/ }));

    expect(onChange).toHaveBeenCalledWith(null, []);
  });
});

function system(id: string, title: string): DesignSystemRecord {
  return {
    id,
    title,
    category: 'General',
    summary: `${title} summary`,
    body: `# ${title}`,
    swatches: ['#111111', '#eeeeee'],
    tokens: [],
    origin: 'bundled',
    editable: false,
  };
}
