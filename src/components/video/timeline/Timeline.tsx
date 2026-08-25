import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useVirtualizer } from '@tanstack/react-virtual';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { deriveProjectBeatTimelineMs } from '@/shared/video/beatGrid';
import { useVideoFlags } from '@/shared/video/useVideoFlags';

import { compareTimelineRows, getProjectTimeline } from './projectTimeline';
import { TimelineCanvas } from './TimelineCanvas';
import { getTimelineCanvasMetrics } from './timelineCanvasMetrics';
import { TimelineEmptyState } from './TimelineEmptyState';
import { TimelineHeader } from './TimelineHeader';
import { RULER_HEIGHT } from './timelineLayout';
import {
  findTimelineOutOfSyncGroups,
  getSelectedLinkGroupIds,
} from './timelineLinkGroups';
import { TimelineLinkWarnings } from './TimelineLinkWarnings';
import { findSceneIdAtPlayhead } from './timelineSceneAtPlayhead';
import type { TimelineProps } from './TimelineTypes';
import { useTimelineAssetMaterializationSync } from './useTimelineAssetMaterializationSync';
import { useTimelineAutoFit } from './useTimelineAutoFit';
import { useTimelineClipboard } from './useTimelineClipboard';
import { useTimelineClipMove } from './useTimelineClipMove';
import { useTimelineClipSelection } from './useTimelineClipSelection';
import { useTimelineDeleteSelection } from './useTimelineDeleteSelection';
import { useTimelineDropHandlers } from './useTimelineDropHandlers';
import { useTimelineEditorBindings } from './useTimelineEditorStore';
import { useTimelineFrameStep } from './useTimelineFrameStep';
import { useTimelineKeyboardShortcuts } from './useTimelineKeyboardShortcuts';
import { useTimelineLabels } from './useTimelineLabels';
import { useTimelineLassoSelection } from './useTimelineLassoSelection';
import { useTimelinePersistence } from './useTimelinePersistence';
import { useTimelineSceneSeek } from './useTimelineSceneSeek';
import { useTimelineTrackActions } from './useTimelineTrackActions';
import { useTimelineTrackHeights } from './useTimelineTrackHeights';
import { useTimelineUiBindings } from './useTimelineUiStore';
import { useTimelineUndoArbitration } from './useTimelineUndoArbitration';
import { useTimelineViewportWidth } from './useTimelineViewportWidth';
import { useTrackDeleteConfirmation } from './useTrackDeleteConfirmation';

