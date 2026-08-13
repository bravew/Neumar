import type { ReactNode } from 'react';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Edge = 'n' | 's' | 'e' | 'w';
type DragMode = 'move' | 'rotate' | `scale-${Corner | Edge}`;

const HANDLE_POSITIONS: Record<Corner | Edge, React.CSSProperties> = {
  nw: { top: -6, left: -6, cursor: 'nwse-resize' },
  ne: { top: -6, right: -6, cursor: 'nesw-resize' },
  sw: { bottom: -6, left: -6, cursor: 'nesw-resize' },
  se: { bottom: -6, right: -6, cursor: 'nwse-resize' },
  n: { top: -6, left: 'calc(50% - 6px)', cursor: 'ns-resize' },
  s: { bottom: -6, left: 'calc(50% - 6px)', cursor: 'ns-resize' },
  e: { right: -6, top: 'calc(50% - 6px)', cursor: 'ew-resize' },
  w: { left: -6, top: 'calc(50% - 6px)', cursor: 'ew-resize' },
};

export interface ClipTransformHandleLabels {
  /** Format string for scale handles — `{position}` is replaced with nw/ne/etc. */
  resize: string;
  rotate: string;
}

interface HandleProps {
  position: Corner | Edge;
  mode: DragMode;
  labels: ClipTransformHandleLabels;
  onDown: (event: React.PointerEvent<HTMLElement>, mode: DragMode) => void;
  onMove: (event: React.PointerEvent<HTMLElement>) => void;
  onUp: (event: React.PointerEvent<HTMLElement>) => void;
}

export function ScaleHandle({
  position,
  mode,
  labels,
  onDown,
  onMove,
  onUp,
}: HandleProps) {
  return (
    <span
      role="button"
      aria-label={labels.resize.replace('{position}', position)}
      className="bg-primary pointer-events-auto absolute size-3 rounded-sm border border-white shadow"
      style={HANDLE_POSITIONS[position]}
      onPointerDown={(e) => onDown(e, mode)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
}

interface RotationHandleProps {
  labels: ClipTransformHandleLabels;
  onDown: (event: React.PointerEvent<HTMLElement>, mode: DragMode) => void;
  onMove: (event: React.PointerEvent<HTMLElement>) => void;
  onUp: (event: React.PointerEvent<HTMLElement>) => void;
}

export function RotationHandle({
  labels,
  onDown,
  onMove,
  onUp,
}: RotationHandleProps) {
  return (
    <span
      role="button"
      aria-label={labels.rotate}
      className="bg-primary pointer-events-auto absolute size-3 rounded-full border border-white shadow"
      style={{ top: -28, left: 'calc(50% - 6px)', cursor: 'grab' }}
      onPointerDown={(e) => onDown(e, 'rotate')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
}

export type { Corner, Edge, DragMode };

export function withHandles(
  corners: ReadonlyArray<Corner>,
  edges: ReadonlyArray<Edge>,
  handlers: Omit<HandleProps, 'position' | 'mode'>,
): ReactNode {
  return (
    <>
      {corners.map((c) => (
        <ScaleHandle
          key={c}
          position={c}
          mode={`scale-${c}` as DragMode}
          {...handlers}
        />
      ))}
      {edges.map((e) => (
        <ScaleHandle
          key={e}
          position={e}
          mode={`scale-${e}` as DragMode}
          {...handlers}
        />
      ))}
    </>
  );
}
