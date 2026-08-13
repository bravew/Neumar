import type { AssetDragPayload } from '@/shared/assets';
import { readAssetDragPayload, ASSET_DRAG_MIME } from '@/shared/assets';
import type { VideoTimelineTrack } from '@/shared/types/video';

import {
  LINKED_ASSET_DRAG_MIME,
  readLinkedAssetDrag,
  type LinkedAssetDragPayload,
} from '../linkedAssetDrag';
import {
  OVERLAY_PRESET_DRAG_MIME,
  readOverlayPresetDrag,
  type OverlayPresetDragPayload,
} from '../overlays/overlayDragPayload';
import {
  PROJECT_ASSET_DRAG_MIME,
  readProjectAssetDrag,
  type ProjectAssetDragPayload,
} from '../projectAssetDrag';

// Drag-over acceptance and drop dispatch for a timeline track lane, extracted
// from TimelineTrack so the component stays under the size cap. Priority
// order matches the historical inline handler: overlay preset (overlay tracks
// only) → project asset → catalog assets → linked asset → OS files.

export interface TimelineTrackDropHandlers {
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
}

export function trackAcceptsDrag(
  dataTransfer: DataTransfer,
  track: VideoTimelineTrack,
  handlers: TimelineTrackDropHandlers,
): boolean {
  const types = Array.from(dataTransfer.types);
  return (
    (!!handlers.onDropLinkedAsset && types.includes(LINKED_ASSET_DRAG_MIME)) ||
    (!!handlers.onDropCatalogAssets && types.includes(ASSET_DRAG_MIME)) ||
    (!!handlers.onDropProjectAsset &&
      types.includes(PROJECT_ASSET_DRAG_MIME)) ||
    (!!handlers.onDropOverlayPreset &&
      track.kind === 'overlay' &&
      types.includes(OVERLAY_PRESET_DRAG_MIME)) ||
    (!!handlers.onDropFiles && types.includes('Files'))
  );
}

/** Returns true when a handler consumed the drop. */
export function dispatchTrackDrop(
  dataTransfer: DataTransfer,
  track: VideoTimelineTrack,
  startMs: number,
  handlers: TimelineTrackDropHandlers,
): boolean {
  const overlayPayload =
    handlers.onDropOverlayPreset && track.kind === 'overlay'
      ? readOverlayPresetDrag(dataTransfer)
      : null;
  if (overlayPayload) {
    handlers.onDropOverlayPreset?.(track, startMs, overlayPayload);
    return true;
  }
  const projectPayload = handlers.onDropProjectAsset
    ? readProjectAssetDrag(dataTransfer)
    : null;
  if (projectPayload) {
    handlers.onDropProjectAsset?.(track, startMs, projectPayload);
    return true;
  }
  const catalogPayload = handlers.onDropCatalogAssets
    ? readAssetDragPayload(dataTransfer)
    : null;
  if (catalogPayload) {
    handlers.onDropCatalogAssets?.(track, startMs, catalogPayload);
    return true;
  }
  const linkedPayload = handlers.onDropLinkedAsset
    ? readLinkedAssetDrag(dataTransfer)
    : null;
  if (linkedPayload) {
    handlers.onDropLinkedAsset?.(track, startMs, linkedPayload);
    return true;
  }
  const fileList = dataTransfer.files;
  if (handlers.onDropFiles && fileList && fileList.length > 0) {
    handlers.onDropFiles(track, startMs, Array.from(fileList));
    return true;
  }
  return false;
}
