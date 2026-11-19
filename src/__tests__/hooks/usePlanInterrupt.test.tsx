import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskPlan } from '@/shared/hooks/agent-types';
import { usePlanInterrupt } from '@/shared/hooks/usePlanInterrupt';

vi.mock('@/config', () => ({ API_BASE_URL: 'http://localhost:5126' }));
vi.mock('@/shared/db/settings', () => ({
  getSettings: () => ({ planMode: 'on' }),
}));

const plan: TaskPlan = {
  id: 'p1',
  goal: 'Ship the change',
  steps: [{ id: 's1', description: 'Write it', status: 'pending' }],
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const interrupt = {
  id: 'plan:p1',
  reason: 'plan_approval',
  message: 'Ship the change',
  responseSchema: { type: 'object' },
  metadata: { decision: { kind: 'plan', plan } },
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubPendingPlan(...bodies: unknown[]) {
  const fetchMock = vi.fn();
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce(response(body));
  }
  fetchMock.mockResolvedValue(response({ plan: null, interrupt: null }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mount(runAgent = vi.fn().mockResolvedValue(undefined)) {
  const workDirRef = { current: '/workspace' };
  const additionalWorkDirsRef = { current: ['/extra'] };
  const modelConfigRef = { current: { model: 'claude-sonnet-5' } };
  const agent = { messages: [], isRunning: false, runAgent };
  const view = renderHook(
    ({ taskId }) =>
      usePlanInterrupt(
        taskId,
        agent,
        null,
        workDirRef,
        additionalWorkDirsRef,
        modelConfigRef,
      ),
    { initialProps: { taskId: 'task-1' } },
  );
  return { ...view, runAgent };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePlanInterrupt standard resume', () => {
  it('loads the plan together with the interrupt that answers it', async () => {
    stubPendingPlan({ plan, interrupt });
    const { result } = mount();

    await waitFor(() =>
      expect(result.current.pendingPlan).toMatchObject({
        id: 'p1',
        goal: 'Ship the change',
      }),
    );
    expect(result.current.pendingDecision?.interrupt.id).toBe('plan:p1');
  });

  it('approves by naming the interrupt id', async () => {
    stubPendingPlan({ plan, interrupt });
    const { result, runAgent } = mount();
    await waitFor(() => expect(result.current.pendingPlan).not.toBeNull());

    act(() => result.current.handleApprovePlan());

    await waitFor(() => expect(runAgent).toHaveBeenCalledTimes(1));
    expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
      resume: [
        {
          interruptId: 'plan:p1',
          status: 'resolved',
          payload: { approved: true },
        },
      ],
      forwardedProps: {
        taskId: 'task-1',
        workDir: '/workspace',
        additionalWorkDirs: ['/extra'],
        modelConfig: { model: 'claude-sonnet-5' },
      },
    });
  });

  it('rejects with an explicit negative answer and shows the steps cancelled', async () => {
    stubPendingPlan({ plan, interrupt });
    const { result, runAgent } = mount();
    await waitFor(() => expect(result.current.pendingPlan).not.toBeNull());

    act(() => result.current.handleRejectPlan());

    await waitFor(() => expect(runAgent).toHaveBeenCalledTimes(1));
    expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
      resume: [
        {
          interruptId: 'plan:p1',
          status: 'resolved',
          payload: { approved: false },
        },
      ],
    });
    expect(result.current.pendingPlan?.steps[0]?.status).toBe('cancelled');
  });

  it('cancels with the standard cancelled status', async () => {
    stubPendingPlan({ plan, interrupt });
    const { result, runAgent } = mount();
    await waitFor(() => expect(result.current.pendingPlan).not.toBeNull());

    act(() => result.current.handleCancelPlan());

    await waitFor(() => expect(runAgent).toHaveBeenCalledTimes(1));
    expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
      resume: [{ interruptId: 'plan:p1', status: 'cancelled' }],
    });
  });

  it('does not submit the same decision twice while it is in flight', async () => {
    stubPendingPlan({ plan, interrupt });
    const runAgent = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = mount(runAgent);
    await waitFor(() => expect(result.current.pendingPlan).not.toBeNull());

    act(() => {
      result.current.handleApprovePlan();
      result.current.handleApprovePlan();
    });

    await waitFor(() => expect(runAgent).toHaveBeenCalledTimes(1));
  });

  it('does not expose the previous task decision after switching tasks', async () => {
    const fetchMock = stubPendingPlan({ plan, interrupt });
    const { result, rerender, runAgent } = mount();
    await waitFor(() => expect(result.current.pendingPlan).not.toBeNull());
    const oldApprove = result.current.handleApprovePlan;

    rerender({ taskId: 'task-2' });
    expect(result.current.pendingPlan).toBeNull();
    act(() => oldApprove());
    expect(runAgent).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:5126/ag-ui/pending-plan/task-2',
        expect.anything(),
      ),
    );
  });

  it('ignores a late submission failure from the previous task', async () => {
    const fetchMock = stubPendingPlan({ plan, interrupt });
    const pending = Promise.withResolvers<void>();
    const runAgent = vi.fn().mockReturnValue(pending.promise);
    const { result, rerender } = mount(runAgent);
    await waitFor(() => expect(result.current.pendingPlan).not.toBeNull());
    act(() => result.current.handleApprovePlan());
    rerender({ taskId: 'task-2' });
    await act(async () => pending.reject(new Error('old request failed')));
    expect(result.current.pendingPlan).toBeNull();
    expect(result.current.submitting).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retains an answerable decision when reloading after a failed submit also fails', async () => {
    const fetchMock = stubPendingPlan({ plan, interrupt });
    const { result } = mount(vi.fn().mockRejectedValue(new Error('offline')));
    await waitFor(() => expect(result.current.pendingPlan).not.toBeNull());
    fetchMock.mockRejectedValue(new Error('offline'));

    act(() => result.current.handleRejectPlan());

    await waitFor(() => expect(result.current.submitting).toBe(false));
    expect(result.current.pendingPlan?.steps[0]?.status).toBe('pending');
    expect(result.current.planRejectedRef.current).toBe(false);
  });

  it('clears a card whose answer lost the race on the server', async () => {
    stubPendingPlan({ plan, interrupt }, { plan: null, interrupt: null });
    const runAgent = vi.fn().mockRejectedValue(new Error('already resolved'));
    const { result } = mount(runAgent);
    await waitFor(() => expect(result.current.pendingPlan).not.toBeNull());

    act(() => result.current.handleApprovePlan());

    await waitFor(() => expect(result.current.pendingPlan).toBeNull());
  });
});
