import { useLocation } from 'react-router-dom';

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesignEntryView } from '@/components/design/EntryView';
import { defaultSettings, saveSettings } from '@/shared/db/settings';

import { renderWithProviders } from './helpers/render-with-providers';

const system = {
  id: 'custom-system',
  title: 'Custom System',
  category: 'Local',
  summary: 'A local system',
  body: '# Custom System',
  swatches: ['#111111'],
  tokens: ['#111111'],
  origin: 'installed' as const,
  editable: true,
};

describe('DesignSystemsTab new conversation action', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('creates a new project pre-scoped to the chosen design system', async () => {
    saveSettings({ ...defaultSettings, language: 'en-US' });
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/projects') && init?.method === 'POST') {
          return jsonResponse({
            project: {
              id: 'design_from_system',
              title: 'Custom System',
              surface: 'prototype',
              status: 'draft',
              skillId: null,
              designSystemId: 'custom-system',
              inspirationDesignSystemIds: [],
              craftRefs: [],
              brief: {},
              outputs: [],
              createdAt: '2026-05-24T00:00:00.000Z',
              updatedAt: '2026-05-24T00:00:00.000Z',
            },
          });
        }
        if (url.endsWith('/projects')) return jsonResponse({ projects: [] });
        if (url.endsWith('/design-systems')) {
          return jsonResponse({ designSystems: [system] });
        }
        if (url.endsWith('/skills')) return jsonResponse({ skills: [] });
        if (url.includes('/prompt-templates')) {
          return jsonResponse({ templates: [] });
        }
        return jsonResponse({});
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    renderWithProviders(
      <>
        <DesignEntryView />
        <LocationProbe />
      </>,
      { initialEntries: ['/design#design-systems'] },
    );

    await user.click(
      await screen.findByTestId('design-system-start-custom-system'),
    );

    await waitFor(() =>
      expect(screen.getByTestId('route-probe')).toHaveTextContent(
        '/design/design_from_system',
      ),
    );
    const [, init] = fetchMock.mock.calls.find(
      ([url, requestInit]) =>
        String(url).endsWith('/projects') && requestInit?.method === 'POST',
    )!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      surface: 'prototype',
      designSystemId: 'custom-system',
      brief: {
        prompt: 'A local system',
        createdFromDesignSystem: true,
        locale: 'en-US',
        chatLocale: 'en-US',
      },
    });
  });
});

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="route-probe">
      {location.pathname}
      {location.hash}
    </div>
  );
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
