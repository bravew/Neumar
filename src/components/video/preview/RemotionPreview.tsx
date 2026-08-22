import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';

import { frameToMs, msToFrame } from '@neumar/video-ir';
import { Player, type PlayerRef } from '@remotion/player';

import { cn } from '@/shared/lib/utils';
import type { VideoAspectRatio, VideoProject } from '@/shared/types/video';
import { useVideoFlags } from '@/shared/video/useVideoFlags';

import type {
  TimelinePlaybackState,
  TimelinePlayheadUpdateSource,
} from '../timeline/useTimelineUiStore';
import { useTimelineUiStore } from '../timeline/useTimelineUiStore';
import { createOverlayAssetLoader } from './overlays/overlayAssetLoader';
import type { PreviewPlaybackRate } from './previewPlaybackRate';
import {
  buildRemotionPreviewData,
  buildRemotionPreviewDataSignature,
  type RemotionPreviewData,
} from './remotionPreviewData';
import { RemotionTimelineComposition } from './RemotionTimelineComposition';
import { useFrameWarmup } from './useFrameWarmup';
import { useLivePreviewProject } from './WebCodecsPreviewModel';

interface RemotionPreviewProps {
  project: VideoProject;
  aspectRatio: VideoAspectRatio;
  playbackRate: PreviewPlaybackRate;
  className?: string;
  /** Externally-driven playhead position in milliseconds. */
  playheadMs?: number;
  playheadUpdateSource?: TimelinePlayheadUpdateSource;
  /** Notified when the Player advances on its own (play / native scrub). */
  onPlayheadChange?: (ms: number) => void;
  onPlaybackStateChange?: (state: TimelinePlaybackState) => void;
}

export interface RemotionPreviewHandle {
  play: (event?: SyntheticEvent) => void;
  pause: () => void;
  togglePlayback: (event?: SyntheticEvent) => void;
}

export const RemotionPreview = forwardRef<
  RemotionPreviewHandle,
  RemotionPreviewProps
