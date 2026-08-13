import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAspectRatio,
  VideoProject,
  VideoStoryboardScene,
} from '@/shared/types/video';

import type { VideoProjectEditorActions } from './editorTypes';
import { SceneInspector } from './SceneInspector';
import { useTimelineEditorStore } from './timeline/useTimelineEditorStore';
import { TimelineClipInspector } from './TimelineClipInspector';

interface PreviewInspectorPanelProps {
  project: VideoProject;
  aspectRatio: VideoAspectRatio;
  actions: VideoProjectEditorActions;
  selectedScene: VideoStoryboardScene | null;
  onFindContext: (sceneId: string) => void;
}

/**
 * Dedicated Inspector column shown beside the preview on the Preview step.
 * Mirrors the always-visible inspector panel used by Final Cut Pro,
 * DaVinci Resolve, and OpenReel — the contents swap based on the strongest
 * editing intent: a selected timeline transition wins over clip or scene
 * selection.
 */
export function PreviewInspectorPanel({
  project,
  aspectRatio,
  actions,
  selectedScene,
  onFindContext,
}: PreviewInspectorPanelProps) {
  const { t } = useLanguage();
  const hasClipSelection = useTimelineEditorStore(
    (state) => state.selectedClipIds.size > 0,
  );
  const hasTransitionSelection = useTimelineEditorStore(
    (state) => state.selectedSeamId !== null && state.timeline !== null,
  );
  const heading = hasTransitionSelection
    ? t.video.editor.previewInspector.transitionTitle
    : hasClipSelection
      ? t.video.editor.previewInspector.clipTitle
      : selectedScene
        ? t.video.editor.previewInspector.sceneTitle
        : t.video.editor.previewInspector.title;
  return (
    <aside className="border-border bg-background flex h-full min-h-0 min-w-0 flex-col rounded-md border">
      <header className="border-border flex shrink-0 items-center justify-between border-b px-3 py-2">
        <h3 className="text-foreground text-xs font-semibold tracking-wide uppercase">
          {heading}
        </h3>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {hasTransitionSelection || hasClipSelection ? (
          <TimelineClipInspector project={project} aspectRatio={aspectRatio} />
        ) : selectedScene ? (
          <SceneInspector
            project={project}
            scene={selectedScene}
            open
            onOpenChange={() => undefined}
            actions={actions}
            onFindContext={onFindContext}
            inline
          />
        ) : (
          <p className="text-muted-foreground text-xs">
            {t.video.editor.previewInspector.empty}
          </p>
        )}
      </div>
    </aside>
  );
}
