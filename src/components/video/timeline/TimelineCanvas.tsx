import type { RefObject } from 'react';

import type { Virtualizer } from '@tanstack/react-virtual';

import type { AssetDragPayload } from '@/shared/assets';
import type { MaterializationStateMap } from '@/shared/hooks/useAssetMaterializationEvents';
import type {
  VideoAgentToolCallInput,
  VideoProject,
  VideoTimelineClip,
  VideoTimelineMarker,
  VideoTimelineTrack,
} from '@/shared/types/video';

import type { LinkedAssetDragPayload } from '../linkedAssetDrag';
import type { OverlayPresetDragPayload } from '../overlays/overlayDragPayload';
import type { ProjectAssetDragPayload } from '../projectAssetDrag';
import { BeatGridOverlay } from './BeatGridOverlay';
import { SnapOverlay } from './SnapOverlay';
import type { TimelineClientPoint } from './timelineClipDrag';
import { TimelineHoverIndicator } from './TimelineHoverIndicator';
import type { TimelineTrackLabels } from './TimelineLabels';
import { TimelineLassoOverlay } from './TimelineLassoOverlay';
import { TRACK_HEADER_WIDTH } from './timelineLayout';
import { formatTimelineTime } from './timelineMath';
import { TimelineMoveOverlay } from './TimelineMoveOverlay';
import { TimelineNewTrackDropZone } from './TimelineNewTrackDropZone';
import { TimelinePlayhead } from './TimelinePlayhead';
import { TimelineRuler } from './TimelineRuler';
import type { TrackInsertSide } from './timelineTrackInsertion';
import { TimelineTrackRows } from './TimelineTrackRows';
import type { useTimelineClipMove } from './useTimelineClipMove';
import type { useTimelineEditorBindings } from './useTimelineEditorStore';
import { useTimelineHoverPreview } from './useTimelineHoverPreview';
import type { useTimelineLabels } from './useTimelineLabels';
import type { useTimelineLassoSelection } from './useTimelineLassoSelection';
import type { TimelinePlaybackState } from './useTimelineUiStore';

type TimelineClipMove = ReturnType<typeof useTimelineClipMove>;
type TimelineEditor = ReturnType<typeof useTimelineEditorBindings>;
type TimelineLabels = ReturnType<typeof useTimelineLabels>;
type TimelineLasso = ReturnType<typeof useTimelineLassoSelection>;

