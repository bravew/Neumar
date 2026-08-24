import { useCallback, useMemo } from 'react';

import { useShallow } from 'zustand/react/shallow';

import { isAssetMaterializationBudgetError } from '@/shared/assets';
import type { AssetMaterializationBudgetError } from '@/shared/assets';
import type { VideoProject, VideoTimelineTrack } from '@/shared/types/video';

import type { VideoProjectEditorActions } from '../editorTypes';
import {
  hydratedDroppedAssetDurationPatch,
  mediaKindMatchesTrack,
  timelineClipFromDroppedAsset,
} from '../timeline/droppedAssetClip';
import {
  compareTimelineRows,
  getProjectTimeline,
} from '../timeline/projectTimeline';
import { findNextOpenClipStartMs } from '../timeline/timelinePlacement';
import { useTimelineEditorStore } from '../timeline/useTimelineEditorStore';
import { useTimelineUiStore } from '../timeline/useTimelineUiStore';
import { targetAspectRatioForProject } from '../timeline/visualAssetFit';

type ProjectAsset = VideoProject['assets'][number];

export function useProjectAssetTimelineActions(params: {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  sessionId: string;
  onBudgetIssue: (error: AssetMaterializationBudgetError) => void;
  onError: (error: unknown) => void;
}) {
  const { project, actions, sessionId, onBudgetIssue, onError } = params;
  const editor = useTimelineEditorStore(
    useShallow((state) => ({
      projectId: state.projectId,
      timeline: state.timeline,
      setProjectTimeline: state.setProjectTimeline,
      insertClip: state.insertClip,
      updateClip: state.updateClip,
    })),
  );
  const playheadMs = useTimelineUiStore((state) => state.playheadMs);
  const selectedTrackId = useTimelineUiStore((state) => state.selectedTrackId);
  const aspectRatio = useMemo(
    () => targetAspectRatioForProject(project),
    [project],
  );
  const activeTimeline = useMemo(
    () =>
      editor.projectId === project.id && editor.timeline
        ? editor.timeline
        : getProjectTimeline(project, aspectRatio),
    [aspectRatio, editor.projectId, editor.timeline, project],
  );

  const downloadAsset = useCallback(
    (asset: ProjectAsset) => {
      if (!canDownloadProjectAsset(asset)) return;
      void actions
        .hydrateProjectAsset(asset.id, { sessionId })
        .catch((error) => {
          if (isAssetMaterializationBudgetError(error)) {
            onBudgetIssue(error);
          } else {
            onError(error);
          }
        });
    },
    [actions, onBudgetIssue, onError, sessionId],
  );

  const placeAsset = useCallback(
    (asset: ProjectAsset) => {
      const track = choosePlacementTrack(
        activeTimeline.tracks,
        asset.kind,
        selectedTrackId,
      );
      if (!track) return;
      if (editor.projectId !== project.id || !editor.timeline) {
        editor.setProjectTimeline(project.id, activeTimeline);
      }
      const clip = timelineClipFromDroppedAsset(asset, track, playheadMs, {
        aspectRatio,
      });
      if (!clip) return;
      const placementStartMs = findNextOpenClipStartMs(
        track,
        playheadMs,
        clip.durationMs,
      );
      const placedClip =
        placementStartMs === clip.startMs
          ? clip
          : { ...clip, startMs: placementStartMs };
      editor.insertClip(track.id, placedClip);
      if (!canDownloadProjectAsset(asset)) return;
      void actions
        .hydrateProjectAsset(asset.id, { sessionId })
        .then((result) => {
          const patch = result
            ? hydratedDroppedAssetDurationPatch(placedClip, result.asset)
            : null;
          if (patch) editor.updateClip(placedClip.id, patch);
        })
        .catch((error) => {
          if (isAssetMaterializationBudgetError(error)) {
            onBudgetIssue(error);
          } else {
            onError(error);
          }
        });
    },
    [
      actions,
      activeTimeline,
      aspectRatio,
      editor,
      onBudgetIssue,
      onError,
      playheadMs,
      project.id,
      selectedTrackId,
      sessionId,
    ],
  );

  return useMemo(
    () => ({ placeAsset, downloadAsset }),
    [downloadAsset, placeAsset],
  );
}

export function canDownloadProjectAsset(asset: ProjectAsset): boolean {
  return (
    asset.materializationState === 'referenced' ||
    asset.materializationState === 'hydrating' ||
    asset.materializationState === 'error'
  );
}

/** True once the asset's master is actually on disk — reveal needs a real file to point Finder at. */
export function canRevealProjectAsset(asset: ProjectAsset): boolean {
  return !canDownloadProjectAsset(asset);
}

function choosePlacementTrack(
  tracks: VideoTimelineTrack[],
  assetKind: ProjectAsset['kind'],
  selectedTrackId: string | null,
): VideoTimelineTrack | null {
  const orderedTracks = [...tracks].sort(compareTimelineRows);
  const selectedTrack = orderedTracks.find(
    (track) => track.id === selectedTrackId,
  );
  if (
    selectedTrack &&
    !selectedTrack.locked &&
    mediaKindMatchesTrack(assetKind, selectedTrack)
  ) {
    return selectedTrack;
  }
  return (
    orderedTracks.find(
      (track) => !track.locked && mediaKindMatchesTrack(assetKind, track),
    ) ?? null
  );
}
