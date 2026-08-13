import { useState } from 'react';

import { ArrowRight, Calculator, RefreshCw, TriangleAlert } from 'lucide-react';

import { useVideoProviders } from '@/shared/hooks/useVideoProject';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAssetPlan,
  VideoProject,
  VideoProviderView,
} from '@/shared/types/video';

import type { VideoEditorStep, VideoProjectEditorActions } from './editorTypes';

export interface PlanModelOption {
  id: string;
  label: string;
}

const BROLL_MODEL_PROVIDER_IDS = new Set(['pexels', 'pixabay', 'storyblocks']);
const TTS_MODEL_PROVIDER_IDS = new Set([
  'kokoro',
  'elevenlabs',
  'cartesia',
  'openai-tts',
  'gemini-tts',
  'hume-octave',
  'indextts',
]);

export function getCompatiblePlanModelOptions(
  assetPlan: VideoAssetPlan | undefined,
  providers: VideoProviderView[],
): PlanModelOption[] {
  if (!assetPlan) return [];
  return providers
    .filter((provider) => isProviderCompatibleWithPlan(assetPlan, provider))
    .map((provider) => ({
      id: provider.capability.id,
      label: provider.capability.label,
    }));
}

function isProviderCompatibleWithPlan(
  assetPlan: VideoAssetPlan,
  provider: VideoProviderView,
): boolean {
  const { id, kinds } = provider.capability;
  if (assetPlan.kind === 'ai-image') {
    return kinds.includes('image');
  }
  if (assetPlan.kind === 'ai-clip') {
    const needsImageToVideo = Boolean(
      assetPlan.refImageId || assetPlan.refImageTailId,
    );
    return kinds.includes(needsImageToVideo ? 'i2v' : 't2v');
  }
  if (assetPlan.kind === 'broll-search') {
    return BROLL_MODEL_PROVIDER_IDS.has(id) && kinds.includes('broll');
  }
  if (assetPlan.kind === 'tts-narration') {
    return TTS_MODEL_PROVIDER_IDS.has(id) && kinds.includes('voice');
  }
  return false;
}

interface StepPlanCanvasProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  onStepChange: (step: VideoEditorStep) => void;
}

