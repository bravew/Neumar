import { useCallback, useRef, type PointerEvent } from 'react';

import { cn } from '@/shared/lib/utils';
import type {
  VideoAudioFadeCurve,
  VideoAudioTimelineClip,
} from '@/shared/types/video';

import type { TimelineClipLabels } from './TimelineLabels';
import { msToPixels } from './timelineMath';
import {
  type TimelineClipSelectionMode,
  useTimelineEditorStore,
} from './useTimelineEditorStore';

interface TimelineAudioFadeControlsProps {
  clip: VideoAudioTimelineClip;
  disabled: boolean;
  labels: Pick<TimelineClipLabels, 'audioFadeInHandle' | 'audioFadeOutHandle'>;
  pixelsPerSecond: number;
  widthPx: number;
  onSelect: (
    clip: VideoAudioTimelineClip,
    options?: { mode?: TimelineClipSelectionMode },
  ) => void;
}

interface AudioFadeDrag {
  edge: 'in' | 'out';
  pointerId: number;
  startClientX: number;
  startDurationMs: number;
}

export function TimelineAudioFadeControls({
  clip,
  disabled,
  labels,
  pixelsPerSecond,
  widthPx,
  onSelect,
}: TimelineAudioFadeControlsProps) {
  const dragRef = useRef<AudioFadeDrag | null>(null);
  const setAudioClipFade = useTimelineEditorStore(
    (state) => state.setAudioClipFade,
  );
  const fadeInMs = clip.fadeInMs ?? 0;
  const fadeOutMs = clip.fadeOutMs ?? 0;
  const maxFadeWidthPx = widthPx / 2;
  const fadeInWidthPx = Math.min(
    maxFadeWidthPx,
    msToPixels(fadeInMs, pixelsPerSecond),
  );
  const fadeOutWidthPx = Math.min(
    maxFadeWidthPx,
    msToPixels(fadeOutMs, pixelsPerSecond),
  );

  const handlePointerDown = useCallback(
    (edge: 'in' | 'out', event: PointerEvent<HTMLButtonElement>) => {
      if (disabled) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      onSelect(clip);
      dragRef.current = {
        edge,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startDurationMs: edge === 'in' ? fadeInMs : fadeOutMs,
      };
    },
    [clip, disabled, fadeInMs, fadeOutMs, onSelect],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const deltaMs = Math.round(
        ((event.clientX - drag.startClientX) / pixelsPerSecond) * 1000,
      );
      const nextDurationMs = clampAudioFadeDuration(
        drag.edge === 'in'
          ? drag.startDurationMs + deltaMs
          : drag.startDurationMs - deltaMs,
        clip.durationMs,
      );
      setAudioClipFade(
        clip.id,
        drag.edge,
        nextDurationMs,
        fadeCurveForEdge(clip, drag.edge),
      );
    },
    [clip, pixelsPerSecond, setAudioClipFade],
  );

  const handlePointerEnd = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-[1]">
        {fadeInWidthPx > 0 ? (
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-white/35 to-transparent mix-blend-screen"
            style={{ width: fadeInWidthPx }}
          />
        ) : null}
        {fadeOutWidthPx > 0 ? (
          <div
            className="absolute inset-y-0 right-0 bg-gradient-to-l from-white/35 to-transparent mix-blend-screen"
            style={{ width: fadeOutWidthPx }}
          />
        ) : null}
      </div>
      {disabled ? null : (
        <>
          <AudioFadeHandle
            label={labels.audioFadeInHandle}
            side="left"
            offsetPx={fadeInWidthPx}
            onPointerDown={(event) => handlePointerDown('in', event)}
            onPointerMove={handlePointerMove}
            onPointerEnd={handlePointerEnd}
          />
          <AudioFadeHandle
            label={labels.audioFadeOutHandle}
            side="right"
            offsetPx={fadeOutWidthPx}
            onPointerDown={(event) => handlePointerDown('out', event)}
            onPointerMove={handlePointerMove}
            onPointerEnd={handlePointerEnd}
          />
        </>
      )}
    </>
  );
}

function AudioFadeHandle({
  label,
  offsetPx,
  onPointerDown,
  onPointerEnd,
  onPointerMove,
  side,
}: {
  label: string;
  offsetPx: number;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerEnd: (event: PointerEvent<HTMLButtonElement>) => void;
  side: 'left' | 'right';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'group absolute top-0 bottom-0 z-20 flex w-3 cursor-ew-resize items-center justify-center',
        side === 'left' ? '-translate-x-1/2' : 'translate-x-1/2',
      )}
      style={{ [side]: offsetPx }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <span className="bg-primary/80 group-hover:bg-primary h-4 w-0.5 rounded-full shadow-sm" />
    </button>
  );
}

function clampAudioFadeDuration(value: number, clipDurationMs: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.round(value), clipDurationMs));
}

function fadeCurveForEdge(
  clip: VideoAudioTimelineClip,
  edge: 'in' | 'out',
): VideoAudioFadeCurve {
  return edge === 'in'
    ? (clip.fadeInCurve ?? 'linear')
    : (clip.fadeOutCurve ?? 'linear');
}
