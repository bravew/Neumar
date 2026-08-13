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

import { cn } from '@/shared/lib/utils';
import type {
  VideoAspectRatio,
  VideoClipTransform,
  VideoProject,
} from '@/shared/types/video';
import { useVideoFlags } from '@/shared/video/useVideoFlags';

import type {
  TimelinePlaybackState,
  TimelinePlayheadUpdateSource,
} from '../timeline/useTimelineUiStore';
import { useTimelineUiStore } from '../timeline/useTimelineUiStore';
import { EditCanvasOverlay } from './EditCanvasOverlay';
import { createOverlayAssetLoader } from './overlays/overlayAssetLoader';
import { VividOverlayLayer } from './overlays/VividOverlayLayer';
import type { PreviewPlaybackRate } from './previewPlaybackRate';
import { PreviewZoomControls } from './PreviewZoomControls';
import type { RemotionPreviewHandle } from './RemotionPreview';
import {
  buildRemotionPreviewData,
  buildRemotionPreviewDataSignature,
  type RemotionPreviewData,
} from './remotionPreviewData';
import { usePreviewViewport } from './usePreviewViewport';
import { WebCodecsAudioEngine } from './webcodecs/AudioEngine';
import { getWebCodecsPreviewUnsupportedReason } from './webcodecs/sceneModel';
import { VideoFrameCache } from './webcodecs/VideoFrameCache';
import { useWebCodecsFrameRenderer } from './WebCodecsFrameRenderer';
import {
  getFrameForMs,
  shouldApplyExternalPlayheadSeek,
  useCanvasViewportSize,
  useLatestRef,
  useLivePreviewProject,
  usePreviewPlaybackClock,
} from './WebCodecsPreviewModel';

interface WebCodecsPreviewProps {
  project: VideoProject;
  aspectRatio: VideoAspectRatio;
  playbackRate: PreviewPlaybackRate;
  className?: string;
  playheadMs?: number;
  playheadUpdateSource?: TimelinePlayheadUpdateSource;
  onPlayheadChange?: (ms: number) => void;
  onPlaybackStateChange?: (state: TimelinePlaybackState) => void;
  onUnsupported?: (reason: string) => void;
}

export const WebCodecsPreview = forwardRef<
  RemotionPreviewHandle,
  WebCodecsPreviewProps
