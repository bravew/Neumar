import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import { closeDatabase } from '@/shared/db';
import { setVideoFeatureFlag } from '@/shared/video/flags';
import { createProject, getVideoProjectDir } from '@/shared/video/store';
import type { VideoProject, VideoReference } from '@/shared/video/types';

const FIXTURE = fileURLToPath(
  new URL('../fixtures/video/reference/still-8s.mp4', import.meta.url),
);

describe('video reference routes', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'video-reference-routes-'),
    );
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setVideoFeatureFlag('video.referenceAnalysis', true);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('returns 404 when the flag is off', async () => {
    const project = await createProject({
      name: 'Reference flag',
      template: 'explainer',
    });
    setVideoFeatureFlag('video.referenceAnalysis', false);
    const res = await videoRoutes.request(`/projects/${project.id}/references`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      reason: 'feature-disabled',
      flag: 'video.referenceAnalysis',
    });
  });

  it('creates, lists, reads, promotes, and deletes a reference', async () => {
    const project = await createProject({
      name: 'Reference crud',
      template: 'explainer',
    });
    const bytes = await fs.readFile(FIXTURE);
    const form = new FormData();
    form.append(
      'file',
      new File([bytes], 'still-8s.mp4', { type: 'video/mp4' }),
    );
    form.append('studyAcknowledged', 'true');
    form.append('label', 'Still study');

    const created = await videoRoutes.request(
      `/projects/${project.id}/references`,
      { method: 'POST', body: form },
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      project: VideoProject;
      reference: VideoReference;
    };
    expect(createdBody.project.assets).toEqual([]);
    expect(createdBody.reference.rights.studyAcknowledged).toBe(true);
    expect(createdBody.reference.rights.reuseAcknowledged).toBe(false);
    const referenceId = createdBody.reference.id;

    const listed = await videoRoutes.request(
      `/projects/${project.id}/references`,
    );
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as {
      references: VideoReference[];
    };
    expect(listedBody.references).toHaveLength(1);

    const one = await videoRoutes.request(
      `/projects/${project.id}/references/${referenceId}`,
    );
    expect(one.status).toBe(200);

    const missingAck = await videoRoutes.request(
      `/projects/${project.id}/references/${referenceId}/promote`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(missingAck.status).toBeGreaterThanOrEqual(400);

    const promoted = await videoRoutes.request(
      `/projects/${project.id}/references/${referenceId}/promote`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reuseAcknowledged: true }),
      },
    );
    expect(promoted.status).toBe(200);
    const promotedBody = (await promoted.json()) as {
      project: VideoProject;
      reference: VideoReference;
    };
    expect(promotedBody.project.assets).toHaveLength(1);
    expect(promotedBody.reference.rights.reuseAcknowledged).toBe(true);

    const archive = path.join(
      getVideoProjectDir(project.id),
      'references',
      referenceId,
    );
    await expect(fs.access(archive)).resolves.toBeUndefined();

    const deleted = await videoRoutes.request(
      `/projects/${project.id}/references/${referenceId}`,
      { method: 'DELETE' },
    );
    expect(deleted.status).toBe(200);
    const deletedBody = (await deleted.json()) as { project: VideoProject };
    expect(deletedBody.project.videoReferences).toEqual([]);
    expect(deletedBody.project.assets).toHaveLength(1);
    await expect(fs.stat(archive)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects multipart intake without a study acknowledgement', async () => {
    const project = await createProject({
      name: 'Reference ack',
      template: 'explainer',
    });
    const bytes = await fs.readFile(FIXTURE);
    const form = new FormData();
    form.append(
      'file',
      new File([bytes], 'still-8s.mp4', { type: 'video/mp4' }),
    );
    const res = await videoRoutes.request(
      `/projects/${project.id}/references`,
      {
        method: 'POST',
        body: form,
      },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'study-required' });
  });

  it('serves the media variants and lets the analysis range be re-trimmed', async () => {
    const project = await createProject({
      name: 'Reference range route',
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
    const { reference } = (await created.json()) as {
      reference: VideoReference;
    };

    const media = await videoRoutes.request(
      `/projects/${project.id}/references/${reference.id}/media`,
    );
    expect(media.status).toBe(200);
    const sourceMedia = await videoRoutes.request(
      `/projects/${project.id}/references/${reference.id}/media?variant=source`,
    );
    expect(sourceMedia.status).toBe(200);

    const tooLong = await videoRoutes.request(
      `/projects/${project.id}/references/${reference.id}/analysis-range`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startMs: 0,
          endMs: reference.durationMs + 60_000,
        }),
      },
    );
    expect(tooLong.status).toBe(422);

    const patched = await videoRoutes.request(
      `/projects/${project.id}/references/${reference.id}/analysis-range`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startMs: 1000, endMs: 4000 }),
      },
    );
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as { reference: VideoReference };
    expect(patchedBody.reference.analysisRange).toEqual({
      startMs: 1000,
      endMs: 4000,
    });

    const mediaAfter = await videoRoutes.request(
      `/projects/${project.id}/references/${reference.id}/media`,
    );
    expect(mediaAfter.status).toBe(200);
  });
});
