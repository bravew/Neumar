import { useMemo } from 'react';

import { AlertCircle, CloudDownload } from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { MaterializationStateMap } from '@/shared/hooks/useAssetMaterializationEvents';
import { cn } from '@/shared/lib/utils';
import type {
  VideoMediaItem,
  VideoAudioTimelineClip,
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';

import {
  timelineClipMaterializationStatus,
  type TimelineClipMaterializationStatus,
} from './timelineClipMaterialization';
import { TimelineClipThumbnail } from './TimelineClipThumbnail';
import { getTimelineClipIcon } from './timelineClipVisuals';
import { WaveformCanvas } from './WaveformCanvas';
import type { WaveformSourceRange } from './waveformPeaks';

interface TimelineClipContentProps {
  clip: VideoTimelineClip;
  track: VideoTimelineTrack;
  mediaSrc?: string;
  asset?: VideoMediaItem;
  materializationStates?: MaterializationStateMap;
  projectId: string;
  widthPx: number;
  label: string;
}

export function TimelineClipContent({
  clip,
  track,
  mediaSrc,
  asset,
  materializationStates,
  projectId,
  widthPx,
  label,
}: TimelineClipContentProps) {
  const ClipIcon = getTimelineClipIcon(clip, track);
  const materializationStatus = timelineClipMaterializationStatus(
    asset,
    materializationStates,
  );
  const waveformSourceRange = useMemo(
    () => (clip.kind === 'audio' ? sourceRangeForAudioClip(clip) : undefined),
    [
      clip.durationMs,
      clip.kind,
      clip.playback?.reverse,
      clip.playback?.speed,
      clip.sourceDurationMs,
      clip.trimEndMs,
      clip.trimStartMs,
    ],
  );

  return (
    <>
      {clip.kind === 'audio' ? (
        <WaveformCanvas
          seed={clip.id}
          src={mediaSrc}
          gainDb={clip.gainDb}
          widthPx={widthPx}
          sourceRange={waveformSourceRange}
          peaksEndpoint={
            asset
              ? `/video/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(asset.id)}/peaks`
              : undefined
          }
        />
      ) : (
        <>
          {asset && (asset.kind === 'video' || asset.kind === 'image') ? (
            <TimelineClipThumbnail
              projectId={projectId}
              clip={clip}
              asset={asset}
              widthPx={widthPx}
            />
          ) : null}
          <span className="relative z-10 flex h-full items-center gap-1.5 truncate">
            <ClipIcon className="size-3 shrink-0" />
            {clip.kind === 'caption' ? (
              // Caption clips are usually too narrow to show their full text —
              // surface it in an immediate tooltip on hover.
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="truncate text-shadow-sm">{label}</span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-xs break-words whitespace-normal"
                  >
                    {label}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <span className="truncate text-shadow-sm">{label}</span>
            )}
          </span>
        </>
      )}
      {materializationStatus ? (
        <TimelineClipMaterializationOverlay status={materializationStatus} />
      ) : null}
    </>
  );
}

function sourceRangeForAudioClip(
  clip: VideoAudioTimelineClip,
): WaveformSourceRange {
  const startMs = Math.max(0, Math.round(clip.trimStartMs));
  const playbackSpeed = clip.playback?.speed ?? 1;
  const fallbackSourceDurationMs = Math.max(
    1,
    Math.round(clip.durationMs * playbackSpeed),
  );
  const rawEndMs =
    clip.trimEndMs > startMs
      ? clip.trimEndMs
      : startMs + fallbackSourceDurationMs;
  const endMs = clip.sourceDurationMs
    ? Math.min(rawEndMs, clip.sourceDurationMs)
    : rawEndMs;
  return {
    startMs,
    durationMs: Math.max(1, Math.round(endMs - startMs)),
    reverse: clip.playback?.reverse === true,
  };
}

function TimelineClipMaterializationOverlay({
  status,
}: {
  status: TimelineClipMaterializationStatus;
}) {
  const isProblem = status.phase === 'error' || status.phase === 'cancelled';
  const percent = status.percent;
  const barWidth =
    percent === null ? (isProblem ? '100%' : '44%') : `${percent}%`;
  const Icon = isProblem ? AlertCircle : CloudDownload;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-20">
      <span
        className={cn(
          'absolute top-1 right-1 inline-flex items-center gap-0.5 rounded-full px-1 py-px text-[8px] leading-none font-semibold shadow-sm',
          isProblem
            ? 'bg-destructive text-destructive-foreground'
            : 'bg-background/90 text-foreground',
        )}
      >
        <Icon
          className={cn('size-2.5', !isProblem && 'animate-pulse')}
          aria-hidden
        />
        {percent === null || isProblem ? null : (
          <span className="tabular-nums">{percent}%</span>
        )}
      </span>
      <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-black/35">
        <div
          className={cn(
            'h-full rounded-r-full',
            isProblem ? 'bg-destructive' : 'bg-primary',
            percent === null && !isProblem && 'animate-pulse',
          )}
          style={{ width: barWidth }}
        />
      </div>
    </div>
  );
}
