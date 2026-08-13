import { afterEach, describe, expect, it, vi } from 'vitest';

import { observeTaskStream } from '@/shared/hooks/agent-messages';
import type {
  AgentMessage,
  TaskObserverContext,
} from '@/shared/hooks/useAgent';

vi.mock('@/shared/db', () => ({
  getMessagesByTaskId: vi.fn(async () => []),
  getTask: vi.fn(async () => ({ status: 'completed' })),
  updateTask: vi.fn(async () => undefined),
}));

vi.mock('@/shared/db/settings', () => ({
  getSettings: vi.fn(() => ({ language: 'en' })),
}));

describe('observeTaskStream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    if (vi.isFakeTimers()) vi.useRealTimers();
  });

  it('reconnects from the last observed SSE id', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sseResponse('id: 0\ndata: {"type":"text","content":"hello"}\n\n'),
      )
      .mockResolvedValueOnce(sseResponse('id: 1\ndata: {"type":"done"}\n\n'));
    vi.stubGlobal('fetch', fetchMock);
    const abortCtrl = new AbortController();
    const ctx = observerContext('task-1');

    const stream = observeTaskStream('task-1', abortCtrl, ctx);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(1000);
    await stream;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('from=0');
    expect(ctx.setMessages).toHaveBeenCalled();
    expect(ctx.setPhase).toHaveBeenCalledWith('idle');
  });
});

function observerContext(taskId: string): TaskObserverContext & {
  messages: AgentMessage[];
  setPhase: ReturnType<typeof vi.fn>;
} {
  const ctx = {
    activeTaskIdRef: { current: taskId },
    isRunningRef: { current: true },
    messages: [] as AgentMessage[],
    setIsRunning: vi.fn((value: boolean) => {
      ctx.isRunningRef.current = value;
    }),
    setPhase: vi.fn(),
    setMessages: vi.fn(
      (
        updater: AgentMessage[] | ((prev: AgentMessage[]) => AgentMessage[]),
      ) => {
        ctx.messages =
          typeof updater === 'function' ? updater(ctx.messages) : updater;
      },
    ),
    setPlan: vi.fn(),
  };
  return ctx;
}

function sseResponse(data: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(data));
        controller.close();
      },
    }),
    {
      headers: { 'Content-Type': 'text/event-stream' },
      status: 200,
    },
  );
}
