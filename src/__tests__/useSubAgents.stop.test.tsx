/**
 * Stop clears the background-task indicator (issue #76 / C6).
 *
 * Decision (2026-09-27, final — see
 * dev-doc/plan/2026-09-27-post-upgrade-sdk-feature-adoption.md, C6): Stop
 * must stop background sub-agents and Bash tasks too, and Neumar does not
 * set `perTaskStopAffordance`. The SDK's documented default already kills
 * background tasks/workflows on interrupt, so a stopped run never sends a
 * `step_finished`/task_notification for a background task that was still
 * running — the indicator must still clear when the run ends, not wait for
 * a notification that will never arrive.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSubAgents } from '@/shared/hooks/useSubAgents';

type TaskEventHandler = (msg: Record<string, unknown>) => void;

let capturedHandler: TaskEventHandler | undefined;

vi.mock('@/shared/hooks/useTaskEventSource', () => ({
  useTaskEventSource: (
    _taskId: string | undefined,
    _isRunning: boolean,
    onMessage: TaskEventHandler,
  ) => {
    capturedHandler = onMessage;
  },
}));

describe('useSubAgents — Stop clears the background-task indicator', () => {
  it('marks a background sub-agent and a background Bash task completed when the run ends without a step_finished', () => {
    const { result, rerender } = renderHook(
      ({ isRunning }: { isRunning: boolean }) =>
        useSubAgents('task-1', isRunning),
      { initialProps: { isRunning: true } },
    );

    // "start a turn that launches a background sub-agent (Agent tool,
    // run_in_background) and a background Bash task" — both arrive as
    // step_started with no matching step_finished yet.
    act(() => {
      capturedHandler?.({
        type: 'step_started',
        id: 'bg-agent-1',
        stepName: 'sub-agent: researcher',
      });
      capturedHandler?.({
        type: 'step_started',
        id: 'bg-bash-1',
        stepName: 'bash: sleep 300',
      });
    });

    expect(result.current.map((a) => a.id).sort()).toEqual([
      'bg-agent-1',
      'bg-bash-1',
    ]);
    expect(result.current.every((a) => a.status === 'running')).toBe(true);

    // "press Stop" — the SDK kills the CLI process and every background
    // task with it, so no task_notification ever arrives for either task;
    // the only observable signal is the run itself ending (isRunning ->
    // false). The indicator must clear anyway.
    act(() => {
      rerender({ isRunning: false });
    });

    expect(result.current).toHaveLength(2);
    expect(result.current.every((a) => a.status === 'completed')).toBe(true);
    expect(result.current.every((a) => a.completedAt !== undefined)).toBe(true);
  });

  it('resets to empty when the task changes', () => {
    const { result, rerender } = renderHook(
      ({ taskId }: { taskId: string }) => useSubAgents(taskId, true),
      { initialProps: { taskId: 'task-1' } },
    );

    act(() => {
      capturedHandler?.({ type: 'step_started', id: 'bg-agent-1' });
    });
    expect(result.current).toHaveLength(1);

    rerender({ taskId: 'task-2' });
    expect(result.current).toHaveLength(0);
  });
});
