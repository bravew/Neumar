import type { ReactNode } from 'react';

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/layout', () => ({
  LeftSidebar: () => <aside data-testid="mock-sidebar" />,
  SidebarProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { VideoModeRoute } from '@/app/pages/VideoMode';

import { renderWithProviders } from './helpers/render-with-providers';

const projects = [
  {
    id: 'video_launch',
    name: 'Launch Reel',
    template: 'slideshow',
    updatedAt: '2026-08-02T00:00:00.000Z',
    renderStatus: 'completed',
    hasOutput: true,
  },
  {
    id: 'video_podcast',
    name: 'Podcast Teaser',
    template: 'podcast',
    updatedAt: '2026-08-03T00:00:00.000Z',
    renderStatus: 'rendering',
    hasOutput: false,
  },
  {
    id: 'video_recap',
    name: 'Launch Recap',
    template: 'slideshow',
    updatedAt: '2026-08-01T00:00:00.000Z',
    renderStatus: 'idle',
    hasOutput: false,
  },
];

describe('VideoMode project library', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('searches, filters, and sorts video projects', async () => {
    const user = userEvent.setup();
    mockVideoProjects();
    const view = renderWithProviders(<VideoModeRoute />, {
      initialEntries: ['/video'],
    });

    expect(await screen.findByText('Podcast Teaser')).toBeVisible();
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(
      view.container.querySelector<HTMLElement>('[class*="auto-fill"]')
        ?.className,
    ).toContain('22rem');
    const cards = () => [...view.container.querySelectorAll('article')];
    expect(view.container.querySelector('article video')).toHaveAttribute(
      'src',
      expect.stringContaining('/video/projects/video_launch/output'),
    );
    expect(cards().map((card) => card.textContent)).toEqual([
      expect.stringContaining('Podcast Teaser'),
      expect.stringContaining('Launch Reel'),
      expect.stringContaining('Launch Recap'),
    ]);

    await user.type(
      screen.getByRole('textbox', { name: 'Search video projects' }),
      'launch',
    );
    expect(screen.queryByText('Podcast Teaser')).toBeNull();
    expect(screen.getByText('Launch Reel')).toBeVisible();
    expect(screen.getByText('Launch Recap')).toBeVisible();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Filter by status' }),
      'completed',
    );
    expect(screen.getByText('Launch Reel')).toBeVisible();
    expect(screen.queryByText('Launch Recap')).toBeNull();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Filter by status' }),
      'all',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sort projects' }),
      'name-asc',
    );
    expect(cards().map((card) => card.textContent)).toEqual([
      expect.stringContaining('Launch Recap'),
      expect.stringContaining('Launch Reel'),
    ]);
  });

  it('confirms and deletes all selected visible projects', async () => {
    const user = userEvent.setup();
    const deleteCalls = mockVideoProjects();
    renderWithProviders(<VideoModeRoute />, { initialEntries: ['/video'] });

    await user.type(
      await screen.findByRole('textbox', { name: 'Search video projects' }),
      'launch',
    );
    await user.click(
      screen.getByRole('button', { name: 'Select all visible' }),
    );
    expect(screen.getByText('2 selected')).toBeVisible();
    expect(
      screen.getByRole('checkbox', { name: 'Select Launch Reel' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Select Launch Recap' }),
    ).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Delete selected' }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/permanently removes 2 video projects/i),
    ).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(deleteCalls).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Delete selected' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );

    await waitFor(() =>
      expect(deleteCalls.sort()).toEqual([
        '/video/projects/video_launch',
        '/video/projects/video_recap',
      ]),
    );
    expect(await screen.findByText('No matching projects')).toBeVisible();
    expect(screen.queryByText('2 selected')).toBeNull();
  });

  it('uses card clicks to toggle projects after selection mode starts', async () => {
    const user = userEvent.setup();
    mockVideoProjects();
    renderWithProviders(<VideoModeRoute />, { initialEntries: ['/video'] });

    await user.click(
      await screen.findByRole('checkbox', { name: 'Select Launch Reel' }),
    );
    expect(screen.getByText('1 selected')).toBeVisible();

    const recapCard = screen.getByText('Launch Recap').closest('article');
    expect(recapCard).not.toBeNull();
    await user.click(recapCard!);
    expect(screen.getByText('2 selected')).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Video projects' }),
    ).toBeVisible();

    await user.click(recapCard!);
    expect(screen.getByText('1 selected')).toBeVisible();
  });

  it('lets keyboard users enter selection mode through a project checkbox', async () => {
    const user = userEvent.setup();
    mockVideoProjects();
    renderWithProviders(<VideoModeRoute />, { initialEntries: ['/video'] });

    const checkbox = await screen.findByRole('checkbox', {
      name: 'Select Launch Reel',
    });
    checkbox.focus();
    await user.keyboard(' ');

    expect(checkbox).toBeChecked();
    expect(screen.getByText('1 selected')).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Video projects' }),
    ).toBeVisible();
  });

  it('removes successful projects and keeps failures after a partial delete', async () => {
    const user = userEvent.setup();
    mockVideoProjects('video_recap');
    renderWithProviders(<VideoModeRoute />, { initialEntries: ['/video'] });

    await user.type(
      await screen.findByRole('textbox', { name: 'Search video projects' }),
      'launch',
    );
    await user.click(
      screen.getByRole('button', { name: 'Select all visible' }),
    );
    await user.click(screen.getByRole('button', { name: 'Delete selected' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );

    await waitFor(() => expect(screen.queryByText('Launch Reel')).toBeNull());
    expect(screen.getByText('Launch Recap')).toBeVisible();
    expect(screen.getByText('1 selected')).toBeVisible();
  });
});

function mockVideoProjects(failingProjectId?: string): string[] {
  const deleteCalls: string[] = [];
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/video/projects' && !init?.method) {
        return jsonResponse({ projects });
      }
      if (
        url.pathname.startsWith('/video/projects/') &&
        init?.method === 'DELETE'
      ) {
        deleteCalls.push(url.pathname);
        if (url.pathname.endsWith(`/${failingProjectId}`)) {
          return jsonResponse({ error: 'Disk busy' }, 500);
        }
        return jsonResponse({ ok: true });
      }
      return jsonResponse({});
    },
  ) as typeof fetch;
  return deleteCalls;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
