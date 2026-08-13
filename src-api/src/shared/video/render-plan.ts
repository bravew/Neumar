import { normalizeCredit, requiredAttributions } from './attribution';
import {
  estimateStoryboardCostCents,
  estimateStoryboardCostUsd,
} from './cost-estimator';
import { VIDEO_PROVIDER_CAPABILITIES } from './providers';
import type {
  AssetPlan,
  ProviderId,
  RenderPlan,
  StoryboardScene,
  VideoProject,
} from './types';

export function buildRenderPlan(project: VideoProject): RenderPlan {
  const storyboard = project.storyboard;
  if (!storyboard) {
    throw new Error('Storyboard required before creating a render plan');
  }
  assertCreditsCover(project);

  const estimate = estimateStoryboardCostCents(storyboard);
  const breakdownByScene = new Map(
    estimate.breakdown.map((item) => [item.sceneId, item]),
  );
  const warnings: string[] = [];
  const scenes = storyboard.scenes.map((scene) => {
    const cached = isSceneCached(project, scene);
    const provider = providerForAssetPlan(scene.assetPlan);
    const capability = provider
      ? VIDEO_PROVIDER_CAPABILITIES.find((item) => item.id === provider)
      : undefined;
    const fallback = breakdownByScene.get(scene.id);
    const durationSec = Math.max(1, Math.ceil(scene.durationMs / 1000));
    const costCents = cached
      ? 0
      : (estimateSceneCostCents(scene) ?? fallback?.highCents ?? 0);

    if (capability && capability.status !== 'active') {
      warnings.push(
        `${scene.intent}: ${capability.label} is ${capability.status}.`,
      );
    }

    return {
      sceneId: scene.id,
      assetPlan: scene.assetPlan,
      modelId: provider ?? 'local',
      model: capability?.label ?? provider ?? fallback?.provider ?? 'local',
      estimatedCostUsd: centsToUsd(costCents),
      estimatedDurationSec: cached ? 0 : durationSec,
      cached,
    };
  });

  const totalCostUsd = roundUsd(
    scenes.reduce((total, scene) => total + scene.estimatedCostUsd, 0),
  );
  const totalEtaSec = scenes.reduce(
    (total, scene) => total + scene.estimatedDurationSec,
    0,
  );
  const budget = project.budget;
  if (budget && budget.spentUsd + totalCostUsd > budget.capUsd) {
    warnings.push('Estimated render plan cost exceeds the project budget cap.');
  }
  if (storyboard.music && !storyboard.music.assetId) {
    warnings.push(
      'Music generation cost is estimated when music is generated.',
    );
  }
  if (storyboard.narration && !storyboard.narration.assetId) {
    warnings.push(
      'Narration generation cost is estimated when narration is generated.',
    );
  }

  return {
    scenes,
    totalCostUsd,
    totalEtaSec,
    warnings: [...new Set(warnings)],
  };
}

export function assertCreditsCover(project: VideoProject): void {
  const required = requiredAttributions(project);
  if (required.length === 0) return;
  const creditText = storyboardCreditText(project);
  const missing = required.filter(
    (credit) => !creditText.includes(normalizeCredit(credit.attribution)),
  );
  if (missing.length === 0) return;
  const names = missing.map((credit) => credit.source).join(', ');
  throw new Error(`ATTRIBUTION_MISSING: ${names}`);
}

export function applyRenderPlanSceneModel(
  project: VideoProject,
  sceneId: string,
  providerId: string,
): VideoProject {
  const storyboard = project.storyboard;
  if (!storyboard) {
    throw new Error('Storyboard required before updating a render plan model');
  }

  let found = false;
  const scenes = storyboard.scenes.map((scene) => {
    if (scene.id !== sceneId) return scene;
    found = true;
    return {
      ...scene,
      assetPlan: applyProviderToAssetPlan(scene.assetPlan, providerId),
    };
  });
  if (!found) {
    throw new Error('Storyboard scene not found');
  }

  const nextStoryboard = {
    ...storyboard,
    scenes,
    costEstimateUsd: estimateStoryboardCostUsd({ scenes }),
  };
  const nextProject: VideoProject = {
    ...project,
    storyboard: nextStoryboard,
    updatedAt: new Date().toISOString(),
  };
  return {
    ...nextProject,
    renderPlan: buildRenderPlan(nextProject),
  };
}

