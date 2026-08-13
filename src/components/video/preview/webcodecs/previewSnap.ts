import type { VideoClipTransform } from '@/shared/types/video';

import type { GizmoHandle } from '../gizmoHandles';
import {
  screenPixelsToLogicalThreshold,
  type PreviewViewportGeometry,
} from './previewViewport';

export const SNAP_THRESHOLD_SCREEN_PIXELS = 8;
export const ROTATION_SNAP_DEGREES = 5;

export interface PreviewSnapGuide {
  axis: 'x' | 'y';
  position: number;
}

export interface PreviewSnapResult<T extends VideoClipTransform> {
  guides: PreviewSnapGuide[];
  transform: T;
}

interface RequiredTransform extends VideoClipTransform {
  positionX: number;
  positionY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export function snapPosition({
  boundsHeight,
  boundsWidth,
  transform,
  viewport,
}: {
  boundsHeight: number;
  boundsWidth: number;
  transform: RequiredTransform;
  viewport: PreviewViewportGeometry;
}): PreviewSnapResult<RequiredTransform> {
  const threshold = screenPixelsToLogicalThreshold(
    viewport,
    SNAP_THRESHOLD_SCREEN_PIXELS,
  );
  let centerX = transform.positionX * viewport.canvasWidth;
  let centerY = transform.positionY * viewport.canvasHeight;
  const guides: PreviewSnapGuide[] = [];
  const snapX = snapAxis({
    candidates: axisCandidates(viewport.canvasWidth),
    center: centerX,
    halfSize: boundsWidth / 2,
    threshold,
  });
  if (snapX) {
    centerX += snapX.delta;
    guides.push({ axis: 'x', position: snapX.guide });
  }
  const snapY = snapAxis({
    candidates: axisCandidates(viewport.canvasHeight),
    center: centerY,
    halfSize: boundsHeight / 2,
    threshold,
  });
  if (snapY) {
    centerY += snapY.delta;
    guides.push({ axis: 'y', position: snapY.guide });
  }
  return {
    guides,
    transform: {
      ...transform,
      positionX: centerX / viewport.canvasWidth,
      positionY: centerY / viewport.canvasHeight,
    },
  };
}

export function snapScale({
  handle,
  startBoundsHeight,
  startBoundsWidth,
  startTransform,
  transform,
  viewport,
}: {
  handle: GizmoHandle;
  startBoundsHeight: number;
  startBoundsWidth: number;
  startTransform: RequiredTransform;
  transform: RequiredTransform;
  viewport: PreviewViewportGeometry;
}): PreviewSnapResult<RequiredTransform> {
  const threshold = screenPixelsToLogicalThreshold(
    viewport,
    SNAP_THRESHOLD_SCREEN_PIXELS,
  );
  const centerX = transform.positionX * viewport.canvasWidth;
  const centerY = transform.positionY * viewport.canvasHeight;
  const guides: PreviewSnapGuide[] = [];
  let scaleX = transform.scaleX;
  let scaleY = transform.scaleY;

  const snapX = snapScaleAxis({
    candidates: axisCandidates(viewport.canvasWidth),
    center: centerX,
    handleNegative: handleHasAxis(handle, 'w'),
    handlePositive: handleHasAxis(handle, 'e'),
    size: startBoundsWidth * (transform.scaleX / startTransform.scaleX),
    startScale: startTransform.scaleX,
    startSize: startBoundsWidth,
    threshold,
  });
  if (snapX) {
    scaleX = snapX.scale;
    guides.push({ axis: 'x', position: snapX.guide });
  }

  const snapY = snapScaleAxis({
    candidates: axisCandidates(viewport.canvasHeight),
    center: centerY,
    handleNegative: handleHasAxis(handle, 'n'),
    handlePositive: handleHasAxis(handle, 's'),
    size: startBoundsHeight * (transform.scaleY / startTransform.scaleY),
    startScale: startTransform.scaleY,
    startSize: startBoundsHeight,
    threshold,
  });
  if (snapY) {
    scaleY = snapY.scale;
    guides.push({ axis: 'y', position: snapY.guide });
  }

  return { guides, transform: { ...transform, scaleX, scaleY } };
}

export function snapRotation(rotation: number): number {
  const target = Math.round(rotation / 90) * 90;
  return Math.abs(rotation - target) <= ROTATION_SNAP_DEGREES
    ? normalizeDegrees(target)
    : rotation;
}

function axisCandidates(size: number): number[] {
  return [0, size / 2, size];
}

function handleHasAxis(handle: GizmoHandle, axis: 'e' | 'n' | 's' | 'w') {
  return (
    handle.startsWith('scale-') && handle.slice('scale-'.length).includes(axis)
  );
}

function snapAxis({
  candidates,
  center,
  halfSize,
  threshold,
}: {
  candidates: number[];
  center: number;
  halfSize: number;
  threshold: number;
}): { delta: number; guide: number } | null {
  const points = [center, center - halfSize, center + halfSize];
  let best: { delta: number; distance: number; guide: number } | null = null;
  for (const point of points) {
    for (const candidate of candidates) {
      const distance = Math.abs(point - candidate);
      if (distance > threshold || (best && distance >= best.distance)) continue;
      best = { delta: candidate - point, distance, guide: candidate };
    }
  }
  return best ? { delta: best.delta, guide: best.guide } : null;
}

function snapScaleAxis({
  candidates,
  center,
  handleNegative,
  handlePositive,
  size,
  startScale,
  startSize,
  threshold,
}: {
  candidates: number[];
  center: number;
  handleNegative: boolean;
  handlePositive: boolean;
  size: number;
  startScale: number;
  startSize: number;
  threshold: number;
}): { guide: number; scale: number } | null {
  if (!handleNegative && !handlePositive) return null;
  const edge = handleNegative ? center - size / 2 : center + size / 2;
  let best: { distance: number; guide: number; scale: number } | null = null;
  for (const candidate of candidates) {
    const distance = Math.abs(edge - candidate);
    if (distance > threshold || (best && distance >= best.distance)) continue;
    const nextSize = Math.abs((candidate - center) * 2);
    if (nextSize <= 0) continue;
    best = {
      distance,
      guide: candidate,
      scale: startScale * (nextSize / Math.max(1, startSize)),
    };
  }
  return best ? { guide: best.guide, scale: best.scale } : null;
}

function normalizeDegrees(value: number): number {
  let next = value;
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  return next;
}
