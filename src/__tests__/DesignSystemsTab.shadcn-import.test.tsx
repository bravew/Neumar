import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesignSystemsTab } from '@/components/design/tabs/DesignSystemsTab';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

describe('DesignSystemsTab shadcn registry import', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('imports a shadcn registry URL and previews the installed system', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const onCatalogChanged = vi.fn();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({ designSystem: importedSystem }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    renderWithProviders(
      <DesignSystemsTab
        systems={[bundledSystem]}
        selectedId=""
        onPreview={onPreview}
        onSelectDefault={vi.fn()}
        onCatalogChanged={onCatalogChanged}
      />,
    );

    await user.click(screen.getByTestId('design-system-import-shadcn'));
    await user.type(
      screen.getByTestId('design-system-shadcn-url'),
      'https://registry.example.com/registry.json',
    );
    await user.type(screen.getByTestId('design-system-shadcn-item'), 'button');
    await user.click(screen.getByTestId('design-system-shadcn-submit'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '/design/design-systems/import/shadcn-registry',
        ),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const [, init] = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/design/design-systems/import/shadcn-registry'),
    )!;
    expect(JSON.parse(String(init?.body))).toEqual({
      url: 'https://registry.example.com/registry.json',
      item: 'button',
    });
    expect(onCatalogChanged).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith(importedSystem);
  });

  it('requires a registry URL before submitting', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    renderWithProviders(
      <DesignSystemsTab
        systems={[bundledSystem]}
        selectedId=""
        onPreview={vi.fn()}
        onSelectDefault={vi.fn()}
        onCatalogChanged={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId('design-system-import-shadcn'));
    await user.click(screen.getByTestId('design-system-shadcn-submit'));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a registry URL.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const bundledSystem: DesignSystemRecord = {
  id: 'default',
  title: 'Default',
  category: 'General',
  summary: 'Bundled',
  body: '# Default',
  swatches: [],
  tokens: [],
  origin: 'bundled',
};

const importedSystem: DesignSystemRecord = {
  id: 'shadcn-button',
  title: 'shadcn Button',
  category: 'Imported',
  summary: 'Imported from registry',
  body: '# shadcn Button',
  swatches: ['#123456'],
  tokens: ['#123456'],
  origin: 'installed',
  editable: true,
  canUninstall: true,
};

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
