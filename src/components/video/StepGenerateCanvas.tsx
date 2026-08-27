import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoAspectRatio, VideoProject } from '@/shared/types/video';

import type { VideoProjectEditorActions } from './editorTypes';
import {
  generateAggregateState,
  generateCompletionPercent,
  generateProgress,
  generateSceneStatuses,
  type GenerateSceneState,
} from './generateSceneStatus';
import { useRenderQueueJobs } from './useRenderQueueJobs';

const STATE_ICONS: Record<GenerateSceneState, typeof CheckCircle2> = {
  ready: CheckCircle2,
  done: CheckCircle2,
  running: Loader2,
  queued: CircleDashed,
  'not-queued': CircleSlash,
  error: XCircle,
  cancelled: CircleSlash,
};

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
  const labels = t.video.editor.generate;
  const render = project.render;
  const approved = project.storyboard?.status === 'approved';
  const { jobs } = useRenderQueueJobs(project.id);
  const statuses = generateSceneStatuses(project, jobs);
  const counts = generateProgress(statuses);
  const actionable = statuses.filter((scene) => scene.state !== 'ready');
  const readyCount = statuses.length - actionable.length;
  // This canvas reports generation, never the render. A busy queue above an
  // `idle` badge was the whole confusion.
  const aggregate = generateAggregateState(statuses, approved);
  const percent = generateCompletionPercent(statuses);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-foreground text-sm font-semibold">
            {labels.title}
          </h2>
          <p className="text-muted-foreground text-xs">
            {render?.message ??
              labels.summary
                .replace('{generative}', String(counts.generative))
                .replace('{done}', String(counts.done))
                .replace(
                  '{ready}',
                  String(statuses.length - counts.generative),
                )}
          </p>
        </div>
        <span className="border-border text-muted-foreground rounded-full border px-2 py-1 text-xs">
          {labels.aggregate[aggregate]}
        </span>
      </div>
      {counts.notQueued > 0 ? (
        <p className="border-warning/30 bg-warning/10 text-warning-foreground mb-3 rounded-md border px-3 py-2 text-xs">
          {approved
            ? labels.notQueuedApproved.replace(
                '{count}',
                String(counts.notQueued),
              )
            : labels.notQueuedPending.replace(
                '{count}',
                String(counts.notQueued),
              )}
        </p>
      ) : null}
      {counts.generative === 0 ? (
        <p className="border-border text-muted-foreground mb-3 rounded-md border px-3 py-2 text-xs">
          {labels.nothingToGenerate}
        </p>
      ) : null}
      <div className="space-y-2">
        {/* Only scenes that still need something list individually. A row per
            scene that already has its media is 47 lines of "nothing to do". */}
        {actionable.map((scene) => {
          const Icon = STATE_ICONS[scene.state];
          return (
            <div
              key={scene.sceneId}
              className="border-border bg-background flex items-center gap-3 rounded-md border p-3"
            >
              <Icon
                className={
                  scene.state === 'running'
                    ? 'text-primary size-4 animate-spin'
                    : scene.state === 'error'
                      ? 'text-destructive size-4'
                      : 'text-muted-foreground size-4'
                }
              />
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-xs font-medium">
                  {t.video.storyboard.sceneLabel.replace(
                    '{index}',
                    String(scene.index + 1),
                  )}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {scene.kind} · {scene.intent}
                </p>
              </div>
              <span className="text-muted-foreground text-[11px]">
                {labels.states[scene.state]}
              </span>
            </div>
          );
        })}
        {readyCount > 0 ? (
          <p className="text-muted-foreground px-1 text-xs">
            {labels.readyCollapsed.replace('{count}', String(readyCount))}
          </p>
        ) : null}
      </div>
      {aggregate === 'running' || aggregate === 'queued' ? (
        <div className="mt-4 space-y-2">
          <div className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {labels.generating
              .replace('{done}', String(counts.done))
              .replace('{total}', String(counts.generative))}
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
