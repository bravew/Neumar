import type { RefObject } from 'react';

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble';
import { getTask, type Task } from '@/shared/db';
import { autoGenerateTitle } from '@/shared/hooks/agent-title';
import type { TaskPlan } from '@/shared/hooks/agent-types';
import { usePostRunEffects } from '@/shared/hooks/usePostRunEffects';
import { notifyAgentEvent } from '@/shared/lib/notifications';

vi.mock('@/shared/db', () => ({ getTask: vi.fn() }));
vi.mock('@/shared/hooks/agent-title', () => ({ autoGenerateTitle: vi.fn() }));
vi.mock('@/shared/hooks/agent-utils', () => ({
  getTaskMessages: () => ({
    notificationTaskDefault: 'Task',
    notificationTaskFailed: 'Task failed',
    notificationTaskCompleted: 'Task completed',
    agentRunFailed: 'Agent run failed',
  }),
}));
vi.mock('@/shared/lib/notifications', () => ({ notifyAgentEvent: vi.fn() }));
vi.mock('@/config', () => ({ API_BASE_URL: 'http://localhost:5126' }));

const sessionLimitMessage =
  "You've hit your session limit · resets 7pm (Asia/Shanghai)";
const taskLabel = 'Create a launch video';

function task(status: Task['status']): Task {
  return {
    id: 'task-1',
    session_id: 'session-1',
    task_index: 1,
    prompt: 'Create a launch video with captions',
    title: taskLabel,
    status,
    cost: null,
    duration: null,
    created_at: '2026-10-05T10:00:00Z',
    updated_at: '2026-10-05T10:00:01Z',
  };
}

const currentUser: AGUIMessage = {
  id: 'user-current',
  role: 'user',
  content: 'Create a launch video with captions',
};
const previousRun: AGUIMessage[] = [
  { id: 'user-old', role: 'user', content: 'Create an earlier draft' },
  {
    id: 'error-old',
    role: 'assistant',
    content: 'An earlier run failed with a different error',
    isError: true,
  },
];

function mountRunningHook(
  messages: AGUIMessage[],
  errorRef?: RefObject<string | null>,
) {
  const planRejectedRef = { current: false };
  const setPendingPlan =
    vi.fn<(plan: React.SetStateAction<TaskPlan | null>) => void>();
  const view = renderHook(
    ({ isRunning, messages }) =>
      usePostRunEffects(
        'task-1',
        { isRunning, messages },
        planRejectedRef,
        setPendingPlan,
        errorRef,
      ),
    { initialProps: { isRunning: true, messages } },
  );
  return {
    ...view,
    finishRun: (finishedMessages = messages) =>
      view.rerender({ isRunning: false, messages: finishedMessages }),
    startRun: (nextMessages: AGUIMessage[]) =>
      view.rerender({ isRunning: true, messages: nextMessages }),
  };
}

function mockHistory(messages: AGUIMessage[]) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/ag-ui/history/task-1')) {
      return Promise.resolve(
        new Response(JSON.stringify({ messages, isRunning: false }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (url.endsWith('/ag-ui/pending-plan/task-1')) {
      return Promise.resolve(
        new Response(JSON.stringify({ plan: null }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('usePostRunEffects terminal error notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTask).mockResolvedValue(task('completed'));
    vi.mocked(notifyAgentEvent).mockResolvedValue(true);
    mockHistory([currentUser]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the synchronous run error as the failed body even when task status is still completed', async () => {
    const errorRef = { current: null as string | null };
    const fetchMock = mockHistory([currentUser]);
    const view = mountRunningHook([currentUser], errorRef);
    expect(notifyAgentEvent).not.toHaveBeenCalled();

    errorRef.current = sessionLimitMessage;
    view.finishRun();

    await waitFor(() => {
      expect(notifyAgentEvent).toHaveBeenCalledWith({
        runId: 'task-1',
        kind: 'failed',
        title: 'Task failed',
        body: sessionLimitMessage,
        link: '/task-v2/task-1',
        source: 'agent-stream',
      });
    });
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/ag-ui/history/'),
      ),
    ).toBe(false);
  });

  it('loads the current-run persisted error when failed status has no direct error', async () => {
    vi.mocked(getTask).mockResolvedValue(task('error'));
    const fetchMock = mockHistory([
      ...previousRun,
      currentUser,
      {
        id: 'error-current',
        role: 'assistant',
        content: sessionLimitMessage,
        isError: true,
      },
    ]);
    const view = mountRunningHook([...previousRun, currentUser]);
    view.finishRun();

    await waitFor(() => {
      expect(notifyAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'failed',
          title: 'Task failed',
          body: sessionLimitMessage,
        }),
      );
    });
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith('/ag-ui/history/task-1'),
      ),
    ).toBe(true);
  });

  it('uses a current-run isError message instead of reporting success for stale completed status', async () => {
    const messages = [
      currentUser,
      {
        id: 'error-current',
        role: 'assistant',
        content: sessionLimitMessage,
        isError: true,
      },
    ];
    mockHistory(messages);
    const view = mountRunningHook([currentUser], { current: null });
    view.finishRun(messages);

    await waitFor(() => {
      expect(notifyAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'failed', body: sessionLimitMessage }),
      );
    });
  });

  it('keeps failed status failed when persisted history has no current-run error', async () => {
    vi.mocked(getTask).mockResolvedValue(task('error'));
    mockHistory([...previousRun, currentUser]);
    const view = mountRunningHook([...previousRun, currentUser]);
    view.finishRun();

    await waitFor(() => {
      expect(notifyAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'failed', title: 'Task failed' }),
      );
    });
    expect(vi.mocked(notifyAgentEvent).mock.calls[0]?.[0].body).not.toBe(
      previousRun[1].content,
    );
  });

  it('uses the task label for a later success without inheriting the earlier run error', async () => {
    const errorRef = { current: sessionLimitMessage as string | null };
    vi.mocked(getTask).mockResolvedValue(task('error'));
    const firstRunMessages = [
      currentUser,
      {
        id: 'error-current',
        role: 'assistant',
        content: sessionLimitMessage,
        isError: true,
      },
    ];
    const view = mountRunningHook(firstRunMessages, errorRef);
    view.finishRun();
    await waitFor(() => expect(notifyAgentEvent).toHaveBeenCalledTimes(1));
    expect(notifyAgentEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'failed', body: sessionLimitMessage }),
    );

    const nextUser: AGUIMessage = {
      id: 'user-next',
      role: 'user',
      content: 'Try again now that the session limit reset',
    };
    const successfulMessages = [
      ...firstRunMessages,
      nextUser,
      { id: 'answer-next', role: 'assistant', content: 'The video is ready' },
    ];
    mockHistory(successfulMessages);
    vi.mocked(getTask).mockResolvedValue(task('completed'));
    errorRef.current = null;
    view.startRun([...firstRunMessages, nextUser]);
    view.finishRun(successfulMessages);

    await waitFor(() => expect(notifyAgentEvent).toHaveBeenCalledTimes(2));
    expect(notifyAgentEvent).toHaveBeenLastCalledWith({
      runId: 'task-1',
      kind: 'succeeded',
      title: 'Task completed',
      body: taskLabel,
      link: '/task-v2/task-1',
      source: 'agent-stream',
    });
    expect(autoGenerateTitle).toHaveBeenCalledOnce();
  });
});
