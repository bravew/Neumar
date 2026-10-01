import { useEffect } from 'react';

import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShellLayout } from '@/app/AppShellLayout';
import { ModeSlotShortcuts } from '@/components/layout/sidebar-shell/ModeSlotShortcuts';
import { HotkeyProvider } from '@/shared/hotkeys/HotkeyProvider';
import { HotkeyRegistry } from '@/shared/hotkeys/HotkeyRegistry';
import { ModeProvider } from '@/shared/modes/ModeProvider';
import '@/shared/modes/modes.builtin';

const mounts = vi.hoisted(() => ({ count: 0 }));

vi.mock('@/components/layout', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => children,
  LeftSidebar: () => {
    useEffect(() => {
      mounts.count += 1;
    }, []);
    return <aside data-testid="app-sidebar" />;
  },
}));

function GoLibrary() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/library')}>
      Go library
    </button>
  );
}

describe('AppShellLayout', () => {
  beforeEach(() => {
    mounts.count = 0;
    HotkeyRegistry.clear();
  });

  it('keeps the sidebar mounted across navigations', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <ModeProvider>
          <HotkeyProvider>
            <Routes>
              <Route element={<AppShellLayout />}>
                <Route
                  index
                  element={
                    <div>
                      home <GoLibrary />
                    </div>
                  }
                />
                <Route path="library" element={<div>library</div>} />
              </Route>
            </Routes>
          </HotkeyProvider>
        </ModeProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('app-sidebar')).toBeInTheDocument();
    expect(mounts.count).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Go library' }));
    expect(screen.getByText('library')).toBeInTheDocument();
    expect(mounts.count).toBe(1);
  });
});

describe('ModeSlotShortcuts', () => {
  beforeEach(() => {
    HotkeyRegistry.clear();
  });

  it('registers slot shortcuts without ModeSwitcher', () => {
    render(
      <MemoryRouter>
        <ModeProvider>
          <HotkeyProvider>
            <ModeSlotShortcuts />
          </HotkeyProvider>
        </ModeProvider>
      </MemoryRouter>,
    );

    const ids = HotkeyRegistry.list().map((shortcut) => shortcut.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'mode.switch.tasks',
        'mode.switch.design',
        'mode.switch.automate',
        'mode.switch.video',
      ]),
    );
    expect(ids.some((id) => id.startsWith('mode.switch.'))).toBe(true);
  });
});
