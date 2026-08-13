import { useCallback, useMemo } from 'react';

import type { AssetDragPayload, AssetKind } from '@/shared/assets';
import type {
  VideoAspectRatio,
  VideoProject,
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';

import type { LinkedAssetDragPayload } from '../linkedAssetDrag';
import type { OverlayPresetDragPayload } from '../overlays/overlayDragPayload';
import type { ProjectAssetDragPayload } from '../projectAssetDrag';
import {
  hydratedDroppedAssetDurationPatch,
  linkedAssetKindMatchesTrack,
  mediaKindMatchesTrack,
  timelineClipFromDroppedAsset,
  uploadFilesAndBuildClips,
  type DroppableMediaKind,
} from './droppedAssetClip';
import { timelineClipFromOverlayPreset } from './droppedOverlayClip';
import { findNextOpenClipStartMs } from './timelinePlacement';
import type { TimelineProps } from './TimelineTypes';

interface UseTimelineDropHandlersParams {
  project: VideoProject;
  aspectRatio?: VideoAspectRatio;
  insertClip: (trackId: string, clip: VideoTimelineClip) => void;
  updateClip: (clipId: string, patch: Partial<VideoTimelineClip>) => void;
  onAttachLinkedAsset?: TimelineProps['onAttachLinkedAsset'];
  onAttachCatalogAsset?: TimelineProps['onAttachCatalogAsset'];
  onHydrateProjectAsset?: TimelineProps['onHydrateProjectAsset'];
  onUploadAssets?: TimelineProps['onUploadAssets'];
  materializationSessionId?: string;
}

export function useTimelineDropHandlers({
  project,
  aspectRatio,
  insertClip,
  updateClip,
  onAttachLinkedAsset,
  onAttachCatalogAsset,
  onHydrateProjectAsset,
  onUploadAssets,
  materializationSessionId,
}: UseTimelineDropHandlersParams) {
  const clipOptions = useMemo(() => ({ aspectRatio }), [aspectRatio]);
  const handleDropLinkedAsset = useCallback(
    async (
      track: VideoTimelineTrack,
      startMs: number,
      payload: LinkedAssetDragPayload,
    ) => {
      if (!onAttachLinkedAsset || track.locked) return;
      if (!linkedAssetKindMatchesTrack(payload.kind, track)) return;
      const result = await onAttachLinkedAsset(payload.assetId);
      if (!result) return;
      const clip = timelineClipFromDroppedAsset(
        result.asset,
        track,
        startMs,
        clipOptions,
      );
      if (!clip) return;
      insertClip(track.id, clip);
    },
    [clipOptions, insertClip, onAttachLinkedAsset],
  );
  const handleDropCatalogAssets = useCallback(
    async (
      track: VideoTimelineTrack,
      startMs: number,
      payload: AssetDragPayload,
    ) => {
      if (!onAttachCatalogAsset || track.locked) return;
      const primaryKind = droppableAssetKind(payload.primaryKind);
      if (!primaryKind || !mediaKindMatchesTrack(primaryKind, track)) return;
      let cursorMs = Math.max(0, Math.round(startMs));
      for (const assetId of payload.assetIds) {
        let result: Awaited<
          ReturnType<NonNullable<typeof onAttachCatalogAsset>>
        >;
        try {
          result = await onAttachCatalogAsset(assetId);
        } catch (error) {
          if (import.meta.env.DEV) {
            console.error('Failed to attach catalog asset:', error);
          }
          continue;
        }
        if (!result) continue;
        const clip = timelineClipFromDroppedAsset(
          result.asset,
          track,
          cursorMs,
          clipOptions,
        );
        if (!clip) continue;
        insertClip(track.id, clip);
        cursorMs += clip.durationMs;
      }
    },
    [clipOptions, insertClip, onAttachCatalogAsset],
  );
  const handleDropProjectAsset = useCallback(
    async (
      track: VideoTimelineTrack,
      startMs: number,
      payload: ProjectAssetDragPayload,
    ) => {
      if (track.locked) return;
      if (!linkedAssetKindMatchesTrack(payload.kind, track)) return;
      const asset = project.assets.find((item) => item.id === payload.assetId);
      if (!asset) return;
      const clip = timelineClipFromDroppedAsset(asset, track, startMs, {
        aspectRatio,
        durationMs: payload.durationMs,
      });
      if (!clip) return;
      const placementStartMs = findNextOpenClipStartMs(
        track,
        startMs,
        clip.durationMs,
      );
      const placedClip =
        placementStartMs === clip.startMs
          ? clip
          : { ...clip, startMs: placementStartMs };
      insertClip(track.id, placedClip);
      if (
        asset.materializationState === 'referenced' &&
        onHydrateProjectAsset
      ) {
        void onHydrateProjectAsset(asset.id, {
          sessionId: materializationSessionId,
        })
          .then((result) => {
            const patch = result
              ? hydratedDroppedAssetDurationPatch(placedClip, result.asset)
              : null;
            if (patch) updateClip(placedClip.id, patch);
          })
          .catch((error) => {
            if (import.meta.env.DEV) {
              console.error('Failed to hydrate project asset on drop:', error);
            }
          });
      }
    },
    [
      insertClip,
      aspectRatio,
      materializationSessionId,
      onHydrateProjectAsset,
      project.assets,
      updateClip,
    ],
  );
  const handleDropFiles = useCallback(
    async (track: VideoTimelineTrack, startMs: number, files: File[]) => {
      if (!onUploadAssets || track.locked) return;
      const clips = await uploadFilesAndBuildClips(
        files,
        track,
        startMs,
        project,
        onUploadAssets,
        clipOptions,
      );
      for (const clip of clips) insertClip(track.id, clip);
    },
    [clipOptions, insertClip, onUploadAssets, project],
  );
  const handleDropOverlayPreset = useCallback(
    (
      track: VideoTimelineTrack,
      startMs: number,
      payload: OverlayPresetDragPayload,
    ) => {
      if (track.locked || track.kind !== 'overlay') return;
      const clip = timelineClipFromOverlayPreset(payload, startMs);
      if (!clip) return;
      const placementStartMs = findNextOpenClipStartMs(
        track,
        clip.startMs,
        clip.durationMs,
      );
      insertClip(
        track.id,
        placementStartMs === clip.startMs
          ? clip
          : { ...clip, startMs: placementStartMs },
      );
    },
    [insertClip],
  );
  return {
    handleDropLinkedAsset,
    handleDropCatalogAssets,
    handleDropProjectAsset,
    handleDropOverlayPreset,
    handleDropFiles,
  };
}

function droppableAssetKind(kind: AssetKind): DroppableMediaKind | null {
  return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : null;
}
