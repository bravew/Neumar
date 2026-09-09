import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import { closeDatabase } from '@/shared/db';
import { setVideoFeatureFlag } from '@/shared/video/flags';
import { multicamFingerprint } from '@/shared/video/multicam/fingerprint';
import {
  parseMulticamManifest,
  type MulticamManifest,
} from '@/shared/video/multicam/manifest';
import { buildShotPlan } from '@/shared/video/multicam/shot-plan';
import {
  saveActivityMap,
  saveManifest,
  saveShotPlan,
  saveSyncMap,
} from '@/shared/video/multicam/store';
import { buildSyncMap } from '@/shared/video/multicam/sync';
import { writeProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

let workDir: string;

beforeEach(async () => {
  closeDatabase();
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-multicam-routes-'));
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  setVideoFeatureFlag('video.multicam', true);
});

afterEach(async () => {
  closeDatabase();
  vi.unstubAllEnvs();
  await fs.rm(workDir, { recursive: true, force: true });
});

function manifestFixture(): MulticamManifest {
  return parseMulticamManifest({
    schema: 'neuma.video.multicam-manifest.v1',
    id: 'group-1',
    label: 'Panel',
    referenceCameraId: 'cam-wide',
    participants: [
      { id: 'p-ana', name: 'Ana' },
      { id: 'p-ben', name: 'Ben' },
    ],
    cameras: [
      { id: 'cam-wide', label: 'Wide', type: 'wide', assetId: 'asset-wide' },
      {
        id: 'cam-ana',
        label: 'Ana',
        type: 'close',
        assetId: 'asset-ana',
        participantId: 'p-ana',
        isolatedAudioAssetId: 'mic-ana',
        offsetMs: 200,
      },
      {
        id: 'cam-ben',
        label: 'Ben',
        type: 'close',
        assetId: 'asset-ben',
        participantId: 'p-ben',
        isolatedAudioAssetId: 'mic-ben',
      },
    ],
  });
}

async function seedGroup(): Promise<{
  manifest: MulticamManifest;
  fingerprint: string;
}> {
  await writeProject(projectFixture());
  const manifest = manifestFixture();
  const fingerprint = multicamFingerprint({
    manifest,
    sourceIdentities: { 'asset-wide': 'sha-a', 'asset-ana': 'sha-b' },
  });

  await saveManifest('project-1', manifest, fingerprint);
  await saveSyncMap(
    'project-1',
    buildSyncMap({ manifest, frameRate: 30, sourceFingerprint: fingerprint }),
  );
  await saveActivityMap('project-1', {
    schema: 'neuma.video.multicam-activity.v1',
    manifestId: manifest.id,
    windowMs: 100,
    participants: [
      {
        participantId: 'p-ana',
        frames: [{ atReferenceMs: 0, raw: 0.9, corrected: 0.9 }],
        bleed: {},
        bleedConfidence: 1,
        bleedCorrectionApplied: false,
      },
    ],
    sourceFingerprint: fingerprint,
  });
  await saveShotPlan(
    'project-1',
    buildShotPlan({
      manifest,
      speechRanges: [
        {
          participantId: 'p-ana',
          startMs: 1000,
          endMs: 5000,
          meanProbability: 0.9,
        },
      ],
      durationMs: 8000,
      sourceFingerprint: fingerprint,
    }),
  );
  return { manifest, fingerprint };
}

describe('multicam analysis routes', () => {
  it('lists camera groups with their readiness', async () => {
    await seedGroup();

    const response = await videoRoutes.request('/projects/project-1/multicam');

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      groups: Array<{
        id: string;
        cameras: number;
        readiness: { automaticReady: boolean };
      }>;
    };
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toMatchObject({
      id: 'group-1',
      cameras: 3,
      participants: 2,
      syncMode: 'manual',
    });
    expect(body.groups[0]?.readiness.automaticReady).toBe(true);
  });

  it('returns an empty list for a project with no camera groups', async () => {
    await writeProject(projectFixture());

    const response = await videoRoutes.request('/projects/project-1/multicam');

    expect(response.status).toBe(200);
    expect(((await response.json()) as { groups: unknown[] }).groups).toEqual(
      [],
    );
  });

  it('serves the manifest with its readiness', async () => {
    await seedGroup();

    const response = await videoRoutes.request(
      '/projects/project-1/multicam/group-1/manifest',
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      manifest: MulticamManifest;
      readiness: { automaticReady: boolean };
    };
    expect(body.manifest.referenceCameraId).toBe('cam-wide');
    expect(body.readiness.automaticReady).toBe(true);
  });

  it('serves the sync map with per-camera offsets in project frames', async () => {
    await seedGroup();

    const response = await videoRoutes.request(
      '/projects/project-1/multicam/group-1/sync',
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { cameras: Array<{ cameraId: string; offsetFrames: number }> };
    };
    expect(
      body.data.cameras.find((camera) => camera.cameraId === 'cam-ana'),
    ).toMatchObject({ offsetMs: 200, offsetFrames: 6 });
    expect(
      body.data.cameras.find((camera) => camera.cameraId === 'cam-wide'),
    ).toMatchObject({ offsetMs: 0, method: 'reference' });
  });

  it('serves the activity map with raw probabilities intact', async () => {
    await seedGroup();

    const response = await videoRoutes.request(
      '/projects/project-1/multicam/group-1/activity',
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        participants: Array<{
          frames: Array<{ raw: number; corrected: number }>;
        }>;
      };
    };
    expect(body.data.participants[0]?.frames[0]).toMatchObject({ raw: 0.9 });
  });

  it('serves the shot plan and marks it current', async () => {
    await seedGroup();

    const response = await videoRoutes.request(
      '/projects/project-1/multicam/group-1/plan',
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      stale: boolean;
      data: { shots: Array<{ cameraId: string }> };
    };
    expect(body.stale).toBe(false);
    expect(body.data.shots.some((shot) => shot.cameraId === 'cam-ana')).toBe(
      true,
    );
  });

  it('labels a plan stale rather than hiding it when its inputs moved on', async () => {
    const { manifest } = await seedGroup();
    // Re-run sync against a changed source; the plan is now behind it.
    await saveSyncMap(
      'project-1',
      buildSyncMap({
        manifest,
        frameRate: 30,
        sourceFingerprint: 'a-different-fingerprint',
      }),
    );

    const response = await videoRoutes.request(
      '/projects/project-1/multicam/group-1/plan',
    );

    const body = (await response.json()) as { stale: boolean };
    // A reviewer should still see what the last run concluded.
    expect(body.stale).toBe(true);
  });

  it('never mutates the timeline', async () => {
    await seedGroup();
    const before = await videoRoutes.request('/projects/project-1/timeline');
    const timelineBefore = await before.json();

    await videoRoutes.request('/projects/project-1/multicam/group-1/plan');
    await videoRoutes.request('/projects/project-1/multicam/group-1/sync');

    const after = await videoRoutes.request('/projects/project-1/timeline');
    expect(await after.json()).toEqual(timelineBefore);
  });

  it('404s for a group that does not exist', async () => {
    await writeProject(projectFixture());

    expect(
      (
        await videoRoutes.request(
          '/projects/project-1/multicam/missing/manifest',
        )
      ).status,
    ).toBe(404);
  });

  it('reports a typed reason when the feature is disabled', async () => {
    await seedGroup();
    setVideoFeatureFlag('video.multicam', false);

    const response = await videoRoutes.request('/projects/project-1/multicam');

    expect(response.status).toBe(404);
    const body = (await response.json()) as { reason: string; flag: string };
    // Distinguishable from "not found" so a client can offer to enable it.
    expect(body).toMatchObject({
      reason: 'feature-disabled',
      flag: 'video.multicam',
    });
  });

  it('rejects a group id that would escape the project directory', async () => {
    await writeProject(projectFixture());

    const response = await videoRoutes.request(
      '/projects/project-1/multicam/..%2F..%2Fetc/manifest',
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Multicam',
    template: 'custom',
    prompt: '',
    revision: 0,
    assets: [],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 8000,
      fps: 30,
      tracks: [],
    },
    render: { status: 'idle' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
  } as VideoProject;
}
