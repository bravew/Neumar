import type {
  VideoAudioSeamMode,
  VideoClipFilters,
  VideoTimelineClip,
  VideoTimelineTrack,
  VideoTransitionKind,
  VideoVisualTimelineClip,
} from '@/shared/types/video';
import { normalizeVideoTransition } from '@/shared/types/video';

export const MIXED_CLIP_VALUE = '__mixed__';

export interface SelectedVisualTimelineClip {
  track: VideoTimelineTrack;
  clip: VideoVisualTimelineClip;
}

export interface CommonTimelineValue<T> {
  value: T;
  mixed: boolean;
}

export function findSelectedVisualClips(
  tracks: VideoTimelineTrack[],
  selectedClipIds: Set<string>,
): SelectedVisualTimelineClip[] {
  const selected: SelectedVisualTimelineClip[] = [];
  if (selectedClipIds.size === 0) return selected;
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (selectedClipIds.has(clip.id) && isVisualTimelineClip(clip)) {
        selected.push({ track, clip });
      }
    }
  }
  return selected;
}

export function selectedTracksAreLocked(
  selected: SelectedVisualTimelineClip[],
): boolean {
  return selected.length > 0 && selected.every((item) => item.track.locked);
}

export function commonTransitionValue(
  selected: SelectedVisualTimelineClip[],
): CommonTimelineValue<VideoTransitionKind> {
  return commonValue(
    selected.map(
      (item) => normalizeVideoTransition(item.clip.transitionToNext).kind,
    ),
    'cut',
  );
}

export function commonAudioSeamValue(
  selected: SelectedVisualTimelineClip[],
): CommonTimelineValue<VideoAudioSeamMode> {
  return commonValue(
    selected.map((item) => item.clip.audioSeamToNext ?? 'follow'),
    'follow',
  );
}

export function commonFilterValue(
  selected: SelectedVisualTimelineClip[],
  key: keyof VideoClipFilters,
  neutral: number,
): CommonTimelineValue<number> {
  return commonValue(
    selected.map((item) => item.clip.filters?.[key] ?? neutral),
    neutral,
  );
}

function commonValue<T>(values: T[], fallback: T): CommonTimelineValue<T> {
  if (values.length === 0) return { value: fallback, mixed: false };
  const [first] = values;
  return {
    value: first ?? fallback,
    mixed: values.some((value) => !Object.is(value, first)),
  };
}

function isVisualTimelineClip(
  clip: VideoTimelineClip,
): clip is VideoVisualTimelineClip {
  return (
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
  );
}
