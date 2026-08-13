import { useMemo } from 'react';

import { type AssetDragPayload } from '@/shared/assets';
import type { MaterializationStateMap } from '@/shared/hooks/useAssetMaterializationEvents';
import { cn } from '@/shared/lib/utils';
import {
  type VideoProject,
  type VideoAgentToolCallInput,
  type VideoTimelineClip,
  type VideoTimelineTrack,
} from '@/shared/types/video';

import type { LinkedAssetDragPayload } from '../linkedAssetDrag';
import type { OverlayPresetDragPayload } from '../overlays/overlayDragPayload';
import type { ProjectAssetDragPayload } from '../projectAssetDrag';
import { compareTimelineClips } from './projectTimeline';
import { TimelineClip } from './TimelineClip';
import type {
  TimelineClientPoint,
  TimelineClipDropTarget,
  TimelineClipMovePreview,
} from './timelineClipDrag';
import type { TimelineTrackLabels } from './TimelineLabels';
import { pixelsToMs } from './timelineMath';
import { getTimelineClipMediaSrc, resolveClipAsset } from './timelineMedia';
import {
  dispatchTrackDrop,
  trackAcceptsDrag,
} from './timelineTrackDropDispatch';
import { TimelineTrackDropIndicator } from './TimelineTrackDropIndicator';
import {
  TimelineTrackTransitions,
  useTimelineTrackTransitions,
} from './TimelineTrackTransitions';
import { TrackHeader } from './TrackHeader';
import type {
  TimelineClipSelectionMode,
  TimelineTrimEdge,
} from './useTimelineEditorStore';
import { useTimelineTrackContextMenu } from './useTimelineTrackContextMenu';

interface TimelineTrackProps {
  project: VideoProject;
  materializationStates?: MaterializationStateMap;
  track: VideoTimelineTrack;
  headerWidth: number;
  timelineWidth: number;
  pixelsPerSecond: number;
  fps: number;
  playheadMs: number;
  selectedTrack: boolean;
  selectedClipIds: Set<string>;
  selectedLinkGroupIds: Set<string>;
  labels: TimelineTrackLabels;
  timelineTransitionsEnabled?: boolean;
  onSelectTrack: (trackId: string) => void;
  onSelectClip: (
    clip: VideoTimelineClip,
    options?: { mode?: TimelineClipSelectionMode },
  ) => void;
  onTrimClip: (
    clipId: string,
    edge: TimelineTrimEdge,
    deltaMs: number,
    baselineClip: VideoTimelineClip,
  ) => void;
  onMoveClip: (
    clipId: string,
    deltaMs: number,
    baselineClip: VideoTimelineClip,
    clientPoint?: TimelineClientPoint,
  ) => void;
  clipMoveDropTarget?: TimelineClipDropTarget | null;
  onMoveClipPreview?: (preview: TimelineClipMovePreview) => void;
  onMoveClipPreviewEnd?: () => void;
  onDeleteSelectedClip: (options?: { ripple?: boolean }) => void;
  onDropLinkedAsset?: (
    track: VideoTimelineTrack,
    startMs: number,
    payload: LinkedAssetDragPayload,
  ) => void;
  onDropCatalogAssets?: (
    track: VideoTimelineTrack,
    startMs: number,
    payload: AssetDragPayload,
  ) => void;
  onDropProjectAsset?: (
    track: VideoTimelineTrack,
    startMs: number,
    payload: ProjectAssetDragPayload,
  ) => void;
  onDropOverlayPreset?: (
    track: VideoTimelineTrack,
    startMs: number,
    payload: OverlayPresetDragPayload,
  ) => void;
  onDropFiles?: (
    track: VideoTimelineTrack,
    startMs: number,
    files: File[],
  ) => void;
  onToggleTrackMute: (track: VideoTimelineTrack) => void;
  onToggleTrackLock: (track: VideoTimelineTrack) => void;
  onToggleTrackSyncLock: (track: VideoTimelineTrack) => void;
  onToggleTrackVisibility?: (track: VideoTimelineTrack) => void;
  onDeleteTrack?: (track: VideoTimelineTrack) => void;
  onRenameTrack: (trackId: string, name: string) => void;
  onMoveTrackLayer: (trackId: string, direction: 'up' | 'down') => void;
  onAddClipFiles?: (track: VideoTimelineTrack, files: File[]) => void;
  onApplyAgentTool?: (
    input: VideoAgentToolCallInput,
  ) => Promise<unknown> | unknown;
}

