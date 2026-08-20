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
  messages: Array<{ id: string; role: 'assistant'; content: string }>,
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
