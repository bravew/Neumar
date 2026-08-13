import { useRef } from 'react';

import { cn } from '@/shared/lib/utils';
import type { VideoTimelineMarker } from '@/shared/types/video';

import {
  TimelineMarkerInspector,
  type TimelineMarkerLabels,
} from './TimelineMarkerInspector';
import { formatTimelineTime, msToPixels, pixelsToMs } from './timelineMath';

interface TimelineRulerProps {
  durationMs: number;
  headerWidth: number;
  timelineWidth: number;
  pixelsPerSecond: number;
  markers?: VideoTimelineMarker[];
  selectedMarkerId?: string | null;
  markerLabels: TimelineMarkerLabels;
  ariaLabel: string;
  onSeek: (ms: number) => void;
  onSelectMarker: (markerId: string | null) => void;
  onUpdateMarker: (
    markerId: string,
    patch: Partial<Omit<VideoTimelineMarker, 'id'>>,
  ) => void;
  onDeleteMarker: (markerId: string) => void;
}

export function TimelineRuler({
  durationMs,
  headerWidth,
  timelineWidth,
  pixelsPerSecond,
  markers = [],
  selectedMarkerId,
  markerLabels,
  ariaLabel,
  onSeek,
  onSelectMarker,
  onUpdateMarker,
  onDeleteMarker,
}: TimelineRulerProps) {
  const selectedMarkerButtonRef = useRef<HTMLButtonElement | null>(null);
  const intervalMs = getTickIntervalMs(pixelsPerSecond);
  const ticks: number[] = [];
  for (let ms = 0; ms <= durationMs + intervalMs; ms += intervalMs) {
    ticks.push(ms);
  }

  const selectedMarker =
    markers.find((marker) => marker.id === selectedMarkerId) ?? null;

  return (
    <div
      className={cn(
        'border-border bg-background sticky top-0 block h-8 border-b text-left',
        selectedMarker ? 'z-[70]' : 'z-30',
      )}
      style={{ width: headerWidth + timelineWidth }}
      aria-label={ariaLabel}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left - headerWidth;
        if (x >= 0) onSeek(pixelsToMs(x, pixelsPerSecond));
      }}
    >
      <div
        className="border-border bg-background sticky left-0 z-40 h-full border-r"
        style={{ width: headerWidth }}
      />
      {ticks.map((tick) => (
        <div
          key={tick}
          className="border-border/80 text-muted-foreground absolute top-0 bottom-0 border-l pt-1 pl-1 text-[10px]"
          style={{ left: headerWidth + msToPixels(tick, pixelsPerSecond) }}
        >
          {formatTimelineTime(tick)}
        </div>
      ))}
      {markers.map((marker) => (
        <button
          key={marker.id}
          ref={
            selectedMarkerId === marker.id ? selectedMarkerButtonRef : undefined
          }
          type="button"
          data-testid={`timeline-marker-${marker.id}`}
          className={cn(
            'absolute top-1.5 z-[75] h-4 w-3 -translate-x-1/2 rounded-sm border border-white/70 shadow-sm',
            markerClassName(marker.color),
            marker.isChapter && 'h-5',
            selectedMarkerId === marker.id && 'ring-primary z-[85] ring-2',
          )}
          style={{
            left: headerWidth + msToPixels(marker.timeMs, pixelsPerSecond),
          }}
          title={markerTitle(marker)}
          aria-label={markerTitle(marker)}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelectMarker(marker.id);
          }}
        />
      ))}
      <TimelineMarkerInspector
        marker={selectedMarker}
        headerWidth={headerWidth}
        timelineWidth={timelineWidth}
        pixelsPerSecond={pixelsPerSecond}
        labels={markerLabels}
        onUpdateMarker={onUpdateMarker}
        onDeleteMarker={onDeleteMarker}
        onClose={() => onSelectMarker(null)}
        anchorRef={selectedMarkerButtonRef}
      />
    </div>
  );
}

function markerTitle(marker: VideoTimelineMarker): string {
  return marker.comment ? `${marker.label}: ${marker.comment}` : marker.label;
}

function markerClassName(color: VideoTimelineMarker['color']): string {
  switch (color) {
    case 'red':
      return 'bg-red-500';
    case 'orange':
      return 'bg-orange-500';
    case 'yellow':
      return 'bg-yellow-400';
    case 'green':
      return 'bg-emerald-500';
    case 'purple':
      return 'bg-purple-500';
    case 'blue':
    default:
      return 'bg-sky-500';
  }
}

function getTickIntervalMs(pixelsPerSecond: number): number {
  const intervals = [
    500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000,
    900_000, 1_800_000,
  ];
  return (
    intervals.find((interval) => msToPixels(interval, pixelsPerSecond) >= 72) ??
    intervals[intervals.length - 1]!
  );
}
