import { useCallback, useEffect, useRef } from 'react';

import { Trash2 } from 'lucide-react';

import type { VideoSubtitleStyle } from '@/shared/types/video';

import type { CanvasBounds, CaptionLike } from './captionOverlayTypes';
import {
  DEFAULT_FONT_SIZE,
  SNAP_TOLERANCE,
  SNAP_X,
  SNAP_Y,
} from './captionOverlayTypes';

export interface CaptionBoxLabels {
  resize: string;
  delete: string;
}

interface CaptionBoxProps {
  caption: CaptionLike;
  bounds: CanvasBounds;
  active: boolean;
  editing: boolean;
  labels: CaptionBoxLabels;
  onActivate: () => void;
  onStartEdit: () => void;
  onFinishEdit: () => void;
  onPatch: (patch: { text?: string; style?: VideoSubtitleStyle }) => void;
  onDelete?: () => void;
}

interface DragState {
  pointerId: number;
  mode: 'move' | 'resize';
  startClientX: number;
  startClientY: number;
  startStyle: VideoSubtitleStyle;
}

/** Build a CSS `text-shadow` value from the canvas-relative shadow fields.
 * Offsets/blur are stored against a 1080 reference height so the rendered
 * shadow scales with the preview's actual height. */
function buildTextShadow(
  style: VideoSubtitleStyle,
  pxHeight: number,
): string | undefined {
  const color = style.shadowColor;
  const offX = style.shadowOffsetX ?? 0;
  const offY = style.shadowOffsetY ?? 0;
  const blur = style.shadowBlur ?? 0;
  if (!color || (offX === 0 && offY === 0 && blur === 0)) return undefined;
  const scale = pxHeight / 1080;
  return `${(offX * scale).toFixed(2)}px ${(offY * scale).toFixed(2)}px ${(blur * scale).toFixed(2)}px ${color}`;
}

export function CaptionBox({
  caption,
  bounds,
  active,
  editing,
  labels,
  onActivate,
  onStartEdit,
  onFinishEdit,
  onPatch,
  onDelete,
}: CaptionBoxProps) {
  const style = caption.style ?? {};
  // Defaults match the Remotion preview's Caption layout exactly so the
  // editable box sits on top of the rendered text. If these drift, the user
  // sees the caption in one place and grabs invisible handles in another.
  const cx = style.positionX ?? 0.5;
  const cy =
    style.positionY ??
    (style.position === 'top' ? 0.1 : style.position === 'middle' ? 0.5 : 0.85);
  const maxW = style.maxWidth ?? 0.8;
  const fontSize = style.fontSize ?? DEFAULT_FONT_SIZE;
  const fontPx = (fontSize / 1080) * bounds.height;

  const dragRef = useRef<DragState | null>(null);
  const editRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const el = editRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = (event.clientX - drag.startClientX) / bounds.width;
      const deltaY = (event.clientY - drag.startClientY) / bounds.height;
      if (drag.mode === 'move') {
        let nx = (drag.startStyle.positionX ?? 0.5) + deltaX;
        let ny = (drag.startStyle.positionY ?? 0.82) + deltaY;
        if (!event.shiftKey) {
          for (const s of SNAP_X) {
            if (Math.abs(nx - s) < SNAP_TOLERANCE) nx = s;
          }
          for (const s of SNAP_Y) {
            if (Math.abs(ny - s) < SNAP_TOLERANCE) ny = s;
          }
        }
        nx = Math.max(0, Math.min(1, nx));
        ny = Math.max(0, Math.min(1, ny));
        onPatch({
          style: { ...drag.startStyle, positionX: nx, positionY: ny },
        });
      } else {
        const baseWidth = drag.startStyle.maxWidth ?? 0.8;
        const baseFont = drag.startStyle.fontSize ?? DEFAULT_FONT_SIZE;
        const nextWidth = Math.max(0.1, Math.min(1, baseWidth + deltaX * 2));
        const scale = nextWidth / baseWidth;
        const nextFont = Math.max(
          8,
          Math.min(160, Math.round(baseFont * scale)),
        );
        onPatch({
          style: {
            ...drag.startStyle,
            maxWidth: nextWidth,
            fontSize: nextFont,
          },
        });
      }
    },
    [bounds.height, bounds.width, onPatch],
  );

  const handlePointerDown = (
    event: React.PointerEvent<HTMLElement>,
    mode: DragState['mode'],
  ) => {
    if (editing) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onActivate();
    dragRef.current = {
      pointerId: event.pointerId,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startStyle: {
        ...style,
        positionX: cx,
        positionY: cy,
        maxWidth: maxW,
        fontSize,
      },
    };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  const left = bounds.x + cx * bounds.width;
  const top = bounds.y + cy * bounds.height;
  const widthPx = maxW * bounds.width;

  return (
    <div
      className="pointer-events-auto absolute"
      style={{
        left,
        top,
        width: widthPx,
        transform: 'translateX(-50%)',
        // Keep the idle outline visible enough to find on busy backgrounds
        // (the previous 1px dashed white-40% disappeared on bright frames).
        outline: active
          ? '2px solid rgb(59 130 246)'
          : '2px dashed rgba(59,130,246,0.65)',
        outlineOffset: '3px',
        borderRadius: 4,
        zIndex: 5,
      }}
      onPointerDown={(e) => handlePointerDown(e, 'move')}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartEdit();
      }}
    >
      <div
        ref={editRef}
        contentEditable={editing}
        suppressContentEditableWarning
        onBlur={(e) => {
          onFinishEdit();
          const next = e.currentTarget.textContent ?? '';
          if (next !== caption.text) onPatch({ text: next });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
          }
        }}
        className="block rounded px-3 py-1.5 leading-tight font-semibold text-white shadow-lg outline-none"
        style={{
          fontFamily: style.fontFamily,
          fontSize: `${fontPx}px`,
          color: style.color,
          background: style.background ?? 'rgba(0,0,0,0.7)',
          textAlign: style.textAlign ?? 'center',
          fontWeight: style.fontWeight ?? 700,
          fontStyle: style.fontStyle ?? 'normal',
          textDecoration: style.textDecoration ?? 'none',
          textShadow: buildTextShadow(style, bounds.height),
          WebkitTextStrokeColor: style.strokeColor,
          WebkitTextStrokeWidth:
            style.strokeWidth && style.strokeWidth > 0
              ? `${(style.strokeWidth / 1080) * bounds.height}px`
              : undefined,
          cursor: editing ? 'text' : 'grab',
        }}
      >
        {caption.text}
      </div>
      {active && !editing ? (
        <>
          <span
            role="button"
            aria-label={labels.resize}
            className="bg-primary absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-full border border-white shadow"
            onPointerDown={(e) => handlePointerDown(e, 'resize')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
          {onDelete ? (
            <button
              type="button"
              aria-label={labels.delete}
              className="text-destructive bg-background absolute -top-2 -right-2 grid size-5 place-items-center rounded-full border shadow"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="size-3" />
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
