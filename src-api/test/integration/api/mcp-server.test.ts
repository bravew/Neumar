import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mcpServerRoutes } from '@/app/api/mcp-server';

import { getDatabase } from '@/shared/db';
import {
  createAgentRun,
  createProject,
  saveSetting,
} from '@/shared/db/operations';
import {
  ensureBridgeSecret,
  getBridgeSecretPath,
  readBridgeSecret,
} from '@/shared/services/external-mcp/auth';
import { writeDaemonRecord } from '@/shared/services/external-mcp/daemon-record';

function app() {
  const hono = new Hono();
  hono.route('/mcp/server', mcpServerRoutes);
  return hono;
}

function authHeaders(token?: string): Record<string, string> {
  const secret = token ?? readBridgeSecret() ?? ensureBridgeSecret();
  return { Authorization: `Bearer ${secret}` };
}

async function jsonOf(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe('External MCP daemon facade', () => {
  beforeEach(() => {
    saveSetting('externalMcpEnabled', 'false');
    saveSetting('externalMcpWritesEnabled', 'false');
    saveSetting('externalMcpAgentRunsEnabled', 'false');
    ensureBridgeSecret();
  });

  afterEach(() => {
    saveSetting('externalMcpEnabled', 'false');
    saveSetting('externalMcpWritesEnabled', 'false');
    saveSetting('externalMcpAgentRunsEnabled', 'false');
  });

  it('serves /status without a secret and never returns the secret', async () => {
    writeDaemonRecord('http://127.0.0.1:5126');
    const res = await app().request('/mcp/server/status');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ready).toBe(true);
    expect(body.daemonUrl).toBe('http://127.0.0.1:5126');
    expect(body.flags).toMatchObject({
      enabled: false,
      writesEnabled: false,
      agentRunsEnabled: false,
    });
    expect(JSON.stringify(body)).not.toContain(readBridgeSecret());
    expect(body).not.toHaveProperty('secret');
    expect(body).not.toHaveProperty('token');
  });

  it('serves /install-info without a secret', async () => {
    writeDaemonRecord('http://127.0.0.1:5126');
    const res = await app().request('/mcp/server/install-info');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.serverName).toBe('neumar');
    expect(body.daemonUrl).toBe('http://127.0.0.1:5126');
    expect(body.env).toEqual({
      NEUMAR_APP_DATA_DIR: expect.any(String),
    });
    expect(typeof body.codexCommand).toBe('string');
    expect(typeof body.claudeCodeCommand).toBe('string');
    expect(JSON.stringify(body)).not.toContain(readBridgeSecret());
    expect(body).not.toHaveProperty('secret');
  });

  it('rejects command routes when the secret file is missing', async () => {
    unlinkSync(getBridgeSecretPath());
    const res = await app().request('/mcp/server/projects', {
      headers: { Authorization: 'Bearer not-the-secret' },
    });
    expect(res.status).toBe(401);
    const body = await jsonOf(res);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('rejects command routes without a bearer token', async () => {
    saveSetting('externalMcpEnabled', 'true');
    const res = await app().request('/mcp/server/projects');
    expect(res.status).toBe(401);
    expect((await jsonOf(res)).code).toBe('UNAUTHORIZED');
  });

  it('returns FEATURE_DISABLED when the feature flag is off', async () => {
    const res = await app().request('/mcp/server/projects', {
      headers: authHeaders(),
    });
    expect(res.status).toBe(403);
    expect((await jsonOf(res)).code).toBe('FEATURE_DISABLED');
  });

  it('returns WRITE_DISABLED when writes are off', async () => {
    saveSetting('externalMcpEnabled', 'true');
    const res = await app().request('/mcp/server/projects', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: randomUUID(),
        name: 'Blocked Project',
      }),
    });
    expect(res.status).toBe(403);
    expect((await jsonOf(res)).code).toBe('WRITE_DISABLED');
  });

  it('rejects credential-shaped input', async () => {
    saveSetting('externalMcpEnabled', 'true');
    saveSetting('externalMcpWritesEnabled', 'true');
    const res = await app().request('/mcp/server/projects', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: randomUUID(),
        name: 'Secrets',
        apiKey: 'sk-test',
      }),
    });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).code).toBe('VALIDATION_FAILED');
  });

  it('rejects oversized page limits', async () => {
    saveSetting('externalMcpEnabled', 'true');
    const res = await app().request('/mcp/server/projects?limit=101', {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).code).toBe('VALIDATION_FAILED');
  });

  it('lists and creates projects without leaking workspace paths', async () => {
    saveSetting('externalMcpEnabled', 'true');
    saveSetting('externalMcpWritesEnabled', 'true');
    const requestId = randomUUID();
    const created = await app().request('/mcp/server/projects', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        name: `MCP Project ${requestId.slice(0, 8)}`,
        description: 'from tests',
        color: '#112233',
      }),
    });
    expect(created.status).toBe(201);
    const project = await jsonOf(created);
    expect(project).not.toHaveProperty('workspace');
    expect(project).not.toHaveProperty('work_dir');
    expect(typeof project.id).toBe('string');

    const replay = await app().request('/mcp/server/projects', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        name: `MCP Project ${requestId.slice(0, 8)}`,
        description: 'from tests',
        color: '#112233',
      }),
    });
    expect(replay.status).toBe(201);
    expect((await jsonOf(replay)).id).toBe(project.id);

    const listed = await app().request('/mcp/server/projects', {
      headers: authHeaders(),
    });
    expect(listed.status).toBe(200);
    const page = await jsonOf(listed);
    expect(Array.isArray(page.items)).toBe(true);
    expect(page).toHaveProperty('nextCursor');
    expect(JSON.stringify(page)).not.toContain('workspace');
  });

  it('returns CONFLICT when the same requestId is reused with a different payload', async () => {
    saveSetting('externalMcpEnabled', 'true');
    saveSetting('externalMcpWritesEnabled', 'true');
    const requestId = randomUUID();
    const first = await app().request('/mcp/server/projects', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, name: 'First payload' }),
    });
    expect(first.status).toBe(201);

    const second = await app().request('/mcp/server/projects', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, name: 'Different payload' }),
    });
    expect(second.status).toBe(409);
    expect((await jsonOf(second)).code).toBe('CONFLICT');
  });

  it('returns AMBIGUOUS_RESULT for a non-unique project name', async () => {
    saveSetting('externalMcpEnabled', 'true');
    const name = `Dup ${randomUUID()}`;
    createProject({ id: randomUUID(), name });
    createProject({ id: randomUUID(), name });
    const res = await app().request(
      `/mcp/server/projects/${encodeURIComponent(name)}`,
      { headers: authHeaders() },
    );
    expect(res.status).toBe(409);
    expect((await jsonOf(res)).code).toBe('AMBIGUOUS_RESULT');
  });

  it('creates a session+task atomically and allowlists updates', async () => {
    saveSetting('externalMcpEnabled', 'true');
    saveSetting('externalMcpWritesEnabled', 'true');
    const created = await app().request('/mcp/server/tasks', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: randomUUID(),
        prompt: 'Inspect the library',
        title: 'MCP task',
        priority: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const body = await jsonOf(created);
    expect(body.taskId).toBeTruthy();
    expect((body.task as Record<string, unknown>).title).toBe('MCP task');
    expect((body.task as Record<string, unknown>).priority).toBe('high');
    expect(body).not.toHaveProperty('work_dir');

    const patched = await app().request(`/mcp/server/tasks/${body.taskId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Renamed',
        labels: ['mcp'],
        blockedReason: 'waiting',
      }),
    });
    expect(patched.status).toBe(200);
    const updated = await jsonOf(patched);
    expect(updated.title).toBe('Renamed');
    expect(updated.labels).toEqual(['mcp']);
    expect(updated.blockedReason).toBe('waiting');
    expect(updated.status).toBe('running');
  });

  it('adds an agent-attributed comment', async () => {
    saveSetting('externalMcpEnabled', 'true');
    saveSetting('externalMcpWritesEnabled', 'true');
    const created = await app().request('/mcp/server/tasks', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: randomUUID(),
        prompt: 'Needs a comment',
      }),
    });
    const taskId = (await jsonOf(created)).taskId as string;
    const comment = await app().request(
      `/mcp/server/tasks/${taskId}/comments`,
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: randomUUID(),
          content: 'Noted from MCP',
        }),
      },
    );
    expect(comment.status).toBe(201);
    const body = await jsonOf(comment);
    expect(body.authorType).toBe('agent');
    expect(body.authorId).toBe('external-mcp');
    expect(body.content).toBe('Noted from MCP');
  });

  it('filters task search by project before applying the limit', async () => {
    saveSetting('externalMcpEnabled', 'true');
    saveSetting('externalMcpWritesEnabled', 'true');
    const project = createProject({
      id: randomUUID(),
      name: `Search ${randomUUID()}`,
    });
    for (let index = 0; index < 3; index += 1) {
      await app().request('/mcp/server/tasks', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: randomUUID(),
          prompt: `UniqueNeedle task ${index}`,
        }),
      });
    }
    const inProject = await app().request('/mcp/server/tasks', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: randomUUID(),
        prompt: 'UniqueNeedle in project',
        projectId: project.id,
      }),
    });
    expect(inProject.status).toBe(201);

    const res = await app().request(
      `/mcp/server/tasks/search?query=UniqueNeedle&projectId=${project.id}&limit=1`,
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const page = await jsonOf(res);
    expect(page.items).toHaveLength(1);
    expect((page.items as Array<{ projectId: string }>)[0]?.projectId).toBe(
      project.id,
    );
  });

  it('nests source_run_id continuation runs under their source', async () => {
    saveSetting('externalMcpEnabled', 'true');
    saveSetting('externalMcpWritesEnabled', 'true');
    const created = await app().request('/mcp/server/tasks', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: randomUUID(),
        prompt: 'Lineage tree',
      }),
    });
    const taskId = (await jsonOf(created)).taskId as string;
    const rootId = randomUUID();
    const childId = randomUUID();
    createAgentRun({
      id: rootId,
      taskId,
      provider: 'claude',
    });
    createAgentRun({
      id: childId,
      taskId,
      provider: 'claude',
    });
    getDatabase()
      .prepare('UPDATE agent_runs SET source_run_id = ? WHERE id = ?')
      .run(rootId, childId);

    const res = await app().request(`/mcp/server/tasks/${taskId}/run-tree`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const tree = await jsonOf(res);
    const roots = tree.roots as Array<{
      id: string;
      children: Array<{ id: string }>;
    }>;
    expect(roots).toHaveLength(1);
    expect(roots[0]?.id).toBe(rootId);
    expect(roots[0]?.children.map((child) => child.id)).toEqual([childId]);
  });
});
