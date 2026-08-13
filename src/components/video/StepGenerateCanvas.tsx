import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoAspectRatio, VideoProject } from '@/shared/types/video';

import type { VideoProjectEditorActions } from './editorTypes';

const ASPECTS: VideoAspectRatio[] = ['16:9', '9:16', '1:1', '4:5'];

interface StepGenerateCanvasProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
}

export function StepGenerateCanvas({
  project,
  actions,
}: StepGenerateCanvasProps) {
  const { t } = useLanguage();
  const render = project.render;
  const status = render?.status ?? 'idle';
  const progress = Math.max(0, Math.min(100, render?.progress ?? 0));
  const scenes = project.storyboard?.scenes ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-foreground text-sm font-semibold">
            {t.video.editor.generate.title}
          </h2>
          <p className="text-muted-foreground text-xs">
            {render?.message ?? t.video.editor.generate.description}
          </p>
        </div>
        <span className="border-border text-muted-foreground rounded-full border px-2 py-1 text-xs">
          {status}
        </span>
      </div>
      <div className="space-y-2">
        {scenes.map((scene, index) => {
          const materialized = project.scenes?.some(
            (candidate) => candidate.id === scene.id,
          );
          const Icon =
            status === 'error'
              ? XCircle
              : materialized
                ? CheckCircle2
                : status === 'running'
                  ? Loader2
                  : CircleDashed;
          return (
            <div
              key={scene.id}
              className="border-border bg-background flex items-center gap-3 rounded-md border p-3"
            >
              <Icon
                className={
                  status === 'running' && !materialized
                    ? 'text-primary size-4 animate-spin'
                    : 'text-muted-foreground size-4'
                }
              />
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-xs font-medium">
                  {t.video.storyboard.sceneLabel.replace(
                    '{index}',
                    String(index + 1),
                  )}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {scene.assetPlan.kind} · {scene.intent}
                </p>
              </div>
              <span className="text-muted-foreground text-[11px]">
                {materialized
                  ? t.video.editor.progress.done
                  : t.video.editor.progress.queued}
              </span>
            </div>
          );
        })}
      </div>
      {status === 'running' ? (
        <div className="mt-4 space-y-2">
          <div className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {t.video.editor.progress.rendering.replace(
              '{percent}',
              String(Math.round(progress)),
            )}
          </p>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {ASPECTS.map((aspect) => (
          <button
            key={aspect}
            type="button"
            disabled={
              project.storyboard?.status !== 'approved' || status === 'running'
            }
            className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs disabled:opacity-60"
            onClick={() => void actions.renderProject(aspect)}
          >
            <Play className="mr-1 inline size-3" />
            {t.video.editor.actions.renderAspect.replace('{aspect}', aspect)}
          </button>
        ))}
        <button
          type="button"
          disabled={status !== 'running'}
          className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs disabled:opacity-60"
          onClick={() => void actions.cancelRender()}
        >
          {t.video.editor.actions.cancel}
        </button>
      </div>
    </div>
  );
}
