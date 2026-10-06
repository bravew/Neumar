import { HttpAgent, type AgentSubscriber } from '@ag-ui/client';
import { EventType } from '@ag-ui/core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useRunError } from '@/shared/hooks/useRunError';

const sessionLimitMessage =
  "You've hit your session limit · resets 7pm (Asia/Shanghai)";

function createAgent() {
  let subscriber: AgentSubscriber | undefined;
  const unsubscribe = vi.fn();
  const agent = {
    messages: [],
    isRunning: true,
    abortRun: vi.fn(),
    subscribe: vi.fn((nextSubscriber: AgentSubscriber) => {
      subscriber = nextSubscriber;
      return { unsubscribe };
    }),
  };
  const eventParams = {
    agent: new HttpAgent({ url: 'http://localhost:5126/ag-ui' }),
    messages: [],
    state: {},
    input: {
      threadId: 'task-1',
      runId: 'run-1',
      messages: [],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    },
  };
  return {
    agent,
    unsubscribe,
    eventParams,
    getSubscriber: () => {
      if (!subscriber) throw new Error('Expected an agent subscription');
      return subscriber;
    },
  };
}

describe('useRunError agent events', () => {
  it('captures RUN_ERROR synchronously and preserves the reset timezone without aborting the stream', () => {
    const { agent, eventParams, getSubscriber } = createAgent();
    const { result } = renderHook(() =>
      useRunError('task-1', agent, 'Agent run failed'),
    );
    const onRunError = getSubscriber().onRunErrorEvent;
    expect(onRunError).toBeTypeOf('function');

    act(() => {
      onRunError?.({
        ...eventParams,
        event: { type: EventType.RUN_ERROR, message: sessionLimitMessage },
      });
      // The terminal notification can read the ref before React commits state.
      expect(result.current.runErrorRef.current).toBe(sessionLimitMessage);
    });

    expect(result.current.runError).toBe(sessionLimitMessage);
    expect(agent.abortRun).not.toHaveBeenCalled();
  });

  it('clears both the error ref and state when the next run starts', () => {
    const { agent, eventParams, getSubscriber } = createAgent();
    const { result } = renderHook(() =>
      useRunError('task-1', agent, 'Agent run failed'),
    );
    const subscriber = getSubscriber();
    expect(subscriber.onRunStartedEvent).toBeTypeOf('function');

    act(() => {
      subscriber.onRunErrorEvent?.({
        ...eventParams,
        event: { type: EventType.RUN_ERROR, message: sessionLimitMessage },
      });
    });
    expect(result.current.runError).toBe(sessionLimitMessage);

    act(() => {
      subscriber.onRunStartedEvent?.({
        ...eventParams,
        event: {
          type: EventType.RUN_STARTED,
          threadId: 'task-1',
          runId: 'run-2',
        },
      });
      expect(result.current.runErrorRef.current).toBeNull();
    });

    expect(result.current.runError).toBeNull();
    expect(agent.abortRun).not.toHaveBeenCalled();
  });

  it('surfaces a transport failure through onRunFailed without aborting the stream', () => {
    const { agent, eventParams, getSubscriber } = createAgent();
    const { result } = renderHook(() =>
      useRunError('task-1', agent, 'Agent run failed'),
    );
    const subscriber = getSubscriber();
    expect(subscriber.onRunFailed).toBeTypeOf('function');

    act(() => {
      subscriber.onRunFailed?.({
        ...eventParams,
        error: new Error('Connection closed before the run finished'),
      });
      expect(result.current.runErrorRef.current).toBe(
        'Connection closed before the run finished',
      );
    });

    expect(result.current.runError).toBe(
      'Connection closed before the run finished',
    );
    expect(agent.abortRun).not.toHaveBeenCalled();
  });

  it('keeps the specific RUN_ERROR when a generic onRunFailed follows it', () => {
    const { agent, eventParams, getSubscriber } = createAgent();
    const { result } = renderHook(() =>
      useRunError('task-1', agent, 'Agent run failed'),
    );
    const subscriber = getSubscriber();

    act(() => {
      subscriber.onRunErrorEvent?.({
        ...eventParams,
        event: { type: EventType.RUN_ERROR, message: sessionLimitMessage },
      });
      subscriber.onRunFailed?.({
        ...eventParams,
        error: new Error('Agent run failed'),
      });
    });

    expect(result.current.runError).toBe(sessionLimitMessage);
    expect(result.current.runErrorRef.current).toBe(sessionLimitMessage);
  });

  it('unsubscribes when the agent changes and when the hook unmounts', () => {
    const first = createAgent();
    const second = createAgent();
    const { rerender, unmount } = renderHook(
      ({ agent }) => useRunError('task-1', agent, 'Agent run failed'),
      { initialProps: { agent: first.agent } },
    );

    expect(first.agent.subscribe).toHaveBeenCalledOnce();
    rerender({ agent: second.agent });
    expect(first.unsubscribe).toHaveBeenCalledOnce();
    expect(second.agent.subscribe).toHaveBeenCalledOnce();

    unmount();
    expect(second.unsubscribe).toHaveBeenCalledOnce();
  });

  it('preserves the task-scoped CustomEvent error path and removes its listener on unmount', () => {
    const { agent } = createAgent();
    const { result, unmount } = renderHook(() =>
      useRunError('task-1', agent, 'Agent run failed'),
    );
    const dispatchError = (taskId: string) =>
      window.dispatchEvent(
        new CustomEvent('agui-run-error', {
          detail: { taskId, message: sessionLimitMessage },
        }),
      );

    act(() => {
      dispatchError('other-task');
    });
    expect(result.current.runError).toBeNull();
    expect(agent.abortRun).not.toHaveBeenCalled();

    act(() => {
      dispatchError('task-1');
    });
    expect(result.current.runError).toBe(sessionLimitMessage);
    expect(result.current.runErrorRef.current).toBe(sessionLimitMessage);
    expect(agent.abortRun).toHaveBeenCalledOnce();

    unmount();
    dispatchError('task-1');
    expect(agent.abortRun).toHaveBeenCalledOnce();
  });
});
