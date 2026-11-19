import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePermissionRequests } from '@/shared/hooks/usePermissionRequests';

vi.mock('@/config', () => ({ API_BASE_URL: 'http://localhost:5126' }));
vi.mock('@/shared/hooks/useTaskEventSource', () => ({
  useTaskEventSource: vi.fn(),
}));

const permission = {
  id: 'perm-1',
  tool: 'Bash',
  command: 'ls',
  description: 'List files',
};

const interrupt = {
  id: 'permission:perm-1',
  reason: 'tool_permission',
  message: 'Run Bash?',
  responseSchema: { type: 'object' },
  metadata: { decision: { kind: 'permission', taskId: 'task-1', permission } },
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(openInterrupts: unknown[]) {
  const fetchMock = vi.fn(async (url: string) =>
    url.includes('/ag-ui/interrupts/')
      ? response({ interrupts: openInterrupts })
      : response({ success: true }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mount(isRunning: boolean, runAgent = vi.fn().mockResolvedValue({})) {
  const view = renderHook(
    (props: { isRunning: boolean }) =>
      usePermissionRequests('task-1', props.isRunning, { runAgent }),
    { initialProps: { isRunning } },
  );
  return { ...view, runAgent };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePermissionRequests after the run ends at a prompt', () => {
  it('loads the prompt the agent is still waiting on and marks it paused', async () => {
    stubFetch([interrupt]);
    const { result } = mount(false);

    await waitFor(() =>
      expect(result.current.permissionRequests).toMatchObject([
        { id: 'perm-1', paused: true },
      ]),
    );
  });

  it('never denies a waiting prompt just because the run ended', async () => {
    const fetchMock = stubFetch([interrupt]);
    const { result, rerender } = mount(true);

    rerender({ isRunning: false });

    await waitFor(() =>
      expect(result.current.permissionRequests[0]?.paused).toBe(true),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://localhost:5126/agent/permission',
      expect.anything(),
    );
  });

  it('answers a paused prompt by resuming the run, not through the live endpoint', async () => {
    const fetchMock = stubFetch([interrupt]);
    const { result, runAgent } = mount(false);
    await waitFor(() =>
      expect(result.current.permissionRequests[0]?.paused).toBe(true),
    );

    await act(() => result.current.respond('perm-1', 'always_allow'));

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent.mock.calls[0]?.[0]).toEqual({
      resume: [
        {
          interruptId: 'permission:perm-1',
          status: 'resolved',
          payload: { approved: true, alwaysAllow: true },
        },
      ],
      forwardedProps: { taskId: 'task-1' },
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://localhost:5126/agent/permission',
      expect.anything(),
    );
    expect(result.current.permissionRequests[0]).toMatchObject({
      resolved: true,
      decision: 'always_allow',
    });
  });

  it('sends an explicit denial as approved false', async () => {
    stubFetch([interrupt]);
    const { result, runAgent } = mount(false);
    await waitFor(() =>
      expect(result.current.permissionRequests[0]?.paused).toBe(true),
    );

    await act(() => result.current.respond('perm-1', 'deny'));

    expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
      resume: [{ payload: { approved: false } }],
    });
  });

  it('does not send a persistent rule the agent forbade', async () => {
    stubFetch([
      {
        ...interrupt,
        metadata: {
          decision: {
            kind: 'permission',
            taskId: 'task-1',
            permission: { ...permission, suppress_always_allow_rule: true },
          },
        },
      },
    ]);
    const { result, runAgent } = mount(false);
    await waitFor(() =>
      expect(result.current.permissionRequests[0]?.paused).toBe(true),
    );

    await act(() => result.current.respond('perm-1', 'always_allow'));

    expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
      resume: [{ payload: { approved: true } }],
    });
    expect(
      (runAgent.mock.calls[0]?.[0] as { resume: Array<{ payload: object }> })
        .resume[0]?.payload,
    ).not.toHaveProperty('alwaysAllow');
  });

  it('reopens the card when the answer lost a race, and closes it once the server says it is gone', async () => {
    const fetchMock = stubFetch([interrupt]);
    const runAgent = vi.fn().mockRejectedValue(new Error('already answered'));
    const { result } = mount(false, runAgent);
    await waitFor(() =>
      expect(result.current.permissionRequests[0]?.paused).toBe(true),
    );
    fetchMock.mockImplementation(async () => response({ interrupts: [] }));

    await act(() => result.current.respond('perm-1', 'allow'));

    await waitFor(() =>
      expect(result.current.permissionRequests[0]).toMatchObject({
        resolved: true,
        decision: 'deny',
      }),
    );
  });

  it('keeps a prompt open when the interrupt list cannot be read', async () => {
    const fetchMock = stubFetch([interrupt]);
    const { result, rerender } = mount(true);
    // The live prompt arrives while the run is active; a failing read at the
    // end of the run must not close it.
    fetchMock.mockImplementation(async () => response({}, 500));
    act(() => {
      rerender({ isRunning: false });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.permissionRequests.every((p) => !p.resolved)).toBe(
      true,
    );
  });
});

describe('usePermissionRequests while the run is live', () => {
  it('answers through the live endpoint', async () => {
    const fetchMock = stubFetch([]);
    const { result, runAgent } = mount(true);

    await act(() => result.current.respond('perm-live', 'allow'));

    expect(runAgent).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5126/agent/permission',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
