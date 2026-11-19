import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  onPermissionWaitsSettled,
  openPermissionWait,
  resetPermissionWaitsForTest,
} from '@/core/agent/permission-waits';

import {
  expectContinuationRunId,
  hasPermissionHold,
  holdUntilPermissionsSettled,
  releasePermissionHold,
} from '@/shared/services/ag-ui/permission-hold';

function openWait(taskId: string, id: string): () => void {
  return openPermissionWait({
    taskId,
    sessionId: 's',
    prompt: { id, tool: 'Bash', command: 'ls', description: 'd' },
    expiresAt: null,
  } as never);
}

afterEach(() => {
  releasePermissionHold('t1');
  resetPermissionWaitsForTest();
});

function hold(signal = new AbortController().signal) {
  const resume = vi.fn();
  const abandon = vi.fn();
  holdUntilPermissionsSettled({ taskId: 't1', signal, resume, abandon });
  return { resume, abandon };
}

describe('permission waits', () => {
  it('settles immediately when nothing is open', () => {
    const settled = vi.fn();
    onPermissionWaitsSettled('t1', settled);
    expect(settled).toHaveBeenCalledOnce();
  });

  it('waits for every open prompt of the task, and only that task', () => {
    const settled = vi.fn();
    const settleA = openWait('t1', 'a');
    const settleB = openWait('t1', 'b');
    const settleOther = openWait('t2', 'c');
    onPermissionWaitsSettled('t1', settled);

    settleA();
    expect(settled).not.toHaveBeenCalled();
    settleB();
    expect(settled).toHaveBeenCalledOnce();
    settleOther();
  });

  it('does not call a cancelled waiter', () => {
    const settled = vi.fn();
    const settle = openWait('t1', 'a');
    const cancel = onPermissionWaitsSettled('t1', settled);

    cancel();
    settle();

    expect(settled).not.toHaveBeenCalled();
  });

  it('treats settling twice as one settle', () => {
    const settled = vi.fn();
    const settleA = openWait('t1', 'a');
    openWait('t1', 'b');
    onPermissionWaitsSettled('t1', settled);

    settleA();
    settleA();

    expect(settled).not.toHaveBeenCalled();
  });
});

describe('permission hold', () => {
  it('starts the continuation once the last prompt settles', () => {
    const settleA = openWait('t1', 'a');
    const settleB = openWait('t1', 'b');
    const { resume, abandon } = hold();

    settleA();
    expect(resume).not.toHaveBeenCalled();
    settleB();

    expect(resume).toHaveBeenCalledOnce();
    expect(abandon).not.toHaveBeenCalled();
    expect(hasPermissionHold('t1')).toBe(false);
  });

  it('uses the run id the answering request named', () => {
    const settle = openWait('t1', 'a');
    const { resume } = hold();

    expect(expectContinuationRunId('t1', 'run-42')).toBe(true);
    settle();

    expect(resume).toHaveBeenCalledWith('run-42');
  });

  it('continues at once when the prompt was answered before the hold began', () => {
    const { resume } = hold();

    expect(resume).toHaveBeenCalledOnce();
  });

  it('abandons instead of continuing when the run was stopped', () => {
    const controller = new AbortController();
    const settle = openWait('t1', 'a');
    const { resume, abandon } = hold(controller.signal);

    // An abort settles the prompt it was waiting on; that is not an answer.
    controller.abort();
    settle();

    expect(resume).not.toHaveBeenCalled();
    expect(abandon).toHaveBeenCalledOnce();
  });

  it('release abandons without a continuation, even if a prompt settles later', () => {
    const settle = openWait('t1', 'a');
    const { resume, abandon } = hold();

    expect(releasePermissionHold('t1')).toBe(true);
    settle();

    expect(abandon).toHaveBeenCalledOnce();
    expect(resume).not.toHaveBeenCalled();
    expect(releasePermissionHold('t1')).toBe(false);
  });

  it('reports no hold for a task that is not held', () => {
    expect(expectContinuationRunId('t1', 'run')).toBe(false);
  });
});
