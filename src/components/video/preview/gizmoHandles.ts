export type GizmoResizeHandle =
  | 'scale-e'
  | 'scale-n'
  | 'scale-ne'
  | 'scale-nw'
  | 'scale-s'
  | 'scale-se'
  | 'scale-sw'
  | 'scale-w';

export type GizmoHandle = GizmoResizeHandle | 'move' | 'rotate';

export interface GizmoBounds {
  cx: number;
  cy: number;
  h: number;
  rotation: number;
  w: number;
}

export interface GizmoHandlePoint {
  cursor: string;
  handle: GizmoResizeHandle;
  x: number;
  y: number;
}

export const GIZMO_HANDLE_HIT_SIZE = 18;
export const GIZMO_HANDLE_VISUAL_SIZE = 10;
export const GIZMO_ROTATION_OFFSET = 24;

export const GIZMO_RESIZE_HANDLES: readonly GizmoHandlePoint[] = [
  { cursor: 'nwse-resize', handle: 'scale-nw', x: -0.5, y: -0.5 },
  { cursor: 'ns-resize', handle: 'scale-n', x: 0, y: -0.5 },
  { cursor: 'nesw-resize', handle: 'scale-ne', x: 0.5, y: -0.5 },
  { cursor: 'ew-resize', handle: 'scale-e', x: 0.5, y: 0 },
  { cursor: 'nwse-resize', handle: 'scale-se', x: 0.5, y: 0.5 },
  { cursor: 'ns-resize', handle: 'scale-s', x: 0, y: 0.5 },
  { cursor: 'nesw-resize', handle: 'scale-sw', x: -0.5, y: 0.5 },
  { cursor: 'ew-resize', handle: 'scale-w', x: -0.5, y: 0 },
] as const;

export function gizmoHandlePosition(
  bounds: Pick<GizmoBounds, 'h' | 'w'>,
  point: Pick<GizmoHandlePoint, 'x' | 'y'>,
): { x: number; y: number } {
  return {
    x: point.x * bounds.w,
    y: point.y * bounds.h,
  };
}