interface TimelineCanvasProps {
  clipMove: TimelineClipMove;
  editor: TimelineEditor;
  fps: number;
  labels: TimelineLabels;
  lasso: TimelineLasso;
  markers: VideoTimelineMarker[];
  beatTimesMs: number[];
  materializationStates?: MaterializationStateMap;
  pixelsPerSecond: number;
  playheadMs: number;
  playbackState: TimelinePlaybackState;
  project: VideoProject;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  scrollRef: RefObject<HTMLDivElement | null>;
  selectedLinkGroupIds: Set<string>;
  selectedSceneId?: string | null;
  selectedTrackId: string | null;
  setScrollX: (scrollX: number) => void;
  timelineDurationMs: number;
  timelineTransitionsEnabled?: boolean;
  timelineWidth: number;
  totalHeight: number;
  tracks: VideoTimelineTrack[];
  onApplyAgentTool?: (
    input: VideoAgentToolCallInput,
  ) => Promise<unknown> | unknown;
  onDeleteSelectedClip: (options?: { ripple?: boolean }) => void;
  onDropCatalogAssets?: (
    track: VideoTimelineTrack,
    startMs: number,
    payload: AssetDragPayload,
  ) => void;
  onDropFiles?: (
    track: VideoTimelineTrack,
    startMs: number,
    files: File[],
  ) => void;
  onDropOnNewTrack?: (
    dataTransfer: DataTransfer,
    anchorTrackId: string | null,
    side: TrackInsertSide,
    startMs: number,
  ) => boolean;
  onDropLinkedAsset?: (
    track: VideoTimelineTrack,
    startMs: number,
    payload: LinkedAssetDragPayload,
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
  onMoveClip: (
    clipId: string,
    deltaMs: number,
    baselineClip: VideoTimelineClip,
    clientPoint?: TimelineClientPoint,
  ) => void;
  onRenameTrack: (trackId: string, name: string) => void;
  onSeek: (ms: number) => void;
  onSelectClip: (
    clip: VideoTimelineClip,
    options?: Parameters<TimelineEditor['selectClip']>[1],
  ) => void;
  onSelectTrack: (trackId: string) => void;
  onToggleTrackLock: (track: VideoTimelineTrack) => void;
  onToggleTrackMute: (track: VideoTimelineTrack) => void;
  onToggleTrackSyncLock: (track: VideoTimelineTrack) => void;
  onToggleTrackVisibility?: (track: VideoTimelineTrack) => void;
  onDeleteTrack?: (track: VideoTimelineTrack) => void;
}

export function TimelineCanvas({
  clipMove,
  editor,
  fps,
  labels,
  lasso,
  markers,
  beatTimesMs,
  materializationStates,
  pixelsPerSecond,
  playheadMs,
  playbackState,
  project,
  rowVirtualizer,
  scrollRef,
  selectedLinkGroupIds,
  selectedSceneId,
  selectedTrackId,
  setScrollX,
  timelineDurationMs,
  timelineTransitionsEnabled = true,
  timelineWidth,
  totalHeight,
  tracks,
  onApplyAgentTool,
  onDeleteSelectedClip,
  onDropCatalogAssets,
  onDropFiles,
  onDropLinkedAsset,
  onDropProjectAsset,
  onDropOverlayPreset,
  onDropOnNewTrack,
  onMoveClip,
  onRenameTrack,
  onSeek,
  onSelectClip,
  onSelectTrack,
  onToggleTrackLock,
  onToggleTrackMute,
  onToggleTrackSyncLock,
  onToggleTrackVisibility,
  onDeleteTrack,
}: TimelineCanvasProps) {
  const hover = useTimelineHoverPreview({
    fps,
    isBusy:
      playbackState === 'playing' ||
      clipMove.overlay !== null ||
      lasso.rect !== null,
    pixelsPerSecond,
    scrollRef,
    timelineDurationMs,
    timelineWidth,
    trackHeaderWidth: TRACK_HEADER_WIDTH,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      className="relative min-h-0 flex-1 overflow-auto"
      onScroll={(event) => setScrollX(event.currentTarget.scrollLeft)}
      onPointerLeave={hover.clearHover}
      onPointerMoveCapture={hover.handlePointerMove}
    >
      <div
        data-timeline-scroll-content
        className="relative"
        style={{
          height: Math.max(totalHeight, rowVirtualizer.getTotalSize()),
          minHeight: '100%',
          width: TRACK_HEADER_WIDTH + timelineWidth,
        }}
        onPointerDownCapture={hover.clearHover}
        onPointerDown={lasso.handlePointerDown}
        onPointerMove={lasso.handlePointerMove}
        onPointerUp={lasso.handlePointerUp}
        onPointerCancel={lasso.handlePointerCancel}
      >
        {onDropOnNewTrack ? (
          <TimelineNewTrackDropZone
            pixelsPerSecond={pixelsPerSecond}
            timelineWidth={timelineWidth}
            hint={labels.track.newTrackDropHint}
            onDropOnNewTrack={onDropOnNewTrack}
          />
        ) : null}
        <BeatGridOverlay
          beatTimesMs={beatTimesMs}
          headerWidth={TRACK_HEADER_WIDTH}
          height={Math.max(totalHeight, rowVirtualizer.getTotalSize())}
          pixelsPerSecond={pixelsPerSecond}
        />
        <TimelineRuler
          durationMs={timelineDurationMs}
          headerWidth={TRACK_HEADER_WIDTH}
          timelineWidth={timelineWidth}
          pixelsPerSecond={pixelsPerSecond}
          markers={markers}
          selectedMarkerId={editor.selectedMarkerId}
          markerLabels={labels.marker}
          ariaLabel={labels.toolbar.seek}
          onSeek={onSeek}
          onSelectMarker={editor.selectMarker}
          onUpdateMarker={editor.updateMarker}
          onDeleteMarker={editor.deleteMarker}
        />
        <SnapOverlay
          headerWidth={TRACK_HEADER_WIDTH}
          pixelsPerSecond={pixelsPerSecond}
          snap={clipMove.overlay?.snap ?? null}
        />
        <TimelineLassoOverlay rect={lasso.rect} />
        <TimelineHoverIndicator
          headerWidth={TRACK_HEADER_WIDTH}
          height={Math.max(totalHeight, rowVirtualizer.getTotalSize())}
          hoverMs={hover.hoverMs}
          pixelsPerSecond={pixelsPerSecond}
        />
        <TimelinePlayhead
          playheadMs={playheadMs}
          durationMs={timelineDurationMs}
          headerWidth={TRACK_HEADER_WIDTH}
          pixelsPerSecond={pixelsPerSecond}
          ariaLabel={labels.toolbar.playhead.replace(
            '{time}',
            formatTimelineTime(playheadMs),
          )}
          onSeek={onSeek}
        />
        <TimelineTrackRows
          rows={virtualRows}
          tracks={tracks}
          project={project}
          materializationStates={materializationStates}
          timelineWidth={timelineWidth}
          pixelsPerSecond={pixelsPerSecond}
          fps={fps}
          selectedTrackId={selectedTrackId}
          selectedSceneId={selectedSceneId}
          selectedClipIds={editor.selectedClipIds}
          selectedLinkGroupIds={selectedLinkGroupIds}
          labels={labels.track as TimelineTrackLabels}
          playheadMs={playheadMs}
          timelineTransitionsEnabled={timelineTransitionsEnabled}
          onSelectTrack={onSelectTrack}
          onSelectClip={onSelectClip}
          onTrimClip={editor.trimClip}
          onMoveClip={onMoveClip}
          clipMoveDropTarget={clipMove.dropTarget}
          onMoveClipPreview={clipMove.handleMovePreview}
          onMoveClipPreviewEnd={clipMove.handleMovePreviewEnd}
          onDeleteSelectedClip={onDeleteSelectedClip}
          onDropLinkedAsset={onDropLinkedAsset}
          onDropCatalogAssets={onDropCatalogAssets}
          onDropOverlayPreset={onDropOverlayPreset}
          onDropProjectAsset={onDropProjectAsset}
          onDropFiles={onDropFiles}
          onDropOnNewTrack={onDropOnNewTrack}
          onToggleTrackMute={onToggleTrackMute}
          onToggleTrackLock={onToggleTrackLock}
          onToggleTrackSyncLock={onToggleTrackSyncLock}
          onToggleTrackVisibility={onToggleTrackVisibility}
          onDeleteTrack={onDeleteTrack}
          onRenameTrack={onRenameTrack}
          onMoveTrackLayer={editor.moveTrackLayer}
          onApplyAgentTool={onApplyAgentTool}
        />
        <TimelineMoveOverlay preview={clipMove.overlay} />
      </div>
    </div>
  );
}
