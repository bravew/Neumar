import { act } from 'react';

import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppRail } from '@/components/layout/rail/AppRail';
import { ModeProvider } from '@/shared/modes/ModeProvider';
import '@/shared/modes/modes.builtin';

vi.mock('@/components/layout/rail/RailMenu', () => ({
  RailMenu: () => null,
  usePendingApprovalCount: () => 0,
}));

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      nav: { home: 'Home', menu: 'Menu' },
      library: { title: 'Library' },
      modes: {},
    },
  }),
}));

vi.mock('@/components/layout/sidebar-shell/SidebarFooter', () => ({
  SidebarFooter: () => null,
}));

describe('rail app icon', () => {
  it('goes Home, not to the resumed task', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <ModeProvider>
              <AppRail />
            </ModeProvider>
          ),
        },
      ],
      { initialEntries: ['/task-v2/abc'] },
    );
    render(<RouterProvider router={router} />);

    // Leave Tasks so the Tasks icon would resume the conversation.
    await act(() => router.navigate('/video'));
    await user.click(screen.getByTestId('rail-home-logo'));
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByTestId('rail-home-logo')).toHaveAccessibleName('Home');
  });
});