>(function RemotionPreview(
  {
    project,
    aspectRatio,
    playbackRate,
    className,
    playheadMs,
    playheadUpdateSource = 'external',
    onPlayheadChange,
    onPlaybackStateChange,
  },
  ref,
) {
  const liveProject = useLivePreviewProject(project);
  const dataSignature = buildRemotionPreviewDataSignature(
    liveProject,
    aspectRatio,
  );
  const dataRef = useRef<{
    signature: string;
    data: RemotionPreviewData;
  } | null>(null);
  if (dataRef.current?.signature !== dataSignature) {
    dataRef.current = {
      signature: dataSignature,
      data: buildRemotionPreviewData(liveProject, aspectRatio),
    };
  }
  const data = dataRef.current.data;
  const { flags: videoFlags } = useVideoFlags();
  const vividOverlaysEnabled = videoFlags['video.vividOverlays'] !== false;
  const remotionMediaEnabled = videoFlags['video.remotionMedia'] !== false;
  const loadOverlayAsset = useMemo(
    () => createOverlayAssetLoader(project.id),
    [project.id],
  );
  const inputProps = useMemo(
    () => ({
      data: vividOverlaysEnabled ? data : { ...data, vividOverlays: [] },
      loadOverlayAsset,
      useRemotionMedia: remotionMediaEnabled,
    }),
    [data, loadOverlayAsset, remotionMediaEnabled, vividOverlaysEnabled],
  );
  const playerRef = useRef<PlayerRef | null>(null);
  const hoverMs = useTimelineUiStore((state) => state.hoverMs);
  const hoverMsRef = useRef<number | null>(null);
  const suppressedFrameUpdateRef = useRef<number | null>(null);
  const previousHoverFrameRef = useRef<number | null>(null);
  // The frame currently believed to be displayed. Set by BOTH the player's
  // own frameupdate (during playback) AND by external seeks (transcript /
  // timeline clicks). When an external `playheadMs` prop arrives that maps
  // to this same frame, we skip seekTo — preventing the seek/frameupdate
  // feedback loop that would otherwise pause the Player on every tick.
  // See Remotion best-practices doc & player/player.md (seekTo pauses briefly).
  const lastSyncedFrameRef = useRef<number | null>(null);
  const warmupAnchorFrameRef = useRef(0);
  const [warmupFrame, setWarmupFrame] = useState(0);
  const warmupSources = useFrameWarmup({
    data,
    currentFrame: warmupFrame,
    lookaheadFrames: data.fps,
  });

  const updateWarmupFrame = useCallback(
    (frame: number) => {
      const threshold = Math.max(1, Math.floor(data.fps / 2));
      if (Math.abs(frame - warmupAnchorFrameRef.current) < threshold) return;
      warmupAnchorFrameRef.current = frame;
      setWarmupFrame(frame);
    },
    [data.fps],
  );

  const seekToFrame = useCallback(
    (frame: number, options?: { suppressFrameUpdate?: boolean }) => {
      const player = playerRef.current;
      if (!player) return;
      const targetFrame = clampRemotionFrame(frame, data.durationInFrames);
      if (options?.suppressFrameUpdate) {
        suppressedFrameUpdateRef.current = targetFrame;
      }
      lastSyncedFrameRef.current = targetFrame;
      warmupAnchorFrameRef.current = targetFrame;
      setWarmupFrame(targetFrame);
      player.seekTo(targetFrame);
    },
    [data.durationInFrames],
  );

  useImperativeHandle(
    ref,
    () => ({
      play: (event) => playerRef.current?.play(event),
      pause: () => playerRef.current?.pause(),
      togglePlayback: (event) => playerRef.current?.toggle(event),
    }),
    [],
  );

  useEffect(() => {
    hoverMsRef.current = hoverMs;
  }, [hoverMs]);

  useEffect(() => {
    if (playheadMs === undefined) return;
    if (hoverMs !== null) return;
    const player = playerRef.current;
    if (!player) return;
    const targetFrame = getRemotionFrameForMs({
      durationInFrames: data.durationInFrames,
      fps: data.fps,
      ms: playheadMs,
    });
    if (
      !shouldApplyExternalPlayheadSeek({
        playheadUpdateSource,
        lastSyncedFrame: lastSyncedFrameRef.current,
        targetFrame,
      })
    ) {
      return;
    }
    seekToFrame(targetFrame);
  }, [
    data.durationInFrames,
    data.fps,
    hoverMs,
    playheadMs,
    playheadUpdateSource,
    seekToFrame,
  ]);

  useEffect(() => {
    if (hoverMs === null) {
      if (previousHoverFrameRef.current === null) return;
      previousHoverFrameRef.current = null;
      // Without an external playhead source there is no stable frame to restore.
      if (playheadMs === undefined) return;
      seekToFrame(
        getRemotionFrameForMs({
          durationInFrames: data.durationInFrames,
          fps: data.fps,
          ms: playheadMs,
        }),
        { suppressFrameUpdate: true },
      );
      return;
    }
    const targetFrame = getRemotionFrameForMs({
      durationInFrames: data.durationInFrames,
      fps: data.fps,
      ms: hoverMs,
    });
    if (previousHoverFrameRef.current === targetFrame) return;
    previousHoverFrameRef.current = targetFrame;
    seekToFrame(targetFrame, { suppressFrameUpdate: true });
  }, [data.durationInFrames, data.fps, hoverMs, playheadMs, seekToFrame]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !onPlayheadChange) return;
    const handleFrame = (event: { detail: { frame: number } }) => {
      if (suppressedFrameUpdateRef.current === event.detail.frame) {
        suppressedFrameUpdateRef.current = null;
        lastSyncedFrameRef.current = event.detail.frame;
        updateWarmupFrame(event.detail.frame);
        return;
      }
      if (hoverMsRef.current !== null) {
        lastSyncedFrameRef.current = event.detail.frame;
        updateWarmupFrame(event.detail.frame);
        return;
      }
      if (lastSyncedFrameRef.current === event.detail.frame) return;
      lastSyncedFrameRef.current = event.detail.frame;
      updateWarmupFrame(event.detail.frame);
      onPlayheadChange(frameToMs(event.detail.frame, data.fps));
    };
    player.addEventListener('frameupdate', handleFrame);
    return () => player.removeEventListener('frameupdate', handleFrame);
  }, [data.fps, onPlayheadChange, updateWarmupFrame]);

  // Escape-key fallback to exit fullscreen. The Remotion Player's built-in
  // fullscreen button calls Element.requestFullscreen(), and inside Tauri's
  // webview the native Escape exit path is sometimes intercepted — leaving
  // the maximized player covering the whole app with no way back. Wire an
  // explicit listener that calls exitFullscreen() so users can always escape.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!document.fullscreenElement) return;
      event.preventDefault();
      const player = playerRef.current;
      if (player?.isFullscreen()) {
        player.exitFullscreen();
      } else if (document.exitFullscreen) {
        void document.exitFullscreen();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !onPlaybackStateChange) return;
    const handlePlay = () => onPlaybackStateChange('playing');
    const handlePause = () => onPlaybackStateChange('paused');
    const handleEnded = () => onPlaybackStateChange('stopped');
    player.addEventListener('play', handlePlay);
    player.addEventListener('pause', handlePause);
    player.addEventListener('ended', handleEnded);
    return () => {
      player.removeEventListener('play', handlePlay);
      player.removeEventListener('pause', handlePause);
      player.removeEventListener('ended', handleEnded);
    };
  }, [onPlaybackStateChange]);

  return (
    <div className={cn('relative size-full', className)}>
      <Player
        key={dataSignature}
        ref={playerRef}
        component={RemotionTimelineComposition}
        inputProps={inputProps}
        durationInFrames={data.durationInFrames}
        fps={data.fps}
        playbackRate={playbackRate}
        compositionWidth={data.compositionWidth}
        compositionHeight={data.compositionHeight}
        controls
        acknowledgeRemotionLicense
        className="size-full"
        style={{ width: '100%', height: '100%' }}
      />
      {warmupSources.length > 0 ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 size-px overflow-hidden opacity-0"
        >
          {warmupSources.map((src) => (
            <video key={src} src={src} preload="auto" muted playsInline />
          ))}
        </div>
      ) : null}
    </div>
  );
});

export function shouldApplyExternalPlayheadSeek({
  playheadUpdateSource,
  lastSyncedFrame,
  targetFrame,
}: {
  playheadUpdateSource: TimelinePlayheadUpdateSource;
  lastSyncedFrame: number | null;
  targetFrame: number;
}): boolean {
  if (playheadUpdateSource === 'preview' && lastSyncedFrame !== null) {
    return false;
  }
  return lastSyncedFrame !== targetFrame;
}

export function getRemotionFrameForMs({
  durationInFrames,
  fps,
  ms,
}: {
  durationInFrames: number;
  fps: number;
  ms: number;
}): number {
  return clampRemotionFrame(msToFrame(Math.max(0, ms), fps), durationInFrames);
}

function clampRemotionFrame(frame: number, durationInFrames: number): number {
  const maxFrame =
    Number.isFinite(durationInFrames) && durationInFrames > 0
      ? Math.max(0, durationInFrames - 1)
      : 0;
  if (!Number.isFinite(frame)) return 0;
  return Math.min(Math.max(0, frame), maxFrame);
}
