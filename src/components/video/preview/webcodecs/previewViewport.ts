export const PREVIEW_ZOOM = {
  max: 16,
  min: 0.25,
  step: 1.25,
} as const;

export interface PreviewViewportGeometry {
  canvasHeight: number;
  canvasWidth: number;
  centerX: number;
  centerY: number;
  scale: number;
  viewportHeight: number;
  viewportWidth: number;
}

export interface PreviewViewportPoint {
  x: number;
  y: number;
}

export interface PreviewViewportRect {
  h: number;
  w: number;
  x: number;
  y: number;
}

export function getFitScale({
  canvasHeight,
  canvasWidth,
  viewportHeight,
  viewportWidth,
}: Pick<
  PreviewViewportGeometry,
  'canvasHeight' | 'canvasWidth' | 'viewportHeight' | 'viewportWidth'
>): number {
  if (
    canvasHeight <= 0 ||
    canvasWidth <= 0 ||
    viewportHeight <= 0 ||
    viewportWidth <= 0
  ) {
    return 1;
  }
  return Math.min(viewportWidth / canvasWidth, viewportHeight / canvasHeight);
}

export function clampCenter(
  geometry: PreviewViewportGeometry,
): PreviewViewportGeometry {
  return {
    ...geometry,
    centerX: clampAxisCenter({
      canvasSize: geometry.canvasWidth,
      center: geometry.centerX,
      scale: geometry.scale,
      viewportSize: geometry.viewportWidth,
    }),
    centerY: clampAxisCenter({
      canvasSize: geometry.canvasHeight,
      center: geometry.centerY,
      scale: geometry.scale,
      viewportSize: geometry.viewportHeight,
    }),
  };
}

export function frameRectInViewport(
  geometry: PreviewViewportGeometry,
): PreviewViewportRect {
  const origin = viewportOrigin(geometry);
  return {
    h: geometry.canvasHeight * geometry.scale,
    w: geometry.canvasWidth * geometry.scale,
    x: origin.x,
    y: origin.y,
  };
}

export function screenToCanvas(
  geometry: PreviewViewportGeometry,
  point: PreviewViewportPoint,
): PreviewViewportPoint {
  if (geometry.scale <= 0) return { x: point.x, y: point.y };
  const origin = viewportOrigin(geometry);
  return {
    x: (point.x - origin.x) / geometry.scale,
    y: (point.y - origin.y) / geometry.scale,
  };
}

export function canvasToOverlay(
  geometry: PreviewViewportGeometry,
  point: PreviewViewportPoint,
): PreviewViewportPoint {
  const origin = viewportOrigin(geometry);
  return {
    x: origin.x + point.x * geometry.scale,
    y: origin.y + point.y * geometry.scale,
  };
}

export function positionToOverlay(
  geometry: PreviewViewportGeometry,
  position: PreviewViewportPoint,
): PreviewViewportPoint {
  return canvasToOverlay(geometry, {
    x: position.x * geometry.canvasWidth,
    y: position.y * geometry.canvasHeight,
  });
}

export function screenPixelsToLogicalThreshold(
  geometry: Pick<PreviewViewportGeometry, 'scale'>,
  screenPixels: number,
): number {
  if (geometry.scale <= 0) return screenPixels;
  return screenPixels / geometry.scale;
}

function viewportOrigin({
  centerX,
  centerY,
  scale,
  viewportHeight,
  viewportWidth,
}: PreviewViewportGeometry): PreviewViewportPoint {
  return {
    x: viewportWidth / 2 - centerX * scale,
    y: viewportHeight / 2 - centerY * scale,
  };
}

function clampAxisCenter({
  canvasSize,
  center,
  scale,
  viewportSize,
}: {
  canvasSize: number;
  center: number;
  scale: number;
  viewportSize: number;
}): number {
  if (canvasSize <= 0 || scale <= 0 || viewportSize <= 0) {
    return canvasSize / 2;
  }
  const visibleSize = viewportSize / scale;
  if (visibleSize >= canvasSize) return canvasSize / 2;
  return clamp(center, visibleSize / 2, canvasSize - visibleSize / 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
