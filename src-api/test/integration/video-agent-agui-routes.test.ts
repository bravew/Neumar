import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/video/agent-sdk', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/video/agent-sdk')>();
  return {
    ...actual,
    isVideoAgenticRuntimeEnabled: () => true,
    runVideoAgentTurn: vi.fn(
      (
        _project: unknown,
        prompt: string,
        _context: unknown,
        options: { signal?: AbortSignal },
      ) =>
        (async function* () {
          yield { type: 'text' as const, content: 'first' };
          await new Promise((resolve) =>
            setTimeout(resolve, prompt.includes('slow') ? 80 : 10),
          );
          if (options.signal?.aborted) {
            const error = new Error('aborted');
            error.name = 'AbortError';
            throw error;
          }
          yield { type: 'text' as const, content: 'second' };
        })(),
    ),
  };
});

import { aguiRoutes } from '@/app/api/ag-ui';
import { videoRoutes } from '@/app/api/video';

import { closeDatabase, getDatabase } from '@/shared/db';
import { getActiveAGUIRun } from '@/shared/services/ag-ui/runtime';
import { createProject } from '@/shared/video/store';

async function readUntilRunStarted(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  const decoder = new TextDecoder();
  let received = '';
  while (!received.includes('RUN_STARTED')) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('Stream closed before RUN_STARTED');
    received += decoder.decode(chunk.value, { stream: true });
  }
}

describe('Video agent durable AG-UI route', () => {
  let workDir = '';

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-agent-agui-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('journals one root run and one terminal event', async () => {
    const project = await createProject({
      name: 'AG-UI journal',
      template: 'slideshow',
    });
    const response = await videoRoutes.request(
      `/projects/${project.id}/agent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Make it concise', mode: 'chat' }),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('RUN_STARTED');
    expect(body).toContain('RUN_FINISHED');

    const runs = getDatabase()
      .prepare(
        `SELECT id, status FROM agent_runs
         WHERE mode = 'video' AND owner_key = ? AND parent_run_id IS NULL`,
      )
      .all(project.id) as Array<{ id: string; status: string }>;
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('completed');
    const terminals = getDatabase()
      .prepare(
        `SELECT event_type FROM agent_run_events
         WHERE run_id = ? AND event_type IN ('RUN_FINISHED', 'RUN_ERROR')`,
      )
      .all(runs[0]?.id) as Array<{ event_type: string }>;
    expect(terminals).toEqual([{ event_type: 'RUN_FINISHED' }]);
  });

  it('continues and finalizes after the initiating client disconnects', async () => {
    const project = await createProject({
      name: 'Detached AG-UI',
      template: 'slideshow',
    });
    const response = await videoRoutes.request(
      `/projects/${project.id}/agent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'slow turn', mode: 'chat' }),
      },
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) throw new Error('Missing response reader');
    await readUntilRunStarted(reader);
    await reader?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const run = getDatabase()
      .prepare(
        `SELECT status FROM agent_runs
         WHERE mode = 'video' AND owner_key = ?`,
      )
      .get(project.id) as { status: string };
    expect(run.status).toBe('completed');
  });

  it('cancels through the owner-checked AG-UI route', async () => {
    const project = await createProject({
      name: 'Cancelled AG-UI',
      template: 'slideshow',
    });
    const response = await videoRoutes.request(
      `/projects/${project.id}/agent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'slow cancellation', mode: 'chat' }),
      },
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing response reader');
    await readUntilRunStarted(reader);
    const run = getDatabase()
      .prepare(
        `SELECT id FROM agent_runs
         WHERE mode = 'video' AND owner_key = ? AND status = 'running'`,
      )
      .get(project.id) as { id: string };
    expect(getActiveAGUIRun('video', project.id, run.id)).toBeDefined();

    const cancelled = await aguiRoutes.request(
      `/cancel/video/${encodeURIComponent(project.id)}/${encodeURIComponent(run.id)}`,
      { method: 'POST' },
    );
    expect(await cancelled.json()).toEqual({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await reader.cancel();

    expect(
      getDatabase()
        .prepare('SELECT status FROM agent_runs WHERE id = ?')
        .get(run.id),
    ).toMatchObject({ status: 'cancelled' });
    expect(
      getDatabase()
        .prepare(
          `SELECT event_type FROM agent_run_events
           WHERE run_id = ? AND event_type IN ('RUN_FINISHED', 'RUN_ERROR')`,
        )
        .all(run.id),
    ).toEqual([{ event_type: 'RUN_ERROR' }]);
  });
});
