import { useState } from 'react';

import { MemoryRouter } from 'react-router-dom';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatDock } from '@/components/chat-dock/ChatDock';
import type { Task } from '@/shared/db';

const db = vi.hoisted(() => ({
  tasks: [] as Partial<Task>[],
  messages: {} as Record<string, { id: string; content: string }[]>,
}));

vi.mock('@/shared/db', () => ({
  getAllTasks: async () => db.tasks,
  getMessagesByTaskId: async (id: string) => db.messages[id] ?? [],
  createMessage: vi.fn(),
  createSession: vi.fn(),
  createTask: vi.fn(),
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

function Dock() {
  const [taskId, setTaskId] = useState<string | null>(null);
  return (
    <MemoryRouter>
      <span data-testid="dock-task">{taskId ?? 'none'}</span>
      <ChatDock taskId={taskId} onTaskId={setTaskId} onClose={() => {}} />
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
    db.messages = {
      latest: [{ id: 'm1', content: 'latest reply' }],
      older: [{ id: 'm2', content: 'older reply' }],
    };
  });

  it('opens on the most recent session', async () => {
    render(<Dock />);
    expect(await screen.findByText('latest reply')).toBeInTheDocument();
    expect(screen.getByTestId('dock-task')).toHaveTextContent('latest');
  });

  it('lists side chats apart, filters, and switches on click', async () => {
    const user = userEvent.setup();
    render(<Dock />);
    await screen.findByText('latest reply');

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
    expect(await screen.findByText('older reply')).toBeInTheDocument();
    expect(screen.getByTestId('dock-task')).toHaveTextContent('older');
  });

  it('keeps a new chat empty instead of reopening the latest', async () => {
    const user = userEvent.setup();
    render(<Dock />);
    await screen.findByText('latest reply');

    await user.click(screen.getByRole('button', { name: 'Switch chat' }));
    await user.click(screen.getByRole('button', { name: 'New chat' }));

    await waitFor(() =>
      expect(screen.getByTestId('dock-task')).toHaveTextContent('none'),
    );
    expect(screen.queryByText('latest reply')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-dock-input')).toBeInTheDocument();
  });
});
