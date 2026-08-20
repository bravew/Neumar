import { MemoryRouter, useLocation } from 'react-router-dom';

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InitialMessageSender,
  resetInitialSendDispatchTrackingForTests,
  type LocationState,
} from '@/components/task/InitialMessageSender';
import {
  createMessage,
  createSession,
  createTask,
  getMessagesByTaskId,
  getSession,
  getTask,
} from '@/shared/db';
import type { Message, Session, Task } from '@/shared/db';

const agentMocks = vi.hoisted(() => ({
  addMessage: vi.fn(),
  runAgent: vi.fn().mockResolvedValue(undefined),
  setMessages: vi.fn(),
}));

vi.mock('@copilotkit/react-core/v2', () => ({
  useAgent: () => ({
    agent: {
      addMessage: agentMocks.addMessage,
      runAgent: agentMocks.runAgent,
      setMessages: agentMocks.setMessages,
    },
  }),
  useCopilotKit: () => ({
    copilotkit: { runtimeConnectionStatus: 'connected' },
  }),
}));

vi.mock('@/shared/db', () => ({
  createMessage: vi.fn(),
  createSession: vi.fn(),
  createTask: vi.fn(),
  getMessagesByTaskId: vi.fn(),
  getSession: vi.fn(),
  getTask: vi.fn(),
}));

describe('InitialMessageSender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInitialSendDispatchTrackingForTests();
    agentMocks.runAgent.mockResolvedValue(undefined);
    vi.mocked(createMessage).mockResolvedValue(message());
    vi.mocked(createSession).mockResolvedValue(session());
    vi.mocked(createTask).mockResolvedValue(task());
    vi.mocked(getMessagesByTaskId).mockResolvedValue([]);
    vi.mocked(getSession).mockResolvedValue(null);
  });

  it('sends the initial prompt for a newly-created task and clears route state', async () => {
    vi.mocked(getTask).mockResolvedValueOnce(null);

    renderSender();

    await waitFor(() => expect(agentMocks.runAgent).toHaveBeenCalledTimes(1));

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-1',
        session_id: 'session-1',
        prompt: 'Draft a launch plan',
      }),
    );
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: 'task-1',
        type: 'user',
        content: 'Draft a launch plan',
      }),
    );
    expect(agentMocks.setMessages).toHaveBeenCalledWith([]);
    expect(agentMocks.setMessages.mock.invocationCallOrder[0]).toBeLessThan(
      agentMocks.addMessage.mock.invocationCallOrder[0],
    );
    expect(screen.getByTestId('location-state')).toHaveTextContent('null');
  });

  it('does not resend when reload state points at an existing conversation', async () => {
    vi.mocked(getTask).mockResolvedValue(task({ status: 'completed' }));
    vi.mocked(getMessagesByTaskId).mockResolvedValue([
      message({ content: 'Draft a launch plan' }),
    ]);

    renderSender();

    await waitFor(() =>
      expect(getMessagesByTaskId).toHaveBeenCalledWith('task-1'),
    );

    expect(createTask).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
    expect(agentMocks.addMessage).not.toHaveBeenCalled();
    expect(agentMocks.runAgent).not.toHaveBeenCalled();
    expect(screen.getByTestId('location-state')).toHaveTextContent('null');
  });

  it("does not resend the initial prompt on a remount racing ahead of the first send's DB write", async () => {
    // Reproduces the duplicate-"hello"-bubble bug: a remount's DB check
    // (getTask/getMessagesByTaskId) can race ahead of the first mount's own
    // in-flight persistence, so per-instance refs alone don't catch it —
    // the module-level dispatch guard must.
    vi.mocked(getTask).mockResolvedValue(null);
    vi.mocked(getMessagesByTaskId).mockResolvedValue([]);

    const { unmount } = renderSender();
    await waitFor(() => expect(agentMocks.runAgent).toHaveBeenCalledTimes(1));
    unmount();

    renderSender();
    await waitFor(() => expect(agentMocks.addMessage).toHaveBeenCalledTimes(1));
    expect(agentMocks.runAgent).toHaveBeenCalledTimes(1);
  });

  it('does not resend when the existing task is already running', async () => {
    vi.mocked(getTask).mockResolvedValue(task({ status: 'running' }));
    vi.mocked(getMessagesByTaskId).mockResolvedValue([]);

    renderSender();

    await waitFor(() =>
      expect(getMessagesByTaskId).toHaveBeenCalledWith('task-1'),
    );

    expect(createTask).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
    expect(agentMocks.runAgent).not.toHaveBeenCalled();
    expect(screen.getByTestId('location-state')).toHaveTextContent('null');
  });
});

function renderSender(state: LocationState = { ...defaultLocationState }) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/task-v2/task-1',
          state,
        },
      ]}
    >
      <InitialMessageSender taskId="task-1" addTask={vi.fn()} />
      <LocationStateProbe />
    </MemoryRouter>,
  );
}

function LocationStateProbe() {
  const location = useLocation();
  return (
    <output data-testid="location-state">
      {JSON.stringify(location.state ?? null)}
    </output>
  );
}

const defaultLocationState: LocationState = {
  prompt: 'Draft a launch plan',
  sessionId: 'session-1',
  taskIndex: 1,
};

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    prompt: 'Draft a launch plan',
    task_count: 0,
    created_at: '2026-06-27T00:00:00.000Z',
    updated_at: '2026-06-27T00:00:00.000Z',
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    session_id: 'session-1',
    task_index: 1,
    prompt: 'Draft a launch plan',
    status: 'running',
    cost: null,
    duration: null,
    created_at: '2026-06-27T00:00:00.000Z',
    updated_at: '2026-06-27T00:00:00.000Z',
    ...overrides,
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    task_id: 'task-1',
    type: 'user',
    content: 'Draft a launch plan',
    tool_name: null,
    tool_input: null,
    tool_output: null,
    tool_use_id: null,
    subtype: null,
    error_message: null,
    attachments: null,
    message_id: 'msg-1',
    cost: null,
    usage_input: null,
    usage_output: null,
    usage_cache_read: null,
    usage_cache_creation: null,
    model: null,
    created_at: '2026-06-27T00:00:00.000Z',
    ...overrides,
  };
}
