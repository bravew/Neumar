import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TasksRecents } from '@/components/layout/sidebar-shell/recents/TasksRecents';
import type { Task } from '@/shared/db';

const navigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      nav: {
        noTasksYet: 'No tasks yet',
        tasksLoadError: 'Could not load tasks',
      },
      common: {},
    },
  }),
}));

function task(id: string, title: string): Task {
  return {
    id,
    session_id: 'session',
    task_index: 1,
    prompt: title,
    title,
    status: 'completed',
    cost: null,
    duration: null,
    created_at: '2026-09-30T00:00:00.000Z',
    updated_at: '2026-09-30T00:00:00.000Z',
  };
}

describe('TasksRecents', () => {
  beforeEach(() => {
    navigate.mockReset();
  });

  it('renders a skeleton while tasks are loading and not the empty state', () => {
    vi.useFakeTimers();
    render(
      <TasksRecents
        tasks={[]}
        status="loading"
        runningTaskIds={[]}
        searchQuery=""
      />,
    );

    expect(screen.queryByText('No tasks yet')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('tasks-recents-skeleton'),
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(screen.getByTestId('tasks-recents-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('No tasks yet')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders the empty state only when the list is ready and empty', () => {
    render(
      <TasksRecents
        tasks={[]}
        status="ready"
        runningTaskIds={[]}
        searchQuery=""
      />,
    );

    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
    expect(
      screen.queryByTestId('tasks-recents-skeleton'),
    ).not.toBeInTheDocument();
  });

  it('navigates twice when two different rows are clicked in sequence', async () => {
    const user = userEvent.setup();
    render(
      <TasksRecents
        tasks={[task('task-a', 'Alpha'), task('task-b', 'Beta')]}
        status="ready"
        runningTaskIds={[]}
        searchQuery=""
      />,
    );

    await user.click(screen.getByText('Alpha'));
    await user.click(screen.getByText('Beta'));

    expect(navigate).toHaveBeenNthCalledWith(1, '/task-v2/task-a', {
      state: null,
    });
    expect(navigate).toHaveBeenNthCalledWith(2, '/task-v2/task-b', {
      state: null,
    });
  });
});
