import { useState } from 'react';

import { MediaGenerationWorkspace } from '@/components/creative/MediaGenerationWorkspace';
import { recordCreativeDebugCounter } from '@/shared/creative-workflow/debug-counters';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAssetPlan,
  VideoProject,
  VideoStoryboardScene,
} from '@/shared/types/video';

import type { VideoProjectEditorActions } from './editorTypes';
import {
  AiClipPlanFields,
  AiImagePlanFields,
  RegenerateSceneControls,
} from './SceneAssetPlanAdvancedFields';
import {
  sceneGenerationCapabilities,
  sceneGenerationReferences,
} from './sceneGenerationWorkspace';
import { KenBurnsFields } from './SceneKenBurnsFields';
import { SceneLipsyncPlanFields } from './SceneLipsyncPlanFields';
import { VideoAssetProxyStatus } from './VideoAssetProxyStatus';

const PLAN_KINDS: VideoAssetPlan['kind'][] = [
  'existing',
  'ai-image',
  'ai-clip',
  'broll-search',
  'image-pan',
  'tts-narration',
  'lipsync',
];

interface SceneAssetPlanInspectorProps {
  project: VideoProject;
  scene: VideoStoryboardScene;
  actions: VideoProjectEditorActions;
  onChange: (assetPlan: VideoAssetPlan) => void;
}

