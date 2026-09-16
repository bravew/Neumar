import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import { closeDatabase } from '@/shared/db';
import { setVideoFeatureFlag } from '@/shared/video/flags';
import { writeReferenceEnvelope } from '@/shared/video/reference/store';
import {
  createProject,
  getProject,
  updateProjectDocument,
} from '@/shared/video/store';
import type { VideoFramework, VideoReference } from '@/shared/video/types';

const FRAMEWORK: VideoFramework = {
  id: 'fw-route',
  version: 1,
  displayName: 'Route spine',
  category: 'explainer',
  hook: 'cold-open',
  pace: 'medium',
  aspectRatios: ['16:9'],
  totalDuration: { typicalMs: 4000, minMs: 2000, maxMs: 8000 },
  sections: [
    {
      id: 'sec-hook',
      role: 'hook',
      purpose: 'Open',
      timing: { proportion: 1, minMs: 1000, maxMs: 8000, observedMs: 4000 },
      slots: [
        {
          id: 'slot-aroll',
          kind: 'a-roll',
          constraints: {},
          fallback: { kind: 'ask-user' },
          required: true,
        },
      ],
      systemIds: [],
      pacing: { cutsPerMinute: 0, shortestHoldMs: 1000, longestHoldMs: 2000 },
      confidence: 0.8,
      derivedFromSectionIds: ['sec-1'],
    },
  ],
  systems: [],
  provenance: {
    referenceId: 'ref-route1',
    derivedFromArtifacts: ['analysis'],
    extractedBy: 'test',
    extractedAt: '2026-09-15T00:00:00.000Z',
  },
  confidence: 0.8,
};

describe('video framework apply routes', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'video-framework-apply-'),
    );
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setVideoFeatureFlag('video.referenceAnalysis', true);
    setVideoFeatureFlag('video.agentApply', false);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('returns 404 when the analysis flag is off', async () => {
    const seeded = await seedProject();
    setVideoFeatureFlag('video.referenceAnalysis', false);
    const res = await videoRoutes.request(
      `/projects/${seeded.id}/frameworks/${FRAMEWORK.id}/bind`,
      { method: 'POST', body: JSON.stringify({}), headers: jsonHeaders },
    );
    expect(res.status).toBe(404);
  });

  it('previews a proposal without mutating the timeline', async () => {
    const seeded = await seedProject();
    const preview = await videoRoutes.request(
      `/projects/${seeded.id}/frameworks/${FRAMEWORK.id}/preview`,
      {
        method: 'POST',
        body: JSON.stringify({ targetMs: 4000 }),
        headers: jsonHeaders,
      },
    );
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as {
      ops: unknown[];
      proposal: unknown;
    };
    expect(body.ops.length).toBeGreaterThan(0);
    expect(body.proposal).toBeTruthy();
    const after = await getProject(seeded.id);
    expect(after.timeline?.tracks[0]?.clips ?? []).toEqual(
      seeded.timeline?.tracks[0]?.clips ?? [],
    );
  });

  it('applies an approved batch onto the user timeline', async () => {
    const seeded = await seedProject();
    const applied = await videoRoutes.request(
      `/projects/${seeded.id}/frameworks/${FRAMEWORK.id}/apply`,
      {
        method: 'POST',
        body: JSON.stringify({
          targetMs: 4000,
          expectedProjectRevision: seeded.revision,
        }),
        headers: jsonHeaders,
      },
    );
    expect(applied.status).toBe(200);
    const next = await getProject(seeded.id);
    expect(next.timeline?.tracks.some((track) => track.clips.length > 0)).toBe(
      true,
    );
    expect(next.revision).toBeGreaterThan(seeded.revision ?? 0);
  });
});

const jsonHeaders = { 'Content-Type': 'application/json' };

async function seedProject() {
  const created = await createProject({
    name: 'Framework apply routes',
    template: 'explainer',
  });
  const reference: VideoReference = {
    id: 'ref-route1',
    label: 'clip',
    origin: 'upload',
    mediaPath: 'references/ref-route1/media/source.mp4',
    contentHash: 'abc123',
    durationMs: 4000,
    rights: { studyAcknowledged: true, reuseAcknowledged: false },
    artifactIds: [],
    createdAt: new Date().toISOString(),
  };
  const project = await updateProjectDocument(created.id, (current) => ({
    ...current,
    videoReferences: [reference],
    assets: [
      {
        id: 'asset-user',
        kind: 'video',
        source: 'user',
        path: 'assets/user.mp4',
        metadata: { durationMs: 8000, width: 1920, height: 1080 },
      },
    ],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      fps: 30,
      durationMs: 0,
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
    },
  }));
  await writeReferenceEnvelope(project.id, {
    kind: 'framework',
    referenceId: reference.id,
    sourceFingerprint: 'fp-1',
    derivedFrom: {},
    generatedAt: new Date().toISOString(),
    producer: 'test',
    data: FRAMEWORK,
  });
  return getProject(project.id);
}
