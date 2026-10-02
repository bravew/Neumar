import { act, type ReactNode } from 'react';

import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShellLayout } from '@/app/AppShellLayout';
import { HotkeyProvider } from '@/shared/hotkeys/HotkeyProvider';
import { HotkeyRegistry } from '@/shared/hotkeys/HotkeyRegistry';
import { ModeProvider } from '@/shared/modes/ModeProvider';
import '@/shared/modes/modes.builtin';

const ui = vi.hoisted(() => ({ simpleShell: true, usageActivityOpens: 0 }));

vi.mock('@/shared/db/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/db/settings')>();
  return {
    ...actual,
    getSettings: () => ({ ...actual.getSettings(), ui }),
    useSettingsValue: () => ({ ...actual.getSettings(), ui }),
  };
});

vi.mock('@/components/layout', () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => children,
  LeftSidebar: () => <aside data-testid="app-sidebar" />,
}));

vi.mock('@/components/layout/rail/AppRail', () => ({
  AppRail: () => <nav data-testid="app-rail" />,
}));

vi.mock('@/components/layout/sidebar-shell/SidebarToggleShortcut', () => ({
  SidebarToggleShortcut: () => null,
}));

function renderShell(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <ModeProvider>
            <HotkeyProvider>
              <AppShellLayout />
            </HotkeyProvider>
          </ModeProvider>
        ),
        children: [
          { index: true, element: <div>home</div> },
          { path: 'video/:projectId', element: <div>video editor</div> },
          { path: 'design', element: <div>design entry</div> },
          { path: 'design/:projectId', element: <div>design editor</div> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const cyclePanel = () =>
  act(() => {
    window.dispatchEvent(new CustomEvent('shell:cycle-panel'));
  });

describe('AppShellLayout panels', () => {
  beforeEach(() => {
    HotkeyRegistry.clear();
    ui.simpleShell = true;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280,
    });
  });

  it('opens editors rail-only without collapsing the panel on pages', async () => {
    const router = renderShell('/');
    expect(await screen.findByTestId('app-sidebar')).toBeInTheDocument();

    await act(() => router.navigate('/video/abc'));
    expect(screen.getByText('video editor')).toBeInTheDocument();
    expect(screen.getByTestId('app-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();

    // B → C → A: the editor's own record reaches the panel again.
    cyclePanel();
    expect(screen.queryByTestId('app-rail')).not.toBeInTheDocument();
    cyclePanel();
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument();

    await act(() => router.navigate('/design/p1'));
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument();
    cyclePanel();
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();

    await act(() => router.navigate('/'));
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument();
  });

  it('gives Design the rail and panel in the simple shell', async () => {
    renderShell('/design');
    expect(await screen.findByText('design entry')).toBeInTheDocument();
    expect(screen.getByTestId('app-rail')).toBeInTheDocument();
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument();
  });

  it('keeps Design chromeless when the simple shell is off', async () => {
    ui.simpleShell = false;
    const router = renderShell('/design');
    expect(await screen.findByText('design entry')).toBeInTheDocument();
    expect(screen.queryByTestId('app-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();

    await act(() => router.navigate('/'));
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument();
  });
});
