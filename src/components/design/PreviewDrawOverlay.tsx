import { useEffect, useRef, useState, type PointerEvent } from 'react';

import { Eraser, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DrawStroke } from '@/shared/types/design-mode';
import { randomUUID } from '@/shared/utils/uuid';

interface PreviewDrawOverlayProps {
  labels: {
    clear: string;
    sendToChat: string;
    strokeCount: string;
  };
  onSubmit: (
    strokes: DrawStroke[],
    viewport: { width: number; height: number; scale: number },
  ) => Promise<void> | void;
  onCanvasRef?: (canvas: HTMLCanvasElement | null) => void;
}

export function PreviewDrawOverlay({
  labels,
  onSubmit,
  onCanvasRef,
}: PreviewDrawOverlayProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeStrokeRef = useRef<DrawStroke | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [strokes, setStrokes] = useState<DrawStroke[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const update = () =>
      setSize({
        width: Math.max(1, Math.round(node.clientWidth)),
        height: Math.max(1, Math.round(node.clientHeight)),
      });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    for (const stroke of strokes) drawStroke(ctx, stroke);
  }, [size, strokes]);

  const pointFromEvent = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(event.clientX - rect.left),
      y: Math.round(event.clientY - rect.top),
      pressure: event.pressure || undefined,
    };
  };

  const startStroke = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const stroke: DrawStroke = {
      id: randomUUID(),
      pointerType: normalizePointerType(event.pointerType),
      color: '#2563eb',
      width: event.pointerType === 'mouse' ? 3 : 4,
      points: [pointFromEvent(event)],
    };
    activeStrokeRef.current = stroke;
    setStrokes((prev) => [...prev, stroke]);
  };

  const extendStroke = (event: PointerEvent<HTMLCanvasElement>) => {
    const active = activeStrokeRef.current;
    if (!active) return;
    const point = pointFromEvent(event);
    setStrokes((prev) =>
      prev.map((stroke) =>
        stroke.id === active.id
          ? { ...stroke, points: [...stroke.points, point] }
          : stroke,
      ),
    );
  };

  const endStroke = () => {
    activeStrokeRef.current = null;
  };

  const submit = async () => {
    if (strokes.length === 0) return;
    setSubmitting(true);
    try {
      await onSubmit(strokes, {
        width: size.width,
        height: size.height,
        scale: window.devicePixelRatio || 1,
      });
      setStrokes([]);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-10"
      style={{ touchAction: 'none' }}
    >
      <canvas
        ref={(node) => {
          canvasRef.current = node;
          onCanvasRef?.(node);
        }}
        aria-label={labels.strokeCount.replace(
          '{count}',
          String(strokes.length),
        )}
        className="absolute inset-0 size-full cursor-crosshair"
        onPointerDown={startStroke}
        onPointerMove={extendStroke}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      />
      <div className="bg-background/95 absolute right-3 bottom-3 flex items-center gap-2 rounded-md border p-2 shadow-sm">
        <span className="text-muted-foreground text-xs">
          {labels.strokeCount.replace('{count}', String(strokes.length))}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={labels.clear}
          onClick={() => setStrokes([])}
        >
          <Eraser className="size-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={submitting || strokes.length === 0}
          onClick={() => void submit()}
        >
          <Send className="size-4" />
          {labels.sendToChat}
        </Button>
      </div>
    </div>
  );
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: DrawStroke) {
  if (stroke.points.length === 0) return;
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
  for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
  ctx.restore();
}

function normalizePointerType(value: string): DrawStroke['pointerType'] {
  return value === 'pen' || value === 'touch' ? value : 'mouse';
}
