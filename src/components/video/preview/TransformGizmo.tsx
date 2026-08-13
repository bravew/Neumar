import type { PointerEvent } from 'react';

import {
  GIZMO_HANDLE_HIT_SIZE,
  GIZMO_HANDLE_VISUAL_SIZE,
  GIZMO_RESIZE_HANDLES,
  GIZMO_ROTATION_OFFSET,
  gizmoHandlePosition,
  type GizmoBounds,
  type GizmoHandle,
  type GizmoResizeHandle,
} from './gizmoHandles';

const RESIZE_HANDLE_TITLE_POSITION: Record<GizmoResizeHandle, string> = {
  'scale-e': 'E',
  'scale-n': 'N',
  'scale-ne': 'NE',
  'scale-nw': 'NW',
  'scale-s': 'S',
  'scale-se': 'SE',
  'scale-sw': 'SW',
  'scale-w': 'W',
};

interface TransformGizmoProps {
  bounds: GizmoBounds;
  labels: {
    move: string;
    resize: string;
    rotate: string;
  };
  onHandlePointerDown: (
    event: PointerEvent<SVGElement>,
    handle: GizmoHandle,
  ) => void;
}

export function TransformGizmo({
  bounds,
  labels,
  onHandlePointerDown,
}: TransformGizmoProps) {
  const rotateY = -bounds.h / 2 - GIZMO_ROTATION_OFFSET;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-20 size-full overflow-visible"
      aria-hidden="true"
    >
      <g
        transform={`translate(${bounds.cx} ${bounds.cy}) rotate(${bounds.rotation})`}
      >
        <rect
          data-gizmo-handle="move"
          x={-bounds.w / 2}
          y={-bounds.h / 2}
          width={bounds.w}
          height={bounds.h}
          fill="transparent"
          stroke="var(--primary)"
          strokeDasharray="7 5"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          className="pointer-events-auto cursor-move"
          onPointerDown={(event) => onHandlePointerDown(event, 'move')}
        >
          <title>{labels.move}</title>
        </rect>
        <line
          x1={0}
          y1={-bounds.h / 2}
          x2={0}
          y2={rotateY}
          stroke="var(--primary)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {GIZMO_RESIZE_HANDLES.map((point) => {
          const position = gizmoHandlePosition(bounds, point);
          const title = formatResizeHandleTitle(labels.resize, point.handle);
          return (
            <g
              key={point.handle}
              data-gizmo-handle={point.handle}
              className="pointer-events-auto"
              style={{ cursor: point.cursor }}
              onPointerDown={(event) =>
                onHandlePointerDown(event, point.handle)
              }
            >
              <circle
                cx={position.x}
                cy={position.y}
                r={GIZMO_HANDLE_HIT_SIZE / 2}
                fill="transparent"
              >
                <title>{title}</title>
              </circle>
              <rect
                x={position.x - GIZMO_HANDLE_VISUAL_SIZE / 2}
                y={position.y - GIZMO_HANDLE_VISUAL_SIZE / 2}
                width={GIZMO_HANDLE_VISUAL_SIZE}
                height={GIZMO_HANDLE_VISUAL_SIZE}
                rx={2}
                fill="var(--background)"
                stroke="var(--primary)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
        <g
          data-gizmo-handle="rotate"
          className="pointer-events-auto cursor-grab"
          onPointerDown={(event) => onHandlePointerDown(event, 'rotate')}
        >
          <circle
            cx={0}
            cy={rotateY}
            r={GIZMO_HANDLE_HIT_SIZE / 2}
            fill="transparent"
          >
            <title>{labels.rotate}</title>
          </circle>
          <circle
            cx={0}
            cy={rotateY}
            r={GIZMO_HANDLE_VISUAL_SIZE / 2}
            fill="var(--background)"
            stroke="var(--primary)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </g>
    </svg>
  );
}

function formatResizeHandleTitle(
  template: string,
  handle: GizmoResizeHandle,
): string {
  const position = RESIZE_HANDLE_TITLE_POSITION[handle];
  return template.includes('{position}')
    ? template.replace('{position}', position)
    : `${template} ${position}`;
}
