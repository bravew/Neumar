import { useEffect, useMemo, useState } from 'react';

import * as Popover from '@radix-ui/react-popover';
import {
  ChevronDown,
  Cloud,
  FolderOpen,
  HardDrive,
  Play,
  RefreshCw,
} from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAspectRatio,
  VideoCaptionRenderMode,
  VideoLoudnessTargetSetting,
  VideoProject,
  VideoRenderProviderView,
} from '@/shared/types/video';

import { canRenderProject } from '../render-readiness';
import { SavePluginCandidateDialog } from '../SavePluginCandidateDialog';
import { RenderSettingsForm } from './RenderSettingsForm';
import { RenderStatusSummary } from './RenderStatusSummary';

interface RenderOptions {
  where?: 'local' | 'cloud';
  renderProviderId?: string;
  cloudEgressConfirmed?: boolean;
  loudnessTargetLufs?: Exclude<VideoLoudnessTargetSetting, 'off'>;
  autoColor?: boolean;
  autoReframe?: boolean;
  captionMode?: VideoCaptionRenderMode;
}

interface RenderControlsProps {
  project: VideoProject;
  aspect: VideoAspectRatio;
  renderProviders: VideoRenderProviderView[];
  storyboardApproved: boolean;
  outputAvailable?: boolean;
  onOpenOutput?: () => void;
  onOpenOutputFolder?: () => void;
  onRender: (aspect: VideoAspectRatio, options?: RenderOptions) => unknown;
  onQueueRender?: (
    aspectRatios: VideoAspectRatio[],
    options?: RenderOptions,
  ) => unknown;
}

function hasTimelineCaptions(project: VideoProject): boolean {
  const tracks = project.timeline?.tracks ?? [];
  return tracks.some(
    (track) => track.kind === 'caption' && (track.clips?.length ?? 0) > 0,
  );
}

/**
 * Compact split-button render trigger.
 *
 * Main button kicks off render with the currently-active settings; the chevron
 * opens a Radix popover with Local / Cloud / provider / consent controls.
 * Used by the Preview step in place of a full toolbar row.
 */
