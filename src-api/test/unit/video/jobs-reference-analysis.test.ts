import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import {
  drainVideoJobs,
  enqueueReferenceAnalysisJob,
  listVideoJobs,
} from '@/shared/video/jobs';
import { acquireReference } from '@/shared/video/reference/acquire';
import { startReferenceRun } from '@/shared/video/reference/run';
import { createProject } from '@/shared/video/store';

const FIXTURE = fileURLToPath(
  new URL('../../fixtures/video/reference/still-8s.mp4', import.meta.url),
);

describe('reference-analysis video jobs', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-job-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    await drainVideoJobs(8).catch(() => undefined);
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('enqueues and drains a reference-analysis job', async () => {
    const project = await createProject({
      name: 'Reference job',
      template: 'explainer',
    });
    const { reference } = await acquireReference(project.id, {
      origin: 'upload',
      studyAcknowledged: true,
      fileBytes: await fs.readFile(FIXTURE),
      fileName: 'still-8s.mp4',
    });
    const run = await startReferenceRun(project.id, reference.id);
    const job = await enqueueReferenceAnalysisJob(project.id, {
      referenceId: reference.id,
      runId: run.id,
    });
    expect(job.kind).toBe('reference-analysis');
    expect(listVideoJobs(project.id).some((item) => item.id === job.id)).toBe(
      true,
    );
    const done = await drainVideoJobs(4);
    expect(done.some((item) => item.id === job.id)).toBe(true);
  });
});
