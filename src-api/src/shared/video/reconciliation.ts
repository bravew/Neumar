import { createLogger } from '@/shared/utils/logger';

import { parseVideoStoryboard } from './agent-tools';
import { getProject } from './store';
import type { AssetPlan, Storyboard, StoryboardScene } from './types';

const logger = createLogger('VideoPlanReconciliation');

export interface VideoReconciliationReport {
  projectId: string;
  planId: string;
  planRevision: number;
  dryRun: true;
  committedAttachmentSceneIds: string[];
  remainingSceneIds: string[];
  inconsistentSceneIds: string[];
  proposedOperations: Array<{
    operation: 'video_attach_asset' | 'video_set_storyboard';
    sceneId?: string;
    assetId?: string;
    reason: string;
  }>;
}

export async function reconcileVideoProjectPlan(
  projectId: string,
): Promise<VideoReconciliationReport> {
  const project = await getProject(projectId);
  const plan = project.agentPlan;
  if (!plan) throw new Error('Video agent plan not found');
  const storyboard = plannedStoryboard(plan.steps.map((step) => step.inputs));
  if (!storyboard) throw new Error('Durable plan contains no storyboard input');
  const actualScenes = new Map(
    (project.scenes ?? []).map((scene) => [scene.id, scene]),
  );
  const committedAttachmentSceneIds: string[] = [];
  const remainingSceneIds: string[] = [];
  const inconsistentSceneIds: string[] = [];
  const proposedOperations: VideoReconciliationReport['proposedOperations'] =
    [];
  const placeholderAssetCounts = new Map<string, number>();

  for (const planned of storyboard.scenes) {
    const assetId = assetIdForPlan(planned.assetPlan);
    if (!assetId) continue;
    const actual = actualScenes.get(planned.id);
    const attached =
      actual?.clips.some((clip) => clip.mediaId === assetId) ?? false;
    if (attached) {
      committedAttachmentSceneIds.push(planned.id);
      continue;
    }
    remainingSceneIds.push(planned.id);
    placeholderAssetCounts.set(
      assetId,
      (placeholderAssetCounts.get(assetId) ?? 0) + 1,
    );
    if (hasOneMillisecondRange(planned.assetPlan)) {
      inconsistentSceneIds.push(planned.id);
    }
    proposedOperations.push({
      operation: 'video_attach_asset',
      sceneId: planned.id,
      assetId,
      reason: actual
        ? 'planned asset is not attached'
        : 'planned scene is missing',
    });
  }
  for (const planned of storyboard.scenes) {
    const assetId = assetIdForPlan(planned.assetPlan);
    if (
      assetId &&
      (placeholderAssetCounts.get(assetId) ?? 0) > 1 &&
      !inconsistentSceneIds.includes(planned.id)
    ) {
      inconsistentSceneIds.push(planned.id);
    }
  }
  const report: VideoReconciliationReport = {
    projectId,
    planId: plan.id,
    planRevision: plan.revision,
    dryRun: true,
    committedAttachmentSceneIds,
    remainingSceneIds,
    inconsistentSceneIds,
    proposedOperations,
  };
  logger.info('video.agent.reconciliation_dry_run', {
    project_id: projectId,
    plan_id: plan.id,
    plan_revision: plan.revision,
    committed_attachment_count: committedAttachmentSceneIds.length,
    remaining_scene_count: remainingSceneIds.length,
    inconsistent_scene_count: inconsistentSceneIds.length,
  });
  return report;
}

function plannedStoryboard(
  inputs: Array<Record<string, unknown>>,
): Storyboard | undefined {
  for (const input of inputs) {
    const storyboard = input.storyboard;
    if (
      storyboard &&
      typeof storyboard === 'object' &&
      'scenes' in storyboard
    ) {
      return parseVideoStoryboard(storyboard);
    }
  }
  return undefined;
}

function assetIdForPlan(plan: AssetPlan): string | undefined {
  return plan.kind === 'existing' || plan.kind === 'image-pan'
    ? plan.assetId
    : undefined;
}

function hasOneMillisecondRange(plan: StoryboardScene['assetPlan']): boolean {
  return (
    plan.kind === 'existing' &&
    Boolean(plan.trimMs && plan.trimMs[1] - plan.trimMs[0] <= 1)
  );
}
