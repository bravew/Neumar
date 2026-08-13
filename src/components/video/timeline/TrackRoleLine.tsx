import type { VideoTimelineTrack } from '@/shared/types/video';

import type { TimelineTrackLabels } from './TimelineLabels';

interface TrackRoleLineProps {
  track: VideoTimelineTrack;
  labels: Pick<TimelineTrackLabels, 'trackRole' | 'trackZone'>;
}

export function TrackRoleLine({ track, labels }: TrackRoleLineProps) {
  return (
    <div className="text-muted-foreground truncate text-[10px]">
      <span>{labels.trackZone[zoneForTrack(track)]}</span>
      <span aria-hidden> · </span>
      <span>{labels.trackRole[roleForTrack(track)]}</span>
    </div>
  );
}

function zoneForTrack(
  track: VideoTimelineTrack,
): keyof TimelineTrackLabels['trackZone'] {
  if (track.kind === 'caption') return 'caption';
  if (
    track.kind === 'audio-vo' ||
    track.kind === 'audio-music' ||
    track.kind === 'audio-sfx'
  ) {
    return 'audio';
  }
  return 'visual';
}

function roleForTrack(
  track: VideoTimelineTrack,
): keyof TimelineTrackLabels['trackRole'] {
  switch (track.kind) {
    case 'video':
      return 'primary';
    case 'broll':
      return 'broll';
    case 'overlay':
      return 'overlay';
    case 'audio-vo':
      return 'voice';
    case 'audio-music':
      return 'music';
    case 'audio-sfx':
      return 'sfx';
    case 'caption':
      return 'captions';
    default: {
      const exhaustive: never = track;
      return exhaustive;
    }
  }
}
