import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import { closeDatabase, getDatabase } from '@/shared/db';
import { createProject } from '@/shared/video/store';

describe('video agent run context route', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-run-context-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    vi.stubEnv('NEUMA_VIDEO_AGENTIC_RUNTIME', 'off');
    vi.stubEnv('NEUMA_VIDEO_AGENT_SDK', 'off');
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('rejects missing and mismatched project owners before launching', async () => {
    const project = await createProject({
      name: 'Run context owner',
      template: 'slideshow',
    });
    const missing = await videoRoutes.request('/projects/missing/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Make a cut', mode: 'chat' }),
    });
    expect(missing.status).toBe(404);

    const mismatch = await videoRoutes.request(
      `/projects/${project.id}/agent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'Make a cut',
          mode: 'chat',
          runContext: { projectId: 'another-project' },
        }),
      },
    );
    expect(mismatch.status).toBe(409);
  });

  it('generates omitted identities and converges duplicate request keys', async () => {
    const project = await createProject({
      name: 'Run context identity',
      template: 'slideshow',
    });
    const omitted = await videoRoutes.request(`/projects/${project.id}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Make a cut', mode: 'chat' }),
    });
    expect(omitted.status).toBe(200);
    await omitted.text();

    const request = {
      message: 'Try a tighter cut',
      mode: 'chat',
      runContext: {
        clientRequestId: crypto.randomUUID(),
        messageId: crypto.randomUUID(),
      },
    };
    const first = await videoRoutes.request(`/projects/${project.id}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    expect(first.status).toBe(200);
    await first.text();
    const duplicate = await videoRoutes.request(
      `/projects/${project.id}/agent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      },
    );
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      disposition: 'existing',
    });

    const rows = getDatabase()
      .prepare(
        `SELECT id, client_request_id, request_message_id
         FROM agent_runs
         WHERE mode = 'video' AND owner_key = ?
         ORDER BY started_at`,
      )
      .all(project.id) as Array<{
      id: string;
      client_request_id: string | null;
      request_message_id: string | null;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.client_request_id)).toBe(true);
    expect(rows.every((row) => row.request_message_id)).toBe(true);
    for (const row of rows) {
      const events = getDatabase()
        .prepare(
          `SELECT seq, event_type FROM agent_run_events
           WHERE run_id = ? AND seq >= 0 ORDER BY seq`,
        )
        .all(row.id) as Array<{ seq: number; event_type: string }>;
      expect(events[0]).toMatchObject({ seq: 0, event_type: 'RUN_STARTED' });
      expect(events.at(-1)?.event_type).toBe('RUN_FINISHED');
    }
  });
});
