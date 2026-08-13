import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSetting } from '@/shared/db/operations';
import {
  cancelVideoJob,
  drainVideoJobs,
  enqueueRenderJob,
  listRenderJobs,
} from '@/shared/video/jobs';
import { createProject } from '@/shared/video/store';

const pipelineMocks = vi.hoisted(() => ({
  cancelRender: vi.fn(),
  renderProject: vi.fn(),
}));

vi.mock('@/shared/video/pipeline', () => ({
  cancelRender: pipelineMocks.cancelRender,
  renderProject: pipelineMocks.renderProject,
}));

let workDir: string;

describe('video render queue', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-render-queue-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setSetting('workDir', workDir);
    pipelineMocks.cancelRender.mockReset();
    pipelineMocks.renderProject.mockReset();
    pipelineMocks.renderProject.mockImplementation(
      async (_projectId: string, options: { aspectRatio?: string }) => ({
        status: 'done',
        outputPath: `out-${options.aspectRatio ?? '16:9'}.mp4`,
        updatedAt: new Date().toISOString(),
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('queues and drains multi-aspect render jobs sequentially', async () => {
    const project = await createProject({
      name: 'Queued render',
      template: 'slideshow',
    });

    const job = await enqueueRenderJob(project.id, {
      aspectRatios: ['16:9', '9:16'],
      loudnessTargetLufs: -14,
      autoReframeEnabled: false,
    });
    await drainVideoJobs(1);

    expect(job.kind).toBe('render');
    expect(pipelineMocks.renderProject).toHaveBeenCalledTimes(2);
    expect(pipelineMocks.renderProject).toHaveBeenNthCalledWith(
      1,
      project.id,
      expect.objectContaining({
        aspectRatio: '16:9',
        loudnessTargetLufs: -14,
        autoReframeEnabled: false,
      }),
    );
    expect(pipelineMocks.renderProject).toHaveBeenNthCalledWith(
      2,
      project.id,
      expect.objectContaining({ aspectRatio: '9:16' }),
    );
    expect(listRenderJobs(project.id)[0]).toMatchObject({
      id: job.id,
      status: 'done',
      result: {
        aspectRatios: ['16:9', '9:16'],
      },
    });
  });

  it('cancels an active render job through the render controller', async () => {
    const project = await createProject({
      name: 'Cancellable render',
      template: 'slideshow',
    });
    let finishRender: (value: unknown) => void = () => {};
    pipelineMocks.renderProject.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRender = resolve;
        }),
    );

    const job = await enqueueRenderJob(project.id, { aspectRatios: ['16:9'] });
    await waitForRenderJobStatus(project.id, job.id, 'running');

    expect(cancelVideoJob(job.id)).toMatchObject({ status: 'cancelled' });
    expect(pipelineMocks.cancelRender).toHaveBeenCalledWith(project.id);

    finishRender({
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
    });
    await drainVideoJobs(1);

    expect(listRenderJobs(project.id)[0]).toMatchObject({
      id: job.id,
      status: 'cancelled',
    });
  });
});

async function waitForRenderJobStatus(
  projectId: string,
  jobId: string,
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled',
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const job = listRenderJobs(projectId).find((item) => item.id === jobId);
    if (job?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for render job ${jobId} to be ${status}`);
}
