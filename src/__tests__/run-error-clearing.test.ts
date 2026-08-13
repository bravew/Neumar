import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentActions } from '@/shared/hooks/useAgentActions';
import { useBranchActions } from '@/shared/hooks/useBranchActions';

vi.mock('@/shared/db', () => ({
  createMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/db/database', () => ({
  createBranch: vi.fn().mockResolvedValue('branch-1'),
  createEditBranch: vi.fn().mockResolvedValue({
    branchId: 'branch-1',
    messageUuid: 'edited-msg-1',
  }),
  getMessagesByTaskId: vi.fn().mockResolvedValue([]),
  regenerateResponse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/stores/branch-store', () => ({
  useBranchStore: Object.assign(
    vi.fn(() => ({
      addBranch: vi.fn(),
      setActiveBranch: vi.fn(),
      selectBranchAtFork: vi.fn(),
    })),
    { getState: () => ({ taskBranches: {} }) },
  ),
}));

/**
 * Regression coverage for the stale run-error banner bug: a prior run's
 * error stayed on screen after the user switched models and sent a new
 * message, because nothing cleared it before the new `runAgent()` call —
 * only the manual dismiss (×) wired `clearRunError`. Reproduced live: the
 * network request correctly carried `agentType: "claude"` on the second
 * send, and the backend returned a fresh, different error, but the UI kept
 * showing the first run's message untouched.
 */
describe('run-error clearing on new runs', () => {
  const agentRef = {
    current: {
      messages: [] as unknown[],
      isRunning: false,
      addMessage: vi.fn(),
      setMessages: vi.fn(),
      abortRun: vi.fn(),
      runAgent: vi.fn().mockResolvedValue(undefined),
    },
  } as never;
  const taskIdRef = { current: 'task-1' } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    (agentRef as { current: { isRunning: boolean } }).current.isRunning = false;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
  });

  it('clears the stale error before starting a fresh AskUserQuestion-bridge run', async () => {
    const clearRunError = vi.fn();
    const historyMessagesRef = { current: undefined } as never;
    const { result } = renderHook(() =>
      useAgentActions(
        agentRef,
        taskIdRef,
        historyMessagesRef,
        vi.fn(),
        undefined,
        undefined,
        undefined,
        clearRunError,
      ),
    );

    await act(async () => {
      result.current.handleSendMessage('answer');
    });

    expect(clearRunError).toHaveBeenCalled();
    const agent = (
      agentRef as { current: { runAgent: ReturnType<typeof vi.fn> } }
    ).current;
    expect(clearRunError.mock.invocationCallOrder[0]).toBeLessThan(
      agent.runAgent.mock.invocationCallOrder[0],
    );
  });

  it('clears the stale error before regenerating a response', async () => {
    const clearRunError = vi.fn();
    const workDirRef = { current: undefined } as never;
    const additionalWorkDirsRef = { current: undefined } as never;
    const modelConfigRef = { current: undefined } as never;

    const { result } = renderHook(() =>
      useBranchActions(
        agentRef,
        taskIdRef,
        workDirRef,
        additionalWorkDirsRef,
        modelConfigRef,
        clearRunError,
      ),
    );

    await act(async () => {
      await result.current.handleRegenerate('msg-1');
    });

    expect(clearRunError).toHaveBeenCalled();
    const agent = (
      agentRef as { current: { runAgent: ReturnType<typeof vi.fn> } }
    ).current;
    expect(clearRunError.mock.invocationCallOrder[0]).toBeLessThan(
      agent.runAgent.mock.invocationCallOrder[0],
    );
  });

  it('clears the stale error before resubmitting an edited message', async () => {
    const clearRunError = vi.fn();
    const workDirRef = { current: undefined } as never;
    const additionalWorkDirsRef = { current: undefined } as never;
    const modelConfigRef = { current: undefined } as never;

    const { result } = renderHook(() =>
      useBranchActions(
        agentRef,
        taskIdRef,
        workDirRef,
        additionalWorkDirsRef,
        modelConfigRef,
        clearRunError,
      ),
    );

    await act(async () => {
      await result.current.handleEditMessage('msg-1', 'edited text');
    });

    expect(clearRunError).toHaveBeenCalled();
    const agent = (
      agentRef as { current: { runAgent: ReturnType<typeof vi.fn> } }
    ).current;
    expect(clearRunError.mock.invocationCallOrder[0]).toBeLessThan(
      agent.runAgent.mock.invocationCallOrder[0],
    );
  });
});
