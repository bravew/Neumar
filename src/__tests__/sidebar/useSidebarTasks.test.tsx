import { MemoryRouter } from 'react-router-dom';

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SidebarRecents } from '@/components/layout/sidebar-shell/SidebarRecents';
import type { Task } from '@/shared/db';

const tasks: Task[] = [
  {
    id: 'task-dashboard',
    session_id: 'session',
    task_index: 1,
    prompt: 'Write the brief',
    title: 'Write the brief',
    status: 'completed',
    cost: null,
    duration: null,
    created_at: '2026-09-30T00:00:00.000Z',
    updated_at: '2026-09-30T00:00:00.000Z',
  },
];

vi.mock('@/shared/db', () => ({
  getAllTasks: vi.fn(() => Promise.resolve(tasks)),
}));

vi.mock('@/shared/modes/useMode', () => ({
  useMode: () => ({ activeMode: { id: 'tasks' } }),
}));

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      nav: {
        recents: 'Recents',
        searchPlaceholder: 'Search',
        noTasksYet: 'No tasks yet',
        tasksLoadError: 'Could not load tasks',
        noRecentItems: 'No recent items',
      },
      common: {},
    },
  }),
}));

describe('SidebarRecents task source', () => {
  it('lists tasks from the shared query without a tasks prop', async () => {
    render(
      <MemoryRouter>
        <SidebarRecents runningTaskIds={[]} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Write the brief')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('No tasks yet')).not.toBeInTheDocument();
    });
  });
});
