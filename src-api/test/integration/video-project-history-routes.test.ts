import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import { closeDatabase } from '@/shared/db';
import type {
  ProjectRevisionEntry,
  RestoreResult,
} from '@/shared/video/project-history';
import { getProject, writeProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

let workDir: string;

beforeEach(async () => {
  closeDatabase();
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-history-routes-'));
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
});

afterEach(async () => {
  closeDatabase();
  vi.unstubAllEnvs();
  await fs.rm(workDir, { recursive: true, force: true });
});

async function listHistory(): Promise<{
  currentRevision: number;
  entries: ProjectRevisionEntry[];
}> {
  const response = await videoRoutes.request('/projects/project-1/history');
  expect(response.status).toBe(200);
  return (await response.json()) as {
    currentRevision: number;
    entries: ProjectRevisionEntry[];
  };
}

describe('project history routes', () => {
  it('lists every saved revision with its author and counts', async () => {
    await writeProject(projectFixture());
    const saved = await getProject('project-1');
    await writeProject(
      { ...saved, name: 'Second pass' },
      { authorKind: 'user', reason: 'Renamed' },
    );

    const history = await listHistory();
    expect(history.entries.length).toBeGreaterThanOrEqual(2);
    expect(history.entries.at(-1)).toMatchObject({
      authorKind: 'user',
      reason: 'Renamed',
    });
    expect(history.currentRevision).toBe(
      (await getProject('project-1')).revision,
    );
  });

  it('previews a prior revision without changing the project', async () => {
    await writeProject(projectFixture());
    const [first] = (await listHistory()).entries;
    const saved = await getProject('project-1');
    await writeProject({ ...saved, name: 'Changed' });

    const response = await videoRoutes.request(
      `/projects/project-1/history/${first!.digest}`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { project: VideoProject };
    expect(body.project.name).toBe('History routes');
    // Preview is read-only.
    expect((await getProject('project-1')).name).toBe('Changed');
  });

  it('names a revision so retention will not prune it', async () => {
    await writeProject(projectFixture());
    const [entry] = (await listHistory()).entries;

    const response = await videoRoutes.request(
      `/projects/project-1/history/${entry!.digest}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Client approved' }),
      },
    );

    expect(response.status).toBe(200);
    expect(
      (await listHistory()).entries.find(
        (candidate) => candidate.digest === entry!.digest,
      ),
    ).toMatchObject({ name: 'Client approved' });
  });

  it('returns 404 when naming a revision that does not exist', async () => {
    await writeProject(projectFixture());

    const response = await videoRoutes.request(
      `/projects/project-1/history/${'a'.repeat(64)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Nope' }),
      },
    );

    expect(response.status).toBe(404);
  });

  it('summarizes the difference between two revisions', async () => {
    await writeProject(projectFixture());
    const [first] = (await listHistory()).entries;
    const saved = await getProject('project-1');
    await writeProject({
      ...saved,
      timeline: { ...saved.timeline!, durationMs: 9000 },
    });
    const entries = (await listHistory()).entries;
    const latest = entries.at(-1)!;

    const response = await videoRoutes.request(
      `/projects/project-1/history/${first!.digest}/compare?against=${latest.digest}`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { durationDeltaMs: number };
    expect(body.durationDeltaMs).toBe(5000);
  });

  it('requires the against parameter to compare', async () => {
    await writeProject(projectFixture());
    const [first] = (await listHistory()).entries;

    const response = await videoRoutes.request(
      `/projects/project-1/history/${first!.digest}/compare`,
    );

    expect(response.status).toBe(400);
  });

  it('restores forward: the head is captured and the pointer never moves back', async () => {
    await writeProject(projectFixture());
    const original = (await listHistory()).entries.at(-1)!;
    const saved = await getProject('project-1');
    await writeProject({ ...saved, name: 'Work in progress' });
    const head = await getProject('project-1');

    const response = await videoRoutes.request(
      `/projects/project-1/history/${original.digest}/restore`,
      { method: 'POST' },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as RestoreResult;
    const restored = await getProject('project-1');

    expect(restored.name).toBe('History routes');
    // Forward, not backward: the restore is a new revision above the head it
    // replaced, so the work in progress is still recoverable.
    expect(restored.revision).toBeGreaterThan(head.revision);
    expect(body.headSnapshot.digest).toBeTruthy();
    const headPreview = await videoRoutes.request(
      `/projects/project-1/history/${body.headSnapshot.digest}`,
    );
    expect(
      ((await headPreview.json()) as { project: VideoProject }).project.name,
    ).toBe('Work in progress');
  });

  it('restoring the same digest twice lands on the same document', async () => {
    await writeProject(projectFixture());
    const original = (await listHistory()).entries.at(-1)!;
    const saved = await getProject('project-1');
    await writeProject({ ...saved, name: 'Diverged' });

    await videoRoutes.request(
      `/projects/project-1/history/${original.digest}/restore`,
      { method: 'POST' },
    );
    const first = await getProject('project-1');
    await videoRoutes.request(
      `/projects/project-1/history/${original.digest}/restore`,
      { method: 'POST' },
    );
    const second = await getProject('project-1');

    expect(second.name).toBe(first.name);
    expect(second.timeline).toEqual(first.timeline);
    // A second restore is still a new revision; it is idempotent in content,
    // not in revision number.
    expect(second.revision).toBeGreaterThan(first.revision);
  });

  it('rejects a digest that is not a sha256', async () => {
    await writeProject(projectFixture());

    const response = await videoRoutes.request(
      '/projects/project-1/history/not-a-digest',
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'History routes',
    template: 'custom',
    prompt: '',
    revision: 0,
    assets: [],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 4000,
      fps: 30,
      tracks: [
        {
          id: 'track-video-main',
          kind: 'video',
          name: 'Video 1',
          muted: false,
          locked: false,
          order: 0,
          clips: [],
        },
      ],
    },
    render: { status: 'idle' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
  } as VideoProject;
}
