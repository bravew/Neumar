import { Fragment, useId, useMemo } from 'react';

type PreviewPoint = { x: number; y: number };

export type SketchPreviewItem =
  | {
      kind: 'stroke';
      color: string;
      opacity: number;
      points: PreviewPoint[];
      width: number;
    }
  | {
      kind: 'rect';
      color: string;
      opacity: number;
      width: number;
      x: number;
      y: number;
      w: number;
      h: number;
    }
  | {
      kind: 'line';
      color: string;
      opacity: number;
      width: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    };

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const VIEWBOX_PADDING = 32;
const MAX_ABS_COORDINATE = 100_000;
const MAX_STROKE_WIDTH = 256;
const DEFAULT_COLOR = '#2563EB';

export function SketchPreview({
  content,
  testId,
}: {
  content: string;
  testId?: string;
}) {
  const items = useMemo(() => parseSketchPreviewDocument(content), [content]);
  const geometry = useMemo(() => computeSketchPreviewGeometry(items), [items]);
  const reactId = useId();
  const gridPatternId = `neuma-sketch-preview-grid-${reactId.replace(/:/g, '')}`;

  return (
    <div className="bg-muted/20 flex h-full min-h-[420px] items-center justify-center overflow-auto rounded-md border p-4">
      <svg
        viewBox={`${geometry.x} ${geometry.y} ${geometry.width} ${geometry.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full max-h-[70vh] w-full max-w-full rounded-md border bg-white"
        aria-hidden="true"
        data-testid={testId}
      >
        <defs>
          <pattern
            id={gridPatternId}
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 24 0 L 0 0 0 24"
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect
          x={geometry.x}
          y={geometry.y}
          width={geometry.width}
          height={geometry.height}
          fill="#ffffff"
        />
        <rect
          x={geometry.x}
          y={geometry.y}
          width={geometry.width}
          height={geometry.height}
          fill={`url(#${gridPatternId})`}
        />
        {items.length > 0 ? (
          items.map((item, index) => (
            <Fragment key={`${item.kind}-${index}`}>
              {renderSketchPreviewItem(item, index)}
            </Fragment>
          ))
        ) : (
          <g stroke="#cbd5e1" strokeWidth="4" strokeLinecap="round" fill="none">
            <path d="M 440 320 H 840" />
            <path d="M 520 390 H 760" />
          </g>
        )}
      </svg>
    </div>
  );
}

export function parseSketchPreviewDocument(
  content: string,
): SketchPreviewItem[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) return [];
    const document = isRecord(parsed.document) ? parsed.document : parsed;
    if (Array.isArray(document.strokes)) {
      return document.strokes.flatMap((item) => {
        const normalized = normalizeNeumaStroke(item);
        return normalized ? [normalized] : [];
      });
    }
    if (Array.isArray(document.items)) {
      return document.items.flatMap((item) => {
        const normalized = normalizeSketchItem(item);
        return normalized ? [normalized] : [];
      });
    }
    return [];
  } catch {
    return [];
  }
}

