import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import { closeDatabase } from '@/shared/db';
import { getProject, writeProject } from '@/shared/video/store';
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
