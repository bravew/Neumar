import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { msToFrame } from '@neumar/video-ir';

import type { VideoClipTransform, VideoProject } from '@/shared/types/video';

import { useTimelineEditorStore } from '../timeline/useTimelineEditorStore';
import type {
  TimelinePlaybackState,
  TimelinePlayheadUpdateSource,
} from '../timeline/useTimelineUiStore';
import { editableClipId } from './EditCanvasOverlayModel';
import type { RemotionPreviewData } from './remotionPreviewData';
import { PlaybackClock } from './webcodecs/PlaybackClock';
import type { WebCodecsVisualLayer } from './webcodecs/sceneModel';

/**
 * Merge the LIVE editor-store timeline (the source the undo/redo history
 * mutates) onto the project so the preview reflects committed transforms and
 * undos immediately, instead of the 300ms-debounced persisted `project` prop.
 */
export function useLivePreviewProject(project: VideoProject): VideoProject {
  const editorTimeline = useTimelineEditorStore((state) => state.timeline);
  const editorProjectId = useTimelineEditorStore((state) => state.projectId);
  return useMemo(
    () =>
      editorProjectId === project.id && editorTimeline
        ? { ...project, timeline: editorTimeline }
        : project,
    [editorProjectId, editorTimeline, project],
  );
}

export interface PreviewViewportSize {
  height: number;
  width: number;
}

export function useCanvasViewportSize(
  enabled: boolean,
  canvasRef: RefObject<HTMLCanvasElement | null>,
): PreviewViewportSize {
  const [viewportSize, setViewportSize] = useState({ height: 0, width: 0 });

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const syncSize = (width: number, height: number) => {
      const next = {
        height: Math.max(0, Math.floor(height)),
        width: Math.max(0, Math.floor(width)),
      };
      setViewportSize((prev) =>
        prev.height === next.height && prev.width === next.width ? prev : next,
      );
    };

    const rect = canvas.getBoundingClientRect();
    syncSize(rect.width, rect.height);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      syncSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef, enabled]);

  return viewportSize;
}

export function applyVisualTransformOverrides(
  layers: WebCodecsVisualLayer[],
  transformOverrides: Record<string, VideoClipTransform>,
): WebCodecsVisualLayer[] {
  return layers.map((layer) => {
    const transform = transformOverrides[editableClipId(layer.clip)];
    if (!transform) return layer;
    if (layer.kind === 'image') {
      return {
        ...layer,
        clip: {
          ...layer.clip,
          transform,
        },
      };
    }
    return {
      ...layer,
      clip: {
        ...layer.clip,
        transform,
      },
    };
  });
}

export function getCanvasDpr(): number {
  if (typeof window === 'undefined') return 1;
  return Math.max(1, window.devicePixelRatio || 1);
}

export function getFrameForMs(ms: number, data: RemotionPreviewData): number {
  return Math.min(
    msToFrame(Math.max(0, ms), data.fps),
    Math.max(0, data.durationInFrames - 1),
  );
}

export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function usePreviewPlaybackClock({
  data,
  frameRef,
  lastSyncedFrameRef,
  onIsPlayingChange,
  playheadRef,
  stateRef,
}: {
  data: RemotionPreviewData;
  frameRef: RefObject<(frame: number) => Promise<boolean>>;
  lastSyncedFrameRef: RefObject<number | null>;
  onIsPlayingChange: (playing: boolean) => void;
  playheadRef: RefObject<((ms: number) => void) | undefined>;
  stateRef: RefObject<((state: TimelinePlaybackState) => void) | undefined>;
}): PlaybackClock {
  const playbackClock = useMemo(() => {
    let clock: PlaybackClock;
    clock = new PlaybackClock({
      durationInFrames: data.durationInFrames,
      fps: data.fps,
      onFrame: (frame) => {
        lastSyncedFrameRef.current = frame;
        clock.reportRenderStart(frame);
        void frameRef
          .current(frame)
          .then((presented) => clock.reportRenderEnd(frame, presented))
          .catch(() => clock.reportRenderEnd(frame, false));
      },
      onPlaybackStateChange: (state) => {
        onIsPlayingChange(state === 'playing');
        stateRef.current?.(state);
      },
      onPlayheadMs: (ms) => {
        playheadRef.current?.(ms);
      },
    });
    return clock;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable
  }, [
    data.durationInFrames,
    data.fps,
    frameRef,
    lastSyncedFrameRef,
    onIsPlayingChange,
    playheadRef,
    stateRef,
  ]);
  useEffect(() => () => playbackClock.dispose(), [playbackClock]);
  return playbackClock;
}

export function shouldApplyExternalPlayheadSeek({
  lastSyncedFrame,
  playheadUpdateSource,
  targetFrame,
}: {
  lastSyncedFrame: number | null;
  playheadUpdateSource: TimelinePlayheadUpdateSource;
  targetFrame: number;
}): boolean {
  if (playheadUpdateSource === 'preview' && lastSyncedFrame !== null) {
    return false;
  }
  return lastSyncedFrame !== targetFrame;
}
