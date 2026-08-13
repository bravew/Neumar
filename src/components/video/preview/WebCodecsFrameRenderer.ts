import { useCallback, useEffect, useRef, type RefObject } from 'react';

import type { VideoClipTransform } from '@/shared/types/video';

import type { RemotionPreviewData } from './remotionPreviewData';
import { copyDecodedCanvas, loadImageSource } from './webcodecs/canvasSources';
import {
  drawWebCodecsFrame,
  type ResolvedWebCodecsTransition,
  type ResolvedWebCodecsVisualLayer,
} from './webcodecs/Compositor';
import type { PreviewViewportGeometry } from './webcodecs/previewViewport';
import {
  getActiveWebCodecsVisualLayers,
  getTransitionSeamAtFrame,
  type WebCodecsTransitionSeam,
  type WebCodecsVisualLayer,
} from './webcodecs/sceneModel';
import {
  VideoFrameCache,
  WebCodecsPreviewDecodeError,
} from './webcodecs/VideoFrameCache';
import { WebGLTransitionRenderer } from './webcodecs/WebGLTransitionRenderer';
import {
  applyVisualTransformOverrides,
  getCanvasDpr,
} from './WebCodecsPreviewModel';

interface UseWebCodecsFrameRendererOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  data: RemotionPreviewData;
  editCanvasEnabled: boolean;
  editViewport: PreviewViewportGeometry | null;
  getCache: () => VideoFrameCache;
  imageCacheRef: RefObject<Map<string, Promise<HTMLImageElement>>>;
  onUnsupported?: (reason: string) => void;
  renderEpochRef: RefObject<number>;
  transformOverrides: Record<string, VideoClipTransform>;
  unsupportedReason: string | null;
}

interface WebCodecsRenderTransitionSeam {
  direction?: WebCodecsTransitionSeam['direction'];
  kind: WebCodecsTransitionSeam['kind'];
  params?: WebCodecsTransitionSeam['params'];
  progress: WebCodecsTransitionSeam['progress'];
  timing?: WebCodecsTransitionSeam['timing'];
}

export interface RenderWebCodecsFrameToCanvasOptions {
  cache: VideoFrameCache;
  canvas: HTMLCanvasElement;
  data: RemotionPreviewData;
  dpr?: number;
  frame: number;
  imageCache: Map<string, Promise<HTMLImageElement>>;
  isStale?: () => boolean;
  transformOverrides?: Record<string, VideoClipTransform>;
  transitionRenderer?: WebGLTransitionRenderer;
  viewport?: PreviewViewportGeometry;
}

