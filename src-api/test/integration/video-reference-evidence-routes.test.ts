import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import { closeDatabase } from '@/shared/db';
import { setVideoFeatureFlag } from '@/shared/video/flags';
import { createProject } from '@/shared/video/store';
import type { VideoProject, VideoReference } from '@/shared/video/types';

const FIXTURE = fileURLToPath(
  new URL('../fixtures/video/reference/still-8s.mp4', import.meta.url),
);

describe('video reference evidence routes', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'video-reference-evidence-'),
    );
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setVideoFeatureFlag('video.referenceAnalysis', true);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('builds boundaries and cacheable labeled evidence', async () => {
    const project = await createProject({
      name: 'Reference evidence routes',
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

    const boundaries = await videoRoutes.request(
      `/projects/${project.id}/references/${refId}/boundaries`,
      { method: 'POST' },
    );
    expect(boundaries.status).toBe(200);
    const boundaryBody = (await boundaries.json()) as {
      caveat: string;
      boundaries: { candidates: unknown[] };
    };
    expect(boundaryBody.caveat).toContain('Not shot labels');
    expect(boundaryBody.boundaries.candidates).toEqual([]);

    const evidence = await videoRoutes.request(
      `/projects/${project.id}/references/${refId}/evidence`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ everyMs: 2000, columns: 2, cellWidth: 160 }),
      },
    );
    expect(evidence.status).toBe(200);
    const evidenceBody = (await evidence.json()) as {
      sampledAtMs: number[];
      cacheHit: boolean;
    };
    expect(evidenceBody.cacheHit).toBe(false);
    expect(evidenceBody.sampledAtMs).toEqual(
      [...evidenceBody.sampledAtMs].sort((left, right) => left - right),
    );

    const listed = await videoRoutes.request(
      `/projects/${project.id}/references/${refId}/evidence`,
    );
    expect(listed.status).toBe(200);
  });
});