export function RenderControls({
  project,
  aspect,
  renderProviders,
  storyboardApproved,
  outputAvailable,
  onOpenOutput,
  onOpenOutputFolder,
  onRender,
  onQueueRender,
}: RenderControlsProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [renderWhere, setRenderWhere] = useState<'local' | 'cloud'>(
    project.settings?.renderWhere ?? 'local',
  );
  const cloudProviders = useMemo(
    () =>
      renderProviders.filter(
        (provider) =>
          provider.provider !== 'local' &&
          provider.enabled &&
          provider.hasApiKey,
      ),
    [renderProviders],
  );
  const [renderProviderId, setRenderProviderId] = useState(
    project.settings?.cloudRenderProviderId ?? cloudProviders[0]?.id ?? 'fal',
  );
  const [cloudEgressConfirmed, setCloudEgressConfirmed] = useState(
    project.settings?.cloudRenderConsents?.[renderProviderId]?.confirmed ===
      true,
  );
  const [loudnessTargetLufs, setLoudnessTargetLufs] =
    useState<VideoLoudnessTargetSetting>(
      project.settings?.loudnessTargetLufs ?? 'off',
    );
  const [autoColor, setAutoColor] = useState(
    project.settings?.autoColorEnabled === true,
  );
  const [autoReframe, setAutoReframe] = useState(
    project.settings?.autoReframeEnabled !== false,
  );
  // Caption render default: persisted project setting wins; otherwise if the
  // timeline has caption clips, default to 'burn-in' so the rendered MP4
  // matches what the user just previewed. Without this, captions silently
  // disappeared from the exported file even though they showed in preview.
  const [captionMode, setCaptionMode] = useState<VideoCaptionRenderMode>(() => {
    if (project.settings?.renderCaptionMode) {
      return project.settings.renderCaptionMode;
    }
    return hasTimelineCaptions(project) ? 'burn-in' : 'off';
  });

  useEffect(() => {
    if (renderWhere !== 'cloud') return;
    if (cloudProviders.length === 0) return;
    if (cloudProviders.some((provider) => provider.id === renderProviderId)) {
      return;
    }
    const nextProviderId = cloudProviders[0]!.id;
    setRenderProviderId(nextProviderId);
    setCloudEgressConfirmed(
      project.settings?.cloudRenderConsents?.[nextProviderId]?.confirmed ===
        true,
    );
  }, [
    cloudProviders,
    project.settings?.cloudRenderConsents,
    renderProviderId,
    renderWhere,
  ]);

  const isRendering = project.render?.status === 'running';
  const renderProgress = project.render?.progress;
  const renderReady = canRenderProject(project, storyboardApproved);
  const renderBlocked =
    isRendering ||
    !renderReady ||
    (renderWhere === 'cloud' &&
      (cloudProviders.length === 0 || !cloudEgressConfirmed));

  const handleRender = () => {
    const options = currentRenderOptions();
    void onRender(aspect, options);
    setOpen(false);
  };

  const handleQueueRender = () => {
    if (!onQueueRender) return;
    void onQueueRender([aspect], currentRenderOptions());
    setOpen(false);
  };

  const currentRenderOptions = (): RenderOptions => ({
    where: renderWhere,
    renderProviderId: renderWhere === 'cloud' ? renderProviderId : undefined,
    cloudEgressConfirmed:
      renderWhere === 'cloud' ? cloudEgressConfirmed : undefined,
    loudnessTargetLufs:
      loudnessTargetLufs === 'off' ? undefined : loudnessTargetLufs,
    autoColor,
    autoReframe,
    captionMode,
  });

  const ModeIcon = renderWhere === 'cloud' ? Cloud : HardDrive;

  return (
    <div className="flex items-center gap-2">
      <div className="border-primary bg-primary text-primary-foreground inline-flex overflow-hidden rounded-md border">
        <button
          type="button"
          onClick={handleRender}
          disabled={renderBlocked}
          className="hover:bg-primary/90 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium disabled:opacity-60"
        >
          <RefreshCw
            className={`size-3 ${isRendering ? 'animate-spin' : ''}`}
          />
          {isRendering
            ? renderProgress != null
              ? `${Math.round(renderProgress)}%`
              : t.video.editor.actions.rerender
            : t.video.editor.actions.rerender}
          <ModeIcon className="ml-1 size-3 opacity-80" />
        </button>
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={t.video.editor.preview.title}
              aria-haspopup="dialog"
              aria-expanded={open}
              className="hover:bg-primary/90 border-primary-foreground/20 inline-flex items-center border-l px-1.5 py-1.5"
            >
              <ChevronDown className="size-3" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={6}
              className="bg-popover text-popover-foreground z-50 max-h-[80vh] w-80 overflow-y-auto rounded-md border p-3 text-xs shadow-md"
            >
              <RenderStatusSummary project={project} aspect={aspect} />
              <SavePluginCandidateDialog project={project} />
              <RenderSettingsForm
                project={project}
                cloudProviders={cloudProviders}
                state={{
                  renderWhere,
                  renderProviderId,
                  cloudEgressConfirmed,
                  loudnessTargetLufs,
                  autoColor,
                  autoReframe,
                  captionMode,
                }}
                setters={{
                  setRenderWhere,
                  setRenderProviderId,
                  setCloudEgressConfirmed,
                  setLoudnessTargetLufs,
                  setAutoColor,
                  setAutoReframe,
                  setCaptionMode,
                }}
                renderBlocked={renderBlocked}
                onQueueRender={onQueueRender ? handleQueueRender : undefined}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      {outputAvailable && onOpenOutput ? (
        <button
          type="button"
          onClick={onOpenOutput}
          className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs"
        >
          <Play className="size-3" />
          {t.video.editor.preview.openOutput}
        </button>
      ) : null}
      {onOpenOutputFolder ? (
        <button
          type="button"
          onClick={onOpenOutputFolder}
          aria-label={t.video.editor.preview.openOutputFolder}
          title={t.video.editor.preview.openOutputFolder}
          className="border-border hover:bg-accent inline-flex size-8 items-center justify-center rounded-md border text-xs"
        >
          <FolderOpen className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
