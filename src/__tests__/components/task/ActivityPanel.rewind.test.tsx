import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActivityPanel } from '@/components/task/ActivityPanel';
import type { AgentMessage } from '@/shared/hooks/agent-types';

import { renderWithProviders } from '../../helpers/render-with-providers';

const taskId = 'task-129';
const userMessageId = '20266436-aab4-4a9a-b582-ea82eed599b2';
const messages: AgentMessage[] = [
  { type: 'user', messageRowId: 42, content: 'Edit the draft' },
  {
    type: 'tool_use',
    id: 'tool-1',
    name: 'Edit',
    input: { file_path: '/work/task-session/draft.md' },
  },
];

function renderPanel(isRunning = false, onRewindComplete = vi.fn()) {
  renderWithProviders(
    <ActivityPanel
      messages={messages}
      taskId={taskId}
      sessionRoot="/work/task-session"
      isRunning={isRunning}
      onOpenDiff={vi.fn()}
      onRewindComplete={onRewindComplete}
    />,
  );
  return onRewindComplete;
}

function stubFetch(
  list: { checkpoints: { messageRowId: number; userMessageId: string }[] },
  rewind: (dryRun: boolean) => Response,
) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (input.includes('/agent/rewind/checkpoints/')) {
      return new Response(JSON.stringify(list), { status: 200 });
    }
    if (input.endsWith('/agent/rewind')) {
      const request = JSON.parse(String(init?.body)) as { dryRun: boolean };
      return rewind(request.dryRun);
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function rewindPosts(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls
    .filter(([input]) => input.endsWith('/agent/rewind'))
    .map(
      ([, init]) =>
        JSON.parse(String(init?.body)) as {
          taskId: string;
          userMessageId: string;
          dryRun: boolean;
        },
    );
}

afterEach(() => vi.unstubAllGlobals());

describe('Activity rewind', () => {
  it('previews tracked files before submitting the confirmed rewind', async () => {
    const fetchMock = stubFetch(
      { checkpoints: [{ messageRowId: 42, userMessageId }] },
      () =>
        new Response(
          JSON.stringify({
            canRewind: true,
            filesChanged: ['/work/task-session/draft.md'],
          }),
          { status: 200 },
        ),
    );
    const onComplete = renderPanel();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Rewind files to before this turn',
      }),
    );
    expect(
      await screen.findByText('Files that would change: 1'),
    ).toBeInTheDocument();
    expect(screen.getByText('draft.md')).toBeInTheDocument();
    expect(rewindPosts(fetchMock)).toEqual([
      { taskId, userMessageId, dryRun: true },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Rewind files' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(rewindPosts(fetchMock)).toEqual([
      { taskId, userMessageId, dryRun: true },
      { taskId, userMessageId, dryRun: false },
    ]);
    expect(screen.getByText('Files rewound.')).toBeInTheDocument();
  });

  it('hides the action for tasks without recorded Claude checkpoints and while running', async () => {
    const fetchMock = stubFetch({ checkpoints: [] }, () => {
      throw new Error('Unexpected rewind');
    });
    renderPanel();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          input.includes('/rewind/checkpoints/'),
        ),
      ).toHaveLength(1),
    );
    expect(
      screen.queryByRole('button', {
        name: 'Rewind files to before this turn',
      }),
    ).not.toBeInTheDocument();
  });

  it('hides the rewind action while a task is running', () => {
    const fetchMock = stubFetch(
      { checkpoints: [{ messageRowId: 42, userMessageId }] },
      () => {
        throw new Error('Unexpected rewind');
      },
    );
    renderPanel(true);
    expect(
      screen.queryByRole('button', {
        name: 'Rewind files to before this turn',
      }),
    ).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        input.includes('/rewind/checkpoints/'),
      ),
    ).toHaveLength(0);
  });

  it('keeps the files unchanged when the preview is empty', async () => {
    const fetchMock = stubFetch(
      { checkpoints: [{ messageRowId: 42, userMessageId }] },
      (dryRun) =>
        dryRun
          ? new Response(
              JSON.stringify({ canRewind: true, filesChanged: [] }),
              { status: 200 },
            )
          : new Response(
              JSON.stringify({
                canRewind: false,
                error: 'Checkpoint not found',
              }),
              { status: 404 },
            ),
    );
    renderPanel();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Rewind files to before this turn',
      }),
    );
    expect(
      await screen.findByText('No tracked files would change.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Rewind files' }),
    ).not.toBeInTheDocument();
    expect(rewindPosts(fetchMock)).toHaveLength(1);
  });

  it('displays the endpoint status and error when a preview fails', async () => {
    const fetchMock = stubFetch(
      { checkpoints: [{ messageRowId: 42, userMessageId }] },
      () =>
        new Response(
          JSON.stringify({ canRewind: false, error: 'Checkpoint not found' }),
          { status: 404 },
        ),
    );
    renderPanel();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Rewind files to before this turn',
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '404: Checkpoint not found',
    );
    expect(rewindPosts(fetchMock)).toHaveLength(1);
  });
});
