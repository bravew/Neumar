import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import { closeDatabase } from '@/shared/db';
import { writeVideoAgentPlan } from '@/shared/video/agent-plan';
import { appendVideoExecutionLog } from '@/shared/video/execution-log';
import { createProject } from '@/shared/video/store';

describe('video durable plan routes', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-plan-routes-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('returns the canonical plan, resume state, and bounded execution log', async () => {
    const project = await createProject({
      name: 'Route plan',
      template: 'custom',
    });
    const written = await writeVideoAgentPlan(project.id, {
      title: 'Build route fixture',
      request: 'Build it durably.',
      steps: [
        {
          id: 'storyboard',
          title: 'Set storyboard',
          intent: 'Set the complete storyboard.',
          dependsOn: [],
          operation: 'video_set_storyboard',
          inputs: {},
          verification: ['Storyboard exists.'],
          rollback: 'Undo the journal entry.',
        },
      ],
    });
    const plan = written.plan!;
    await appendVideoExecutionLog(project.id, {
      runId: 'run-1',
      planId: plan.id,
      planRevision: plan.revision,
      stepId: 'storyboard',
      attempt: 1,
      phase: 'started',
      operation: 'video_set_storyboard',
      idempotencyKey: 'key-1',
      inputDigest: 'digest-1',
      projectRevisionBefore: plan.projectRevisionAtStart,
    });

    const planResponse = await videoRoutes.request(
      `/projects/${project.id}/agent-plan`,
    );
    expect(planResponse.status).toBe(200);
    expect(await planResponse.json()).toMatchObject({
      plan: { id: plan.id, status: 'active' },
      drifted: false,
      progress: { status: 'ready', nextStep: { id: 'storyboard' } },
    });

    const logResponse = await videoRoutes.request(
      `/projects/${project.id}/execution-log?limit=1`,
    );
    expect(logResponse.status).toBe(200);
    expect(await logResponse.json()).toMatchObject({
      records: [{ sequence: 1, phase: 'started', stepId: 'storyboard' }],
    });
  });
});