export function Timeline({
  project,
  aspectRatio,
  selectedSceneId,
  selectedSceneSource,
  onSelectScene,
  onTimelineChange,
  onTogglePlayback,
  onApplyAgentTool,
  onUndoAgentJournalEntry,
  onRedoAgentJournalEntry,
  onAttachLinkedAsset,
  onAttachCatalogAsset,
  onHydrateProjectAsset,
  onUploadAssets,
  className,
}: TimelineProps) {
  const { t } = useLanguage();
  const { flags } = useVideoFlags();
  const timelineTransitionsEnabled =
    flags['video.timelineTransitions'] !== false;
  const labels = useTimelineLabels();
  const timelineRootRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const timeline = useMemo(
    () => getProjectTimeline(project, aspectRatio),
    [aspectRatio, project],
  );
  const editor = useTimelineEditorBindings();
  const { materializationSessionId, materializationStates } =
    useTimelineAssetMaterializationSync({ project, editor });
  const ui = useTimelineUiBindings();
  const {
    playheadMs,
    playbackState,
    pixelsPerSecond,
    viewportWidth,
    snappingEnabled,
    snapTolerancePx,
    selectedTrackId,
    setViewportWidth,
    setScrollX,
    setPlayheadMs,
    zoomIn,
    zoomOut,
    zoomToFit,
    resetZoom,
    togglePlayback,
    toggleSnapping,
    setRazorToolEnabled,
    selectTrack,
  } = ui;
  const { trackHeights, getTrackHeight } = useTimelineTrackHeights();
  const activeTimeline =
    editor.projectId === project.id && editor.timeline
      ? editor.timeline
      : timeline;
  const tracks = useMemo(
    () => [...activeTimeline.tracks].sort(compareTimelineRows),
    [activeTimeline.tracks],
  );
  const markers = activeTimeline.markers ?? [];
  const beatTimesMs = useMemo(
    () => deriveProjectBeatTimelineMs({ ...project, timeline: activeTimeline }),
    [activeTimeline, project],
  );
  const activePlayheadSceneId = useMemo(
    () => findSceneIdAtPlayhead(tracks, playheadMs),
    [playheadMs, tracks],
  );
  const { timelineDurationMs, timelineWidth, totalHeight } =
    getTimelineCanvasMetrics(
      activeTimeline.durationMs,
      viewportWidth,
      pixelsPerSecond,
      tracks,
      getTrackHeight,
    );
  const rowVirtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => getTrackHeight(tracks[index]),
    overscan: 3,
    paddingStart: RULER_HEIGHT,
  });
  useEffect(
    () => rowVirtualizer.measure(),
    [rowVirtualizer, trackHeights, tracks],
  );
  const lasso = useTimelineLassoSelection({
    rows: rowVirtualizer.getVirtualItems(),
    tracks,
    pixelsPerSecond,
    onSelectTrack: selectTrack,
    onSelectClips: editor.selectClips,
  });
  useEffect(() => {
    editor.setProjectTimeline(project.id, timeline);
  }, [editor, project.id, timeline]);
  useTimelinePersistence({ projectId: project.id, onTimelineChange });
  const handleSplitSelectedClip = useCallback(() => {
    editor.splitSelectedClipAtPlayhead(playheadMs);
  }, [editor, playheadMs]);
  const handleDeleteSelectedClip = useTimelineDeleteSelection({
    activeTimeline,
    editor,
    labels: labels.track,
    onApplyAgentTool,
  });
  const handleAddMarker = useCallback(() => {
    editor.addMarker(playheadMs, t.video.editor.timeline.markerDefaultLabel);
  }, [editor, playheadMs, t.video.editor.timeline.markerDefaultLabel]);
  const clipboard = useTimelineClipboard({ playheadMs });
  const undoArbitration = useTimelineUndoArbitration({
    agentJournal: project.agentJournal ?? [],
    editor,
    onRedoAgentJournalEntry,
    onUndoAgentJournalEntry,
  });
  const clipMove = useTimelineClipMove({
    tracks,
    scrollRef,
    markers,
    beatTimesMs,
    playheadMs,
    timelineDurationMs,
    pixelsPerSecond,
    snappingEnabled,
    snapTolerancePx,
    selectedClipIds: editor.selectedClipIds,
    moveClip: editor.moveClip,
  });
  const {
    handleDropLinkedAsset,
    handleDropCatalogAssets,
    handleDropProjectAsset,
    handleDropOverlayPreset,
    handleDropFiles,
    handleDropOnNewTrack,
  } = useTimelineDropHandlers({
    project,
    aspectRatio,
    insertClip: editor.insertClip,
    updateClip: editor.updateClip,
    onAttachLinkedAsset,
    onAttachCatalogAsset,
    onHydrateProjectAsset,
    onUploadAssets,
    materializationSessionId,
  });
  const handleStepFrames = useTimelineFrameStep({
    fps: activeTimeline.fps,
    playheadMs,
    setPlayheadMs,
    timelineDurationMs,
  });
  useEffect(() => {
    if (timelineTransitionsEnabled || editor.selectedSeamId === null) return;
    editor.selectSeam(null);
  }, [editor, editor.selectedSeamId, timelineTransitionsEnabled]);
  useTimelineKeyboardShortcuts({
    rootRef: timelineRootRef,
    hasSelectedClips: editor.selectedClipIds.size > 0,
    hasSelectedTransition:
      timelineTransitionsEnabled && editor.selectedSeamId !== null,
    onSplitSelectedClip: handleSplitSelectedClip,
    onDeleteSelectedClip: handleDeleteSelectedClip,
    onSelectAllClips: editor.selectAllClips,
    onCopySelection: () => void clipboard.copy(),
    onCutSelection: () => void clipboard.cut(),
    onPasteClipboard: () => void clipboard.paste(),
    onUndo: undoArbitration.undo,
    onRedo: undoArbitration.redo,
    onAddMarker: handleAddMarker,
    onToggleSnapping: toggleSnapping,
    onSelectTool: () => setRazorToolEnabled(false),
    onRazorTool: () => setRazorToolEnabled(true),
    onStepFrames: handleStepFrames,
  });
  useTimelineViewportWidth({ scrollRef, setViewportWidth });
  const handleSelectClip = useTimelineClipSelection({
    onSelectScene,
    selectClip: editor.selectClip,
  });
  useTimelineSceneSeek({
    selectedSceneId,
    selectedSceneSource,
    tracks,
    pixelsPerSecond,
    scrollRef,
    setPlayheadMs,
    selectClip: editor.selectClip,
  });
  useEffect(() => {
    if (!activePlayheadSceneId) return;
    if (activePlayheadSceneId === selectedSceneId) return;
    onSelectScene?.(activePlayheadSceneId, { source: 'timeline' });
  }, [activePlayheadSceneId, onSelectScene, selectedSceneId]);
  const {
    handleRenameTrack,
    handleToggleTrackLock,
    handleToggleTrackSyncLock,
    handleToggleTrackMute,
    handleToggleTrackVisibility,
  } = useTimelineTrackActions({
    updateTrack: editor.updateTrack,
    removeTrack: editor.removeTrack,
  });
  const { requestDeleteTrack, dialog: trackDeleteDialog } =
    useTrackDeleteConfirmation(editor.removeTrack);
  const selectedLinkGroupIds = useMemo(
    () => getSelectedLinkGroupIds(tracks, editor.selectedClipIds),
    [editor.selectedClipIds, tracks],
  );
  const outOfSyncGroups = useMemo(
    () => findTimelineOutOfSyncGroups(activeTimeline),
    [activeTimeline],
  );

  const handleSeek = useCallback(
    (ms: number) => setPlayheadMs(Math.min(ms, timelineDurationMs)),
    [setPlayheadMs, timelineDurationMs],
  );
  const clipCount = useMemo(
    () => tracks.reduce((sum, track) => sum + track.clips.length, 0),
    [tracks],
  );
  const { handleResetZoom, handleZoomToFit } = useTimelineAutoFit({
    projectId: project.id,
    scrollRef,
    setViewportWidth,
    timelineDurationMs,
    tracksLength: tracks.length,
    clipCount,
    zoomToFit,
    resetZoom,
  });
  if (tracks.length === 0) {
    return (
      <TimelineEmptyState
        title={t.video.editor.timeline.title}
        empty={t.video.editor.timeline.empty}
        className={className}
      />
    );
  }

  return (
    <section
      ref={timelineRootRef}
      className={cn(
        'border-border bg-background flex min-h-0 flex-col overflow-hidden rounded-md border',
        className,
      )}
    >
      <TimelineHeader
        title={t.video.editor.timeline.title}
        durationMs={timeline.durationMs}
        playbackState={playbackState}
        pixelsPerSecond={pixelsPerSecond}
        snappingEnabled={snappingEnabled}
        labels={labels.toolbar}
        onTogglePlayback={onTogglePlayback ?? togglePlayback}
        onZoomOut={zoomOut}
        onZoomIn={zoomIn}
        onZoomToFit={handleZoomToFit}
        onResetZoom={handleResetZoom}
        onAddVideoTrack={editor.addVideoTrack}
        onAddTrack={editor.addTrack}
        onAddCaption={() => editor.insertCaptionAtPlayhead(playheadMs)}
        onToggleSnapping={toggleSnapping}
        onAddMarker={handleAddMarker}
      />
      <TimelineLinkWarnings
        blockedWarning={editor.lastEditWarning}
        outOfSyncGroups={outOfSyncGroups}
        labels={labels.track}
        onClearWarning={editor.clearEditWarning}
        onResyncGroup={editor.resyncLinkGroup}
        onUnlinkGroup={editor.unlinkLinkGroup}
      />
      <TimelineCanvas
        clipMove={clipMove}
        editor={editor}
        fps={activeTimeline.fps}
        labels={labels}
        lasso={lasso}
        markers={markers}
        beatTimesMs={beatTimesMs}
        materializationStates={materializationStates}
        pixelsPerSecond={pixelsPerSecond}
        playheadMs={playheadMs}
        playbackState={playbackState}
        project={project}
        rowVirtualizer={rowVirtualizer}
        scrollRef={scrollRef}
        selectedLinkGroupIds={selectedLinkGroupIds}
        selectedSceneId={selectedSceneId}
        selectedTrackId={selectedTrackId}
        setScrollX={setScrollX}
        timelineDurationMs={timelineDurationMs}
        timelineTransitionsEnabled={timelineTransitionsEnabled}
        timelineWidth={timelineWidth}
        totalHeight={totalHeight}
        tracks={tracks}
        onApplyAgentTool={onApplyAgentTool}
        onDeleteSelectedClip={handleDeleteSelectedClip}
        onDropCatalogAssets={handleDropCatalogAssets}
        onDropFiles={handleDropFiles}
        onDropOnNewTrack={handleDropOnNewTrack}
        onDropLinkedAsset={handleDropLinkedAsset}
        onDropOverlayPreset={handleDropOverlayPreset}
        onDropProjectAsset={handleDropProjectAsset}
        onMoveClip={clipMove.handleMoveClip}
        onRenameTrack={handleRenameTrack}
        onSeek={handleSeek}
        onSelectClip={handleSelectClip}
        onSelectTrack={selectTrack}
        onToggleTrackLock={handleToggleTrackLock}
        onToggleTrackMute={handleToggleTrackMute}
        onToggleTrackSyncLock={handleToggleTrackSyncLock}
        onToggleTrackVisibility={handleToggleTrackVisibility}
        onDeleteTrack={requestDeleteTrack}
      />
      {trackDeleteDialog}
    </section>
  );
}
