import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import {
  writeVideoAgentPlan,
  readVideoAgentPlan,
  supersedeVideoAgentPlan,
} from '@/shared/video/agent-plan';
import { listVideoIntentLog } from '@/shared/video/recipes';
import {
  createProject,
  getProject,
  getVideoProjectDir,
  writeProject,
} from '@/shared/video/store';

describe('durable Video agent plans', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-agent-plan-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('persists the canonical plan and an atomic, path-redacted Markdown projection', async () => {
    const project = await createProject({
      name: 'External montage',
      template: 'slideshow',
    });
    const externalPath = path.join(workDir, 'external', 'master.mp4');
    await fs.mkdir(path.dirname(externalPath), { recursive: true });
    await fs.writeFile(externalPath, 'video');
    await writeProject({
      ...(await getProject(project.id)),
      assets: [
        {
          id: 'asset-1',
          kind: 'video',
          source: 'user',
          origin: 'external',
          path: externalPath,
          metadata: { durationMs: 4000 },
          provenance: { sourceDisplayName: 'master.mp4' },
        },
      ],
    });

    const written = await writeVideoAgentPlan(project.id, {
      title: 'Build the montage',
      request: 'Use the selected clip and add music.',
      assumptions: ['Output is 16:9.'],
      steps: [
        {
          id: 'storyboard',
          title: 'Apply storyboard',
          intent: 'Create one scene from the selected clip.',
          dependsOn: [],
          operation: 'video_set_storyboard',
          inputs: { assetId: 'asset-1', sourcePath: externalPath },
          verification: ['One scene references asset-1.'],
          rollback: 'Apply the journal inverse diff.',
        },
      ],
    });
    const markdown = await fs.readFile(written.markdownPath, 'utf8');
    const persisted = await getProject(project.id);

    expect(written.drifted).toBe(false);
    expect(persisted.agentPlan).toMatchObject({
      status: 'active',
      revision: 1,
      title: 'Build the montage',
    });
    expect(markdown).toContain('`asset-1` — master.mp4');
    expect(markdown).toContain('[external path redacted]');
    expect(markdown).not.toContain(externalPath);
    expect(
      (
        await fs.readdir(path.join(getVideoProjectDir(project.id), 'agent'))
      ).sort(),
    ).toEqual(['plan.md']);

    await fs.appendFile(written.markdownPath, '\nmanual edit\n');
    await expect(readVideoAgentPlan(project.id)).resolves.toMatchObject({
      drifted: true,
    });
  });

  it('makes a written plan executable and records the request in the intent log', async () => {
    const project = await createProject({
      name: 'Approval',
      template: 'slideshow',
    });
    const written = await writeVideoAgentPlan(project.id, {
      title: 'Confirmed cut',
      request: 'Build the cut I just confirmed.',
      steps: [
        {
          id: 'render',
          title: 'Render',
          intent: 'Render and verify the final cut.',
          dependsOn: [],
          operation: 'video_render',
          inputs: { preset: 'standard' },
          verification: ['Human review passes.'],
          rollback: 'Keep the prior render output.',
        },
      ],
    });

    const persisted = await getProject(project.id);
    const intents = listVideoIntentLog(project.id);

    expect(written.drifted).toBe(false);
    // No second approval step: writing the plan is what makes it runnable.
    expect(persisted.agentPlan).toMatchObject({
      status: 'active',
      projectRevisionAtStart: persisted.revision,
      createdAt: expect.any(String),
    });
    // The user instruction the plan came from is the durable consent record.
    expect(intents.at(-1)).toMatchObject({
      accepted: true,
      userIntentText: 'Build the cut I just confirmed.',
      planId: persisted.agentPlan?.id,
      planRevision: persisted.agentPlan?.revision,
    });
  });

  it('migrates a legacy draft/approved plan to the active shape on load', async () => {
    const project = await createProject({ name: 'Legacy', template: 'custom' });
    const persisted = await getProject(project.id);
    // Shape written before the approval states were removed.
    await writeProject({
      ...persisted,
      agentPlan: {
        schemaVersion: 1,
        id: 'legacy-plan',
        revision: 1,
        status: 'draft',
        title: 'Legacy plan',
        request: 'Build it.',
        assumptions: [],
        projectRevisionAtApproval: 3,
        approvedAt: '2026-08-01T00:00:00.000Z',
        steps: [],
        markdownDigest: 'legacy',
      },
    } as never);

    const loaded = await getProject(project.id);

    expect(loaded.agentPlan).toMatchObject({
      id: 'legacy-plan',
      status: 'active',
      projectRevisionAtStart: 3,
      createdAt: '2026-08-01T00:00:00.000Z',
    });
    expect(loaded.agentPlan).not.toHaveProperty('projectRevisionAtApproval');
    expect(loaded.agentPlan).not.toHaveProperty('approvedAt');
  });

  it('creates a new plan revision after superseding the previous one', async () => {
    const project = await createProject({ name: 'Revise', template: 'custom' });
    const input = {
      title: 'First cut',
      request: 'Build it.',
      steps: [
        {
          id: 'step-1',
          title: 'Build',
          intent: 'Build it.',
          dependsOn: [],
          operation: 'video_set_storyboard',
          inputs: {},
          verification: ['Storyboard exists.'],
          rollback: 'Restore the prior storyboard.',
        },
      ],
    };
    await writeVideoAgentPlan(project.id, input);
    await supersedeVideoAgentPlan(project.id);
    await writeVideoAgentPlan(project.id, { ...input, title: 'Second cut' });

    await expect(getProject(project.id)).resolves.toMatchObject({
      agentPlan: { revision: 2, status: 'active', title: 'Second cut' },
    });
  });
});
