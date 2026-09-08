import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import { closeDatabase } from '@/shared/db';
import {
  getProject,
  updateProjectDocument,
  writeProject,
} from '@/shared/video/store';
import type { VideoProject, VideoTimeline } from '@/shared/video/types';

let workDir: string;

beforeEach(async () => {
  closeDatabase();
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-timeline-route-'));
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
});

afterEach(async () => {
  closeDatabase();
  vi.unstubAllEnvs();
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('video timeline route', () => {
  it('preserves markers when updating a timeline', async () => {
    await writeProject(projectFixture());

    const timeline: VideoTimeline = {
      ...timelineFixture(),
      markers: [
        {
          id: 'marker-1',
          timeMs: 1200,
          label: '',
          color: 'blue',
          isChapter: true,
          comment: 'First beat',
        },
      ],
      intro: { kind: 'fade', durationMs: 500 },
      outro: { kind: 'fade', durationMs: 750 },
    };

    const response = await videoRoutes.request('/projects/project-1/timeline', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeline }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      project: VideoProject;
      timeline: VideoTimeline;
    };
    expect(body.timeline.markers).toEqual(timeline.markers);
    expect(body.project.timeline?.markers).toEqual(timeline.markers);
    expect(body.project.timeline?.intro).toEqual(timeline.intro);
    expect(body.project.timeline?.outro).toEqual(timeline.outro);

    const persisted = await getProject('project-1');
    expect(persisted.timeline?.markers).toEqual(timeline.markers);
  });

  it('rejects a stale timeline write instead of renumbering it above the state it clobbered', async () => {
    await writeProject(projectFixture());

    // Two tabs both loaded revision 0. The first one saves.
    const first = await videoRoutes.request('/projects/project-1/timeline', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeline: { ...timelineFixture(), durationMs: 5000 },
        expectedRevision: 0,
      }),
    });
    expect(first.status).toBe(200);
    const afterFirst = await getProject('project-1');
    expect(afterFirst.timeline?.durationMs).toBe(5000);

    // The second tab saves the timeline it loaded before the first write.
    const second = await videoRoutes.request('/projects/project-1/timeline', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeline: { ...timelineFixture(), durationMs: 9000 },
        expectedRevision: 0,
      }),
    });

    expect(second.status).toBe(409);
    const conflict = (await second.json()) as {
      error: string;
      currentRevision: number;
      expectedRevision: number;
    };
    expect(conflict.currentRevision).toBe(afterFirst.revision);
    expect(conflict.expectedRevision).toBe(0);

    // The first tab's edit survives; it was not silently clobbered.
    const persisted = await getProject('project-1');
    expect(persisted.timeline?.durationMs).toBe(5000);
  });

  it('still accepts a write that carries the current revision', async () => {
    await writeProject(projectFixture());
    const current = await getProject('project-1');

    const response = await videoRoutes.request('/projects/project-1/timeline', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeline: { ...timelineFixture(), durationMs: 7000 },
        expectedRevision: current.revision,
      }),
    });

    expect(response.status).toBe(200);
    const persisted = await getProject('project-1');
    expect(persisted.timeline?.durationMs).toBe(7000);
    expect(persisted.revision).toBeGreaterThan(current.revision);
  });

  it('serializes a timeline PATCH against an updateProjectDocument caller', async () => {
    await writeProject(projectFixture());

    // Before the two lock maps were collapsed, `withProjectLock` (routes) and
    // `projectDocumentUpdateLocks` (updateProjectDocument) could not see each
    // other, so these two could interleave and one would lose its write.
    const order: string[] = [];
    const patch = videoRoutes
      .request('/projects/project-1/timeline', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: { ...timelineFixture(), durationMs: 5000 },
        }),
      })
      .then((response) => {
        order.push(`patch:${response.status}`);
        return response;
      });
    const documentUpdate = updateProjectDocument(
      'project-1',
      async (project) => {
        order.push('update:start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('update:end');
        return { ...project, name: 'Renamed under the lock' };
      },
    ).then(() => order.push('update:done'));

    await Promise.all([patch, documentUpdate]);

    // Whichever ran first ran to completion before the other started; neither
    // observed a half-applied document.
    expect(order.indexOf('update:start')).toBeLessThan(
      order.indexOf('update:end'),
    );
    const persisted = await getProject('project-1');
    // Both writes survive: the rename and the timeline change are both present.
    expect(persisted.name).toBe('Renamed under the lock');
    expect(persisted.timeline?.durationMs).toBe(5000);
  });

  it('accepts a write with no expectedRevision, for callers that have not adopted it', async () => {
    await writeProject(projectFixture());

    const response = await videoRoutes.request('/projects/project-1/timeline', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeline: { ...timelineFixture(), durationMs: 6000 },
      }),
    });

    expect(response.status).toBe(200);
    expect((await getProject('project-1')).timeline?.durationMs).toBe(6000);
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Timeline route',
    template: 'explainer',
    prompt: '',
    assets: [],
    timeline: timelineFixture(),
    render: { status: 'idle' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-06-19T00:00:00.000Z',
    updatedAt: '2026-06-19T00:00:00.000Z',
  };
}

function timelineFixture(): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: 10_000,
    fps: 30,
    tracks: [
      {
        id: 'track-video-main',
        kind: 'video',
        name: 'Video 1',
        muted: false,
        locked: false,
        hidden: false,
        order: 0,
        clips: [],
      },
    ],
  };
}
