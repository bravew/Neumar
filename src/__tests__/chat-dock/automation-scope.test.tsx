import { useEffect, useState } from 'react';

import { MemoryRouter } from 'react-router-dom';

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OutcomeAutomationLists } from '@/components/automation/OutcomeAutomationLists';
import { ChatDock } from '@/components/chat-dock/ChatDock';

vi.mock('@/shared/db', () => ({
  getAllTasks: async () => [],
  createSession: vi.fn(),
  createTask: vi.fn(),
}));

vi.mock('@/components/chat-dock/DockThread', () => ({
  DockThread: ({ taskId }: { taskId: string }) => (
    <p data-testid="dock-thread">{taskId}</p>
  ),
}));

vi.mock('@/components/chat-dock/usePageContext', () => ({
  usePageContextValue: () => null,
}));

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      common: { loading: 'Loading' },
      automation: {
        title: 'Automations',
        reports: 'Reports',
        monitoring: 'Monitoring',
        files: 'Files',
        publishing: 'Publishing',
        somethingElse: 'Something else',
        createAutomation: 'Create',
        questionOutcome: 'What should happen?',
        questionWhen: 'When should it run?',
        questionWhere: 'Where should the result go?',
        errors: { generic: 'Error' },
      },
      task: {
        dockTitle: 'Scope it',
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

/**
 * Stand-in for AppShellLayout: the dock is mounted only after the shell hears
 * `shell:open-dock`, which is how a closed dock reaches the user.
 */
function Shell({ startOpen }: { startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [taskId, setTaskId] = useState<string | null>(null);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('shell:open-dock', onOpen);
    return () => window.removeEventListener('shell:open-dock', onOpen);
  }, []);
  return (
    <MemoryRouter>
      <OutcomeAutomationLists
        automations={[]}
        status="ready"
        onSelect={() => {}}
      />
      {open ? (
        <ChatDock
          taskId={taskId}
          onTaskId={setTaskId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </MemoryRouter>
  );
}

async function scopeAndSubmit(category: string) {
  const user = userEvent.setup();
  await user.click(screen.getByTestId(`automation-category-${category}`));

  const dock = await screen.findByTestId('chat-dock');
  await user.type(
    await within(dock).findByLabelText('What should happen?'),
    'Summarize sales',
  );
  await user.type(within(dock).getByLabelText('When should it run?'), 'Daily');
  await user.type(
    within(dock).getByLabelText('Where should the result go?'),
    'Slack',
  );
  await user.click(
    within(dock).getByText('Scope it', { selector: 'button[type="submit"]' }),
  );
  return within(dock).getByTestId('chat-dock-input') as HTMLInputElement;
}

describe('automation scope reaches the dock', () => {
  it.each(['reports', 'monitoring', 'files', 'publishing', 'somethingElse'])(
    'delivers the %s category and labeled answers from a closed dock',
    async (category) => {
      render(<Shell startOpen={false} />);
      expect(screen.queryByTestId('chat-dock')).toBeNull();

      const input = await scopeAndSubmit(category);

      await waitFor(() => expect(input.value).not.toBe(''));
      expect(input.value).toBe(
        [
          `Automation category: ${category}`,
          'What should happen? Summarize sales',
          'When should it run? Daily',
          'Where should the result go? Slack',
        ].join('; '),
      );
    },
  );

  it('delivers the same scope when the dock is already open', async () => {
    render(<Shell startOpen />);
    const input = await scopeAndSubmit('reports');

    await waitFor(() =>
      expect(input.value).toContain('Automation category: reports'),
    );
    expect(input.value).toContain('Where should the result go? Slack');
  });
});