export function StepPlanCanvas({
  project,
  actions,
  onStepChange,
}: StepPlanCanvasProps) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [pendingSceneId, setPendingSceneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { providers } = useVideoProviders();
  const plan = project.renderPlan;
  const totalAfterPlan =
    (project.budget?.spentUsd ?? 0) + (plan?.totalCostUsd ?? 0);
  const overBudget = Boolean(
    project.budget && plan && totalAfterPlan > project.budget.capUsd,
  );

  const refreshPlan = async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.createRenderPlan();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const updateSceneModel = async (sceneId: string, providerId: string) => {
    setPendingSceneId(sceneId);
    setError(null);
    try {
      await actions.updateRenderPlanSceneModel(sceneId, providerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingSceneId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-foreground text-sm font-semibold">
            {t.video.editor.plan.title}
          </h2>
          <p className="text-muted-foreground text-xs">
            {t.video.editor.plan.description}
          </p>
        </div>
        <button
          type="button"
          className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs disabled:opacity-60"
          disabled={busy}
          onClick={() => void refreshPlan()}
        >
          <RefreshCw
            className={
              busy ? 'mr-1 inline size-3 animate-spin' : 'mr-1 inline size-3'
            }
          />
          {busy ? t.video.editor.plan.refreshing : t.video.editor.plan.refresh}
        </button>
      </div>

      {!plan ? (
        <section className="border-border bg-muted/20 flex min-h-56 items-center justify-center rounded-md border border-dashed">
          <div className="max-w-md px-6 text-center">
            <Calculator className="text-muted-foreground mx-auto size-6" />
            <p className="text-foreground mt-3 text-sm font-medium">
              {t.video.editor.plan.empty}
            </p>
            <button
              type="button"
              className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60"
              disabled={busy}
              onClick={() => void refreshPlan()}
            >
              {busy
                ? t.video.editor.plan.refreshing
                : t.video.editor.plan.refresh}
            </button>
          </div>
        </section>
      ) : (
        <section className="border-border overflow-x-auto rounded-md border">
          <div className="min-w-[720px]">
            <div className="bg-muted/30 border-border text-muted-foreground grid grid-cols-[1.2fr_1fr_0.6fr_0.6fr_0.6fr] gap-3 border-b px-3 py-2 text-[11px] font-medium">
              <span>{t.video.editor.plan.scene}</span>
              <span>{t.video.editor.plan.model}</span>
              <span>{t.video.editor.plan.estimate}</span>
              <span>{t.video.editor.plan.eta}</span>
              <span>{t.video.editor.plan.cache}</span>
            </div>
            {plan.scenes.map((scene) => {
              const storyboardScene = project.storyboard?.scenes.find(
                (item) => item.id === scene.sceneId,
              );
              const modelValue = scene.modelId || scene.model;
              const modelOptions = getCompatiblePlanModelOptions(
                storyboardScene?.assetPlan,
                providers,
              );
              const selectOptions = modelOptions.some(
                (option) => option.id === modelValue,
              )
                ? modelOptions
                : [{ id: modelValue, label: scene.model }, ...modelOptions];
              const canSelectModel = modelOptions.length > 0;
              const isModelBusy = pendingSceneId === scene.sceneId;
              return (
                <div
                  key={scene.sceneId}
                  className="border-border grid grid-cols-[1.2fr_1fr_0.6fr_0.6fr_0.6fr] gap-3 border-b px-3 py-2 text-xs last:border-b-0"
                >
                  <span className="truncate">
                    {storyboardScene?.intent ?? scene.sceneId}
                  </span>
                  <span className="text-muted-foreground min-w-0">
                    {canSelectModel ? (
                      <select
                        aria-label={`${t.video.editor.plan.model} ${
                          storyboardScene?.intent ?? scene.sceneId
                        }`}
                        className="border-border bg-background text-foreground w-full rounded-md border px-2 py-1 text-xs disabled:opacity-60"
                        disabled={busy || pendingSceneId !== null}
                        value={modelValue}
                        onChange={(event) => {
                          if (event.target.value === modelValue) return;
                          void updateSceneModel(
                            scene.sceneId,
                            event.target.value,
                          );
                        }}
                      >
                        {selectOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="block truncate">
                        {isModelBusy
                          ? t.video.editor.plan.refreshing
                          : scene.model}
                      </span>
                    )}
                  </span>
                  <span>${scene.estimatedCostUsd.toFixed(2)}</span>
                  <span>
                    {t.video.editor.plan.seconds.replace(
                      '{seconds}',
                      String(scene.estimatedDurationSec),
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {scene.cached
                      ? t.video.editor.plan.cached
                      : t.video.editor.plan.uncached}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {plan ? (
        <div className="border-border bg-background mt-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span>
              {t.video.editor.plan.totalCost.replace(
                '{cost}',
                plan.totalCostUsd.toFixed(2),
              )}
            </span>
            <span>
              {t.video.editor.plan.totalEta.replace(
                '{seconds}',
                String(plan.totalEtaSec),
              )}
            </span>
            {project.budget ? (
              <span
                className={
                  overBudget ? 'text-destructive' : 'text-muted-foreground'
                }
              >
                {t.video.editor.plan.budget.replace(
                  '{remaining}',
                  Math.max(0, project.budget.capUsd - totalAfterPlan).toFixed(
                    2,
                  ),
                )}
              </span>
            ) : null}
          </div>
          {plan.warnings.length > 0 || overBudget ? (
            <div className="mt-3 space-y-1 text-xs text-amber-600 dark:text-amber-300">
              {overBudget ? (
                <p className="flex items-center gap-1.5">
                  <TriangleAlert className="size-3" />
                  {t.video.editor.plan.overBudget}
                </p>
              ) : null}
              {plan.warnings.map((warning) => (
                <p key={warning} className="flex items-center gap-1.5">
                  <TriangleAlert className="size-3" />
                  {warning}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-destructive mt-3 text-xs">{error}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60"
          disabled={!plan || overBudget}
          onClick={() => onStepChange('generate')}
        >
          <ArrowRight className="mr-1 inline size-3" />
          {t.video.editor.plan.continue}
        </button>
      </div>
    </div>
  );
}