function estimateSceneCostCents(scene: StoryboardScene): number | undefined {
  const plan = scene.assetPlan;
  if (plan.kind !== 'ai-clip') return undefined;
  const provider = providerForAssetPlan(plan);
  const capability = provider
    ? VIDEO_PROVIDER_CAPABILITIES.find((item) => item.id === provider)
    : undefined;
  if (!capability?.defaultCostPerSecCents) return undefined;
  const durationMs = plan.durationMs ?? scene.durationMs;
  return Math.ceil(durationMs / 1000) * capability.defaultCostPerSecCents;
}

function storyboardCreditText(project: VideoProject): string {
  const scenes = project.storyboard?.scenes ?? [];
  return normalizeCredit(
    scenes
      .flatMap((scene) => [
        scene.intent,
        scene.caption?.text,
        ...(scene.overlayCaptions?.map((caption) => caption.text) ?? []),
      ])
      .filter((text): text is string => Boolean(text))
      .join('\n'),
  );
}

function providerForAssetPlan(plan: AssetPlan): ProviderId | undefined {
  if (plan.kind === 'ai-image') {
    return plan.provider ?? 'seedream-5-0-lite';
  }
  if (plan.kind === 'ai-clip') {
    return plan.provider ?? 'seedance-2-0-fast';
  }
  if (plan.kind === 'tts-narration') {
    return plan.provider ?? 'kokoro';
  }
  if (plan.kind === 'broll-search' && plan.provider !== 'linked') {
    return plan.provider ?? 'pexels';
  }
  return undefined;
}

function applyProviderToAssetPlan(
  plan: AssetPlan,
  providerId: string,
): AssetPlan {
  const capability = VIDEO_PROVIDER_CAPABILITIES.find(
    (item) => item.id === providerId,
  );
  if (!capability) {
    throw new Error(`Unsupported video model ${providerId}`);
  }
  if (!isProviderCompatibleWithAssetPlan(plan, capability.id)) {
    throw new Error(`${capability.label} is not compatible with ${plan.kind}`);
  }

  if (plan.kind === 'ai-image' || plan.kind === 'ai-clip') {
    return { ...plan, provider: capability.id };
  }
  if (plan.kind === 'broll-search') {
    return { ...plan, provider: capability.id as BrollProviderId };
  }
  if (plan.kind === 'tts-narration') {
    return { ...plan, provider: capability.id as TtsProviderId };
  }
  throw new Error(`${plan.kind} scenes do not support model selection`);
}

function isProviderCompatibleWithAssetPlan(
  plan: AssetPlan,
  providerId: ProviderId,
): boolean {
  const capability = VIDEO_PROVIDER_CAPABILITIES.find(
    (item) => item.id === providerId,
  );
  if (!capability) return false;

  if (plan.kind === 'ai-image') {
    return capability.kinds.includes('image');
  }
  if (plan.kind === 'ai-clip') {
    const needsImageToVideo = Boolean(plan.refImageId || plan.refImageTailId);
    return capability.kinds.includes(needsImageToVideo ? 'i2v' : 't2v');
  }
  if (plan.kind === 'broll-search') {
    return isBrollProviderId(providerId) && capability.kinds.includes('broll');
  }
  if (plan.kind === 'tts-narration') {
    return isTtsProviderId(providerId) && capability.kinds.includes('voice');
  }
  return false;
}

type BrollProviderId = Extract<
  ProviderId,
  'pexels' | 'pixabay' | 'storyblocks'
>;

function isBrollProviderId(
  providerId: ProviderId,
): providerId is BrollProviderId {
  return (
    providerId === 'pexels' ||
    providerId === 'pixabay' ||
    providerId === 'storyblocks'
  );
}

type TtsProviderId = Extract<
  ProviderId,
  | 'kokoro'
  | 'elevenlabs'
  | 'cartesia'
  | 'openai-tts'
  | 'gemini-tts'
  | 'hume-octave'
  | 'indextts'
>;

function isTtsProviderId(providerId: ProviderId): providerId is TtsProviderId {
  return (
    providerId === 'kokoro' ||
    providerId === 'elevenlabs' ||
    providerId === 'cartesia' ||
    providerId === 'openai-tts' ||
    providerId === 'gemini-tts' ||
    providerId === 'hume-octave' ||
    providerId === 'indextts'
  );
}

function isSceneCached(project: VideoProject, scene: StoryboardScene): boolean {
  const plan = scene.assetPlan;
  if (plan.kind === 'existing' || plan.kind === 'image-pan') {
    return project.assets.some((asset) => asset.id === plan.assetId);
  }
  return false;
}

function centsToUsd(cents: number): number {
  return roundUsd(cents / 100);
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}
