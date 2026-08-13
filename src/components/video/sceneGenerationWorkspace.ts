import type {
  MediaGenerationCapability,
  MediaGenerationReference,
} from '@/components/creative/MediaGenerationWorkspace';
import type { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAssetPlan,
  VideoProject,
  VideoStoryboardScene,
} from '@/shared/types/video';

import { projectAssetDisplayName } from './assets/projectAssetMedia';

type GenerationPlan = Extract<VideoAssetPlan, { kind: 'ai-image' | 'ai-clip' }>;

export function sceneGenerationCapabilities(
  plan: GenerationPlan,
  scene: VideoStoryboardScene,
  t: ReturnType<typeof useLanguage>['t'],
): MediaGenerationCapability[] {
  return [
    {
      id: 'provider',
      label: t.creative.mediaGeneration.provider,
      value: plan.provider || t.creative.mediaGeneration.projectDefaults,
    },
    {
      id: 'aspect',
      label: t.creative.mediaGeneration.aspectRatio,
      value: plan.aspectRatio || t.creative.mediaGeneration.projectDefaults,
    },
    {
      id: 'duration',
      label: t.creative.mediaGeneration.duration,
      value: `${Math.round(sceneGenerationDurationMs(plan, scene) / 100) / 10}s`,
    },
  ];
}

export function sceneGenerationReferences(
  plan: GenerationPlan,
  project: VideoProject,
  t?: ReturnType<typeof useLanguage>['t'],
): MediaGenerationReference[] {
  const refs =
    plan.kind === 'ai-image'
      ? (plan.refImageIds ?? []).map((id) => ({
          key: `image:${id}`,
          id,
          roleLabel: '',
        }))
      : [
          {
            key: plan.refImageId ? `head:${plan.refImageId}` : '',
            id: plan.refImageId,
            roleLabel: t?.video.editor.inspector.scene.referenceImage ?? '',
          },
          {
            key: plan.refImageTailId ? `tail:${plan.refImageTailId}` : '',
            id: plan.refImageTailId,
            roleLabel: t?.video.editor.inspector.scene.referenceImageTail ?? '',
          },
        ].filter(hasReferenceId);
  return refs.flatMap(({ key, id, roleLabel }) => {
    const asset = project.assets.find((candidate) => candidate.id === id);
    if (!asset) return [];
    const name = projectAssetDisplayName(asset);
    return [
      {
        id: key,
        name: roleLabel ? `${roleLabel}: ${name}` : name,
        summary:
          asset.metadata?.width && asset.metadata.height
            ? `${asset.metadata.width}x${asset.metadata.height}`
            : undefined,
      },
    ];
  });
}

function hasReferenceId(reference: {
  key: string;
  id: string | undefined;
  roleLabel: string;
}): reference is { key: string; id: string; roleLabel: string } {
  return isString(reference.id) && reference.key.length > 0;
}

function sceneGenerationDurationMs(
  plan: GenerationPlan,
  scene: VideoStoryboardScene,
): number {
  return plan.kind === 'ai-clip'
    ? (plan.durationMs ?? scene.durationMs)
    : scene.durationMs;
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
