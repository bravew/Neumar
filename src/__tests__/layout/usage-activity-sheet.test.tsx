import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RailMenu } from '@/components/layout/rail/RailMenu';

vi.mock('@/app/pages/Dashboard', () => ({
  DashboardBody: () => <p>dashboard body</p>,
}));

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      nav: {
        menu: 'Menu',
        approvals: 'Approvals',
        dashboard: 'Dashboard',
        settings: 'Settings',
      },
      ideas: { title: 'Ideas' },
      dashboard: { title: 'Dashboard' },
    },
  }),
}));

describe('Usage & activity', () => {
  it('opens as a sheet over the current page (#164)', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter([{ path: '*', element: <RailMenu /> }], {
      initialEntries: ['/task-v2/abc'],
    });
    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Dashboard' }),
    );

    const sheet = await screen.findByTestId('usage-activity-sheet');
    // The body is lazy-loaded with the Dashboard chunk.
    expect(await screen.findByText('dashboard body')).toBeInTheDocument();
    expect(sheet).toContainElement(screen.getByText('dashboard body'));
    expect(screen.getByRole('dialog', { name: 'Dashboard' })).toBe(sheet);
    expect(router.state.location.pathname).toBe('/task-v2/abc');

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByTestId('usage-activity-sheet'),
      ).not.toBeInTheDocument(),
    );
  });
});
