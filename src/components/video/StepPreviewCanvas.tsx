import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';

import { PlayCircle } from 'lucide-react';
import { Panel, Group as PanelGroup } from 'react-resizable-panels';
import { toast } from 'sonner';

import { ResizeHandle } from '@/components/ui/resize-handle';
import { API_BASE_URL } from '@/config';
import { useVideoRenderProviders } from '@/shared/hooks/useVideoProject';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAspectRatio,
  VideoProject,
  VideoStoryboardScene,
} from '@/shared/types/video';

import { AssetsRail } from './assets/AssetsRail';
import type { VideoProjectEditorActions } from './editorTypes';
import { openVideoProjectFolder } from './openVideoProjectFolder';
import { CaptionOverlay } from './preview/CaptionOverlay';
import { openRenderedOutput } from './preview/previewOutputActions';
import {
  DEFAULT_PREVIEW_PLAYBACK_RATE,
  type PreviewPlaybackRate,
} from './preview/previewPlaybackRate';
import { PreviewRenderer } from './preview/PreviewRenderer';
import { PreviewStepHeader } from './preview/PreviewStepHeader';
import type { RemotionPreviewHandle } from './preview/RemotionPreview';
import { RenderProgressBar } from './preview/RenderProgressBar';
import { PreviewInspectorPanel } from './PreviewInspectorPanel';
import { PreviewSceneStrip } from './PreviewSceneStrip';
import { QaReportPanel } from './QaReportPanel';
import { RenderQueuePanel } from './RenderQueuePanel';
import { Timeline } from './timeline/Timeline';
import type { TimelineSceneSelectionSource } from './timeline/TimelineTypes';
import { useTimelineUiStore } from './timeline/useTimelineUiStore';

interface StepPreviewCanvasProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  selectedSceneId?: string | null;
  selectedSceneSource?: TimelineSceneSelectionSource;
  selectedScene?: VideoStoryboardScene | null;
  onSelectScene?: (sceneId: string) => void;
  onFindContext?: (sceneId: string) => void;
  selectedContextAssetIds?: string[];
  onToggleAssetContext?: (asset: VideoProject['assets'][number]) => void;
}

