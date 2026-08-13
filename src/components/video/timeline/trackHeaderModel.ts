import { Captions, EyeOff, Music, Video, Volume2 } from 'lucide-react';

import {
  isVisualTimelineTrack,
  type VideoTimelineTrack,
} from '@/shared/types/video';

export const trackSupportsLayerOrder = isVisualTimelineTrack;

export function trackHasAudio(track: VideoTimelineTrack): boolean {
  return track.kind !== 'caption';
}

export function fileAcceptForTrack(track: VideoTimelineTrack): string {
  if (
    track.kind === 'audio-vo' ||
    track.kind === 'audio-music' ||
    track.kind === 'audio-sfx'
  ) {
    return 'audio/*';
  }
  return 'video/*,image/*';
}

export function trackAcceptsClipUpload(track: VideoTimelineTrack): boolean {
  return track.kind !== 'caption';
}

export function getTrackIcon(track: VideoTimelineTrack) {
  if (track.kind === 'caption') return Captions;
  if (track.kind === 'audio-music' || track.kind === 'audio-sfx') return Music;
  if (track.kind === 'audio-vo') return Volume2;
  if (track.kind === 'overlay' || track.kind === 'broll') return EyeOff;
  return Video;
}
