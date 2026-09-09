import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getVideoToolCapabilityMetadata } from '@/extensions/agent/video/permissions';

import { closeDatabase } from '@/shared/db';
import {
  MULTICAM_TOOL_NAMES,
  multicamApplyReviewedPlan,
  multicamGetEditSummary,
  multicamGetManifest,
  multicamGetTranscript,
  multicamOverrideCut,
  multicamPreviewFrame,
  shouldRegisterMulticamTools,
} from '@/shared/mcp/video-multicam-tools';
import { setVideoFeatureFlag } from '@/shared/video/flags';
import { parseMulticamManifest } from '@/shared/video/multicam/manifest';
import { startReview } from '@/shared/video/multicam/review';
import { buildShotPlan } from '@/shared/video/multicam/shot-plan';
import {
  saveManifest,
  saveReview,
  saveShotPlan,
  saveSyncMap,
} from '@/shared/video/multicam/store';
import { buildSyncMap } from '@/shared/video/multicam/sync';
import { writeProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

let workDir: string;

beforeEach(async () => {
  closeDatabase();
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-multicam-tools-'));
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  setVideoFeatureFlag('video.multicam', true);
});

afterEach(async () => {
  closeDatabase();
  vi.unstubAllEnvs();
  await fs.rm(workDir, { recursive: true, force: true });
});

function manifestFixture() {
  return parseMulticamManifest({
    schema: 'neuma.video.multicam-manifest.v1',
    id: 'group-1',
    label: 'Panel',
    referenceCameraId: 'cam-wide',
    participants: [{ id: 'p-ana', name: 'Ana' }],
    cameras: [
      { id: 'cam-wide', label: 'Wide', type: 'wide', assetId: 'asset-wide' },
      {
        id: 'cam-ana',
        label: 'Ana',
        type: 'close',
        assetId: 'asset-ana',
        participantId: 'p-ana',
        isolatedAudioAssetId: 'mic-ana',
        offsetMs: 400,
      },
    ],
    policy: { cutLeadMs: 0, minShotMs: 1000, maxShotMs: 30_000 },
  });
}

async function seed() {
  await writeProject(projectFixture());
  const manifest = manifestFixture();
  await saveManifest('project-1', manifest, 'fp');
  await saveSyncMap(
    'project-1',
    buildSyncMap({ manifest, frameRate: 30, sourceFingerprint: 'fp' }),
  );
  const plan = buildShotPlan({
    manifest,
    speechRanges: [
      {
        participantId: 'p-ana',
        startMs: 2000,
        endMs: 6000,
        meanProbability: 0.9,
      },
    ],
    durationMs: 10_000,
    sourceFingerprint: 'fp',
  });
  await saveShotPlan('project-1', plan);
  return { manifest, plan };
}

describe('multicam tool registration', () => {
  it('names exactly the nine tools the plan lists', () => {
    expect(MULTICAM_TOOL_NAMES).toHaveLength(9);
    expect(MULTICAM_TOOL_NAMES).toContain('video_multicam_apply_reviewed_plan');
  });

  it('every tool carries permission and cost metadata', () => {
    // The lookup throws for an unclassified tool, so an unclassified one would
    // fail at runtime rather than ship open.
    for (const name of MULTICAM_TOOL_NAMES) {
      const metadata = getVideoToolCapabilityMetadata(name);
      expect(metadata.classification).toBeTruthy();
      expect(['free', 'metered']).toContain(metadata.costClass);
    }
  });

  it('meters preview, which is read-only but compute-expensive', () => {
    expect(
      getVideoToolCapabilityMetadata('video_multicam_preview_frame').costClass,
    ).toBe('metered');
    expect(
      getVideoToolCapabilityMetadata('video_multicam_get_manifest').costClass,
    ).toBe('free');
  });

  it('classifies applying a plan as a write, not a read', () => {
    expect(
      getVideoToolCapabilityMetadata('video_multicam_apply_reviewed_plan')
        .classification,
    ).not.toBe(
      getVideoToolCapabilityMetadata('video_multicam_get_manifest')
        .classification,
    );
  });

  it('withholds the domain from a project with no camera group', async () => {
    await writeProject(projectFixture());

    // Nine more tools in every turn's context is a real cost for a capability
    // most projects never use.
    expect(await shouldRegisterMulticamTools('project-1')).toBe(false);
  });

  it('registers the domain once a camera group exists', async () => {
    await seed();

    expect(await shouldRegisterMulticamTools('project-1')).toBe(true);
  });

  it('withholds the domain when the feature is off', async () => {
    await seed();
    setVideoFeatureFlag('video.multicam', false);

    expect(await shouldRegisterMulticamTools('project-1')).toBe(false);
  });
});

describe('multicam tool handlers', () => {
  it('returns a typed unavailable reason when the feature is off', async () => {
    await seed();
    setVideoFeatureFlag('video.multicam', false);

    expect(await multicamGetManifest('project-1', 'group-1')).toMatchObject({
      available: false,
      reason: 'feature-disabled',
    });
  });

  it('serves the manifest with sync offsets', async () => {
    await seed();

    const result = await multicamGetManifest('project-1', 'group-1');
    expect(result).toMatchObject({ available: true });
    if (!result.available) return;
    expect(result.sync).toContainEqual(
      expect.objectContaining({ cameraId: 'cam-ana', offsetMs: 400 }),
    );
  });

  it('says transcripts are unavailable rather than returning an empty list', async () => {
    await seed();

    // An empty list reads as "nobody said anything", which is a different and
    // wrong claim.
    expect(await multicamGetTranscript('project-1', 'group-1')).toMatchObject({
      available: false,
      reason: 'no-analysis',
    });
  });

  it('summarizes the plan and the review state', async () => {
    await seed();

    const result = await multicamGetEditSummary('project-1', 'group-1');
    expect(result).toMatchObject({ available: true });
    if (!result.available) return;
    expect(result.shotCount).toBeGreaterThan(0);
    expect(result.review).toBeNull();
  });

  it('records an override and bumps the review revision', async () => {
    const { plan } = await seed();
    const shotId = `${plan.shots[1]!.cameraId}@${plan.shots[1]!.startMs}`;

    const result = await multicamOverrideCut(
      'project-1',
      'group-1',
      shotId,
      'cam-wide',
    );
    expect(result).toMatchObject({ available: true });
    if (!result.available) return;
    expect(result.review).toMatchObject({ revision: 1, overridden: 1 });
  });

  it('names where an instant falls on every angle', async () => {
    await seed();

    const result = await multicamPreviewFrame('project-1', 'group-1', 5000);
    expect(result).toMatchObject({ available: true });
    if (!result.available) return;
    expect(result.angles).toContainEqual(
      expect.objectContaining({ cameraId: 'cam-ana', sourceMs: 5400 }),
    );
  });

  it('returns the prior result when the same review revision is applied twice', async () => {
    const { plan } = await seed();
    const review = startReview(plan);
    const applied = {
      ...review,
      applied: {
        batchId: 'multicam-existing',
        reviewRevision: review.revision,
        appliedAt: '2026-09-08T00:00:00.000Z',
        clipIds: ['clip-1'],
      },
    };
    await saveReview('project-1', applied);

    const result = await multicamApplyReviewedPlan(
      'project-1',
      'group-1',
      'track-multicam',
    );

    expect(result).toMatchObject({
      available: true,
      repeated: true,
      batchId: 'multicam-existing',
      clipIds: ['clip-1'],
    });
  });

  it('builds a fresh batch when nothing has been applied', async () => {
    const { plan } = await seed();
    await saveReview('project-1', {
      ...startReview(plan),
      revision: 1,
      shots: startReview(plan).shots.map((shot) => ({
        ...shot,
        decision: 'accepted' as const,
      })),
    });

    const result = await multicamApplyReviewedPlan(
      'project-1',
      'group-1',
      'track-multicam',
    );

    expect(result).toMatchObject({ available: true, repeated: false });
    if (!result.available || result.repeated) return;
    expect(result.batch.ops.length).toBeGreaterThan(0);
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Multicam tools',
    template: 'custom',
    prompt: '',
    revision: 0,
    assets: [],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 10_000,
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
