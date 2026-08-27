import type { ReactNode } from 'react';

import { useLocation } from 'react-router-dom';

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/layout', () => ({
  LeftSidebar: () => <aside data-testid="mock-sidebar" />,
  SidebarProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { VideoModeRoute } from '@/app/pages/VideoMode';

import { renderWithProviders } from './helpers/render-with-providers';

describe('VideoMode intent entry', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('keeps the inline creation form behind configure by default', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/video/projects')) {
        return jsonResponse({ projects: [] });
      }
      return jsonResponse({});
    }) as typeof fetch;

    renderWithProviders(<VideoModeRoute />, {
      initialEntries: ['/video'],
    });

    expect(
      await screen.findByRole('button', { name: /^start$/i }),
    ).toBeVisible();
    // No modal trigger; the form and HTML quick action stay hidden until
    // Configure is expanded.
    expect(
      screen.queryByRole('button', { name: /create project/i }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: /create an html video/i }),
    ).toBeNull();
    expect(screen.queryByRole('textbox', { name: /project name/i })).toBeNull();

    const configure = screen.getByRole('button', { name: /configure/i });
    expect(configure).toHaveAttribute('aria-expanded', 'false');
    await user.click(configure);

    expect(configure).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('textbox', { name: /project name/i }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: /create project/i }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: /create an html video/i }),
    ).toBeVisible();
  });

  it('opens the inline creation form from a routed new intent without a modal', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/video/projects')) {
        return jsonResponse({ projects: [] });
      }
      return jsonResponse({});
    }) as typeof fetch;

    renderWithProviders(<VideoModeRoute />, {
      initialEntries: ['/video?new=1&prompt=Launch%20spot'],
    });

    // The routed prompt seeds the inline form — no popup dialog.
    expect(await screen.findByDisplayValue('Launch spot')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /configure/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('creates a video project inline from Start without a modal', async () => {
    const user = userEvent.setup();
    const createCalls: unknown[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/video/projects') && init?.method === 'POST') {
          createCalls.push(JSON.parse(String(init.body)));
          return jsonResponse({
            project: {
              id: 'vid_new',
              name: 'A launch reel',
              template: 'custom',
              updatedAt: '2026-06-27T00:00:00.000Z',
            },
          });
        }
        if (url.includes('/video/projects')) {
          return jsonResponse({ projects: [] });
        }
        return jsonResponse({});
      },
    ) as typeof fetch;

    renderWithProviders(
      <>
        <VideoModeRoute />
        <LocationProbe />
      </>,
      { initialEntries: ['/video'] },
    );

    await user.type(
      await screen.findByPlaceholderText(/describe the output/i),
      'A launch reel',
    );
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(createCalls[0]).toEqual(
      expect.objectContaining({ template: 'custom' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location-probe')).toHaveTextContent(
        '/video/vid_new',
      ),
    );
    // No modal is involved in the inline creation path.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('preserves prompt when routing an image intent to Design', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/video/projects')) {
        return jsonResponse({ projects: [] });
      }
      return jsonResponse({});
    }) as typeof fetch;

    renderWithProviders(
      <>
        <VideoModeRoute />
        <LocationProbe />
      </>,
      {
        initialEntries: ['/video'],
      },
    );

    await user.click(await screen.findByRole('radio', { name: /^image$/i }));
    await user.type(
      screen.getByPlaceholderText(/describe the output/i),
      'Album cover',
    );
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    expect(screen.getByTestId('location-probe')).toHaveTextContent(
      '/design?surface=image&prompt=Album+cover',
    );
  });
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location-probe">
      {location.pathname}
      {location.search}
    </output>
  );
}
