import type {
  VideoAspectRatio,
  VideoProject,
  VideoRenderProviderView,
} from '@/shared/types/video';

import type { VideoProjectEditorActions } from '../editorTypes';
import { ShareModal } from '../ShareModal';
import { EditorHandoffExport } from './EditorHandoffExport';
import { PreviewModeToggle, type PreviewViewMode } from './OutputView';
import { PreviewDisplayControls } from './PreviewDisplayControls';
import type { PreviewPlaybackRate } from './previewPlaybackRate';
import { RenderControls } from './RenderControls';

const ASPECTS: VideoAspectRatio[] = ['16:9', '9:16', '1:1', '4:5'];

interface PreviewStepHeaderProps {
  project: VideoProject;
  aspect: VideoAspectRatio;
  playbackRate: PreviewPlaybackRate;
  renderProviders: VideoRenderProviderView[];
  selectedOutput?: NonNullable<VideoProject['outputs']>[number];
  outputUrl?: string;
  labels: {
    status: string;
    previewTitle: string;
    playbackSpeed: string;
  };
  actions: Pick<
    VideoProjectEditorActions,
    | 'queueEditorHandoff'
    | 'getEditorHandoffJob'
    | 'renderProject'
    | 'queueRenderProject'
    | 'approveStoryboard'
  >;
  onAspectChange: (aspect: VideoAspectRatio) => void;
  onPlaybackRateChange: (playbackRate: PreviewPlaybackRate) => void;
  onOpenOutput: () => void;
  onOpenOutputFolder: () => void;
  viewMode: PreviewViewMode;
  onViewModeChange: (mode: PreviewViewMode) => void;
}

export function PreviewStepHeader({
  project,
  aspect,
  playbackRate,
  renderProviders,
  selectedOutput,
  outputUrl,
  labels,
  actions,
  onAspectChange,
  onPlaybackRateChange,
  onOpenOutput,
  onOpenOutputFolder,
  viewMode,
  onViewModeChange,
}: PreviewStepHeaderProps) {
  return (
    <div className="border-border flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
      <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
        {labels.status.replace('{status}', project.render?.status ?? 'idle')}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <PreviewModeToggle
          mode={viewMode}
          onChange={onViewModeChange}
          outputAvailable={Boolean(outputUrl)}
        />
        <PreviewDisplayControls
          aspect={aspect}
          aspectLabel={labels.previewTitle}
          aspectOptions={ASPECTS}
          playbackRate={playbackRate}
          playbackRateLabel={labels.playbackSpeed}
          onAspectChange={onAspectChange}
          onPlaybackRateChange={onPlaybackRateChange}
        />
        <ShareModal
          project={project}
          aspect={aspect}
          output={selectedOutput}
          outputUrl={outputUrl}
        />
        <EditorHandoffExport
          onQueue={actions.queueEditorHandoff}
          onGetJob={actions.getEditorHandoffJob}
        />
        <RenderControls
          project={project}
          aspect={aspect}
          renderProviders={renderProviders}
          storyboardApproved={project.storyboard?.status === 'approved'}
          outputAvailable={Boolean(outputUrl)}
          onOpenOutput={onOpenOutput}
          onOpenOutputFolder={onOpenOutputFolder}
          onRender={actions.renderProject}
          onApproveStoryboard={actions.approveStoryboard}
          onQueueRender={actions.queueRenderProject}
        />
      </div>
    </div>
  );
}
