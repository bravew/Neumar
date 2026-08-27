import { useCallback, useMemo } from 'react';

import { useShallow } from 'zustand/react/shallow';

import {
  acquireAssetMaterializationLease,
  isAssetMaterializationBudgetError,
} from '@/shared/assets';
import type { AssetMaterializationBudgetError } from '@/shared/assets';
import type {
  VideoProject,
  VideoTimeline,
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';

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
      const releaseLease = acquireAssetMaterializationLease(sessionId);
      void actions
        .hydrateProjectAsset(asset.id, { sessionId })
        .catch((error) => {
          if (isAssetMaterializationBudgetError(error)) {
            onBudgetIssue(error);
          } else {
            onError(error);
          }
        })
        .finally(releaseLease);
    },
    [actions, onBudgetIssue, onError, sessionId],
  );

  // Shared by both the single-asset and bulk placement paths. Takes the
  // timeline/insertClip explicitly (rather than closing over `editor`) so
  // the bulk path can re-read the live store between placements — insert
  // one clip, then look up the next open slot against the timeline that
  // now includes it, instead of every clip in a multi-select computing its
  // slot from the same stale snapshot and landing on top of each other.
  const placeOneAsset = useCallback(
    (
      asset: ProjectAsset,
      timeline: VideoTimeline,
      insertClip: (trackId: string, clip: VideoTimelineClip) => void,
    ) => {
      const track = choosePlacementTrack(
        timeline.tracks,
        asset.kind,
        selectedTrackId,
      );
      if (!track) return;
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
      insertClip(track.id, placedClip);
      if (!canDownloadProjectAsset(asset)) return;
      const releaseLease = acquireAssetMaterializationLease(sessionId);
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
        })
        .finally(releaseLease);
    },
    [
      actions,
      aspectRatio,
      editor,
      onBudgetIssue,
      onError,
      playheadMs,
      selectedTrackId,
      sessionId,
    ],
  );

  const ensureProjectTimeline = useCallback(() => {
    if (editor.projectId !== project.id || !editor.timeline) {
      editor.setProjectTimeline(project.id, activeTimeline);
    }
  }, [activeTimeline, editor, project.id]);

  const placeAsset = useCallback(
    (asset: ProjectAsset) => {
      ensureProjectTimeline();
      placeOneAsset(asset, activeTimeline, editor.insertClip);
    },
    [activeTimeline, editor.insertClip, ensureProjectTimeline, placeOneAsset],
  );

  const placeAssets = useCallback(
    (assets: ProjectAsset[]) => {
      ensureProjectTimeline();
      for (const asset of assets) {
        const state = useTimelineEditorStore.getState();
        const timeline = state.timeline ?? activeTimeline;
        placeOneAsset(asset, timeline, state.insertClip);
      }
    },
    [activeTimeline, ensureProjectTimeline, placeOneAsset],
  );

  return useMemo(
    () => ({ placeAsset, placeAssets, downloadAsset }),
    [downloadAsset, placeAsset, placeAssets],
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