export function SceneAssetPlanInspector({
  project,
  scene,
  actions,
  onChange,
}: SceneAssetPlanInspectorProps) {
  const { t } = useLanguage();
  const plan = scene.assetPlan;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referenceUploadConfirmed, setReferenceUploadConfirmed] =
    useState(false);
  const imageAssets = project.assets.filter((asset) => asset.kind === 'image');
  const firstAssetId = imageAssets[0]?.id ?? project.assets[0]?.id ?? '';
  const canGenerate = plan.kind === 'ai-image' || plan.kind === 'ai-clip';
  const hasReferenceImages =
    plan.kind === 'ai-image'
      ? Boolean(plan.refImageIds?.length)
      : plan.kind === 'ai-clip'
        ? Boolean(plan.refImageId || plan.refImageTailId)
        : false;
  const selectedAsset =
    plan.kind === 'existing' || plan.kind === 'image-pan'
      ? project.assets.find((asset) => asset.id === plan.assetId)
      : undefined;

  const switchKind = (kind: VideoAssetPlan['kind']) => {
    onChange(defaultPlan(kind, scene, firstAssetId));
  };

  const uploadReferenceImages = async (files: FileList | null) => {
    if (!files || files.length === 0 || plan.kind !== 'ai-image') return;
    setBusy(true);
    setError(null);
    try {
      const result = await actions.uploadReferenceImages(files);
      const ids = result?.assets.map((asset) => asset.id) ?? [];
      onChange({ ...plan, refImageIds: [...(plan.refImageIds ?? []), ...ids] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const generateNow = async () => {
    if (plan.kind !== 'ai-image' && plan.kind !== 'lipsync') return;
    setBusy(true);
    setError(null);
    try {
      recordCreativeDebugCounter('generation.submitted');
      await actions.materializeSceneAsset(scene.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const regenerateNow = async () => {
    if (plan.kind !== 'ai-image' && plan.kind !== 'ai-clip') return;
    setBusy(true);
    setError(null);
    try {
      recordCreativeDebugCounter('generation.submitted');
      const refImageId =
        plan.kind === 'ai-image' ? plan.refImageIds?.[0] : plan.refImageId;
      await actions.regenerateScene(scene.id, {
        prompt: plan.prompt,
        provider: plan.provider,
        durationMs:
          plan.kind === 'ai-clip' ? plan.durationMs : scene.durationMs,
        refImageAssetId: refImageId,
        refImageTailAssetId:
          plan.kind === 'ai-clip' ? plan.refImageTailId : undefined,
        seed: plan.seed,
        confirmReferenceUpload: hasReferenceImages
          ? referenceUploadConfirmed
          : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{t.video.editor.inspector.scene.provider}</span>
        <select
          value={plan.kind}
          onChange={(event) =>
            switchKind(event.target.value as VideoAssetPlan['kind'])
          }
          className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
        >
          {PLAN_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {planKindLabel(t, kind)}
            </option>
          ))}
        </select>
      </label>
      {plan.kind === 'existing' || plan.kind === 'image-pan' ? (
        <label className="text-muted-foreground block space-y-1 text-xs">
          <span>{t.assets.selectAsset}</span>
          <select
            value={plan.assetId}
            onChange={(event) =>
              onChange({ ...plan, assetId: event.target.value })
            }
            className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
          >
            {project.assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.path}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {selectedAsset ? (
        <VideoAssetProxyStatus asset={selectedAsset} actions={actions} />
      ) : null}
      {plan.kind === 'ai-image' || plan.kind === 'ai-clip' ? (
        <MediaGenerationWorkspace
          surface={plan.kind === 'ai-image' ? 'image' : 'video'}
          title={planKindLabel(t, plan.kind)}
          description={t.creative.mediaGeneration.description}
          prompt={plan.prompt}
          promptLabel={
            plan.kind === 'ai-image'
              ? t.video.editor.inspector.plan.aiImage.prompt.label
              : t.video.storyboard.assetPrompt
          }
          promptPlaceholder={t.video.storyboard.assetPrompt}
          onPromptChange={(prompt) => onChange({ ...plan, prompt })}
          capabilities={sceneGenerationCapabilities(plan, scene, t)}
          references={sceneGenerationReferences(plan, project, t)}
        >
          {plan.kind === 'ai-image' ? (
            <AiImagePlanFields
              plan={plan}
              imageAssets={imageAssets}
              busy={busy}
              onChange={onChange}
              onUploadReferenceImages={(files) =>
                void uploadReferenceImages(files)
              }
              onGenerateNow={() => void generateNow()}
            />
          ) : null}
          {plan.kind === 'ai-clip' ? (
            <AiClipPlanFields
              plan={plan}
              imageAssets={imageAssets}
              sceneDurationMs={scene.durationMs}
              onChange={onChange}
            />
          ) : null}
          {canGenerate ? (
            <RegenerateSceneControls
              plan={plan}
              busy={busy}
              hasReferenceImages={hasReferenceImages}
              referenceUploadConfirmed={referenceUploadConfirmed}
              onReferenceUploadConfirmedChange={setReferenceUploadConfirmed}
              onRegenerate={() => void regenerateNow()}
            />
          ) : null}
        </MediaGenerationWorkspace>
      ) : null}
      {plan.kind === 'lipsync' ? (
        <SceneLipsyncPlanFields
          plan={plan}
          imageAssets={imageAssets}
          sceneDurationMs={scene.durationMs}
          busy={busy}
          onChange={onChange}
          onGeneratePreview={() => void generateNow()}
        />
      ) : null}
      {plan.kind === 'image-pan' ? (
        <KenBurnsFields plan={plan} onChange={onChange} />
      ) : null}
      {plan.kind === 'broll-search' ? (
        <label className="text-muted-foreground block space-y-1 text-xs">
          <span>{t.video.storyboard.brollQuery}</span>
          <input
            value={plan.query}
            onChange={(event) =>
              onChange({ ...plan, query: event.target.value })
            }
            placeholder={t.video.storyboard.brollQuery}
            className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
          />
        </label>
      ) : null}
      {plan.kind === 'tts-narration' ? (
        <label className="text-muted-foreground block space-y-1 text-xs">
          <span>{t.video.storyboard.ttsText}</span>
          <input
            value={plan.text}
            onChange={(event) =>
              onChange({ ...plan, text: event.target.value })
            }
            placeholder={t.video.storyboard.ttsText}
            className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
          />
        </label>
      ) : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

function planKindLabel(
  t: ReturnType<typeof useLanguage>['t'],
  kind: VideoAssetPlan['kind'],
): string {
  if (kind === 'existing') return t.video.editor.inspector.plan.existing.label;
  if (kind === 'ai-clip') return t.video.editor.inspector.plan.aiClip.label;
  if (kind === 'ai-image') return t.video.editor.inspector.plan.aiImage.label;
  if (kind === 'broll-search')
    return t.video.editor.inspector.plan.brollSearch.label;
  if (kind === 'image-pan') return t.video.editor.inspector.plan.imagePan.label;
  if (kind === 'tts-narration')
    return t.video.editor.inspector.plan.ttsNarration.label;
  return t.video.editor.inspector.plan.lipsync.label;
}

function defaultPlan(
  kind: VideoAssetPlan['kind'],
  scene: VideoStoryboardScene,
  assetId: string,
): VideoAssetPlan {
  if (kind === 'existing') return { kind, assetId };
  if (kind === 'image-pan') return { kind, assetId };
  if (kind === 'ai-image')
    return { kind, prompt: scene.intent, aspectRatio: '16:9' };
  if (kind === 'broll-search')
    return { kind, query: scene.intent, provider: 'pexels' };
  if (kind === 'tts-narration')
    return { kind, text: scene.caption?.text ?? scene.intent };
  if (kind === 'lipsync')
    return {
      kind,
      text: scene.caption?.text ?? scene.intent,
      referenceImageAssetId: assetId,
      lipsyncProvider: 'auto',
      aspectRatio: '16:9',
      motionScale: 0.5,
      background: { kind: 'transparent' },
      egressConfirmed: false,
    };
  return {
    kind: 'ai-clip',
    prompt: scene.intent,
    aspectRatio: '16:9',
    durationMs: scene.durationMs,
    provider: 'seedance-2-0-fast',
  };
}
