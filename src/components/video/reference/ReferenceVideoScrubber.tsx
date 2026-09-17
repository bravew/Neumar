import { Pause, Play } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoReferenceTimelineSection } from '@/shared/types/video';

interface ReferenceVideoScrubberProps {
  sections: VideoReferenceTimelineSection[];
  durationMs: number;
  currentMs: number;
  playing: boolean;
  activeSectionId: string | null;
  onTogglePlay: () => void;
  onSeek: (ms: number) => void;
}

/**
 * Transport for a reference reading.
 *
 * The native control bar is replaced because the analysis is about *where*
 * things happen: the track is drawn as the reading's own sections rather than
 * one undifferentiated bar, so section boundaries are visible while scrubbing
 * and the segment under the playhead is the one highlighted in the list. A
 * transparent range input sits over the segments to keep keyboard scrubbing and
 * drag behaviour that a div cannot provide.
 */
export function ReferenceVideoScrubber({
  sections,
  durationMs,
  currentMs,
  playing,
  activeSectionId,
  onTogglePlay,
  onSeek,
}: ReferenceVideoScrubberProps) {
  const { t } = useLanguage();
  const copy = t.video.reference.reading;
  const safeDuration = durationMs > 0 ? durationMs : 1;
  const progress = Math.min(100, (currentMs / safeDuration) * 100);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="border-border hover:bg-accent flex size-6 shrink-0 items-center justify-center rounded border"
          aria-label={playing ? copy.pause : copy.play}
          onClick={onTogglePlay}
        >
          {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
        </button>
        <div className="relative h-6 min-w-0 flex-1">
          {/*
            Section segments: the track *is* the reading. Decoration only —
            the range input above owns every interaction, so a drag never lands
            on a segment instead of the scrubber. Sections are played from the
            list rows, where the thumbnail and the play control already are.
          */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex h-2.5 -translate-y-1/2 gap-px overflow-hidden rounded">
            {sections.map((section) => {
              const width =
                ((section.endMs - section.startMs) / safeDuration) * 100;
              return (
                <span
                  key={section.id}
                  title={`${section.phase} · ${formatClock(section.startMs)}`}
                  className={cn(
                    'h-full min-w-0 transition-colors',
                    section.id === activeSectionId
                      ? 'bg-primary/70'
                      : 'bg-muted-foreground/25',
                  )}
                  style={{ width: `${width}%` }}
                />
              );
            })}
          </div>
          {/* Boundary ticks, so a marker is legible even on a hairline gap. */}
          {sections.slice(1).map((section) => (
            <span
              key={`tick-${section.id}`}
              className="bg-background/80 pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2"
              style={{ left: `${(section.startMs / safeDuration) * 100}%` }}
            />
          ))}
          {/* Played portion, drawn over the segments so both read at once. */}
          <div
            className="bg-primary/35 pointer-events-none absolute top-1/2 left-0 h-2.5 -translate-y-1/2 rounded-l"
            style={{ width: `${progress}%` }}
          />
          <div
            className="bg-foreground pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-y-1/2"
            style={{ left: `${progress}%` }}
          />
          <input
            type="range"
            min={0}
            max={safeDuration}
            step={100}
            value={Math.min(currentMs, safeDuration)}
            aria-label={copy.seek}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            onChange={(event) => onSeek(Number(event.target.value))}
          />
        </div>
        <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
          {formatClock(currentMs)} / {formatClock(durationMs)}
        </span>
      </div>
    </div>
  );
}

function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
