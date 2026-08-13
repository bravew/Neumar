import { useState } from 'react';

import { Check, PanelsTopLeft, Plus, X } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoProject,
  VideoStoryboard,
  VideoStoryboardScene,
} from '@/shared/types/video';
import { randomUUID } from '@/shared/utils/uuid';

import { PanelShell } from './PanelShell';
import { StoryboardSceneCard } from './StoryboardSceneCard';

interface StoryboardPanelProps {
  project?: VideoProject;
  onUpdateStoryboard?: (
    storyboard: VideoStoryboard,
  ) => Promise<VideoProject | null>;
  onUpdateBudget?: (capUsd: number) => Promise<void>;
  onApprove?: () => Promise<VideoProject | null>;
  onReject?: () => Promise<VideoProject | null>;
  onReplanScene?: (
    sceneId: string,
    hint?: string,
  ) => Promise<VideoProject | null>;
}

export function StoryboardPanel({
  project,
  onUpdateStoryboard,
  onUpdateBudget,
  onApprove,
  onReject,
  onReplanScene,
}: StoryboardPanelProps) {
  const { t } = useLanguage();
  const [message, setMessage] = useState<string | null>(null);
  const storyboard = project?.storyboard;
  const overBudget =
    Boolean(project?.budget) &&
    Boolean(storyboard) &&
    (storyboard?.costEstimateUsd.high ?? 0) > (project?.budget?.capUsd ?? 0);

  const updateStoryboard = async (next: VideoStoryboard) => {
    setMessage(null);
    await onUpdateStoryboard?.(next);
  };

  const updateScene = async (
    sceneId: string,
    patch: Partial<VideoStoryboardScene>,
  ) => {
    if (!storyboard) return;
    await updateStoryboard({
      ...storyboard,
      scenes: storyboard.scenes.map((scene) =>
        scene.id === sceneId ? { ...scene, ...patch } : scene,
      ),
    });
  };

  const addScene = async () => {
    if (!storyboard) return;
    const asset = project?.assets[0];
    await updateStoryboard({
      ...storyboard,
      scenes: [
        ...storyboard.scenes,
        {
          id: randomUUID(),
          durationMs: 4000,
          intent: t.video.storyboard.newSceneIntent,
          transition: 'cut',
          caption: { text: t.video.storyboard.newSceneIntent },
          assetPlan: asset
            ? { kind: 'existing', assetId: asset.id }
            : {
                kind: 'ai-clip',
                prompt: t.video.storyboard.newSceneIntent,
                aspectRatio: '16:9',
                durationMs: 4000,
                provider: 'seedance-2-0-fast',
              },
        },
      ],
    });
  };

  const approve = async () => {
    setMessage(null);
    try {
      await onApprove?.();
      setMessage(t.video.storyboard.approved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const reject = async () => {
    setMessage(null);
    await onReject?.();
    setMessage(t.video.storyboard.rejected);
  };

  return (
    <PanelShell
      title={t.video.storyboard.title}
      description={t.video.storyboard.description}
    >
      {!storyboard ? (
        <StoryboardEmpty project={project} />
      ) : (
        <div className="space-y-4">
          <header className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-foreground text-sm font-medium">
                  {storyboard.intent}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t.video.storyboard.summary
                    .replace('{count}', String(storyboard.scenes.length))
                    .replace(
                      '{seconds}',
                      String(Math.round(storyboard.totalDurationMs / 1000)),
                    )}
                </p>
              </div>
              <span className="border-border text-muted-foreground rounded-full border px-2 py-1 text-xs">
                {storyboard.status}
              </span>
            </div>
            <div className="border-border bg-muted/20 flex flex-wrap items-center gap-2 rounded-md border p-2">
              <span className="text-muted-foreground text-xs">
                {t.video.storyboard.cost
                  .replace('{low}', storyboard.costEstimateUsd.low.toFixed(2))
                  .replace(
                    '{high}',
                    storyboard.costEstimateUsd.high.toFixed(2),
                  )}
              </span>
              <label className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
                {t.video.storyboard.budget}
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={project?.budget?.capUsd ?? 0}
                  onChange={(event) =>
                    void onUpdateBudget?.(Number(event.target.value))
                  }
                  className="border-input bg-background text-foreground w-20 rounded-md border px-2 py-1"
                />
              </label>
            </div>
          </header>

          <div className="space-y-3">
            {storyboard.scenes.map((scene, index) => (
              <StoryboardSceneCard
                key={scene.id}
                scene={scene}
                index={index}
                project={project}
                onChange={(patch) => updateScene(scene.id, patch)}
                onReplan={async () => {
                  await onReplanScene?.(scene.id);
                  setMessage(t.video.storyboard.replanned);
                }}
              />
            ))}
          </div>

          <footer className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addScene}
              className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs"
            >
              <Plus className="mr-1 inline size-3" />
              {t.video.storyboard.addScene}
            </button>
            <button
              type="button"
              onClick={reject}
              className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs"
            >
              <X className="mr-1 inline size-3" />
              {t.video.storyboard.reject}
            </button>
            <button
              type="button"
              disabled={overBudget}
              onClick={approve}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60"
              title={overBudget ? t.video.storyboard.overBudget : undefined}
            >
              <Check className="mr-1 inline size-3" />
              {t.video.storyboard.approve}
            </button>
          </footer>
          {message ? (
            <p className="text-muted-foreground text-xs">{message}</p>
          ) : null}
        </div>
      )}
    </PanelShell>
  );
}

function StoryboardEmpty({ project }: { project?: VideoProject }) {
  const { t } = useLanguage();
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      <PanelsTopLeft className="size-4" />
      <span>
        {project?.assets.length
          ? t.video.storyboard.readyPlaceholder.replace(
              '{count}',
              String(project.assets.length),
            )
          : t.video.storyboard.placeholder}
      </span>
    </div>
  );
}
