import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import { writeVideoAgentPlan } from '@/shared/video/agent-plan';
import { reconcileVideoProjectPlan } from '@/shared/video/reconciliation';
import { createProject, getProject, writeProject } from '@/shared/video/store';

describe('Video plan reconciliation', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-reconcile-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('infers journal-less committed attachments from durable scene clips', async () => {
    const created = await createProject({
      name: 'Interrupted montage',
      template: 'custom',
    });
    const project = await getProject(created.id);
    const storyboard = {
      status: 'edited' as const,
      intent: 'Four-scene montage',
      totalDurationMs: 4000,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: Array.from({ length: 4 }, (_, index) => ({
        id: `scene-${index + 1}`,
        durationMs: 1000,
        intent: `Scene ${index + 1}`,
        assetPlan: {
          kind: 'existing' as const,
          assetId: index < 2 ? `asset-${index + 1}` : 'placeholder-asset',
          ...(index === 3 ? { trimMs: [0, 1] as [number, number] } : {}),
        },
      })),
    };
    await writeProject({
      ...project,
      assets: ['asset-1', 'asset-2', 'placeholder-asset'].map((id) => ({
        id,
        kind: 'video' as const,
        source: 'user' as const,
        path: `videos/${created.id}/assets/${id}.mp4`,
        metadata: { durationMs: 10_000 },
      })),
      scenes: storyboard.scenes.slice(0, 2).map((scene) => ({
        id: scene.id,
        durationMs: scene.durationMs,
        clips: [{ id: `clip-${scene.id}`, mediaId: scene.assetPlan.assetId }],
      })),
      agentJournal: [],
    });
    await writeVideoAgentPlan(created.id, {
      title: 'Recover montage',
      request: 'Continue the interrupted build.',
      steps: [
        {
          id: 'storyboard',
          title: 'Apply storyboard',
          intent: 'Reconcile and complete attachments.',
          dependsOn: [],
          operation: 'video_set_storyboard',
          inputs: { storyboard },
          verification: ['All planned assets are attached.'],
          rollback: 'Use journal inverse diffs when present.',
        },
      ],
    });

    const report = await reconcileVideoProjectPlan(created.id);

    expect(report.committedAttachmentSceneIds).toEqual(['scene-1', 'scene-2']);
    expect(report.remainingSceneIds).toEqual(['scene-3', 'scene-4']);
    expect(report.inconsistentSceneIds).toEqual(
      expect.arrayContaining(['scene-3', 'scene-4']),
    );
    expect(report.proposedOperations).toHaveLength(2);
    expect((await getProject(created.id)).agentJournal).toEqual([]);
  });

  it('preserves the 12 committed ChongQing attachments and proposes only remaining repairs', async () => {
    const fixturePath = fileURLToPath(
      new URL(
        '../../fixtures/video/chongqing-interrupted.json',
        import.meta.url,
      ),
    );
    const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8')) as {
      name: string;
      intent: string;
      committedSceneIds: string[];
      scenes: Array<{ id: string; assetId: string; trimMs?: [number, number] }>;
    };
    const created = await createProject({
      name: fixture.name,
      template: 'custom',
    });
    const project = await getProject(created.id);
    const storyboard = {
      status: 'edited' as const,
      intent: fixture.intent,
      totalDurationMs: fixture.scenes.length * 1000,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: fixture.scenes.map((scene) => ({
        id: scene.id,
        durationMs: 1000,
        intent: scene.id,
        assetPlan: {
          kind: 'existing' as const,
          assetId: scene.assetId,
          ...(scene.trimMs ? { trimMs: scene.trimMs } : {}),
        },
      })),
    };
    await writeProject({
      ...project,
      assets: [...new Set(fixture.scenes.map((scene) => scene.assetId))].map(
        (id) => ({
          id,
          kind: 'video' as const,
          source: 'user' as const,
          path: `videos/${created.id}/assets/${id}.mp4`,
          metadata: { durationMs: 10_000 },
        }),
      ),
      scenes: fixture.scenes
        .filter((scene) => fixture.committedSceneIds.includes(scene.id))
        .map((scene) => ({
          id: scene.id,
          durationMs: 1000,
          clips: [{ id: `clip-${scene.id}`, mediaId: scene.assetId }],
        })),
      agentJournal: [],
    });
    await writeVideoAgentPlan(created.id, {
      title: 'Recover sanitized ChongQing montage',
      request: fixture.intent,
      steps: [
        {
          id: 'storyboard',
          title: 'Reconcile storyboard',
          intent: fixture.intent,
          dependsOn: [],
          operation: 'video_set_storyboard',
          inputs: { storyboard },
          verification: ['All planned assets are attached exactly once.'],
          rollback: 'Use journal inverse diffs when present.',
        },
      ],
    });

    const report = await reconcileVideoProjectPlan(created.id);

    expect(report.committedAttachmentSceneIds).toEqual(
      fixture.committedSceneIds,
    );
    expect(report.remainingSceneIds).toEqual([
      'scene-13',
      'scene-14',
      'scene-15',
      'scene-16',
    ]);
    expect(
      report.proposedOperations.map((operation) => operation.sceneId),
    ).toEqual(report.remainingSceneIds);
    expect(report.inconsistentSceneIds).toEqual(
      expect.arrayContaining(['scene-14', 'scene-15', 'scene-16']),
    );
  });
});
