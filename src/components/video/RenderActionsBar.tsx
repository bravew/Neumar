import { Check, Play, RefreshCw, WandSparkles, X } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import type { VideoProjectEditorActions } from './editorTypes';
import { canRenderProject } from './render-readiness';

interface RenderActionsBarProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  onGenerated?: () => void;
  onApproved?: () => void;
  onRendered?: () => void;
}

export function RenderActionsBar({
  project,
  actions,
  onGenerated,
  onApproved,
  onRendered,
}: RenderActionsBarProps) {
  const { t } = useLanguage();
  const storyboard = project.storyboard;
  const renderStatus = project.render?.status ?? 'idle';
  const renderReady = canRenderProject(
    project,
    storyboard?.status === 'approved',
  );
  const canApprove = Boolean(storyboard) && storyboard?.status !== 'approved';
  const overBudget =
    Boolean(project.budget) &&
    Boolean(storyboard) &&
    (storyboard?.costEstimateUsd.high ?? 0) > (project.budget?.capUsd ?? 0);

  return (
    <div className="border-border bg-background flex flex-wrap items-center gap-2 border-t px-4 py-3">
      <button
        type="button"
        className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs"
        onClick={async () => {
          await actions.generateStoryboard(
            t.video.agent.generatePrompt
              .replace('{template}', project.template)
              .replace('{budget}', String(project.budget?.capUsd ?? 0)),
          );
          onGenerated?.();
        }}
      >
        <WandSparkles className="mr-1 inline size-3" />
        {t.video.editor.actions.generateStoryboard}
      </button>
      {storyboard ? (
        <>
          <button
            type="button"
            className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs"
            onClick={() => void actions.rejectStoryboard()}
          >
            <X className="mr-1 inline size-3" />
            {t.video.editor.actions.reject}
          </button>
          <button
            type="button"
            disabled={!canApprove || overBudget}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60"
            onClick={async () => {
              await actions.approveStoryboard();
              onApproved?.();
            }}
          >
            <Check className="mr-1 inline size-3" />
            {t.video.editor.actions.approve}
          </button>
        </>
      ) : null}
      <button
        type="button"
        disabled={!renderReady || renderStatus === 'running'}
        className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60"
        onClick={async () => {
          await actions.renderProject('16:9');
          onRendered?.();
        }}
      >
        {renderStatus === 'done' ? (
          <RefreshCw className="mr-1 inline size-3" />
        ) : (
          <Play className="mr-1 inline size-3" />
        )}
        {renderStatus === 'done'
          ? t.video.editor.actions.rerender
          : t.video.editor.actions.render}
      </button>
      <button
        type="button"
        disabled={renderStatus !== 'running'}
        className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs disabled:opacity-60"
        onClick={() => void actions.cancelRender()}
      >
        {t.video.editor.actions.cancel}
      </button>
    </div>
  );
}
