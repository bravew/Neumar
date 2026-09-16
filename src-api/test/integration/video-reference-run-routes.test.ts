import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import { closeDatabase } from '@/shared/db';
import { setVideoFeatureFlag } from '@/shared/video/flags';
import { drainVideoJobs } from '@/shared/video/jobs';
import { createProject } from '@/shared/video/store';
import type {
  ReferenceRun,
  VideoProject,
  VideoReference,
} from '@/shared/video/types';

const FIXTURE = fileURLToPath(
  new URL('../fixtures/video/reference/still-8s.mp4', import.meta.url),
);

describe('video reference run routes', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-reference-run-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setVideoFeatureFlag('video.referenceAnalysis', true);
  });

  afterEach(async () => {
    await drainVideoJobs(8).catch(() => undefined);
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('starts, snapshots, cancels, and resumes a reference run', async () => {
    const project = await createProject({
      name: 'Reference run routes',
      template: 'explainer',
    });
    const bytes = await fs.readFile(FIXTURE);
    const form = new FormData();
    form.append(
      'file',
      new File([bytes], 'still-8s.mp4', { type: 'video/mp4' }),
    );
    form.append('studyAcknowledged', 'true');
    const created = await videoRoutes.request(
      `/projects/${project.id}/references`,
      { method: 'POST', body: form },
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      project: VideoProject;
      reference: VideoReference;
    };
    const refId = createdBody.reference.id;

    const analyzed = await videoRoutes.request(
      `/projects/${project.id}/references/${refId}/analyze`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ focus: { text: 'titles' } }),
      },
    );
    expect(analyzed.status).toBe(200);
    const analyzedBody = (await analyzed.json()) as { run: ReferenceRun };
    expect(analyzedBody.run.steps).toHaveLength(8);
    expect(analyzedBody.run.focus?.text).toBe('titles');
    expect(analyzedBody.run.jobId).toBeTruthy();

    const snapshot = await videoRoutes.request(
      `/projects/${project.id}/references/${refId}/run`,
    );
    expect(snapshot.status).toBe(200);

    const stream = await videoRoutes.request(
      `/projects/${project.id}/references/${refId}/run/stream`,
    );
    expect(stream.status).toBe(200);

    const cancelled = await videoRoutes.request(
      `/projects/${project.id}/references/${refId}/run/cancel`,
      { method: 'POST' },
    );
    expect(cancelled.status).toBe(200);
    const cancelledBody = (await cancelled.json()) as { run: ReferenceRun };
    expect(cancelledBody.run.status).toBe('cancelled');
    await drainVideoJobs(8);

    const resumed = await videoRoutes.request(
      `/projects/${project.id}/references/${refId}/run/resume`,
      { method: 'POST' },
    );
    expect(resumed.status).toBe(200);
    const resumedBody = (await resumed.json()) as { run: ReferenceRun };
    expect(['queued', 'running', 'done', 'error']).toContain(
      resumedBody.run.status,
    );

    const media = await videoRoutes.request(
      `/projects/${project.id}/references/${refId}/media`,
    );
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toMatch(/video|octet-stream/);
    await drainVideoJobs(8);
  });
});
