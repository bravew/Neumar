import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { Trash2, X } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import type {
  VideoTimelineMarker,
  VideoTimelineMarkerColor,
} from '@/shared/types/video';

import { RULER_HEIGHT } from './timelineLayout';
import { msToPixels } from './timelineMath';

const MARKER_COLORS: VideoTimelineMarkerColor[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
];
const MARKER_INSPECTOR_WIDTH = 320;
const MARKER_INSPECTOR_ESTIMATED_HEIGHT = 360;
const MARKER_INSPECTOR_GAP = 10;
const MARKER_INSPECTOR_VIEWPORT_PADDING = 8;

export interface TimelineMarkerLabels {
  label: string;
  timeMs: string;
  color: string;
  chapter: string;
  comment: string;
  delete: string;
  close: string;
}

interface TimelineMarkerInspectorProps {
  marker: VideoTimelineMarker | null;
  headerWidth: number;
  timelineWidth: number;
  pixelsPerSecond: number;
  labels: TimelineMarkerLabels;
  onUpdateMarker: (
    markerId: string,
    patch: Partial<Omit<VideoTimelineMarker, 'id'>>,
  ) => void;
  onDeleteMarker: (markerId: string) => void;
  onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
}

export function TimelineMarkerInspector({
  marker,
  headerWidth,
  timelineWidth,
  pixelsPerSecond,
  labels,
  onUpdateMarker,
  onDeleteMarker,
  onClose,
  anchorRef,
}: TimelineMarkerInspectorProps) {
  const [draft, setDraft] = useState({ label: '', timeMs: '0', comment: '' });
  const [fixedPosition, setFixedPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const inspectorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!marker) return;
    setDraft({
      label: marker.label,
      timeMs: String(marker.timeMs),
      comment: marker.comment ?? '',
    });
  }, [marker]);

  useLayoutEffect(() => {
    if (!marker || !anchorRef?.current) {
      setFixedPosition(null);
      return;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const inspectorHeight =
        inspectorRef.current?.offsetHeight ?? MARKER_INSPECTOR_ESTIMATED_HEIGHT;
      const left = clamp(
        rect.left + rect.width / 2 - MARKER_INSPECTOR_WIDTH / 2,
        MARKER_INSPECTOR_VIEWPORT_PADDING,
        window.innerWidth -
          MARKER_INSPECTOR_WIDTH -
          MARKER_INSPECTOR_VIEWPORT_PADDING,
      );
      const belowTop = rect.bottom + MARKER_INSPECTOR_GAP;
      const aboveTop = rect.top - inspectorHeight - MARKER_INSPECTOR_GAP;
      const top =
        belowTop + inspectorHeight + MARKER_INSPECTOR_VIEWPORT_PADDING <=
        window.innerHeight
          ? belowTop
          : Math.max(MARKER_INSPECTOR_VIEWPORT_PADDING, aboveTop);
      setFixedPosition({ left, top });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
    // Zoom changes the marker button's DOM rect without a resize or scroll event.
  }, [anchorRef, marker, pixelsPerSecond]);

  if (!marker) return null;
  const left = clamp(
    headerWidth + msToPixels(marker.timeMs, pixelsPerSecond) - 24,
    headerWidth,
    headerWidth + timelineWidth - MARKER_INSPECTOR_WIDTH,
  );
  const commitDraft = () => {
    onUpdateMarker(marker.id, {
      label: draft.label,
      timeMs: Number(draft.timeMs),
      comment: draft.comment,
    });
  };
  const inspector = (
    <div
      ref={inspectorRef}
      data-testid="timeline-marker-editor"
      className={cn(
        'bg-popover text-popover-foreground border-border grid w-80 gap-3 rounded-md border p-3 text-xs shadow-lg',
        fixedPosition ? 'fixed z-[100]' : 'absolute z-[90] mt-2',
      )}
      style={fixedPosition ? fixedPosition : { left, top: RULER_HEIGHT }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        <strong className="text-foreground font-semibold">
          {labels.label}
        </strong>
        <button
          type="button"
          className="hover:bg-accent text-muted-foreground rounded-md p-1"
          aria-label={labels.close}
          onClick={onClose}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <label className="grid gap-1">
        <span className="text-muted-foreground">{labels.label}</span>
        <input
          value={draft.label}
          className="border-input bg-background h-8 rounded-md border px-2"
          onChange={(event) =>
            setDraft((value) => ({ ...value, label: event.target.value }))
          }
          onBlur={commitDraft}
        />
      </label>
      <label className="grid gap-1">
        <span className="text-muted-foreground">{labels.timeMs}</span>
        <input
          type="number"
          min={0}
          step={100}
          value={draft.timeMs}
          className="border-input bg-background h-8 rounded-md border px-2"
          onChange={(event) =>
            setDraft((value) => ({ ...value, timeMs: event.target.value }))
          }
          onBlur={commitDraft}
        />
      </label>
      <fieldset className="grid gap-1">
        <legend className="text-muted-foreground">{labels.color}</legend>
        <div className="flex gap-1.5">
          {MARKER_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={cn(
                'size-6 rounded-sm border border-white/70 shadow-sm ring-offset-2',
                markerColorClassName(color),
                (marker.color ?? 'blue') === color && 'ring-primary ring-2',
              )}
              aria-label={`${labels.color}: ${color}`}
              onClick={() => onUpdateMarker(marker.id, { color })}
            />
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={marker.isChapter ?? false}
          onChange={(event) =>
            onUpdateMarker(marker.id, {
              isChapter: event.currentTarget.checked || undefined,
            })
          }
        />
        <span>{labels.chapter}</span>
      </label>
      <label className="grid gap-1">
        <span className="text-muted-foreground">{labels.comment}</span>
        <textarea
          value={draft.comment}
          className="border-input bg-background min-h-16 rounded-md border px-2 py-1.5"
          onChange={(event) =>
            setDraft((value) => ({ ...value, comment: event.target.value }))
          }
          onBlur={commitDraft}
        />
      </label>
      <button
        type="button"
        className="border-destructive/40 text-destructive hover:bg-destructive/10 inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2"
        onClick={() => onDeleteMarker(marker.id)}
      >
        <Trash2 className="size-3.5" />
        {labels.delete}
      </button>
    </div>
  );
  return fixedPosition ? createPortal(inspector, document.body) : inspector;
}

function markerColorClassName(color: VideoTimelineMarkerColor): string {
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
