import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertRunOwnerExists: vi.fn(),
  getAgentRunEventsAfter: vi.fn().mockReturnValue([]),
  getAgentRun: vi.fn(),
  getAgentRunsByOwner: vi.fn().mockReturnValue([]),
  getAgentRunsByTaskId: vi.fn().mockReturnValue([]),
  getExecutionDiagnostics: vi.fn(),
  buildSupportBundle: vi.fn(),
}));

vi.mock('@/core/agent/run-context', () => ({
  assertRunOwnerExists: mocks.assertRunOwnerExists,
  RunContextError: class RunContextError extends Error {
    constructor(
      message: string,
      readonly status: 400 | 404 | 409,
    ) {
      super(message);
    }
  },
}));

vi.mock('@/shared/db/operations', () => ({
  getAgentRun: mocks.getAgentRun,
  getAgentRunEventsAfter: mocks.getAgentRunEventsAfter,
  getAgentRunsByOwner: mocks.getAgentRunsByOwner,
  getAgentRunsByTaskId: mocks.getAgentRunsByTaskId,
}));

vi.mock('@/shared/observability/support-bundle', () => ({
  buildSupportBundle: mocks.buildSupportBundle,
}));

vi.mock('@/shared/observability/execution-diagnostics', () => ({
  getExecutionDiagnostics: mocks.getExecutionDiagnostics,
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

import { runsRoutes } from '@/app/api/runs';

describe('Runs API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentRunsByOwner.mockReturnValue([]);
    mocks.getAgentRunsByTaskId.mockReturnValue([]);
    mocks.getAgentRun.mockReturnValue(undefined);
    mocks.buildSupportBundle.mockResolvedValue({
      data: Buffer.from('zip'),
      filename: 'neuma-support.zip',
    });
  });

  it('returns diagnostics only after the persisted owner resolves', async () => {
    mocks.getExecutionDiagnostics.mockReturnValue({
      schema: 'neuma.execution-diagnostics.v1',
      runId: 'run-1',
      mode: 'design',
      ownerKey: 'project-1',
    });

    const response = await runsRoutes.request('/run-1/diagnostics');

    expect(response.status).toBe(200);
    expect(mocks.assertRunOwnerExists).toHaveBeenCalledWith(
      'design',
      'project-1',
    );
    expect(await response.json()).toMatchObject({
      schema: 'neuma.execution-diagnostics.v1',
      runId: 'run-1',
    });
  });

  it('does not reveal diagnostics for a missing run', async () => {
    mocks.getExecutionDiagnostics.mockReturnValue(null);
    const response = await runsRoutes.request('/missing/diagnostics');
    expect(response.status).toBe(404);
    expect(mocks.assertRunOwnerExists).not.toHaveBeenCalled();
  });

  it('exports a support bundle only for the matching persisted owner', async () => {
    mocks.getAgentRun.mockReturnValue({
      id: 'run-1',
      mode: 'video',
      owner_key: 'project-1',
    });
    const response = await runsRoutes.request('/run-1/support-bundle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'video', ownerKey: 'project-1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.assertRunOwnerExists).toHaveBeenCalledWith(
      'video',
      'project-1',
    );
    expect(mocks.buildSupportBundle).toHaveBeenCalledWith({
      runId: 'run-1',
      mode: 'video',
      ownerKey: 'project-1',
    });
  });

  it('rejects support export when the requested owner does not match', async () => {
    mocks.getAgentRun.mockReturnValue({
      id: 'run-1',
      mode: 'design',
      owner_key: 'project-1',
    });
    const response = await runsRoutes.request('/run-1/support-bundle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'video', ownerKey: 'project-1' }),
    });

    expect(response.status).toBe(409);
    expect(mocks.buildSupportBundle).not.toHaveBeenCalled();
  });

  it('validates owner mode and loads the owner-neutral tree', async () => {
    const response = await runsRoutes.request('/owner/video/project-1/tree');
    expect(response.status).toBe(200);
    expect(mocks.assertRunOwnerExists).toHaveBeenCalledWith(
      'video',
      'project-1',
    );
    expect(mocks.getAgentRunsByOwner).toHaveBeenCalledWith(
      'video',
      'project-1',
    );
    expect(await response.json()).toMatchObject({
      tree: [],
      executions: [],
    });
  });

  it('keeps the task compatibility route', async () => {
    const response = await runsRoutes.request('/task-1/tree');
    expect(response.status).toBe(200);
    expect(mocks.getAgentRunsByTaskId).toHaveBeenCalledWith('task-1');
  });
});
