import { useCallback, useEffect, useMemo, useState } from 'react';

import type { RemotionPreviewData } from './remotionPreviewData';
import {
  PREVIEW_ZOOM,
  clampCenter,
  getFitScale,
  screenToCanvas,
  type PreviewViewportGeometry,
  type PreviewViewportPoint,
} from './webcodecs/previewViewport';
import type { PreviewViewportSize } from './WebCodecsPreviewModel';

const EDIT_CANVAS_FRAME_FIT_RATIO = 0.82;

export interface PreviewViewportControls {
  geometry: PreviewViewportGeometry | null;
  resetZoom: () => void;
  zoom: number;
  zoomBy: (factor: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomAtScreenPoint: (point: PreviewViewportPoint, factor: number) => void;
  panByScreenDelta: (delta: PreviewViewportPoint) => void;
}

export function usePreviewViewport({
  data,
  viewportSize,
}: {
  data: RemotionPreviewData;
  viewportSize: PreviewViewportSize;
}): PreviewViewportControls {
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({
    x: data.compositionWidth / 2,
    y: data.compositionHeight / 2,
  });

  useEffect(() => {
    setCenter({ x: data.compositionWidth / 2, y: data.compositionHeight / 2 });
    setZoom(1);
  }, [data.compositionHeight, data.compositionWidth]);

  const geometry = useMemo<PreviewViewportGeometry | null>(() => {
    if (viewportSize.height <= 0 || viewportSize.width <= 0) return null;
    const fitScale = getFitScale({
      canvasHeight: data.compositionHeight,
      canvasWidth: data.compositionWidth,
      viewportHeight: viewportSize.height,
      viewportWidth: viewportSize.width,
    });
    return clampCenter({
      canvasHeight: data.compositionHeight,
      canvasWidth: data.compositionWidth,
      centerX: center.x,
      centerY: center.y,
      scale: fitScale * EDIT_CANVAS_FRAME_FIT_RATIO * zoom,
      viewportHeight: viewportSize.height,
      viewportWidth: viewportSize.width,
    });
  }, [
    center.x,
    center.y,
    data.compositionHeight,
    data.compositionWidth,
    viewportSize.height,
    viewportSize.width,
    zoom,
  ]);

  const setClampedCenter = useCallback(
    (nextCenter: PreviewViewportPoint, nextZoom = zoom) => {
      if (viewportSize.height <= 0 || viewportSize.width <= 0) return;
      const fitScale = getFitScale({
        canvasHeight: data.compositionHeight,
        canvasWidth: data.compositionWidth,
        viewportHeight: viewportSize.height,
        viewportWidth: viewportSize.width,
      });
      const clamped = clampCenter({
        canvasHeight: data.compositionHeight,
        canvasWidth: data.compositionWidth,
        centerX: nextCenter.x,
        centerY: nextCenter.y,
        scale: fitScale * EDIT_CANVAS_FRAME_FIT_RATIO * nextZoom,
        viewportHeight: viewportSize.height,
        viewportWidth: viewportSize.width,
      });
      setCenter({ x: clamped.centerX, y: clamped.centerY });
    },
    [
      data.compositionHeight,
      data.compositionWidth,
      viewportSize.height,
      viewportSize.width,
      zoom,
    ],
  );

  const zoomAtScreenPoint = useCallback(
    (point: PreviewViewportPoint, factor: number) => {
      if (!geometry) return;
      const before = screenToCanvas(geometry, point);
      const nextZoom = clampZoom(zoom * factor);
      const nextScale = (geometry.scale / zoom) * nextZoom;
      setZoom(nextZoom);
      setClampedCenter(
        {
          x: before.x - (point.x - geometry.viewportWidth / 2) / nextScale,
          y: before.y - (point.y - geometry.viewportHeight / 2) / nextScale,
        },
        nextZoom,
      );
    },
    [geometry, setClampedCenter, zoom],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      if (!geometry) return;
      zoomAtScreenPoint(
        { x: geometry.viewportWidth / 2, y: geometry.viewportHeight / 2 },
        factor,
      );
    },
    [geometry, zoomAtScreenPoint],
  );

  const panByScreenDelta = useCallback(
    (delta: PreviewViewportPoint) => {
      if (!geometry || zoom <= 1) return;
      setClampedCenter({
        x: geometry.centerX - delta.x / geometry.scale,
        y: geometry.centerY - delta.y / geometry.scale,
      });
    },
    [geometry, setClampedCenter, zoom],
  );

  const resetZoom = useCallback(() => {
    setZoom(1);
    setClampedCenter(
      { x: data.compositionWidth / 2, y: data.compositionHeight / 2 },
      1,
    );
  }, [data.compositionHeight, data.compositionWidth, setClampedCenter]);

  return {
    geometry,
    panByScreenDelta,
    resetZoom,
    zoom,
    zoomAtScreenPoint,
    zoomBy,
    zoomIn: () => zoomBy(PREVIEW_ZOOM.step),
    zoomOut: () => zoomBy(1 / PREVIEW_ZOOM.step),
  };
}

function clampZoom(value: number): number {
  return Math.max(PREVIEW_ZOOM.min, Math.min(PREVIEW_ZOOM.max, value));
}
