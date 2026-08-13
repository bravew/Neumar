import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesignSystemsTab } from '@/components/design/tabs/DesignSystemsTab';

import { renderWithProviders } from './helpers/render-with-providers';

describe('DesignSystemsTab rename', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renames editable local systems and hides rename on bundled systems', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({
          designSystem: {
            ...localSystem,
            title: 'Renamed Local',
          },
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    renderWithProviders(
      <DesignSystemsTab
        systems={[localSystem, bundledSystem]}
        selectedId=""
        onPreview={vi.fn()}
        onSelectDefault={vi.fn()}
        onCatalogChanged={vi.fn()}
      />,
    );

    expect(
      screen.queryByTestId('design-system-rename-bundled-system'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId('design-system-rename-local-system'));
    await user.clear(screen.getByTestId('design-system-rename-input'));
    await user.type(
      screen.getByTestId('design-system-rename-input'),
      'Renamed Local',
    );
    await user.click(screen.getByTestId('design-system-rename-submit'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/design/design-systems/local-system'),
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const [, init] = fetchMock.mock.calls.find(
      ([url, requestInit]) =>
        String(url).includes('/design/design-systems/local-system') &&
        requestInit?.method === 'PATCH',
    )!;
    expect(JSON.parse(String(init?.body))).toEqual({
      title: 'Renamed Local',
    });
  });
});

const localSystem = {
  id: 'local-system',
  title: 'Local System',
  category: 'Local',
  summary: 'Editable',
  body: '# Local System',
  swatches: [],
  tokens: [],
  origin: 'installed' as const,
  editable: true,
};

const bundledSystem = {
  id: 'bundled-system',
  title: 'Bundled System',
  category: 'General',
  summary: 'Read-only',
  body: '# Bundled System',
  swatches: [],
  tokens: [],
  origin: 'bundled' as const,
};

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
