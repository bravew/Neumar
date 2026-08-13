import type { ReactNode } from 'react';

import {
  Captions,
  KeyRound,
  Link2,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import type { VideoTimelineClip } from '@/shared/types/video';

import type { TimelineTrackLabels } from './TimelineLabels';

interface TimelineClipBadgesProps {
  clip: VideoTimelineClip;
  linkedPartner: boolean;
  labels: Pick<
    TimelineTrackLabels,
    | 'audioFadeClip'
    | 'audioGainClip'
    | 'audioMutedClip'
    | 'audioTransitionClip'
    | 'captionGroup'
    | 'keyframedClip'
    | 'linkedClip'
  >;
}

export function TimelineClipBadges({
  clip,
  linkedPartner,
  labels,
}: TimelineClipBadgesProps) {
  const hasKeyframes = (clip.keyframes?.length ?? 0) > 0;
  const captionGroupId =
    clip.kind === 'caption' ? clip.captionGroupId : undefined;
  const audioMuted = clip.kind === 'audio' && clip.muted === true;
  const audioGain =
    clip.kind === 'audio' && clip.gainDb !== undefined && clip.gainDb !== 0
      ? clip.gainDb
      : null;
  const hasAudioFade =
    clip.kind === 'audio' &&
    ((clip.fadeInMs ?? 0) > 0 || (clip.fadeOutMs ?? 0) > 0);
  const hasAudioTransition =
    clip.kind === 'audio' && !!clip.audioTransitionToNext;
  if (
    !clip.linkGroupId &&
    !hasKeyframes &&
    !captionGroupId &&
    !audioMuted &&
    audioGain === null &&
    !hasAudioFade &&
    !hasAudioTransition
  ) {
    return null;
  }

  return (
    <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5">
      {clip.linkGroupId ? (
        <Badge
          label={labels.linkedClip.replace('{group}', clip.linkGroupId)}
          active={linkedPartner}
        >
          <Link2 className="size-3" />
        </Badge>
      ) : null}
      {captionGroupId ? (
        <Badge label={labels.captionGroup.replace('{group}', captionGroupId)}>
          <Captions className="size-3" />
        </Badge>
      ) : null}
      {hasKeyframes ? (
        <Badge label={labels.keyframedClip}>
          <KeyRound className="size-3" />
        </Badge>
      ) : null}
      {audioMuted ? (
        <Badge label={labels.audioMutedClip} active>
          <VolumeX className="size-3" />
        </Badge>
      ) : null}
      {audioGain !== null ? (
        <Badge
          label={labels.audioGainClip.replace(
            '{gain}',
            formatSignedDb(audioGain),
          )}
          text={formatSignedDb(audioGain)}
        />
      ) : null}
      {hasAudioFade && clip.kind === 'audio' ? (
        <Badge
          label={labels.audioFadeClip
            .replace('{in}', String(clip.fadeInMs ?? 0))
            .replace('{out}', String(clip.fadeOutMs ?? 0))}
        >
          <Volume2 className="size-3" />
        </Badge>
      ) : null}
      {hasAudioTransition && clip.kind === 'audio' ? (
        <Badge
          label={labels.audioTransitionClip.replace(
            '{duration}',
            String(clip.audioTransitionToNext?.durationMs ?? 0),
          )}
        >
          <Waves className="size-3" />
        </Badge>
      ) : null}
    </div>
  );
}

function Badge({
  active = false,
  children,
  label,
  text,
}: {
  active?: boolean;
  children?: ReactNode;
  label: string;
  text?: string;
}) {
  return (
    <span
      className={cn(
        'border-border/60 bg-background/90 text-muted-foreground inline-flex h-4 min-w-4 items-center justify-center rounded-sm border px-0.5 text-[8px] leading-none font-semibold shadow-sm',
        active && 'border-primary text-primary',
      )}
      title={label}
      aria-label={label}
    >
      {text ?? children}
    </span>
  );
}

function formatSignedDb(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}
