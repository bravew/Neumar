import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import { getDatabase } from '@/shared/db';
import { drainVideoJobs } from '@/shared/video/jobs';
import { writeProject } from '@/shared/video/store';

import { createEditorHandoffFixtureProject } from '../unit/video/editor-handoff/fixture-project';

let workDir: string;

describe('video editor handoff routes', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'handoff-route-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('queues, runs, and reports an editor handoff package job', async () => {
    const project = await createEditorHandoffFixtureProject(workDir);
    await writeProject(project);
    getDatabase()
      .prepare(
        `INSERT INTO video_projects
          (id, name, template, updated_at, render_status, budget_cap_cents, budget_spent_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.template,
        project.updatedAt,
        'idle',
        0,
        0,
      );

    const queued = await videoRoutes.request(
      `/projects/${project.id}/editor-handoff`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: ['final-cut-pro', 'premiere-pro', 'edl'],
          mediaMode: 'copy',
        }),
      },
    );

    expect(queued.status).toBe(202);
    const queuedBody = (await queued.json()) as {
      job: { id: string; kind: string; status: string };
    };
    expect(queuedBody.job).toMatchObject({
      kind: 'editor-handoff',
      status: 'queued',
    });

    await drainVideoJobs(1);

    const status = await videoRoutes.request(
      `/projects/${project.id}/editor-handoff/${queuedBody.job.id}`,
    );
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as {
      job: { status: string };
      packagePath?: string;
      conformance?: { errorCount: number };
    };
    expect(statusBody.job.status).toBe('done');
    expect(statusBody.conformance?.errorCount).toBe(1);
    expect(statusBody.packagePath).toBeTruthy();
    await expect(fs.access(statusBody.packagePath!)).resolves.toBeUndefined();
  });
});
