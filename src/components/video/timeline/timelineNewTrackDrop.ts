import type { AssetDragPayload } from '@/shared/assets';
import { readAssetDragPayload } from '@/shared/assets';
import type { VideoTimelineTrack } from '@/shared/types/video';

import {
  readLinkedAssetDrag,
  type LinkedAssetDragPayload,
} from '../linkedAssetDrag';
import {
  readOverlayPresetDrag,
  type OverlayPresetDragPayload,
} from '../overlays/overlayDragPayload';
import {
  readProjectAssetDrag,
  type ProjectAssetDragPayload,
} from '../projectAssetDrag';

/**
 * How close to a lane's top or bottom edge a drop counts as "between lanes"
 * rather than "into this lane". Premiere and Resolve both use a band like this
 * for track insertion; too wide and you can't drop onto a short lane at all.
 */
export const NEW_TRACK_EDGE_BAND_PX = 9;

/** Fraction of a lane the band may occupy, so short lanes stay droppable. */
const MAX_EDGE_BAND_RATIO = 0.25;

export type TrackDropZone = 'above' | 'lane' | 'below';

/**
 * Where a pointer sits within a lane: near the top edge means "insert a new
 * track above this one", near the bottom edge "below", anything else "into it".
 */
export function resolveTrackDropZone(
  clientY: number,
  rect: { top: number; height: number },
): TrackDropZone {
  const band = Math.min(
    NEW_TRACK_EDGE_BAND_PX,
    Math.floor(rect.height * MAX_EDGE_BAND_RATIO),
  );
  if (band <= 0) return 'lane';
  const offset = clientY - rect.top;
  if (offset < band) return 'above';
  if (offset > rect.height - band) return 'below';
  return 'lane';
}

/**
 * Which kind of track a dragged payload wants. Returns null when the drag
 * carries nothing we can place — the caller then leaves the drop alone rather
 * than creating an empty track.
 *
 * OS file drops report no kind: a `File` list is only readable as bytes here,
 * and the media type isn't known until the upload has been probed. Those keep
 * going to an existing lane.
 */
export function newTrackKindForDrag(
  dataTransfer: DataTransfer,
): VideoTimelineTrack['kind'] | null {
  if (readOverlayPresetDrag(dataTransfer)) return 'overlay';

  const project = readProjectAssetDrag(dataTransfer);
  if (project) return trackKindForMediaKind(project.kind);

  const linked = readLinkedAssetDrag(dataTransfer);
  if (linked) return trackKindForMediaKind(linked.kind);

  const catalog = readAssetDragPayload(dataTransfer);
  if (catalog) return trackKindForCatalogDrag(catalog);

  return null;
}

// Audio lanes come in three flavours; a plain audio drop has no way to say
// which, and `audio-sfx` is the one that carries no other meaning — a voiceover
// or music lane implies a role the file may not have.
function trackKindForMediaKind(
  kind: 'image' | 'video' | 'audio',
): VideoTimelineTrack['kind'] {
  return kind === 'audio' ? 'audio-sfx' : 'video';
}

function trackKindForCatalogDrag(
  payload: AssetDragPayload,
): VideoTimelineTrack['kind'] {
  // A catalog drag can carry several assets; `primaryKind` is what the rail
  // showed the user. Video is the fallback because a video lane also accepts
  // stills, where an audio lane would reject them.
  return payload.primaryKind === 'audio' ? 'audio-sfx' : 'video';
}

export type TrackDropPayload =
  | { type: 'overlay'; payload: OverlayPresetDragPayload }
  | { type: 'project'; payload: ProjectAssetDragPayload }
  | { type: 'catalog'; payload: AssetDragPayload }
  | { type: 'linked'; payload: LinkedAssetDragPayload };

/**
 * Decodes a drag into a tagged payload while the `DataTransfer` is still
 * readable — which is only during the drop event itself. A caller that has to
 * create a track before placing the clip must decode first and dispatch after.
 *
 * `trackKind` filters out combinations the new lane could not hold anyway, so
 * an audio drag never creates a video track it would then reject.
 */
export function readTrackDropPayload(
  dataTransfer: DataTransfer,
  trackKind: VideoTimelineTrack['kind'],
): TrackDropPayload | null {
  if (trackKind === 'overlay') {
    const overlay = readOverlayPresetDrag(dataTransfer);
    if (overlay) return { type: 'overlay', payload: overlay };
  }
  const project = readProjectAssetDrag(dataTransfer);
  if (project) return { type: 'project', payload: project };
  const catalog = readAssetDragPayload(dataTransfer);
  if (catalog) return { type: 'catalog', payload: catalog };
  const linked = readLinkedAssetDrag(dataTransfer);
  if (linked) return { type: 'linked', payload: linked };
  return null;
}
