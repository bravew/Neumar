import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mcpServerRoutes } from '@/app/api/mcp-server';

import { createAgentQuestion, saveSetting } from '@/shared/db/operations';
import {
  ensureBridgeSecret,
  readBridgeSecret,
} from '@/shared/services/external-mcp/auth';
import { registerExternalMcpRunLauncher } from '@/shared/services/external-mcp/run-commands';

function app() {
  const hono = new Hono();
  hono.route('/mcp/server', mcpServerRoutes);
  return hono;
}

function authHeaders(): Record<string, string> {
  const secret = readBridgeSecret() ?? ensureBridgeSecret();
  return { Authorization: `Bearer ${secret}` };
}

async function jsonOf(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

async function createTask(prompt: string): Promise<{
  taskId: string;
  sessionId: string;
}> {
  const created = await app().request('/mcp/server/tasks', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: randomUUID(),
      prompt,
    }),
  });
  const body = await jsonOf(created);
  return {
    taskId: body.taskId as string,
    sessionId: body.sessionId as string,
  };
}

describe('External MCP agent runs', () => {
  beforeEach(() => {
    saveSetting('externalMcpEnabled', 'true');
    saveSetting('externalMcpWritesEnabled', 'true');
    saveSetting('externalMcpAgentRunsEnabled', 'false');
    ensureBridgeSecret();
  });

  afterEach(() => {
    saveSetting('externalMcpEnabled', 'false');
    saveSetting('externalMcpWritesEnabled', 'false');
    saveSetting('externalMcpAgentRunsEnabled', 'false');
  });

  it('returns RUN_DISABLED when agent runs are off', async () => {
    const { taskId } = await createTask('Disabled run');
    const res = await app().request('/mcp/server/runs', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: randomUUID(),
        taskId,
      }),
    });
    expect(res.status).toBe(403);
    expect((await jsonOf(res)).code).toBe('RUN_DISABLED');
  });

  it('starts a run immediately, replays requestId, and cancels cooperatively', async () => {
    saveSetting('externalMcpAgentRunsEnabled', 'true');
    const { taskId } = await createTask('Inspect the library from MCP');
    const { taskId: otherTaskId } = await createTask('A different prompt');
    const requestId = randomUUID();

    const started = await app().request('/mcp/server/runs', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, taskId }),
    });
    expect(started.status).toBe(202);
    const first = await jsonOf(started);
    expect(typeof first.runId).toBe('string');
    expect(first.taskId).toBe(taskId);
    expect(first.status).toBe('active');

    const replay = await app().request('/mcp/server/runs', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, taskId }),
    });
    expect(replay.status).toBe(202);
    expect((await jsonOf(replay)).runId).toBe(first.runId);

    const conflict = await app().request('/mcp/server/runs', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        taskId: otherTaskId,
      }),
    });
    expect(conflict.status).toBe(409);
    expect((await jsonOf(conflict)).code).toBe('CONFLICT');

    const got = await app().request(`/mcp/server/runs/${first.runId}`, {
      headers: authHeaders(),
    });
    expect(got.status).toBe(200);
    const status = await jsonOf(got);
    expect(status.runId).toBe(first.runId);
    expect(status.awaitingInput).toBe(false);
    expect(status).toHaveProperty('costUsd');
    expect(status).toHaveProperty('error');

    const cancelled = await app().request(
      `/mcp/server/runs/${first.runId}/cancel`,
      {
        method: 'POST',
        headers: authHeaders(),
      },
    );
    expect(cancelled.status).toBe(200);
    expect((await jsonOf(cancelled)).status).toBe('cancelled');

    const again = await app().request(
      `/mcp/server/runs/${first.runId}/cancel`,
      {
        method: 'POST',
        headers: authHeaders(),
      },
    );
    expect(again.status).toBe(200);
    expect((await jsonOf(again)).status).toBe('cancelled');
  });

  it('surfaces awaiting_input from pending questions', async () => {
    saveSetting('externalMcpAgentRunsEnabled', 'true');
    const { taskId, sessionId } = await createTask('Ask before continuing');
    const started = await app().request('/mcp/server/runs', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: randomUUID(),
        taskId,
      }),
    });
    const runId = (await jsonOf(started)).runId as string;
    createAgentQuestion({
      session_id: sessionId,
      task_id: taskId,
      questions: [{ prompt: 'Which library?' }],
    });
    const got = await app().request(`/mcp/server/runs/${runId}`, {
      headers: authHeaders(),
    });
    const body = await jsonOf(got);
    expect(body.awaitingInput).toBe(true);
  });

  it('returns failed when the launcher throws before the run starts', async () => {
    saveSetting('externalMcpAgentRunsEnabled', 'true');
    registerExternalMcpRunLauncher(() => {
      throw new Error('launch exploded');
    });
    const { taskId } = await createTask('Launcher should fail');
    const started = await app().request('/mcp/server/runs', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: randomUUID(),
        taskId,
      }),
    });
    expect(started.status).toBe(202);
    expect((await jsonOf(started)).status).toBe('failed');
    registerExternalMcpRunLauncher(() => undefined);
  });
});
