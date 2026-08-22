import { useCallback, useRef, useState, type RefObject } from 'react';

import type {
  VideoTimelineMarker,
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';

import type {
  TimelineClientPoint,
  TimelineClipMoveOverlayState,
  TimelineClipMovePreview,
} from './timelineClipDrag';
import { getTimelineTrackIdAtPoint } from './timelineLayout';
import {
  buildTimelineSnapTargets,
  computeTimelineSnap,
  getTimelineSnapToleranceMs,
  type TimelineSnapResult,
} from './timelineSnap';

interface UseTimelineClipMoveParams {
  tracks: VideoTimelineTrack[];
  scrollRef: RefObject<HTMLDivElement | null>;
  markers: VideoTimelineMarker[];
  beatTimesMs: number[];
  playheadMs: number;
  timelineDurationMs: number;
  pixelsPerSecond: number;
  snappingEnabled: boolean;
  snapTolerancePx: number;
  selectedClipIds: Set<string>;
  moveClip: (
    clipId: string,
    deltaMs: number,
    baselineClip?: VideoTimelineClip,
    targetTrackId?: string,
  ) => void;
}

export function useTimelineClipMove({
  tracks,
  scrollRef,
  markers,
  beatTimesMs,
  playheadMs,
  timelineDurationMs,
  pixelsPerSecond,
  snappingEnabled,
  snapTolerancePx,
  selectedClipIds,
  moveClip,
}: UseTimelineClipMoveParams) {
  const [overlay, setOverlay] = useState<TimelineClipMoveOverlayState | null>(
    null,
  );
  const overlayRef = useRef<TimelineClipMoveOverlayState | null>(null);
  const handleMovePreview = useCallback(
    (preview: TimelineClipMovePreview) => {
      const next = buildMoveOverlayState({
        preview,
        tracks,
        scrollElement: scrollRef.current,
        snap: getSnapResult({
          clip: preview.baselineClip,
          deltaMs: preview.deltaMs,
          disabled: preview.disableSnap,
          markers,
          beatTimesMs,
          playheadMs,
          pixelsPerSecond,
          selectedClipIds,
          snapTolerancePx,
          snappingEnabled,
          timelineDurationMs,
          tracks,
        }),
      });
      overlayRef.current = next;
      setOverlay(next);
    },
    [
      markers,
      beatTimesMs,
      pixelsPerSecond,
      playheadMs,
      scrollRef,
      selectedClipIds,
      snapTolerancePx,
      snappingEnabled,
      timelineDurationMs,
      tracks,
    ],
  );
  const handleMovePreviewEnd = useCallback(() => {
    overlayRef.current = null;
    setOverlay(null);
  }, []);
  const handleMoveClip = useCallback(
    (
      clipId: string,
      deltaMs: number,
      baselineClip: VideoTimelineClip,
      clientPoint?: TimelineClientPoint,
    ) => {
      const targetTrackId = clientPoint
        ? getAcceptedTrackIdAtPoint({
            point: clientPoint,
            clip: baselineClip,
            tracks,
            scrollElement: scrollRef.current,
          })
        : undefined;
      const snap = getSnapResult({
        clip: baselineClip,
        deltaMs,
        disabled: clientPoint?.disableSnap,
        markers,
        beatTimesMs,
        playheadMs,
        pixelsPerSecond,
        selectedClipIds,
        snapTolerancePx,
        snappingEnabled,
        timelineDurationMs,
        tracks,
      });
      moveClip(
        clipId,
        deltaMs + (snap?.deltaMs ?? 0),
        baselineClip,
        targetTrackId,
      );
    },
    [
      markers,
      beatTimesMs,
      moveClip,
      pixelsPerSecond,
      playheadMs,
      scrollRef,
      selectedClipIds,
      snapTolerancePx,
      snappingEnabled,
      timelineDurationMs,
      tracks,
    ],
  );

  return {
    dropTarget: overlay?.dropTarget ?? null,
    handleMoveClip,
    handleMovePreview,
    handleMovePreviewEnd,
    overlay,
  };
}

function buildMoveOverlayState({
  preview,
  tracks,
  scrollElement,
  snap,
}: {
  preview: TimelineClipMovePreview;
  tracks: VideoTimelineTrack[];
  scrollElement: HTMLDivElement | null;
  snap: TimelineSnapResult | null;
}): TimelineClipMoveOverlayState {
  const trackId = getTimelineTrackIdAtPoint({
    tracks,
    point: preview,
    scrollElement,
  });
  const track = trackId
    ? tracks.find((item) => item.id === trackId)
    : undefined;
  const dropTarget = track
    ? {
        trackId: track.id,
        startMs: getMovedStartMs(
          preview.baselineClip,
          preview.deltaMs + (snap?.deltaMs ?? 0),
        ),
        accepted:
          !track.locked &&
          timelineTrackAcceptsClip(track, preview.baselineClip),
      }
    : null;
  return {
    ...preview,
    deltaMs: preview.deltaMs + (snap?.deltaMs ?? 0),
    dropTarget,
    snap,
  };
}

function getSnapResult({
  clip,
  deltaMs,
  disabled,
  markers,
  beatTimesMs,
  playheadMs,
  pixelsPerSecond,
  selectedClipIds,
  snapTolerancePx,
  snappingEnabled,
  timelineDurationMs,
  tracks,
}: {
  clip: VideoTimelineClip;
  deltaMs: number;
  disabled?: boolean;
  markers: VideoTimelineMarker[];
  beatTimesMs: number[];
  playheadMs: number;
  pixelsPerSecond: number;
  selectedClipIds: Set<string>;
  snapTolerancePx: number;
  snappingEnabled: boolean;
  timelineDurationMs: number;
  tracks: VideoTimelineTrack[];
}): TimelineSnapResult | null {
  if (!snappingEnabled || disabled) return null;
  const movingClipIds =
    selectedClipIds.has(clip.id) && selectedClipIds.size > 0
      ? selectedClipIds
      : new Set([clip.id]);
  return computeTimelineSnap({
    candidateStartMs: getMovedStartMs(clip, deltaMs),
    durationMs: clip.durationMs,
    targets: buildTimelineSnapTargets({
      tracks,
      movingClipIds,
      markers,
      beatTimesMs,
      playheadMs,
      durationMs: timelineDurationMs,
    }),
    toleranceMs: getTimelineSnapToleranceMs(snapTolerancePx, pixelsPerSecond),
  });
}

function getAcceptedTrackIdAtPoint({
  point,
  clip,
  tracks,
  scrollElement,
}: {
  point: TimelineClientPoint;
  clip: VideoTimelineClip;
  tracks: VideoTimelineTrack[];
  scrollElement: HTMLDivElement | null;
}): string | undefined {
  const trackId = getTimelineTrackIdAtPoint({ tracks, point, scrollElement });
  const track = trackId
    ? tracks.find((item) => item.id === trackId)
    : undefined;
  if (!track || track.locked || !timelineTrackAcceptsClip(track, clip)) {
    return undefined;
  }
  return track.id;
}

function getMovedStartMs(clip: VideoTimelineClip, deltaMs: number): number {
  return Math.max(0, clip.startMs + Math.round(deltaMs));
}

function timelineTrackAcceptsClip(
  track: VideoTimelineTrack,
  clip: VideoTimelineClip,
): boolean {
  if (
    track.kind === 'video' ||
    track.kind === 'broll' ||
    track.kind === 'overlay'
  ) {
    if (track.kind === 'overlay' && clip.kind === 'effect') return true;
    return (
      clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
    );
  }
  if (
    track.kind === 'audio-vo' ||
    track.kind === 'audio-music' ||
    track.kind === 'audio-sfx'
  ) {
    return clip.kind === 'audio';
  }
  return track.kind === 'caption' && clip.kind === 'caption';
}
