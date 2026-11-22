import type { ReactNode } from 'react';

import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgUiProvider } from '@/shared/providers/agui-provider';
import { useThreadStore } from '@/shared/stores/thread-store';

const agentMocks = vi.hoisted(() => {
  const agent = {
    isRunning: false,
    messages: [] as Array<{ id: string; role: string; content: string }>,
    setMessages: vi.fn(),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
  };
  agent.setMessages.mockImplementation((messages) => {
    agent.messages = messages;
  });
  return { agent };
});

vi.mock('@copilotkit/react-core/v2', () => ({
  CopilotKit: ({ children }: { children: ReactNode }) => children,
  useAgent: () => ({ agent: agentMocks.agent }),
}));

vi.mock('@/config', () => ({
  API_BASE_URL: 'http://localhost:5126',
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function historyResponse(
  messages: Array<{
    id: string;
    role: 'assistant' | 'user' | 'activity';
    content: string | Record<string, unknown>;
    activityType?: string;
  }>,
) {
  return {
    files: [],
    isRunning: false,
    messages,
  };
}

describe('AgUiProvider history hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentMocks.agent.messages = [];
    useThreadStore.setState({ threads: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('releases pending hydration when the history request times out', async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeout.signal);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init.signal!;
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          }),
      ),
    );

    try {
      render(<AgUiProvider threadId="slow-task">slow</AgUiProvider>);
      expect(
        useThreadStore.getState().threads['slow-task']?.hydrationState,
      ).toBe('pending');
      await act(async () => {
        timeout.abort(new DOMException('History timed out', 'TimeoutError'));
      });
      expect(
        useThreadStore.getState().threads['slow-task']?.hydrationState,
      ).toBe('error');
      expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('keeps a persisted activity card when a thread reloads', async () => {
    // The history endpoint returns activity rows with an object payload. A
    // parser that only accepts text roles throws the whole history away, so a
    // reloaded task loses its download and plan cards along with every message.
    const content = {
      version: 1,
      taskId: 'activity-task',
      runId: 'run-1',
      toolCallId: 'call-1',
      batchId: 'batch-1',
      items: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              historyResponse([
                { id: 'user-1', role: 'user', content: 'download two videos' },
                {
                  id: 'media-download:["activity-task","call-1","batch-1"]',
                  role: 'activity',
                  activityType: 'media-download',
                  content,
                },
              ]),
            ),
        } as Response),
      ),
    );

    render(<AgUiProvider threadId="activity-task">thread</AgUiProvider>);

    await waitFor(() => {
      expect(
        useThreadStore.getState().threads['activity-task']?.messages,
      ).toHaveLength(2);
    });
    expect(
      useThreadStore.getState().threads['activity-task']?.messages[1],
    ).toMatchObject({
      role: 'activity',
      activityType: 'media-download',
      content,
    });
    expect(
      useThreadStore.getState().threads['activity-task']?.hydrationState,
    ).toBe('hydrated');
  });

  it('ignores an older history response that finishes after a task switch', async () => {
    const oldJson = deferred<ReturnType<typeof historyResponse>>();
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/ag-ui/history/old-task')) {
        return Promise.resolve({
          ok: true,
          json: () => oldJson.promise,
        } as Response);
      }
      if (url.endsWith('/ag-ui/history/new-task')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              historyResponse([
                { id: 'new-answer', role: 'assistant', content: 'New task' },
              ]),
            ),
        } as Response);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = render(<AgUiProvider threadId="old-task">old</AgUiProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    view.rerender(<AgUiProvider threadId="new-task">new</AgUiProvider>);
    await waitFor(() => {
      expect(useThreadStore.getState().threads['new-task']?.messages).toEqual([
        { id: 'new-answer', role: 'assistant', content: 'New task' },
      ]);
    });

    await act(async () => {
      oldJson.resolve(
        historyResponse([
          { id: 'old-answer', role: 'assistant', content: 'Old task' },
        ]),
      );
      await oldJson.promise;
    });

    expect(agentMocks.agent.messages).toEqual([
      { id: 'new-answer', role: 'assistant', content: 'New task' },
    ]);
    expect(useThreadStore.getState().threads['old-task']?.messages).not.toEqual(
      [{ id: 'old-answer', role: 'assistant', content: 'Old task' }],
    );
  });
});
