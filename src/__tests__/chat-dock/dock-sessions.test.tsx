import { useState } from 'react';

import { MemoryRouter } from 'react-router-dom';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatDock } from '@/components/chat-dock/ChatDock';
import type { Task } from '@/shared/db';

const db = vi.hoisted(() => ({
  tasks: [] as Partial<Task>[],
  createTask: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock('@/shared/db', () => ({
  getAllTasks: async () => db.tasks,
  createSession: db.createSession,
  createTask: db.createTask,
}));

// The real thread needs a CopilotKit runtime; the dock only decides which
// task it mounts and with what first prompt.
vi.mock('@/components/chat-dock/DockThread', () => ({
  DockThread: ({
    taskId,
    firstPrompt,
  }: {
    taskId: string;
    firstPrompt?: string;
  }) => (
    <p data-testid="dock-thread">
      {taskId}
      {firstPrompt ? ` first:${firstPrompt}` : ''}
    </p>
  ),
}));

vi.mock('@/components/chat-dock/usePageContext', () => ({
  usePageContextValue: () => null,
}));

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      task: {
        dockTitle: 'Chat',
        dockClose: 'Close',
        dockPlaceholder: 'Message…',
        dockFullView: 'Open full view',
        dockDismiss: 'Remove context',
        dockChats: 'Chats',
        dockSideChats: 'Side chats',
        dockSwitchChat: 'Switch chat',
        dockOpenInPage: 'This chat is open on the page.',
      },
      nav: {
        recents: 'Recents',
        searchPlaceholder: 'Search past sessions...',
        tasksLoadError: 'Error',
        noTasksYet: 'No tasks yet',
      },
      modes: { chat: { primaryAction: 'New chat' } },
    },
  }),
}));

function Dock({ pageTaskId }: { pageTaskId?: string }) {
  const [taskId, setTaskId] = useState<string | null>(null);
  return (
    <MemoryRouter>
      <span data-testid="dock-task">{taskId ?? 'none'}</span>
      <ChatDock
        taskId={taskId}
        pageTaskId={pageTaskId}
        onTaskId={setTaskId}
        onClose={() => {}}
      />
    </MemoryRouter>
  );
}

describe('ChatDock sessions', () => {
  beforeEach(() => {
    db.tasks = [
      { id: 'latest', title: 'Weekly report', prompt: 'report' },
      {
        id: 'side',
        title: 'report.pdf',
        prompt: 'Looking at: library › report.pdf',
      },
      { id: 'older', title: 'Convert video', prompt: 'convert' },
    ];
    db.createTask.mockClear();
    db.createSession.mockClear();
  });

  it('opens on the most recent session', async () => {
    render(<Dock />);
    expect(await screen.findByTestId('dock-thread')).toHaveTextContent(
      'latest',
    );
  });

  it('lists side chats apart, filters, and switches on click', async () => {
    const user = userEvent.setup();
    render(<Dock />);
    await screen.findByTestId('dock-thread');

    await user.click(screen.getByRole('button', { name: 'Switch chat' }));
    const sideHeading = screen.getByRole('heading', { name: 'Side chats' });
    expect(sideHeading.parentElement).toHaveTextContent('report.pdf');
    expect(sideHeading.parentElement).not.toHaveTextContent('Convert video');

    await user.type(
      screen.getByPlaceholderText('Search past sessions...'),
      'conv',
    );
    expect(screen.getAllByTestId('dock-session')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Convert video' }));
    expect(await screen.findByTestId('dock-thread')).toHaveTextContent('older');
  });

  it('starts a new chat that runs through the thread', async () => {
    const user = userEvent.setup();
    render(<Dock />);
    await screen.findByTestId('dock-thread');

    await user.click(screen.getByRole('button', { name: 'Switch chat' }));
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    await waitFor(() =>
      expect(screen.getByTestId('dock-task')).toHaveTextContent('none'),
    );
    expect(screen.queryByTestId('dock-thread')).not.toBeInTheDocument();

    await user.type(
      screen.getByTestId('chat-dock-input'),
      'draft a post{Enter}',
    );
    expect(await screen.findByTestId('dock-thread')).toHaveTextContent(
      'first:draft a post',
    );
    expect(db.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'draft a post', task_index: 1 }),
    );
  });

  it('never mounts the task the page already shows', async () => {
    const user = userEvent.setup();
    render(<Dock pageTaskId="latest" />);
    // The latest session is on the page, so the dock opens the next one.
    expect(await screen.findByTestId('dock-thread')).toHaveTextContent('side');

    await user.click(screen.getByRole('button', { name: 'Switch chat' }));
    await user.click(screen.getByRole('button', { name: 'Weekly report' }));
    expect(
      screen.getByText('This chat is open on the page.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('dock-thread')).not.toBeInTheDocument();
  });
});
