import { createLogger } from '@/shared/utils/logger';
import { hydrateReferencedProjectAssets } from '@/shared/video/catalog-assets';
import {
  attachLinkedAsset,
  enqueueLinkedSourceSync,
  listLinkedFolderChildren,
  listLinkedSources,
  previewLinkedAsset,
  searchLinkedAssets,
} from '@/shared/video/linked-sources';
import {
  autoApproveFreeStoryboard,
  generateStoryboardDraft,
  getProject,
  getStoryboard,
  setStoryboard,
} from '@/shared/video/store';
import type { Storyboard } from '@/shared/video/types';

import { storyboardSchema } from './validators';

const logger = createLogger('VideoAgentTools');

// Asset ids a storyboard places directly on the timeline. Mirrors the set the
// render pipeline downloads in `hydrateReferencedRenderAssets` so a cloud asset
// the agent picks is materialized when placed, not only at final render.
function collectStoryboardPlacedAssetIds(storyboard: Storyboard): string[] {
  const ids = new Set<string>();
  for (const scene of storyboard.scenes ?? []) {
    const plan = scene.assetPlan;
    if (plan.kind === 'existing' || plan.kind === 'image-pan') {
      ids.add(plan.assetId);
    }
  }
  if (storyboard.music?.assetId) ids.add(storyboard.music.assetId);
  if (storyboard.narration?.assetId) ids.add(storyboard.narration.assetId);
  return [...ids];
}

export async function get_project(projectId: string) {
  return getProject(projectId);
}

export async function list_assets(projectId: string) {
  return (await getProject(projectId)).assets;
}

export async function get_script(projectId: string) {
  return (await getProject(projectId)).script ?? '';
}

export async function get_brand_kit(projectId: string) {
  return (await getProject(projectId)).brandKit ?? null;
}

export function get_template_brief(templateId: string) {
  return {
    templateId,
    maxDurationMs: templateId === 'ugc-ad' ? 15000 : 60000,
    guidance:
      'Plan concise scenes, use existing assets first, and estimate cost before spend.',
  };
}

export function estimate_cost(storyboard: Storyboard) {
  const parsed = storyboardSchema.parse(storyboard);
  return parsed.costEstimateUsd;
}

export async function set_storyboard(
  projectId: string,
  storyboard: Storyboard,
) {
  const parsed = storyboardSchema.parse(storyboard) as Storyboard;
  const saved = await setStoryboard(projectId, parsed);

  // Download any cloud/linked assets the storyboard places on the timeline so
  // they render in the preview immediately. `hydrateReferencedProjectAssets`
  // is a no-op for ids that are already materialized or absent. Best-effort:
  // a download failure here must not fail the storyboard write — the render
  // pipeline hydrates again before the final render.
  const placedAssetIds = collectStoryboardPlacedAssetIds(parsed);
  if (placedAssetIds.length > 0) {
    try {
      await hydrateReferencedProjectAssets(projectId, placedAssetIds, {
        role: 'asset',
      });
    } catch (error) {
      logger.warn('Failed to hydrate referenced storyboard assets', {
        projectId,
        error,
      });
    }
  }

  // A storyboard that costs nothing to produce (all local/existing assets) has
  // no spend to confirm, so auto-approve it and skip the manual gate. Paid
  // storyboards still require explicit user approval.
  const autoApproved = await autoApproveFreeStoryboard(projectId);
  return autoApproved ? await getProject(projectId) : saved;
}

export async function plan_storyboard(projectId: string) {
  return generateStoryboardDraft(projectId);
}

export async function request_approval(projectId: string) {
  return getStoryboard(projectId);
}

export async function list_linked_sources(projectId: string) {
  const sources = await listLinkedSources(projectId);
  return sources.map((source) => ({
    id: source.id,
    displayName: source.displayName,
    provider: source.provider,
    role: source.role,
    indexState: source.index.state,
    fileCount: source.index.fileCount ?? 0,
  }));
}

export async function search_linked_assets(
  projectId: string,
  input: {
    query: string;
    kind?: 'image' | 'video' | 'audio';
    role?: 'context' | 'b-roll' | 'reference';
    sourceIds?: string[];
    limit?: number;
  },
) {
  const data = await searchLinkedAssets(projectId, input);
  return data.results.map((hit) => ({
    assetId: hit.asset.id,
    name: hit.asset.name,
    kind: hit.asset.kind,
    durationMs: hit.asset.durationMs,
    score: hit.score,
    matchedOn: hit.matchedOn,
    thumbnailUrl: hit.thumbnailUrl,
    sourceDisplayName: hit.sourceDisplayName,
    matchSnippet: hit.matchSnippet,
  }));
}

export async function list_folder_children(
  projectId: string,
  input: { sourceId: string; path?: string; page?: string },
) {
  return listLinkedFolderChildren(projectId, input);
}

export async function preview_asset(projectId: string, assetId: string) {
  return previewLinkedAsset(projectId, assetId);
}

export async function attach_asset(
  projectId: string,
  input: {
    assetId: string;
    sceneId?: string;
    role?: 'asset' | 'reference';
  },
) {
  return attachLinkedAsset(projectId, input.assetId, {
    sceneId: input.sceneId,
    role: input.role ?? 'asset',
  });
}

export async function sync_source(
  projectId: string,
  input: { sourceId: string; depth?: number },
) {
  return enqueueLinkedSourceSync(projectId, input.sourceId, input.depth);
}
