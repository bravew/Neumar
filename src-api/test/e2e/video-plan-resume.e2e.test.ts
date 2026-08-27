import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getJson, postJson } from '../helpers/http-client';
import {
  spawnApiInstance,
  stopApiInstance,
  type ApiInstance,
} from '../helpers/spawn-api';

describe('video plan resume E2E', () => {
  let api: ApiInstance;
  let homeDir: string;
  let workDir: string;

  beforeAll(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'neumar-e2e-video-resume-home-'));
    workDir = join(homeDir, 'workspace');
    await mkdir(workDir, { recursive: true });
    api = await startApi();
  });

  afterAll(async () => {
    if (api) await stopApiInstance(api);
    await rm(homeDir, { recursive: true, force: true });
  });

  it('restores an approved plan and resume cursor after a real server restart', async () => {
    const created = await postJson(api.baseUrl, '/video/projects', {
      name: 'Durable restart fixture',
      template: 'custom',
    });
    expect(created.status).toBe(201);
    const projectId = (created.json as { project: { id: string } }).project.id;

    const drafted = await postJson(
      api.baseUrl,
      `/video/projects/${projectId}/agent-plan/draft`,
      {
        title: 'Resume after restart',
        request: 'Build this project durably.',
        steps: [
          {
            id: 'storyboard',
            title: 'Set storyboard',
            intent: 'Apply the complete storyboard.',
            dependsOn: [],
            operation: 'video_set_storyboard',
            inputs: {},
            verification: ['Storyboard exists.'],
            rollback: 'Undo the linked journal entry.',
          },
        ],
      },
    );
    expect(drafted.status).toBe(201);
    const approved = await postJson(
      api.baseUrl,
      `/video/projects/${projectId}/agent-plan/approve`,
      {},
    );
    expect(approved.status).toBe(200);

    await stopApiInstance(api);
    api = await startApi();

    const restored = await getJson(
      api.baseUrl,
      `/video/projects/${projectId}/agent-plan`,
    );
    expect(restored.status).toBe(200);
    expect(restored.json).toMatchObject({
      plan: { status: 'approved', title: 'Resume after restart' },
      drifted: false,
      progress: {
        status: 'ready',
        nextStep: { id: 'storyboard' },
      },
    });
  });

  function startApi(): Promise<ApiInstance> {
    return spawnApiInstance('video-plan-resume', {
      homeDir,
      preserveHome: true,
      env: { NEUMA_VIDEO_WORKDIR: workDir },
    });
  }
});
