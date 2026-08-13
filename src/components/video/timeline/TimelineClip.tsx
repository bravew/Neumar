import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react';

import type { MaterializationStateMap } from '@/shared/hooks/useAssetMaterializationEvents';
import { cn } from '@/shared/lib/utils';
import type {
  VideoMediaItem,
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';

import { TimelineAudioFadeControls } from './TimelineAudioFadeControls';
import { TimelineClipBadges } from './TimelineClipBadges';
import { TimelineClipContent } from './TimelineClipContent';
import type {
  TimelineClientPoint,
  TimelineClipMovePreview,
} from './timelineClipDrag';
import {
  applyDocumentMoveFeedback,
  getSelectionMode,
  isIntentionalMove,
} from './timelineClipPointer';
import {
  getTimelineClipClass,
  getTimelineClipLabel,
} from './timelineClipVisuals';
import type { TimelineClipLabels } from './TimelineLabels';
import { msToPixels } from './timelineMath';
import { TimelineTrimHandle } from './TimelineTrimHandle';
import { useTimelineClipKeyboardMove } from './useTimelineClipKeyboardMove';
import type {
  TimelineClipSelectionMode,
  TimelineTrimEdge,
} from './useTimelineEditorStore';
import { useTimelineRazorTool } from './useTimelineRazorTool';

interface TimelineTrimDrag {
  edge: TimelineTrimEdge;
  pointerId: number;
  startClientX: number;
  baselineClip: VideoTimelineClip;
}

interface TimelineMoveDrag {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  baselineClip: VideoTimelineClip;
  hasMoved: boolean;
}

interface TimelineClipProps {
  clip: VideoTimelineClip;
  track: VideoTimelineTrack;
  mediaSrc?: string;
  asset?: VideoMediaItem;
  materializationStates?: MaterializationStateMap;
  projectId: string;
  pixelsPerSecond: number;
  selected: boolean;
  linkedPartner: boolean;
  labels: TimelineClipLabels;
  onSelect: (
    clip: VideoTimelineClip,
    options?: { mode?: TimelineClipSelectionMode },
  ) => void;
  onTrimClip: (
    clipId: string,
    edge: TimelineTrimEdge,
    deltaMs: number,
    baselineClip: VideoTimelineClip,
  ) => void;
  onMoveClip: (
    clipId: string,
    deltaMs: number,
    baselineClip: VideoTimelineClip,
    clientPoint?: TimelineClientPoint,
  ) => void;
  onMovePreview?: (preview: TimelineClipMovePreview) => void;
  onMovePreviewEnd?: () => void;
}

export function TimelineClip({
  clip,
  track,
  mediaSrc,
  asset,
  materializationStates,
  projectId,
  pixelsPerSecond,
  selected,
  linkedPartner,
  labels,
  onSelect,
  onTrimClip,
  onMoveClip,
  onMovePreview,
  onMovePreviewEnd,
}: TimelineClipProps) {
  const trimDragRef = useRef<TimelineTrimDrag | null>(null);
  const moveDragRef = useRef<TimelineMoveDrag | null>(null);
  const restoreMoveFeedbackRef = useRef<(() => void) | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const razor = useTimelineRazorTool({
    clip,
    locked: track.locked,
    pixelsPerSecond,
  });
  const left = msToPixels(clip.startMs, pixelsPerSecond);
  const width = Math.max(24, msToPixels(clip.durationMs, pixelsPerSecond));
  const label = getTimelineClipLabel(clip, asset);
  const trimDisabled = track.locked;
  const moveDisabled = track.locked;
  const keyboardMove = useTimelineClipKeyboardMove({
    clip,
    label,
    labels,
    moveDisabled,
    onMoveClip,
    onSelect,
  });
  const resetMoveFeedback = useCallback(() => {
    setIsMoving(false);
    restoreMoveFeedbackRef.current?.();
    restoreMoveFeedbackRef.current = null;
  }, []);
  useEffect(
    () => () => {
      restoreMoveFeedbackRef.current?.();
      restoreMoveFeedbackRef.current = null;
    },
    [],
  );
  const handleTrimPointerDown = useCallback(
    (edge: TimelineTrimEdge, event: PointerEvent<HTMLButtonElement>) => {
      if (trimDisabled) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      trimDragRef.current = {
        edge,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        baselineClip: clip,
      };
      onSelect(clip);
    },
    [clip, onSelect, trimDisabled],
  );
  const handleTrimPointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const drag = trimDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const deltaMs = Math.round(
        ((event.clientX - drag.startClientX) / pixelsPerSecond) * 1000,
      );
      onTrimClip(clip.id, drag.edge, deltaMs, drag.baselineClip);
    },
    [clip.id, onTrimClip, pixelsPerSecond],
  );
  const handleTrimPointerEnd = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const drag = trimDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      trimDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );
  const handleMovePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (event.button !== 0) return;
      if (razor.splitAtPointer(event)) return;
      onSelect(clip, { mode: getSelectionMode(event) });
      if (moveDisabled) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = event.currentTarget.getBoundingClientRect();
      restoreMoveFeedbackRef.current = applyDocumentMoveFeedback();
      moveDragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        baselineClip: clip,
        hasMoved: false,
      };
    },
    [clip, moveDisabled, onSelect, razor],
  );
  const handleMovePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = moveDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - drag.startClientX;
      const deltaY = event.clientY - drag.startClientY;
      if (!drag.hasMoved && !isIntentionalMove(deltaX, deltaY)) return;
      drag.hasMoved = true;
      setIsMoving(true);
      event.preventDefault();
      const deltaMs = Math.round((deltaX / pixelsPerSecond) * 1000);
      onMovePreview?.({
        clip,
        track,
        baselineClip: drag.baselineClip,
        deltaMs,
        clientX: event.clientX,
        clientY: event.clientY,
        disableSnap: event.metaKey || event.ctrlKey,
        offsetX: drag.offsetX,
        offsetY: drag.offsetY,
        width: drag.width,
        height: drag.height,
      });
    },
    [clip, onMovePreview, pixelsPerSecond, track],
  );
  const handleMovePointerEnd = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = moveDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - drag.startClientX;
      const deltaY = event.clientY - drag.startClientY;
      if (drag.hasMoved || isIntentionalMove(deltaX, deltaY)) {
        const deltaMs = Math.round((deltaX / pixelsPerSecond) * 1000);
        onMoveClip(clip.id, deltaMs, drag.baselineClip, {
          clientX: event.clientX,
          clientY: event.clientY,
          disableSnap: event.metaKey || event.ctrlKey,
        });
      }
      moveDragRef.current = null;
      resetMoveFeedback();
      onMovePreviewEnd?.();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [clip.id, onMoveClip, onMovePreviewEnd, pixelsPerSecond, resetMoveFeedback],
  );
  const handleMovePointerCancel = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = moveDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      moveDragRef.current = null;
      resetMoveFeedback();
      onMovePreviewEnd?.();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [onMovePreviewEnd, resetMoveFeedback],
  );

  return (
    <div
      data-timeline-clip-id={clip.id}
      role="button"
      tabIndex={0}
      aria-grabbed={selected}
      aria-keyshortcuts={keyboardMove.ariaKeyShortcuts}
      aria-label={keyboardMove.ariaLabel}
      className={cn(
        'absolute top-1 bottom-1 touch-none overflow-hidden rounded-sm border px-2 text-left text-[11px] shadow-sm transition-colors select-none',
        getTimelineClipClass(track),
        moveDisabled
          ? 'cursor-not-allowed'
          : isMoving
            ? 'cursor-grabbing'
            : 'cursor-grab',
        isMoving && 'opacity-55',
        selected && 'ring-primary ring-offset-background ring-2 ring-offset-1',
        linkedPartner &&
          !selected &&
          'ring-primary/50 ring-offset-background ring-1 ring-offset-1',
      )}
      style={{
        left,
        width,
        cursor: razor.cursor,
      }}
      onPointerDown={handleMovePointerDown}
      onPointerMove={handleMovePointerMove}
      onPointerUp={handleMovePointerEnd}
      onPointerCancel={handleMovePointerCancel}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={keyboardMove.handleKeyDown}
      // Caption clips render their own richer tooltip in TimelineClipContent;
      // avoid a duplicate native one.
      title={clip.kind === 'caption' ? undefined : label}
    >
      <span className="sr-only" aria-live="polite">
        {keyboardMove.announcement}
      </span>
      <TimelineClipBadges
        clip={clip}
        linkedPartner={linkedPartner || selected}
        labels={labels}
      />
      <TimelineTrimHandle
        side="left"
        label={labels.trimStart}
        disabled={trimDisabled || razor.enabled}
        onPointerDown={(event) => handleTrimPointerDown('start', event)}
        onPointerMove={handleTrimPointerMove}
        onPointerUp={handleTrimPointerEnd}
        onPointerCancel={handleTrimPointerEnd}
      />
      <TimelineClipContent
        clip={clip}
        track={track}
        mediaSrc={mediaSrc}
        asset={asset}
        materializationStates={materializationStates}
        projectId={projectId}
        widthPx={width}
        label={label}
      />
      {clip.kind === 'audio' ? (
        <TimelineAudioFadeControls
          clip={clip}
          disabled={trimDisabled || razor.enabled}
          labels={labels}
          pixelsPerSecond={pixelsPerSecond}
          widthPx={width}
          onSelect={onSelect}
        />
      ) : null}
      <TimelineTrimHandle
        side="right"
        label={labels.trimEnd}
        disabled={trimDisabled || razor.enabled}
        onPointerDown={(event) => handleTrimPointerDown('end', event)}
        onPointerMove={handleTrimPointerMove}
        onPointerUp={handleTrimPointerEnd}
        onPointerCancel={handleTrimPointerEnd}
      />
    </div>
  );
}
