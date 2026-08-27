import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import { writeVideoAgentPlan } from '@/shared/video/agent-plan';
import { appendVideoExecutionLog } from '@/shared/video/execution-log';
import { getVideoPlanResumeState } from '@/shared/video/plan-runner';
import {
  createProject,
  getProject,
  updateProjectDocument,
} from '@/shared/video/store';

describe('Video durable plan resume cursor', () => {
  let workDir: string;
  let projectId: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-plan-runner-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    projectId = (
      await createProject({ name: 'Resume project', template: 'custom' })
    ).id;
    await writeVideoAgentPlan(projectId, {
      title: 'Resume plan',
      request: 'Build and render.',
      steps: [
        {
          id: 'storyboard',
          title: 'Storyboard',
          intent: 'Apply the storyboard.',
          dependsOn: [],
          operation: 'video_set_storyboard',
          inputs: {},
          verification: ['Storyboard is present.'],
          rollback: 'Use the inverse diff.',
        },
        {
          id: 'render',
          title: 'Render',
          intent: 'Render the approved storyboard.',
          dependsOn: ['storyboard'],
          operation: 'video_render',
          inputs: {},
          verification: ['Render passes QA.'],
          rollback: 'Keep the prior render.',
        },
      ],
    });
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('resumes at the first dependency-ready incomplete step', async () => {
    await expect(getVideoPlanResumeState(projectId)).resolves.toMatchObject({
      status: 'ready',
      completedStepIds: [],
      nextStep: { id: 'storyboard' },
    });
  });

  it('imposes no revision constraint before the plan has run a step', async () => {
    // Writing a plan does not freeze the project. The user is free to keep
    // editing between planning and execution — only an in-flight plan can be
    // conflicted with.
    await updateProjectDocument(projectId, (project) => ({
      ...project,
      name: 'Edited before execution',
    }));

    await expect(getVideoPlanResumeState(projectId)).resolves.toMatchObject({
      status: 'ready',
      nextStep: { id: 'storyboard' },
    });
  });

  it('pauses when an unrelated edit lands while the plan is in flight', async () => {
    const project = await getProject(projectId);
    const plan = project.agentPlan!;
    await appendVideoExecutionLog(projectId, {
      runId: 'run-1',
      planId: plan.id,
      planRevision: plan.revision,
      stepId: 'storyboard',
      attempt: 1,
      phase: 'succeeded',
      operation: 'video_set_storyboard',
      idempotencyKey: 'key-1',
      inputDigest: 'input-1',
      projectRevisionBefore: project.revision,
      projectRevisionAfter: project.revision,
    });
    await updateProjectDocument(projectId, (current) => ({
      ...current,
      name: 'Manually edited',
    }));

    await expect(getVideoPlanResumeState(projectId)).resolves.toMatchObject({
      status: 'paused',
      reason: expect.stringContaining('does not match plan revision cursor'),
    });
  });

  it('detects a commit that occurred before the terminal log write', async () => {
    const project = await getProject(projectId);
    const plan = project.agentPlan!;
    await appendVideoExecutionLog(projectId, {
      runId: 'interrupted-run',
      planId: plan.id,
      planRevision: plan.revision,
      stepId: 'storyboard',
      attempt: 1,
      phase: 'started',
      operation: 'video_set_storyboard',
      idempotencyKey: 'interrupted-key',
      inputDigest: 'interrupted-input',
      projectRevisionBefore: project.revision,
    });
    await updateProjectDocument(projectId, (current) => ({
      ...current,
      storyboard: {
        status: 'edited',
        intent: 'Committed before terminal log',
        totalDurationMs: 0,
        costEstimateUsd: { low: 0, high: 0 },
        scenes: [],
      },
    }));

    await expect(getVideoPlanResumeState(projectId)).resolves.toMatchObject({
      status: 'paused',
      uncertainOperations: [
        { stepId: 'storyboard', operation: 'video_set_storyboard', attempt: 1 },
      ],
    });
  });
});