export async function renderWebCodecsFrameToCanvas({
  cache,
  canvas,
  data,
  dpr = 1,
  frame,
  imageCache,
  isStale,
  transformOverrides = {},
  transitionRenderer,
  viewport,
}: RenderWebCodecsFrameToCanvasOptions): Promise<boolean> {
  const targetWidth = viewport
    ? Math.max(1, Math.round(viewport.viewportWidth * dpr))
    : data.compositionWidth;
  const targetHeight = viewport
    ? Math.max(1, Math.round(viewport.viewportHeight * dpr))
    : data.compositionHeight;
  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas2D unavailable');
  }

  const resolveLayers = async (
    sourceLayers: WebCodecsVisualLayer[],
  ): Promise<ResolvedWebCodecsVisualLayer[] | null> => {
    const resolvedByIndex = new Map<number, ResolvedWebCodecsVisualLayer>();
    const videoRequests: Array<{
      index: number;
      layer: Extract<WebCodecsVisualLayer, { kind: 'video' }>;
    }> = [];
    await Promise.all(
      sourceLayers.map(async (layer, index) => {
        if (layer.kind !== 'image') {
          videoRequests.push({ index, layer });
          return;
        }
        const image = await loadImageSource(imageCache, layer.clip.src);
        if (isStale?.()) return;
        resolvedByIndex.set(index, {
          kind: 'image',
          layer,
          source: image,
        });
      }),
    );
    if (isStale?.()) return null;

    const videoFrames = await cache.getFramesAt(
      videoRequests.map(({ index, layer }) => ({
        id: String(index),
        src: layer.clip.src,
        timeSec: layer.sourceTimeSec,
      })),
    );
    if (isStale?.()) return null;

    for (const { index, layer } of videoRequests) {
      const videoFrame = videoFrames.get(String(index));
      if (!videoFrame) continue;
      resolvedByIndex.set(index, {
        kind: 'video',
        layer,
        // CanvasSink returns a pooled surface this component does not own;
        // keep the copy so later getCanvas calls cannot recycle it mid-draw.
        source: copyDecodedCanvas(videoFrame.canvas),
      });
    }

    return sourceLayers
      .map((_, index) => resolvedByIndex.get(index))
      .filter(
        (layer): layer is ResolvedWebCodecsVisualLayer => layer !== undefined,
      );
  };

  const layers = applyVisualTransformOverrides(
    getActiveWebCodecsVisualLayers(data, frame),
    transformOverrides,
  );
  const resolvedLayers = await resolveLayers(layers);
  if (!resolvedLayers) return false;

  const seam = getTransitionSeamAtFrame(data, frame);
  let transition: ResolvedWebCodecsTransition | undefined;
  if (seam) {
    const fromLayers = await resolveLayers(
      applyVisualTransformOverrides(seam.fromClips, transformOverrides),
    );
    if (!fromLayers) return false;
    const toLayers = await resolveLayers(
      applyVisualTransformOverrides(seam.toClips, transformOverrides),
    );
    if (!toLayers) return false;
    transition = resolveWebCodecsRenderTransition({
      fromLayers,
      seam,
      toLayers,
    });
  }

  if (isStale?.()) return false;
  drawWebCodecsFrame({
    ctx,
    data,
    dpr,
    frame,
    layers: resolvedLayers,
    transition,
    transitionRenderer,
    viewport,
  });
  return true;
}

export function useWebCodecsFrameRenderer({
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
}: UseWebCodecsFrameRendererOptions) {
  const transitionRendererRef = useRef<WebGLTransitionRenderer | null>(null);

  useEffect(() => {
    return () => {
      transitionRendererRef.current?.destroy();
      transitionRendererRef.current = null;
    };
  }, []);

  return useCallback(
    async (frame: number) => {
      if (unsupportedReason) return false;
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const epoch = ++renderEpochRef.current;
      const viewport = editCanvasEnabled ? editViewport : null;
      if (editCanvasEnabled && !viewport) return false;
      const dpr = viewport ? getCanvasDpr() : 1;
      try {
        if (getTransitionSeamAtFrame(data, frame)) {
          transitionRendererRef.current ??= new WebGLTransitionRenderer();
        }
        return await renderWebCodecsFrameToCanvas({
          cache: getCache(),
          canvas,
          data,
          dpr,
          frame,
          imageCache: imageCacheRef.current,
          isStale: () => epoch !== renderEpochRef.current,
          transformOverrides,
          transitionRenderer: transitionRendererRef.current ?? undefined,
          viewport: viewport ?? undefined,
        });
      } catch (error) {
        if (
          error instanceof WebCodecsPreviewDecodeError &&
          error.code === 'disposed'
        ) {
          return false;
        }
        onUnsupported?.(
          error instanceof Error ? error.message : 'WebCodecs render failed',
        );
        return false;
      }
    },
    [
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
    ],
  );
}

export function resolveWebCodecsRenderTransition({
  fromLayers,
  seam,
  toLayers,
}: {
  fromLayers: ResolvedWebCodecsVisualLayer[];
  seam: WebCodecsRenderTransitionSeam;
  toLayers: ResolvedWebCodecsVisualLayer[];
}): ResolvedWebCodecsTransition {
  return {
    fromLayers,
    kind: seam.kind,
    ...(seam.direction ? { direction: seam.direction } : {}),
    ...(seam.params ? { params: seam.params } : {}),
    progress: seam.progress,
    ...(seam.timing ? { timing: seam.timing } : {}),
    toLayers,
  };
}
