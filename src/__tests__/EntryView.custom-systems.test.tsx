import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DesignSystemsTab } from '@/components/design/tabs/DesignSystemsTab';

import { renderWithProviders } from './helpers/render-with-providers';

describe('Design systems custom ordering', () => {
  it('renders local systems in their own group above bundled systems', () => {
    renderWithProviders(
      <DesignSystemsTab
        systems={[
          designSystem({ id: 'bundled-a', title: 'Bundled A' }),
          designSystem({
            id: 'custom-b',
            title: 'Custom B',
            origin: 'installed',
            editable: true,
          }),
        ]}
        selectedId=""
        onPreview={vi.fn()}
        onSelectDefault={vi.fn()}
        onCatalogChanged={vi.fn()}
      />,
    );

    expect(screen.getByText('Your design systems')).toBeVisible();
    const cards = screen.getAllByTestId(/design-system-card-/);
    expect(cards[0]).toHaveAttribute(
      'data-testid',
      'design-system-card-custom-b',
    );
    expect(cards[1]).toHaveAttribute(
      'data-testid',
      'design-system-card-bundled-a',
    );
    expect(screen.getByText('Custom')).toBeVisible();
  });
});

function designSystem(input: {
  id: string;
  title: string;
  origin?: 'bundled' | 'installed';
  editable?: boolean;
}) {
  return {
    id: input.id,
    title: input.title,
    category: 'General',
    summary: input.title,
    body: `# ${input.title}`,
    swatches: [],
    tokens: [],
    origin: input.origin ?? 'bundled',
    editable: input.editable,
  };
}
