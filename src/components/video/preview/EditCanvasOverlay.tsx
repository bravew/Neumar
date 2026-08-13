import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoClipTransform, VideoProject } from '@/shared/types/video';

import { useTimelineEditorStore } from '../timeline/useTimelineEditorStore';
import {
  getOverlayLayerBounds,
  getVisualTimelineClipMap,
  hitTestOverlayLayers,
  normalizeTransform,
  snapTransformForDrag,
  transformForDrag,
  type EditCanvasDragState,
} from './EditCanvasOverlayModel';
import type { GizmoHandle } from './gizmoHandles';
import type { RemotionPreviewData } from './remotionPreviewData';
import { SnapGuides } from './SnapGuides';
import { TransformGizmo } from './TransformGizmo';
import type { PreviewSnapGuide } from './webcodecs/previewSnap';
import type {
  PreviewViewportGeometry,
  PreviewViewportPoint,
} from './webcodecs/previewViewport';

interface EditCanvasOverlayProps {
  data: RemotionPreviewData;
  frame: number;
  project: VideoProject;
  transformOverrides: Record<string, VideoClipTransform>;
  viewport: PreviewViewportGeometry;
  onPanByScreenDelta: (delta: PreviewViewportPoint) => void;
  onTransformPreview: (
    clipId: string,
    transform: VideoClipTransform | null,
  ) => void;
  onWheelZoom: (point: PreviewViewportPoint, factor: number) => void;
}

interface PanState {
  clientX: number;
  clientY: number;
  pointerId: number;
}

const WHEEL_ZOOM_FACTOR = 1.25;

export function EditCanvasOverlay({
  data,
  frame,
  project,
  transformOverrides,
  viewport,
  onPanByScreenDelta,
  onTransformPreview,
  onWheelZoom,
}: EditCanvasOverlayProps) {
  const { t } = useLanguage();
  const timeline = useTimelineEditorStore((state) => state.timeline);
  const selectedClipIds = useTimelineEditorStore(
    (state) => state.selectedClipIds,
  );
  const selectClip = useTimelineEditorStore((state) => state.selectClip);
  const setSelectedVisualClipTransform = useTimelineEditorStore(
    (state) => state.setSelectedVisualClipTransform,
  );
  const [snapGuides, setSnapGuides] = useState<PreviewSnapGuide[]>([]);
  const dragRef = useRef<EditCanvasDragState | null>(null);
  const panRef = useRef<PanState | null>(null);

  const timelineClips = useMemo(
    () => getVisualTimelineClipMap(timeline),
    [timeline],
  );
  const layers = useMemo(
    () =>
      getOverlayLayerBounds({
        data,
        frame,
        project,
        timelineClips,
        transformOverrides,
        viewport,
      }),
    [data, frame, project, timelineClips, transformOverrides, viewport],
  );
  const selectedLayer =
    layers.find((layer) => selectedClipIds.has(layer.clipId)) ?? null;

  const handleOverlayPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button === 1) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        panRef.current = {
          clientX: event.clientX,
          clientY: event.clientY,
          pointerId: event.pointerId,
        };
        return;
      }
      if (event.button !== 0 || event.target !== event.currentTarget) return;
      const hit = hitTestOverlayLayers(layers, eventPointToOverlay(event));
      if (!hit) return;
      event.preventDefault();
      setSnapGuides([]);
      selectClip(hit.clipId, { mode: event.shiftKey ? 'toggle' : 'replace' });
    },
    [layers, selectClip],
  );

  const beginDrag = useCallback(
    (event: ReactPointerEvent<SVGElement>, handle: GizmoHandle) => {
      if (!selectedLayer) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setSnapGuides([]);
      const startTransform = normalizeTransform(
        transformOverrides[selectedLayer.clipId] ??
          selectedLayer.clip.transform,
      );
      const svgRect =
        event.currentTarget.ownerSVGElement?.getBoundingClientRect();
      const startCenterClientX = (svgRect?.left ?? 0) + selectedLayer.bounds.cx;
      const startCenterClientY = (svgRect?.top ?? 0) + selectedLayer.bounds.cy;
      dragRef.current = {
        clipId: selectedLayer.clipId,
        handle,
        latestTransform: startTransform,
        pointerId: event.pointerId,
        startBounds: selectedLayer.bounds,
        startCenterClientX,
        startCenterClientY,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startRotationAngle: Math.atan2(
          event.clientY - startCenterClientY,
          event.clientX - startCenterClientX,
        ),
        startTransform,
      };
    },
    [selectedLayer, transformOverrides],
  );

  const updateDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pan = panRef.current;
      if (pan?.pointerId === event.pointerId) {
        onPanByScreenDelta({
          x: event.clientX - pan.clientX,
          y: event.clientY - pan.clientY,
        });
        pan.clientX = event.clientX;
        pan.clientY = event.clientY;
        return;
      }
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const nextRaw = transformForDrag({
        drag,
        event: {
          clientX: event.clientX,
          clientY: event.clientY,
          shiftKey: event.shiftKey,
        },
        viewport,
      });
      const { guides, transform: next } = snapTransformForDrag({
        drag,
        event: { shiftKey: event.shiftKey },
        transform: nextRaw,
        viewport,
      });
      setSnapGuides(guides);
      drag.latestTransform = next;
      onTransformPreview(drag.clipId, next);
    },
    [onPanByScreenDelta, onTransformPreview, viewport],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Release the pan capture taken on this element (the gizmo-handle drag
      // captures on the SVG handle and is released implicitly on pointerup).
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (panRef.current?.pointerId === event.pointerId) {
        panRef.current = null;
        setSnapGuides([]);
        return;
      }
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setSnapGuides([]);
      // Commit to the editor store (one undo entry), then drop the live
      // override so the preview renders from the committed store value — the
      // single source of truth that undo/redo mutates. Keeping the override
      // would shadow the store and make undo look like a no-op.
      setSelectedVisualClipTransform(drag.latestTransform);
      onTransformPreview(drag.clipId, null);
    },
    [onTransformPreview, setSelectedVisualClipTransform],
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      onWheelZoom(
        eventPointToOverlay(event),
        event.deltaY > 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR,
      );
    },
    [onWheelZoom],
  );

  return (
    <div
      className="absolute inset-0 z-20 touch-none"
      data-edit-canvas-guides={snapGuides
        .map((guide) => `${guide.axis}:${guide.position}`)
        .join(',')}
      data-edit-canvas-layer-ids={layers.map((layer) => layer.clipId).join(',')}
      data-edit-canvas-scale={String(viewport.scale)}
      data-edit-canvas-selected-ids={[...selectedClipIds].join(',')}
      onPointerDown={handleOverlayPointerDown}
      onPointerMove={updateDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={handleWheel}
    >
      <SnapGuides guides={snapGuides} viewport={viewport} />
      {selectedLayer ? (
        <TransformGizmo
          bounds={selectedLayer.bounds}
          labels={{
            move: t.video.editor.clipInspector.canvasMove,
            resize: t.video.editor.clipInspector.canvasResize,
            rotate: t.video.editor.clipInspector.canvasRotate,
          }}
          onHandlePointerDown={beginDrag}
        />
      ) : null}
    </div>
  );
}

function eventPointToOverlay(
  event: ReactPointerEvent<HTMLElement> | ReactWheelEvent<HTMLElement>,
): PreviewViewportPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}
