import type { VirtualItem } from '@tanstack/react-virtual';

import type { AssetDragPayload } from '@/shared/assets';
import type { MaterializationStateMap } from '@/shared/hooks/useAssetMaterializationEvents';
import type {
  VideoAgentToolCallInput,
  VideoProject,
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';

import type { LinkedAssetDragPayload } from '../linkedAssetDrag';
import type { OverlayPresetDragPayload } from '../overlays/overlayDragPayload';
import type { ProjectAssetDragPayload } from '../projectAssetDrag';
import type {
  TimelineClientPoint,
  TimelineClipDropTarget,
  TimelineClipMovePreview,
} from './timelineClipDrag';
import type { TimelineTrackLabels } from './TimelineLabels';
import { TRACK_HEADER_WIDTH } from './timelineLayout';
import { TimelineTrack } from './TimelineTrack';
import { TimelineTrackResizeHandle } from './TimelineTrackResizeHandle';
import type {
  TimelineClipSelectionMode,
  TimelineLayerMoveDirection,
  TimelineTrimEdge,
} from './useTimelineEditorStore';
import { useTimelineUiStore } from './useTimelineUiStore';

interface TimelineTrackRowsProps {
  rows: VirtualItem[];
  tracks: VideoTimelineTrack[];
  project: VideoProject;
  materializationStates?: MaterializationStateMap;
  timelineWidth: number;
  pixelsPerSecond: number;
  fps: number;
  selectedTrackId: string | null;
  selectedSceneId?: string | null;
  selectedClipIds: Set<string>;
  selectedLinkGroupIds: Set<string>;
  labels: TimelineTrackLabels;
  playheadMs: number;
  timelineTransitionsEnabled?: boolean;
  clipMoveDropTarget?: TimelineClipDropTarget | null;
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
  onMoveTrackLayer: (
    trackId: string,
    direction: TimelineLayerMoveDirection,
  ) => void;
  onApplyAgentTool?: (
    input: VideoAgentToolCallInput,
  ) => Promise<unknown> | unknown;
}

export function TimelineTrackRows({
  rows,
  tracks,
  project,
  materializationStates,
  timelineWidth,
  pixelsPerSecond,
  fps,
  selectedTrackId,
  selectedSceneId,
  selectedClipIds,
  selectedLinkGroupIds,
  labels,
  playheadMs,
  timelineTransitionsEnabled = true,
  clipMoveDropTarget,
  onSelectTrack,
  onSelectClip,
  onTrimClip,
  onMoveClip,
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
  onApplyAgentTool,
}: TimelineTrackRowsProps) {
  const setTrackHeight = useTimelineUiStore((state) => state.setTrackHeight);
  const resetTrackHeight = useTimelineUiStore(
    (state) => state.resetTrackHeight,
  );
  return (
    <>
      {rows.map((row) => {
        const track = tracks[row.index];
        if (!track) return null;
        return (
          <div
            key={track.id}
            className="absolute left-0"
            style={{
              height: row.size,
              transform: `translateY(${row.start}px)`,
            }}
          >
            <TimelineTrack
              project={project}
              materializationStates={materializationStates}
              track={track}
              headerWidth={TRACK_HEADER_WIDTH}
              timelineWidth={timelineWidth}
              pixelsPerSecond={pixelsPerSecond}
              fps={fps}
              playheadMs={playheadMs}
              timelineTransitionsEnabled={timelineTransitionsEnabled}
              selectedTrack={
                selectedTrackId === track.id ||
                (!!selectedSceneId &&
                  track.clips.some((c) => c.sceneId === selectedSceneId))
              }
              selectedClipIds={selectedClipIds}
              selectedLinkGroupIds={selectedLinkGroupIds}
              labels={labels}
              onSelectTrack={onSelectTrack}
              onSelectClip={onSelectClip}
              onTrimClip={onTrimClip}
              onMoveClip={onMoveClip}
              clipMoveDropTarget={clipMoveDropTarget}
              onMoveClipPreview={onMoveClipPreview}
              onMoveClipPreviewEnd={onMoveClipPreviewEnd}
              onDeleteSelectedClip={onDeleteSelectedClip}
              onDropLinkedAsset={onDropLinkedAsset}
              onDropCatalogAssets={onDropCatalogAssets}
              onDropOverlayPreset={onDropOverlayPreset}
              onDropProjectAsset={onDropProjectAsset}
              onDropFiles={onDropFiles}
              onAddClipFiles={(t, files) => onDropFiles?.(t, playheadMs, files)}
              onToggleTrackMute={onToggleTrackMute}
              onToggleTrackLock={onToggleTrackLock}
              onToggleTrackSyncLock={onToggleTrackSyncLock}
              onToggleTrackVisibility={onToggleTrackVisibility}
              onDeleteTrack={onDeleteTrack}
              onRenameTrack={onRenameTrack}
              onMoveTrackLayer={onMoveTrackLayer}
              onApplyAgentTool={onApplyAgentTool}
            />
            <TimelineTrackResizeHandle
              currentHeight={row.size}
              onResize={(next) => setTrackHeight(track.id, next)}
              onReset={() => resetTrackHeight(track.id)}
              label={labels.resizeTrack}
            />
          </div>
        );
      })}
    </>
  );
}