export function TimelineTrack({
  project,
  materializationStates,
  track,
  headerWidth,
  timelineWidth,
  pixelsPerSecond,
  fps,
  playheadMs,
  selectedTrack,
  selectedClipIds,
  selectedLinkGroupIds,
  labels,
  timelineTransitionsEnabled = true,
  onSelectTrack,
  onSelectClip,
  onTrimClip,
  onMoveClip,
  clipMoveDropTarget,
  onMoveClipPreview,
  onMoveClipPreviewEnd,
  onDeleteSelectedClip,
  onDropLinkedAsset,
  onDropCatalogAssets,
  onDropProjectAsset,
  onDropOverlayPreset,
  onDropFiles,
  onToggleTrackMute,
  onToggleTrackLock,
  onToggleTrackSyncLock,
  onToggleTrackVisibility,
  onDeleteTrack,
  onRenameTrack,
  onMoveTrackLayer,
  onAddClipFiles,
  onApplyAgentTool,
}: TimelineTrackProps) {
  const clips = useMemo(
    () => [...track.clips].sort(compareTimelineClips),
    [track.clips],
  );
  const transitions = useTimelineTrackTransitions({
    enabled: timelineTransitionsEnabled,
    track,
    clips,
    fps,
    pixelsPerSecond,
    labels,
  });
  const dropHandlers = {
    onDropLinkedAsset,
    onDropCatalogAssets,
    onDropProjectAsset,
    onDropOverlayPreset,
    onDropFiles,
  };
  const activeDropTarget =
    clipMoveDropTarget?.trackId === track.id ? clipMoveDropTarget : null;
  const contextMenu = useTimelineTrackContextMenu({
    clips,
    labels,
    onMoveTrackLayer,
    onSelectClip,
    onSelectTrack,
    onToggleTrackLock,
    onToggleTrackMute,
    onToggleTrackSyncLock,
    onApplyAgentTool,
    onDeleteSelectedClip,
    playheadMs,
    selectedClipIds,
    track,
  });
  return (
    <div
      className="grid h-full"
      onContextMenu={contextMenu.onContextMenu}
      style={{
        gridTemplateColumns: `${headerWidth}px ${timelineWidth}px`,
        width: headerWidth + timelineWidth,
      }}
    >
      <TrackHeader
        track={track}
        labels={labels}
        selected={selectedTrack}
        onToggleMute={onToggleTrackMute}
        onToggleLock={onToggleTrackLock}
        onToggleSyncLock={onToggleTrackSyncLock}
        onToggleVisibility={onToggleTrackVisibility}
        onDeleteTrack={onDeleteTrack}
        onRename={onRenameTrack}
        onMoveLayer={onMoveTrackLayer}
        onSelectTrack={onSelectTrack}
        onAddClipFiles={onAddClipFiles}
      />
      <div
        data-timeline-track-id={track.id}
        data-active-timeline-track={selectedTrack ? 'true' : undefined}
        role="button"
        aria-pressed={selectedTrack}
        tabIndex={0}
        className={cn(
          'border-border relative h-full border-b text-left transition-colors',
          selectedTrack
            ? 'ring-primary/30 bg-primary/10 ring-1 ring-inset'
            : 'bg-muted/20 hover:bg-muted/30',
        )}
        onDragOver={(event) => {
          if (transitions.handleDragOver(event)) return;
          if (track.locked) return;
          if (!trackAcceptsDrag(event.dataTransfer, track, dropHandlers)) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={transitions.handleDragLeave}
        onDrop={(event) => {
          if (transitions.handleDrop(event)) return;
          if (track.locked) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const startMs = pixelsToMs(
            event.clientX - rect.left,
            pixelsPerSecond,
          );
          if (
            dispatchTrackDrop(event.dataTransfer, track, startMs, dropHandlers)
          ) {
            event.preventDefault();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelectTrack(track.id);
          }
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.16)_1px,transparent_1px)] bg-[length:80px_100%]" />
        {activeDropTarget ? (
          <TimelineTrackDropIndicator
            dropTarget={activeDropTarget}
            pixelsPerSecond={pixelsPerSecond}
          />
        ) : null}
        {clips.length === 0 && !track.locked ? (
          <div className="pointer-events-none sticky left-0 flex h-full items-center px-3">
            <div className="border-border/60 text-muted-foreground inline-flex items-center gap-1.5 rounded-md border border-dashed bg-transparent px-2 py-1 text-[11px]">
              <span>{labels.trackEmptyDropHint}</span>
            </div>
          </div>
        ) : null}
        {clips.map((clip) => (
          <TimelineClip
            key={clip.id}
            clip={clip}
            track={track}
            mediaSrc={getTimelineClipMediaSrc(project, clip)}
            asset={resolveClipAsset(project, clip)}
            materializationStates={materializationStates}
            projectId={project.id}
            pixelsPerSecond={pixelsPerSecond}
            selected={selectedClipIds.has(clip.id)}
            linkedPartner={
              !!clip.linkGroupId && selectedLinkGroupIds.has(clip.linkGroupId)
            }
            labels={{
              trimStart: labels.trimStart,
              trimEnd: labels.trimEnd,
              linkedClip: labels.linkedClip,
              keyframedClip: labels.keyframedClip,
              captionGroup: labels.captionGroup,
              audioMutedClip: labels.audioMutedClip,
              audioGainClip: labels.audioGainClip,
              audioFadeClip: labels.audioFadeClip,
              audioTransitionClip: labels.audioTransitionClip,
              audioFadeInHandle: labels.audioFadeInHandle,
              audioFadeOutHandle: labels.audioFadeOutHandle,
              keyboardMoveHint: labels.keyboardMoveHint,
              keyboardMoveAnnouncement: labels.keyboardMoveAnnouncement,
            }}
            onSelect={(selectedClip, options) => {
              onSelectTrack(track.id);
              onSelectClip(selectedClip, options);
            }}
            onTrimClip={onTrimClip}
            onMoveClip={onMoveClip}
            onMovePreview={onMoveClipPreview}
            onMovePreviewEnd={onMoveClipPreviewEnd}
          />
        ))}
        <TimelineTrackTransitions
          dragOverSeamId={transitions.dragOverSeamId}
          fps={fps}
          labels={labels}
          pixelsPerSecond={pixelsPerSecond}
          seams={transitions.transitionSeams}
          trackId={track.id}
          onSelectTrack={onSelectTrack}
        />
        {transitions.dropNotice ? (
          <div className="bg-destructive text-destructive-foreground pointer-events-none absolute top-2 left-2 z-30 max-w-60 rounded px-2 py-1 text-[11px] shadow">
            {transitions.dropNotice}
          </div>
        ) : null}
      </div>
      {contextMenu.menu}
    </div>
  );
}
