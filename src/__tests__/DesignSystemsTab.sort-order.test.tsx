import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DesignSystemsTab } from '@/components/design/tabs/DesignSystemsTab';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

import { installLocalStorageMock } from './helpers/local-storage';
import { renderWithProviders } from './helpers/render-with-providers';

beforeEach(() => {
  installLocalStorageMock();
});

function system(
  id: string,
  title: string,
  origin: 'bundled' | 'installed',
  installedAt?: string,
): DesignSystemRecord {
  return {
    id,
    title,
    category: 'General',
    summary: title,
    body: `# ${title}`,
    swatches: [],
    tokens: [],
    origin,
    installedAt,
  };
}

function renderTab(systems: DesignSystemRecord[]) {
  return renderWithProviders(
    <DesignSystemsTab
      systems={systems}
      onPreview={vi.fn()}
      onSelectDefault={vi.fn()}
      onCatalogChanged={vi.fn()}
    />,
  );
}

function cardOrder(container: HTMLElement) {
  return [
    ...container.querySelectorAll('[data-testid^="design-system-card-"]'),
  ].map((card) =>
    card.getAttribute('data-testid')?.replace('design-system-card-', ''),
  );
}

describe('DesignSystemsTab sort order', () => {
  const catalog = [
    system('alpha', 'Alpha', 'installed', '2026-01-01T00:00:00.000Z'),
    system('beta', 'Beta', 'installed', '2026-07-01T00:00:00.000Z'),
    system('zed', 'Zed', 'bundled'),
  ];

  it('hides the toggle when no record carries a timestamp', () => {
    renderTab([
      system('alpha', 'Alpha', 'bundled'),
      system('zed', 'Zed', 'bundled'),
    ]);
    expect(
      screen.queryByTestId('design-systems-sort-order'),
    ).not.toBeInTheDocument();
  });

  it('keeps curated order by default and reorders on newest', async () => {
    const user = userEvent.setup();
    const { container } = renderTab(catalog);

    expect(cardOrder(container)).toEqual(['alpha', 'beta', 'zed']);

    const toggle = screen.getByTestId('design-systems-sort-order');
    await user.click(within(toggle).getByRole('button', { name: 'Newest' }));

    expect(cardOrder(container)).toEqual(['beta', 'alpha', 'zed']);
    expect(
      window.localStorage.getItem('neuma:catalog-sort:design-systems'),
    ).toBe('newest');
  });

  it('restores the persisted order on mount', () => {
    window.localStorage.setItem('neuma:catalog-sort:design-systems', 'newest');
    const { container } = renderTab(catalog);
    expect(cardOrder(container)).toEqual(['beta', 'alpha', 'zed']);
    const toggle = screen.getByTestId('design-systems-sort-order');
    expect(
      within(toggle).getByRole('button', { name: 'Newest' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
