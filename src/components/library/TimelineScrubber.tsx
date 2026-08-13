import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import { cn } from '@/shared/lib/utils';

export interface ScrubberMonth {
  bucket: string;
  top: number;
  height: number;
  label: string;
}

interface TimelineScrubberProps {
  months: ScrubberMonth[];
  totalHeight: number;
  scrollContainer: HTMLElement | null;
  onScrollTo: (offset: number) => void;
  className?: string;
}

const MIN_LABEL_GAP_PX = 40;

export function TimelineScrubber({
  months,
  totalHeight,
  scrollContainer,
  onScrollTo,
  className,
}: TimelineScrubberProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const trackHeight = trackRef.current?.clientHeight ?? 0;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [hoverInfo, setHoverInfo] = useState<{
    y: number;
    label: string;
  } | null>(null);

  useLayoutEffect(() => {
    const node = trackRef.current;
    if (!node) return;
    forceUpdate();
    const ro = new ResizeObserver(() => forceUpdate());
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!scrollContainer) return;
    const update = () => {
      setScrollTop(scrollContainer.scrollTop);
      setViewportHeight(scrollContainer.clientHeight);
    };
    update();
    scrollContainer.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scrollContainer);
    return () => {
      scrollContainer.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [scrollContainer]);

  const yearLabels = useMemo(
    () => buildYearLabels(months, trackHeight, totalHeight),
    [months, trackHeight, totalHeight],
  );

  const offsetToY = useCallback(
    (offset: number) => {
      if (totalHeight <= 0) return 0;
      return Math.min(trackHeight, (offset / totalHeight) * trackHeight);
    },
    [trackHeight, totalHeight],
  );

  const yToOffset = useCallback(
    (y: number) => {
      if (trackHeight <= 0) return 0;
      const ratio = Math.max(0, Math.min(1, y / trackHeight));
      return ratio * Math.max(0, totalHeight - viewportHeight);
    },
    [trackHeight, totalHeight, viewportHeight],
  );

  const labelForY = useCallback(
    (y: number) => {
      if (totalHeight <= 0 || months.length === 0) return '';
      const offset = (y / Math.max(1, trackHeight)) * totalHeight;
      const month = months.find(
        (m) => offset >= m.top && offset < m.top + m.height,
      );
      return month?.label ?? months[months.length - 1]?.label ?? '';
    },
    [months, totalHeight, trackHeight],
  );

  const draggingRef = useRef(false);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (totalHeight <= 0) return;
      draggingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = event.currentTarget.getBoundingClientRect();
      const y = event.clientY - rect.top;
      onScrollTo(yToOffset(y));
      setHoverInfo({ y, label: labelForY(y) });
    },
    [labelForY, onScrollTo, totalHeight, yToOffset],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (totalHeight <= 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const y = event.clientY - rect.top;
      setHoverInfo({ y, label: labelForY(y) });
      if (draggingRef.current) onScrollTo(yToOffset(y));
    },
    [labelForY, onScrollTo, totalHeight, yToOffset],
  );

  const handlePointerLeave = useCallback(() => {
    if (!draggingRef.current) setHoverInfo(null);
  }, []);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      draggingRef.current = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [],
  );

  if (months.length === 0 || totalHeight === 0) return null;

  const indicatorTop = offsetToY(scrollTop);
  const indicatorHeight = Math.max(
    16,
    offsetToY(scrollTop + viewportHeight) - indicatorTop,
  );

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Timeline"
      aria-valuemin={0}
      aria-valuemax={totalHeight}
      aria-valuenow={scrollTop}
      className={cn(
        'relative h-full w-14 shrink-0 cursor-ns-resize touch-none py-2 select-none',
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <div
        aria-hidden
        className="bg-border pointer-events-none absolute top-2 right-3 bottom-2 w-px"
      />
      {months.map((month) => (
        <span
          key={month.bucket}
          aria-hidden
          className="bg-foreground/40 absolute right-[10px] size-1.5 rounded-full"
          style={{ top: offsetToY(month.top + month.height / 2) }}
        />
      ))}
      {yearLabels.map((label) => (
        <span
          key={label.year}
          aria-hidden
          className="text-muted-foreground bg-background absolute right-5 -translate-y-1/2 px-1 text-[11px] font-medium tabular-nums"
          style={{ top: label.y }}
        >
          {label.year}
        </span>
      ))}
      <div
        aria-hidden
        className="bg-primary pointer-events-none absolute right-3 w-px"
        style={{ top: indicatorTop, height: Math.max(8, indicatorHeight) }}
      />
      {hoverInfo ? (
        <div
          aria-hidden
          className="bg-foreground text-background pointer-events-none absolute right-full mr-2 -translate-y-1/2 rounded px-2 py-1 text-xs whitespace-nowrap shadow"
          style={{ top: hoverInfo.y }}
        >
          {hoverInfo.label}
        </div>
      ) : null}
    </div>
  );
}

function buildYearLabels(
  months: ScrubberMonth[],
  trackHeight: number,
  totalHeight: number,
): Array<{ year: string; y: number }> {
  if (totalHeight <= 0 || trackHeight <= 0) return [];
  const seenYears = new Map<string, number>();
  for (const month of months) {
    const year = month.bucket.split('-')[0];
    if (!year) continue;
    const y = ((month.top + month.height / 2) / totalHeight) * trackHeight;
    if (!seenYears.has(year)) seenYears.set(year, y);
  }
  const sorted = [...seenYears.entries()].sort((a, b) => a[1] - b[1]);
  const result: Array<{ year: string; y: number }> = [];
  let lastY = -Infinity;
  for (const [year, y] of sorted) {
    if (y - lastY < MIN_LABEL_GAP_PX) continue;
    result.push({ year, y });
    lastY = y;
  }
  return result;
}