export function StepPreviewCanvas({
  project,
  actions,
  selectedSceneId,
  selectedSceneSource,
  selectedScene,
  onSelectScene,
  onFindContext,
  selectedContextAssetIds,
  onToggleAssetContext,
}: StepPreviewCanvasProps) {
  const { t } = useLanguage();
  const { providers: renderProviders } = useVideoRenderProviders();
  // The project's configured aspect ratio is the source of truth (the agent can
  // change it mid-session via video_set_aspect_ratio); fall back to a prior
  // render output, then 16:9.
  const projectAspect = project.settings?.defaultAspectRatios?.[0];
  const [aspect, setAspect] = useState<VideoAspectRatio>(
    projectAspect ?? project.outputs?.[0]?.aspectRatio ?? '16:9',
  );
  const [playbackRate, setPlaybackRate] = useState<PreviewPlaybackRate>(
    DEFAULT_PREVIEW_PLAYBACK_RATE,
  );
  // Reflect aspect changes the agent makes (does not override a manual pick,
  // which leaves projectAspect unchanged).
  useEffect(() => {
    if (projectAspect) setAspect(projectAspect);
  }, [projectAspect]);
  const hasOutput = Boolean(
    project.outputs?.length || project.render?.outputPath,
  );
  const selectedOutput =
    project.outputs?.find((output) => output.aspectRatio === aspect) ??
    project.outputs?.[0];
  const fallbackCount = project.render?.transitions?.degraded.length ?? 0;
  const scenes = project.storyboard?.scenes ?? [];
  const hasTimelinePreview = Boolean(project.timeline || scenes.length);
  const previewRef = useRef<RemotionPreviewHandle | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const playheadMs = useTimelineUiStore((state) => state.playheadMs);
  const playheadUpdateSource = useTimelineUiStore(
    (state) => state.playheadUpdateSource,
  );
  const setPlayheadMs = useTimelineUiStore((state) => state.setPlayheadMs);
  const togglePlayback = useTimelineUiStore((state) => state.togglePlayback);
  const setPlaybackState = useTimelineUiStore(
    (state) => state.setPlaybackState,
  );
  const videoSrc = hasOutput
    ? `${API_BASE_URL}/video/projects/${encodeURIComponent(
        project.id,
      )}/output?aspectRatio=${encodeURIComponent(aspect)}&v=${
        project.render?.updatedAt ?? ''
      }`
    : undefined;
  const posterSrc = selectedOutput?.posterPath
    ? `${API_BASE_URL}/video/projects/${encodeURIComponent(
        project.id,
      )}/poster?aspectRatio=${encodeURIComponent(aspect)}&v=${
        project.render?.updatedAt ?? ''
      }`
    : undefined;
  const handleTogglePlayback = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (!previewRef.current) {
        togglePlayback();
        return;
      }
      previewRef.current.togglePlayback(event);
    },
    [togglePlayback],
  );
  const handlePreviewPlayheadChange = useCallback(
    (ms: number) => {
      setPlayheadMs(ms, { source: 'preview' });
    },
    [setPlayheadMs],
  );
  const handleOpenOutput = useCallback(async () => {
    try {
      await openRenderedOutput(project, selectedOutput);
    } catch (err) {
      toast.error(
        `${t.video.editor.preview.openOutput}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }, [project, selectedOutput, t.video.editor.preview.openOutput]);
  const handleOpenOutputFolder = useCallback(async () => {
    try {
      await openVideoProjectFolder(project.id);
    } catch (err) {
      toast.error(
        `${t.video.editor.preview.openOutputFolder}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }, [project.id, t.video.editor.preview.openOutputFolder]);
  const handleCancelRender = useCallback(async () => {
    try {
      await actions.cancelRender();
    } catch (err) {
      // Surface so the user knows the render is still going. Silent void here
      // would leave them watching the strip with no feedback that the cancel
      // POST failed (e.g. sidecar dropped).
      toast.error(
        `${t.video.editor.renderProgress.cancel}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }, [actions, t.video.editor.renderProgress.cancel]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <PreviewStepHeader
        project={project}
        aspect={aspect}
        playbackRate={playbackRate}
        renderProviders={renderProviders}
        selectedOutput={selectedOutput}
        outputUrl={videoSrc}
        labels={{
          status: t.video.preview.status,
          previewTitle: t.video.editor.preview.title,
          playbackSpeed: t.video.editor.preview.playbackSpeed,
        }}
        actions={actions}
        onAspectChange={setAspect}
        onPlaybackRateChange={setPlaybackRate}
        onOpenOutput={() => void handleOpenOutput()}
        onOpenOutputFolder={() => void handleOpenOutputFolder()}
      />
      {fallbackCount > 0 ? (
        <div className="border-warning/30 bg-warning/10 text-warning-foreground border-b px-4 py-2 text-xs">
          {t.video.preview.transitionFallback.replace(
            '{count}',
            String(fallbackCount),
          )}
        </div>
      ) : null}
      <PanelGroup
        orientation="vertical"
        autoSave="video.preview.layout.v1"
        className="min-h-0 min-w-0 flex-1"
      >
        <Panel id="main-row" defaultSize="68%" minSize="15%">
          <PanelGroup
            orientation="horizontal"
            autoSave="video.preview.main-row.v1"
            className="min-h-0 min-w-0"
          >
            <Panel
              id="assets"
              defaultSize="20%"
              minSize="12%"
              collapsible
              collapsedSize="0%"
              className="min-w-0"
            >
              <div className="size-full overflow-auto p-3">
                <AssetsRail
                  project={project}
                  actions={actions}
                  selectedContextAssetIds={selectedContextAssetIds}
                  onToggleAssetContext={onToggleAssetContext}
                />
              </div>
            </Panel>
            <ResizeHandle id="assets-preview-handle" />
            <Panel
              id="preview"
              defaultSize="52%"
              minSize="30%"
              className="min-w-0"
            >
              <div className="flex size-full min-h-0 min-w-0 flex-col p-3">
                <div
                  ref={previewContainerRef}
                  className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-black"
                >
                  {hasTimelinePreview ? (
                    <>
                      <PreviewRenderer
                        ref={previewRef}
                        project={project}
                        aspectRatio={aspect}
                        playbackRate={playbackRate}
                        playheadMs={playheadMs}
                        playheadUpdateSource={playheadUpdateSource}
                        onPlayheadChange={handlePreviewPlayheadChange}
                        onPlaybackStateChange={setPlaybackState}
                      />
                      <CaptionOverlay
                        project={project}
                        scene={
                          scenes.find((s) => s.id === selectedSceneId) ?? null
                        }
                        actions={actions}
                        aspectRatio={aspect}
                        containerRef={previewContainerRef}
                      />
                    </>
                  ) : videoSrc ? (
                    <video
                      key={videoSrc}
                      controls
                      src={videoSrc}
                      poster={posterSrc}
                      className="max-h-full max-w-full"
                    />
                  ) : (
                    <div className="text-muted-foreground flex items-center gap-2 text-xs">
                      <PlayCircle className="size-4" />
                      <span>{t.video.preview.placeholder}</span>
                    </div>
                  )}
                </div>
                <div className="mt-3 shrink-0">
                  <PreviewSceneStrip
                    scenes={scenes}
                    selectedSceneId={selectedSceneId}
                    onSelectScene={onSelectScene}
                  />
                </div>
              </div>
            </Panel>
            <ResizeHandle id="preview-inspector-handle" />
            <Panel
              id="inspector"
              defaultSize="28%"
              minSize="16%"
              maxSize="42%"
              collapsible
              collapsedSize="0%"
              className="min-w-0"
            >
              <div className="size-full p-3">
                <PreviewInspectorPanel
                  project={project}
                  aspectRatio={aspect}
                  actions={actions}
                  selectedScene={selectedScene ?? null}
                  onFindContext={onFindContext ?? (() => undefined)}
                />
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
        <ResizeHandle orientation="vertical" id="main-timeline-handle" />
        <Panel id="timeline" defaultSize="32%" minSize="10%" maxSize="85%">
          <div className="size-full px-3 pb-3">
            <Timeline
              project={project}
              aspectRatio={aspect}
              selectedSceneId={selectedSceneId}
              selectedSceneSource={selectedSceneSource}
              onSelectScene={onSelectScene}
              onTimelineChange={actions.updateTimeline}
              onApplyAgentTool={actions.applyAgentTool}
              onTogglePlayback={handleTogglePlayback}
              onUndoAgentJournalEntry={actions.undoAgentJournalEntry}
              onRedoAgentJournalEntry={actions.redoAgentJournalEntry}
              onAttachLinkedAsset={actions.attachLinkedAsset}
              onAttachCatalogAsset={actions.attachCatalogAsset}
              onHydrateProjectAsset={actions.hydrateProjectAsset}
              onUploadAssets={actions.uploadAssets}
              className="size-full"
            />
          </div>
        </Panel>
      </PanelGroup>
      <QaReportPanel output={selectedOutput} projectId={project.id} />
      <RenderQueuePanel projectId={project.id} />
      <RenderProgressBar project={project} onCancel={handleCancelRender} />
    </div>
  );
}