export function computeSketchPreviewGeometry(items: SketchPreviewItem[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const include = (x: number, y: number, padding: number) => {
    minX = Math.min(minX, x - padding);
    minY = Math.min(minY, y - padding);
    maxX = Math.max(maxX, x + padding);
    maxY = Math.max(maxY, y + padding);
  };

  for (const item of items) {
    if (item.kind === 'stroke') {
      const padding = Math.max(1, item.width / 2);
      for (const point of item.points) include(point.x, point.y, padding);
      continue;
    }
    if (item.kind === 'line') {
      const padding = Math.max(1, item.width / 2);
      include(item.x1, item.y1, padding);
      include(item.x2, item.y2, padding);
      continue;
    }
    const padding = Math.max(1, item.width / 2);
    include(
      Math.min(item.x, item.x + item.w),
      Math.min(item.y, item.y + item.h),
      padding,
    );
    include(
      Math.max(item.x, item.x + item.w),
      Math.max(item.y, item.y + item.h),
      padding,
    );
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }

  const x = Math.min(0, minX - VIEWBOX_PADDING);
  const y = Math.min(0, minY - VIEWBOX_PADDING);
  return {
    x,
    y,
    width: Math.max(DEFAULT_WIDTH, maxX + VIEWBOX_PADDING - x),
    height: Math.max(DEFAULT_HEIGHT, maxY + VIEWBOX_PADDING - y),
  };
}

function renderSketchPreviewItem(item: SketchPreviewItem, index: number) {
  const stroke = {
    stroke: item.color,
    strokeWidth: item.width,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
    opacity: item.opacity,
  };
  if (item.kind === 'stroke') {
    if (item.points.length === 0) return null;
    if (item.points.length === 1) {
      const point = item.points[0]!;
      return (
        <circle
          data-sketch-item={index}
          cx={point.x}
          cy={point.y}
          r={Math.max(1, item.width / 2)}
          fill={item.color}
          opacity={item.opacity}
        />
      );
    }
    const d = item.points
      .map(
        (point, pointIndex) =>
          `${pointIndex === 0 ? 'M' : 'L'} ${point.x} ${point.y}`,
      )
      .join(' ');
    return <path data-sketch-item={index} d={d} {...stroke} />;
  }
  if (item.kind === 'line') {
    return (
      <path
        data-sketch-item={index}
        d={`M ${item.x1} ${item.y1} L ${item.x2} ${item.y2}`}
        {...stroke}
      />
    );
  }
  return (
    <rect
      data-sketch-item={index}
      x={Math.min(item.x, item.x + item.w)}
      y={Math.min(item.y, item.y + item.h)}
      width={Math.abs(item.w)}
      height={Math.abs(item.h)}
      {...stroke}
    />
  );
}

function normalizeNeumaStroke(value: unknown): SketchPreviewItem | null {
  if (!isRecord(value) || !Array.isArray(value.points)) return null;
  const points = value.points.flatMap((point) => {
    const normalized = normalizePoint(point);
    return normalized ? [normalized] : [];
  });
  if (points.length === 0) return null;
  const tool = typeof value.tool === 'string' ? value.tool : 'pen';
  if (tool === 'line' && points.length > 1) {
    const first = points[0]!;
    const last = points.at(-1)!;
    return {
      kind: 'line',
      color: normalizeColor(value.color),
      opacity: 1,
      width: normalizeWidth(value.width),
      x1: first.x,
      y1: first.y,
      x2: last.x,
      y2: last.y,
    };
  }
  return {
    kind: 'stroke',
    color: normalizeColor(value.color),
    opacity: tool === 'highlight' ? 0.45 : 1,
    points,
    width: normalizeWidth(value.width),
  };
}

function normalizeSketchItem(value: unknown): SketchPreviewItem | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'pen') {
    if (!Array.isArray(value.points)) return null;
    const points = value.points.flatMap((point) => {
      const normalized = normalizePoint(point);
      return normalized ? [normalized] : [];
    });
    return points.length
      ? {
          kind: 'stroke',
          color: normalizeColor(value.color),
          opacity: 1,
          points,
          width: normalizeWidth(value.size),
        }
      : null;
  }
  if (value.kind === 'rect') {
    return {
      kind: 'rect',
      color: normalizeColor(value.color),
      opacity: 1,
      width: normalizeWidth(value.size),
      x: normalizeNumber(value.x),
      y: normalizeNumber(value.y),
      w: normalizeNumber(value.w),
      h: normalizeNumber(value.h),
    };
  }
  if (value.kind === 'arrow') {
    return {
      kind: 'line',
      color: normalizeColor(value.color),
      opacity: 1,
      width: normalizeWidth(value.size),
      x1: normalizeNumber(value.x1),
      y1: normalizeNumber(value.y1),
      x2: normalizeNumber(value.x2),
      y2: normalizeNumber(value.y2),
    };
  }
  return null;
}

function normalizePoint(value: unknown): PreviewPoint | null {
  if (!isRecord(value)) return null;
  return { x: normalizeNumber(value.x), y: normalizeNumber(value.y) };
}

function normalizeNumber(value: unknown): number {
  const number =
    typeof value === 'number' || typeof value === 'string' ? Number(value) : 0;
  if (!Number.isFinite(number)) return 0;
  return Math.max(-MAX_ABS_COORDINATE, Math.min(MAX_ABS_COORDINATE, number));
}

function normalizeWidth(value: unknown): number {
  const number = normalizeNumber(value);
  return Math.max(1, Math.min(MAX_STROKE_WIDTH, number || 1));
}

function normalizeColor(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : DEFAULT_COLOR;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
