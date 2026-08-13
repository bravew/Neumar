import { useEffect, useMemo, useRef, useState } from 'react';

import {
  Eraser,
  Highlighter,
  Minus,
  MousePointer2,
  PenLine,
  RotateCcw,
  Save,
  Type,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { postDesignSketch, readDesignFile } from '@/shared/hooks/useDesignMode';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { useTheme } from '@/shared/providers/theme-provider';

import { resolveDefaultSketchToolColor } from './sketch-colors';

type SketchTool = 'select' | 'pen' | 'highlight' | 'line' | 'text' | 'eraser';

interface SketchPoint {
  x: number;
  y: number;
}

interface SketchStroke {
  tool: SketchTool;
  color: string;
  width: number;
  points: SketchPoint[];
}

interface SketchDocument {
  strokes: SketchStroke[];
}

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const MIN_SAVE_MS = 500;
const SAVED_FEEDBACK_MS = 1400;

export function SketchEditor({
  projectId,
  screenId,
  onDirtyChange,
}: {
  projectId: string;
  screenId: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useLanguage();
  const { resolvedTheme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const savedTimerRef = useRef<number | null>(null);
  const [tool, setTool] = useState<SketchTool>('pen');
  const [strokes, setStrokes] = useState<SketchStroke[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  const tools = useMemo(
    () => [
      {
        id: 'select' as const,
        icon: MousePointer2,
        label: t.design.sketchToolSelect,
      },
      { id: 'pen' as const, icon: PenLine, label: t.design.sketchToolPen },
      {
        id: 'highlight' as const,
        icon: Highlighter,
        label: t.design.sketchToolHighlight,
      },
      { id: 'line' as const, icon: Minus, label: t.design.sketchToolLine },
      { id: 'text' as const, icon: Type, label: t.design.sketchToolText },
      { id: 'eraser' as const, icon: Eraser, label: t.design.sketchToolEraser },
    ],
    [t],
  );

  useEffect(() => {
    let cancelled = false;
    readDesignFile(projectId, `sketches/${screenId}.json`)
      .then((file) => {
        if (cancelled) return;
        const parsed = JSON.parse(file.content) as {
          document?: SketchDocument;
        };
        setStrokes(parsed.document?.strokes ?? []);
        setDirty(false);
      })
      .catch(() => {
        if (cancelled) return;
        setStrokes([]);
        setDirty(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, screenId]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokes) {
      drawStroke(ctx, stroke);
    }
  }, [strokes]);

  const saveSketch = async () => {
    setSaving(true);
    setSavedFeedback(false);
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
    try {
      await Promise.all([
        postDesignSketch(projectId, {
          screenId,
          document: { strokes },
        }),
        wait(MIN_SAVE_MS),
      ]);
      setDirty(false);
      setSavedFeedback(true);
      savedTimerRef.current = window.setTimeout(() => {
        setSavedFeedback(false);
        savedTimerRef.current = null;
      }, SAVED_FEEDBACK_MS);
    } finally {
      setSaving(false);
    }
  };

  const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'select' || tool === 'text') return;
    const point = pointFromEvent(event);
    drawingRef.current = true;
    if (tool === 'eraser') {
      setStrokes((prev) => prev.slice(0, -1));
      setDirty(true);
      return;
    }
    const next: SketchStroke = {
      tool,
      color:
        tool === 'highlight'
          ? resolveDefaultSketchToolColor('highlight', resolvedTheme)
          : resolveDefaultSketchToolColor(
              tool === 'line' ? 'line' : 'pen',
              resolvedTheme,
            ),
      width: tool === 'highlight' ? 18 : 4,
      points: [point],
    };
    setStrokes((prev) => [...prev, next]);
    setDirty(true);
  };

  const continueStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || tool === 'eraser') return;
    const point = pointFromEvent(event);
    setStrokes((prev) => {
      const last = prev.at(-1);
      if (!last) return prev;
      return [
        ...prev.slice(0, -1),
        { ...last, points: [...last.points, point] },
      ];
    });
  };

  const endStroke = () => {
    drawingRef.current = false;
  };

  return (
    <div className="bg-background relative h-[640px] rounded-md border">
      <div className="bg-background absolute top-3 left-3 z-10 flex flex-col gap-1 rounded-md border p-1 shadow-sm">
        {tools.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.id}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={item.label}
              data-active={tool === item.id}
              className={cn(
                'data-[active=true]:bg-primary data-[active=true]:text-primary-foreground',
              )}
              onClick={() => setTool(item.id)}
            >
              <Icon className="size-4" />
            </Button>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t.design.sketchUndo}
          onClick={() => {
            setStrokes((prev) => prev.slice(0, -1));
            setDirty(true);
          }}
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <span className="bg-background rounded-md border px-2 py-1 text-xs shadow-sm">
          {dirty ? t.design.sketchDirty : t.design.sketchSaved}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={saving || (!dirty && !savedFeedback)}
          onClick={saveSketch}
        >
          <Save className="size-4" />
          {saving
            ? t.design.saving
            : savedFeedback
              ? t.design.sketchSaved
              : t.design.sketchSave}
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        onPointerDown={startStroke}
        onPointerMove={continueStroke}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      />
    </div>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
    y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
  };
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: SketchStroke) {
  if (stroke.points.length === 0) return;
  ctx.globalAlpha = stroke.tool === 'highlight' ? 0.45 : 1;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  if (stroke.tool === 'line' && stroke.points.length > 1) {
    const last = stroke.points.at(-1)!;
    ctx.lineTo(last.x, last.y);
  } else {
    for (const point of stroke.points.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