>(function WebCodecsPreview(
  {
    project,
    aspectRatio,
    playbackRate,
    className,
    playheadMs = 0,
    playheadUpdateSource = 'external',
    onPlayheadChange,
    onPlaybackStateChange,
    onUnsupported,
  },
  ref,
) {
  // Render from the live editor timeline so committed transforms and undos
  // appear on the canvas immediately (see useLivePreviewProject).
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
  // Decode resources are keyed by media source, so only release them when the
  // project or aspect changes — NOT on every transform edit (which would
  // re-decode and flash). The frame cache simply ignores unused sources.
  const disposeKey = `${project.id}|${aspectRatio}`;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const editCanvasEnabled = true;
  const unsupportedReason = getWebCodecsPreviewUnsupportedReason(data);
  const viewportSize = useCanvasViewportSize(editCanvasEnabled, canvasRef);
  const previewViewport = usePreviewViewport({ data, viewportSize });
  const editViewport = previewViewport.geometry;
  const [isPlaying, setIsPlaying] = useState(false);
  const [transformOverrides, setTransformOverrides] = useState<
    Record<string, VideoClipTransform>
  >({});
  const audioEngineRef = useRef<WebCodecsAudioEngine | null>(null);
  const cacheRef = useRef<VideoFrameCache | null>(null);
  const imageCacheRef = useRef<Map<string, Promise<HTMLImageElement>>>(
    new Map(),
  );
  const lastSyncedFrameRef = useRef<number | null>(null);
  const renderEpochRef = useRef(0);
  const hoverMs = useTimelineUiStore((state) => state.hoverMs);
  const hoverFrame = useMemo(
    () => (hoverMs === null ? null : getFrameForMs(hoverMs, data)),
    [data, hoverMs],
  );

  const getCache = useCallback(() => {
    cacheRef.current ??= new VideoFrameCache();
    return cacheRef.current;
  }, []);

  const getAudioEngine = useCallback(() => {
    audioEngineRef.current ??= new WebCodecsAudioEngine();
    return audioEngineRef.current;
  }, []);

  useEffect(() => {
    if (unsupportedReason) onUnsupported?.(unsupportedReason);
  }, [onUnsupported, unsupportedReason]);

  const renderFrame = useWebCodecsFrameRenderer({
    canvasRef,
    data,
    editCanvasEnabled,
    editViewport,
    getCache,
    imageCacheRef,
    onUnsupported,
    renderEpochRef,
    transformOverrides,
    unsupportedReason,
  });

  const frameRef = useLatestRef(renderFrame);
  const playheadRef = useLatestRef(onPlayheadChange);
  const stateRef = useLatestRef(onPlaybackStateChange);

  const playbackClock = usePreviewPlaybackClock({
    data,
    frameRef,
    lastSyncedFrameRef,
    onIsPlayingChange: setIsPlaying,
    playheadRef,
    stateRef,
  });
  useEffect(
    () => playbackClock.setPlaybackRate(playbackRate),
    [playbackClock, playbackRate],
  );

  const stopPlayback = useCallback(() => {
    audioEngineRef.current?.pause();
    playbackClock.pause();
  }, [playbackClock]);

  const playPreview = useCallback(
    (_event?: SyntheticEvent) => {
      if (unsupportedReason) return;
      void getAudioEngine()
        .play(data, playbackClock.currentFrame, playbackRate)
        .catch((error) => {
          onUnsupported?.(
            error instanceof Error ? error.message : 'WebCodecs audio failed',
          );
        });
      playbackClock.play();
    },
    [
      data,
      getAudioEngine,
      onUnsupported,
      playbackClock,
      playbackRate,
      unsupportedReason,
    ],
  );

  useImperativeHandle(
    ref,
    () => ({
      pause: stopPlayback,
      play: playPreview,
      togglePlayback: (event?: SyntheticEvent) => {
        if (playbackClock.isRunning) {
          stopPlayback();
        } else {
          playPreview(event);
        }
      },
    }),
    [playPreview, playbackClock, stopPlayback],
  );

  useEffect(() => {
    const frame = getFrameForMs(playheadMs, data);
    if (hoverFrame !== null) return;
    if (
      !shouldApplyExternalPlayheadSeek({
        lastSyncedFrame: lastSyncedFrameRef.current,
        playheadUpdateSource,
        targetFrame: frame,
      })
    ) {
      return;
    }
    lastSyncedFrameRef.current = frame;
    playbackClock.seekFrame(frame);
    if (playbackClock.isRunning && !unsupportedReason) {
      void getAudioEngine()
        .play(data, frame, playbackRate)
        .catch((error) => {
          onUnsupported?.(
            error instanceof Error ? error.message : 'WebCodecs audio failed',
          );
        });
    }
    void renderFrame(frame);
  }, [
    data,
    getAudioEngine,
    hoverFrame,
    onUnsupported,
    playbackClock,
    playbackRate,
    playheadMs,
    playheadUpdateSource,
    renderFrame,
    unsupportedReason,
  ]);

  useEffect(() => {
    if (hoverFrame === null) return;
    void renderFrame(hoverFrame);
  }, [hoverFrame, renderFrame]);

  useEffect(() => {
    if (
      !editCanvasEnabled ||
      viewportSize.height <= 0 ||
      viewportSize.width <= 0
    ) {
      return;
    }
    void renderFrame(hoverFrame ?? getFrameForMs(playheadMs, data));
  }, [
    data,
    editCanvasEnabled,
    hoverFrame,
    playheadMs,
    renderFrame,
    viewportSize.height,
    viewportSize.width,
  ]);

  useEffect(
    () => () => {
      renderEpochRef.current += 1;
      cacheRef.current?.dispose();
      cacheRef.current = null;
      audioEngineRef.current?.dispose();
      audioEngineRef.current = null;
      imageCacheRef.current.clear();
    },
    [disposeKey],
  );

  const { flags: videoFlags } = useVideoFlags();
  const vividOverlaysEnabled = videoFlags['video.vividOverlays'] !== false;
  const overlayAssetLoader = useMemo(
    () => createOverlayAssetLoader(project.id),
    [project.id],
  );

  const handleTransformPreview = useCallback(
    (clipId: string, transform: VideoClipTransform | null) => {
      setTransformOverrides((prev) => {
        if (transform) return { ...prev, [clipId]: transform };
        const { [clipId]: _removed, ...next } = prev;
        return next;
      });
    },
    [],
  );
  const overlayFrame = hoverFrame ?? getFrameForMs(playheadMs, data);

  return (
    <div
      className={cn('relative size-full bg-black', className)}
      data-webcodecs-duration-frames={data.durationInFrames}
      data-webcodecs-frame={playbackClock.currentFrame}
      data-webcodecs-running={isPlaying ? 'true' : 'false'}
    >
      <canvas
        ref={canvasRef}
        className="size-full bg-black object-contain"
        aria-hidden="true"
      />
      <VividOverlayLayer
        data={data}
        enabled={vividOverlaysEnabled}
        frame={overlayFrame}
        geometry={editViewport}
        loadAsset={overlayAssetLoader}
      />
      {editCanvasEnabled && editViewport && !isPlaying ? (
        <>
          <EditCanvasOverlay
            data={data}
            frame={overlayFrame}
            project={liveProject}
            transformOverrides={transformOverrides}
            viewport={editViewport}
            onPanByScreenDelta={previewViewport.panByScreenDelta}
            onTransformPreview={handleTransformPreview}
            onWheelZoom={previewViewport.zoomAtScreenPoint}
          />
          <PreviewZoomControls
            zoom={previewViewport.zoom}
            onFit={previewViewport.resetZoom}
            onZoomIn={previewViewport.zoomIn}
            onZoomOut={previewViewport.zoomOut}
          />
        </>
      ) : null}
    </div>
  );
});
