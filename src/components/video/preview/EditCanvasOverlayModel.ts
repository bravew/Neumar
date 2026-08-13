import {
  isVisualTimelineClip,
  isVisualTimelineTrack,
  type VideoClipTransform,
  type VideoProject,
  type VideoTimeline,
  type VideoVisualTimelineClip,
} from '@/shared/types/video';

import type { GizmoBounds, GizmoHandle } from './gizmoHandles';
import type {
  RemotionPreviewData,
  RemotionVisualClip,
} from './remotionPreviewData';
import { getLayerBoundsInComposition } from './webcodecs/layerTransform';
import {
  snapPosition,
  snapRotation,
  snapScale,
  type PreviewSnapGuide,
} from './webcodecs/previewSnap';
import {
  canvasToOverlay,
  type PreviewViewportGeometry,
  type PreviewViewportPoint,
} from './webcodecs/previewViewport';
import { getActiveWebCodecsVisualLayers } from './webcodecs/sceneModel';

export interface SourceSize {
  height: number;
  width: number;
}

export interface OverlayLayerBounds {
  bounds: GizmoBounds;
  clip: RemotionVisualClip;
  clipId: string;
  sourceSize: SourceSize;
}

export interface RequiredTransform extends VideoClipTransform {
  positionX: number;
  positionY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface EditCanvasDragState {
  clipId: string;
  handle: GizmoHandle;
  latestTransform: VideoClipTransform;
  pointerId: number;
  startBounds: GizmoBounds;
  startCenterClientX: number;
  startCenterClientY: number;
  startClientX: number;
  startClientY: number;
  startRotationAngle: number;
  startTransform: RequiredTransform;
}

export interface DragTransformResult {
  guides: PreviewSnapGuide[];
  transform: RequiredTransform;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 16;

export function getVisualTimelineClipMap(
  timeline: VideoTimeline | null,
): Map<string, VideoVisualTimelineClip> {
  const clips = new Map<string, VideoVisualTimelineClip>();
  if (!timeline) return clips;
  for (const track of timeline.tracks) {
    if (!isVisualTimelineTrack(track)) continue;
    for (const clip of track.clips) {
      if (isVisualTimelineClip(clip)) clips.set(clip.id, clip);
    }
  }
  return clips;
}

export function getOverlayLayerBounds({
  data,
  frame,
  project,
  timelineClips,
  transformOverrides,
  viewport,
}: {
  data: RemotionPreviewData;
  frame: number;
  project: VideoProject;
  timelineClips: Map<string, VideoVisualTimelineClip>;
  transformOverrides: Record<string, VideoClipTransform>;
  viewport: PreviewViewportGeometry;
}): OverlayLayerBounds[] {
  const activeLayers = getActiveWebCodecsVisualLayers(data, frame);
  return activeLayers.map((layer) => {
    const clipId = editableClipId(layer.clip);
    const override = transformOverrides[clipId];
    const clip = override ? { ...layer.clip, transform: override } : layer.clip;
    const sourceSize = getSourceSize({
      data,
      project,
      timelineClip: timelineClips.get(clipId),
    });
    return {
      bounds: layerBoundsToGizmoBounds({
        clip,
        data,
        sourceSize,
        viewport,
      }),
      clip,
      clipId,
      sourceSize,
    };
  });
}

export function editableClipId(clip: RemotionVisualClip): string {
  return clip.timelineClipId ?? clip.id;
}

export function layerBoundsToGizmoBounds({
  clip,
  data,
  sourceSize,
  viewport,
}: {
  clip: RemotionVisualClip;
  data: RemotionPreviewData;
  sourceSize: SourceSize;
  viewport: PreviewViewportGeometry;
}): GizmoBounds {
  const bounds = getLayerBoundsInComposition({
    clip,
    data,
    sourceHeight: sourceSize.height,
    sourceWidth: sourceSize.width,
  });
  const center = canvasToOverlay(viewport, { x: bounds.cx, y: bounds.cy });
  return {
    cx: center.x,
    cy: center.y,
    h: Math.abs(bounds.h * viewport.scale),
    rotation: bounds.rotation,
    w: Math.abs(bounds.w * viewport.scale),
  };
}

export function hitTestOverlayLayers(
  layers: OverlayLayerBounds[],
  overlayPoint: PreviewViewportPoint,
): OverlayLayerBounds | null {
  for (const layer of [...layers].reverse()) {
    const rotation = (-layer.bounds.rotation * Math.PI) / 180;
    const localX = overlayPoint.x - layer.bounds.cx;
    const localY = overlayPoint.y - layer.bounds.cy;
    const x = localX * Math.cos(rotation) - localY * Math.sin(rotation);
    const y = localX * Math.sin(rotation) + localY * Math.cos(rotation);
    const halfW = layer.bounds.w / 2;
    const halfH = layer.bounds.h / 2;
    if (Math.abs(x) <= halfW && Math.abs(y) <= halfH) return layer;
  }
  return null;
}

export function transformForDrag({
  drag,
  event,
  viewport,
}: {
  drag: EditCanvasDragState;
  event: { clientX: number; clientY: number; shiftKey: boolean };
  viewport: PreviewViewportGeometry;
}): RequiredTransform {
  if (drag.handle === 'move') {
    return {
      ...drag.startTransform,
      positionX:
        drag.startTransform.positionX +
        (event.clientX - drag.startClientX) /
          viewport.scale /
          viewport.canvasWidth,
      positionY:
        drag.startTransform.positionY +
        (event.clientY - drag.startClientY) /
          viewport.scale /
          viewport.canvasHeight,
    };
  }
  if (drag.handle === 'rotate') {
    const nextAngle = Math.atan2(
      event.clientY - drag.startCenterClientY,
      event.clientX - drag.startCenterClientX,
    );
    let rotation =
      drag.startTransform.rotation +
      ((nextAngle - drag.startRotationAngle) * 180) / Math.PI;
    if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
    return { ...drag.startTransform, rotation: normalizeDegrees(rotation) };
  }

  const rotation = (-drag.startBounds.rotation * Math.PI) / 180;
  const dx = event.clientX - drag.startCenterClientX;
  const dy = event.clientY - drag.startCenterClientY;
  const localX = dx * Math.cos(rotation) - dy * Math.sin(rotation);
  const localY = dx * Math.sin(rotation) + dy * Math.cos(rotation);
  const startHalfW = Math.max(1, drag.startBounds.w / 2);
  const startHalfH = Math.max(1, drag.startBounds.h / 2);
  const edgeX =
    handleHasAxis(drag.handle, 'e') || handleHasAxis(drag.handle, 'w');
  const edgeY =
    handleHasAxis(drag.handle, 'n') || handleHasAxis(drag.handle, 's');
  const nextScaleX = clampScale(
    drag.startTransform.scaleX * (Math.abs(localX) / startHalfW),
  );
  const nextScaleY = clampScale(
    drag.startTransform.scaleY * (Math.abs(localY) / startHalfH),
  );

  if (edgeX && edgeY) {
    const factor = Math.max(
      Math.abs(localX) / startHalfW,
      Math.abs(localY) / startHalfH,
    );
    return {
      ...drag.startTransform,
      scaleX: clampScale(drag.startTransform.scaleX * factor),
      scaleY: clampScale(drag.startTransform.scaleY * factor),
    };
  }
  if (edgeX) return { ...drag.startTransform, scaleX: nextScaleX };
  return { ...drag.startTransform, scaleY: nextScaleY };
}

export function snapTransformForDrag({
  drag,
  event,
  transform,
  viewport,
}: {
  drag: EditCanvasDragState;
  event: { shiftKey: boolean };
  transform: RequiredTransform;
  viewport: PreviewViewportGeometry;
}): DragTransformResult {
  if (event.shiftKey) return { guides: [], transform };
  if (drag.handle === 'move') {
    return snapPosition({
      boundsHeight: drag.startBounds.h / viewport.scale,
      boundsWidth: drag.startBounds.w / viewport.scale,
      transform,
      viewport,
    });
  }
  if (drag.handle === 'rotate') {
    return {
      guides: [],
      transform: { ...transform, rotation: snapRotation(transform.rotation) },
    };
  }
  return snapScale({
    handle: drag.handle,
    startBoundsHeight: drag.startBounds.h / viewport.scale,
    startBoundsWidth: drag.startBounds.w / viewport.scale,
    startTransform: drag.startTransform,
    transform,
    viewport,
  });
}

export function normalizeTransform(
  transform: VideoClipTransform | undefined,
): RequiredTransform {
  const uniform = transform?.scale ?? 1;
  return {
    ...transform,
    positionX: transform?.positionX ?? 0.5,
    positionY: transform?.positionY ?? 0.5,
    rotation: transform?.rotation ?? 0,
    scaleX: transform?.scaleX ?? uniform,
    scaleY: transform?.scaleY ?? uniform,
  };
}

function getSourceSize({
  data,
  project,
  timelineClip,
}: {
  data: RemotionPreviewData;
  project: VideoProject;
  timelineClip: VideoVisualTimelineClip | undefined;
}): SourceSize {
  const sourceRef = timelineClip?.sourceRef;
  if (sourceRef?.kind === 'asset') {
    const asset = project.assets.find((item) => item.id === sourceRef.assetId);
    if (asset?.metadata.width && asset.metadata.height) {
      return { height: asset.metadata.height, width: asset.metadata.width };
    }
  }
  return { height: data.compositionHeight, width: data.compositionWidth };
}

function clampScale(value: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
}

function handleHasAxis(handle: GizmoHandle, axis: 'e' | 'n' | 's' | 'w') {
  return (
    handle.startsWith('scale-') && handle.slice('scale-'.length).includes(axis)
  );
}

function normalizeDegrees(value: number): number {
  let next = value;
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  return next;
}
