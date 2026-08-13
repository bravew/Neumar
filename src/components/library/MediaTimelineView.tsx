import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { MediaGridItem } from './MediaGridView';
import { groupByMonth } from './mediaTimelineGrouping';
import {
  DAY_HEADER_HEIGHT,
  layoutDay,
  MonthBlock,
  MONTH_HEADER_HEIGHT,
  type DayLayout,
  type MonthLayout,
  type TimelineLayout,
} from './MediaTimelineRow';
import { TimelineScrubber } from './TimelineScrubber';

export interface MediaTimelineViewProps {
  items: MediaGridItem[];
  selectedIds?: string[];
  onToggleSelect?: (item: MediaGridItem) => void;
  onOpen?: (item: MediaGridItem) => void;
  onPreview?: (item: MediaGridItem) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  className?: string;
  containerHeight?: number;
}

export function MediaTimelineView({
  items,
  selectedIds = [],
  onToggleSelect,
  onOpen,
  onPreview,
  onLoadMore,
  hasMore,
  className,
}: MediaTimelineViewProps) {
  const { t, language } = useLanguage();
  const labels = useMemo(
    () => ({
      today: t.cloudStorage.timelineToday ?? 'Today',
      yesterday: t.cloudStorage.timelineYesterday ?? 'Yesterday',
    }),
    [t.cloudStorage],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const initial = Math.floor(node.getBoundingClientRect().width);
    if (initial > 0) setContainerWidth(initial);
    else setContainerWidth(640);
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setContainerWidth(Math.floor(width));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const months = useMemo(
    () => groupByMonth(items, language ?? 'en', labels),
    [items, language, labels],
  );

  const layout = useMemo<TimelineLayout>(() => {
    if (containerWidth <= 0) {
      return { totalHeight: 0, months: [] };
    }
    let cursor = 0;
    const positioned: MonthLayout[] = [];
    for (const month of months) {
      const monthTop = cursor;
      const monthDays: DayLayout[] = [];
      let monthCursor = MONTH_HEADER_HEIGHT;
      for (const day of month.days) {
        const headerTop = monthCursor;
        const contentTop = monthCursor + DAY_HEADER_HEIGHT;
        const dayLayout = layoutDay(day, containerWidth);
        const totalDayHeight = DAY_HEADER_HEIGHT + dayLayout.height;
        const offsetBoxes = dayLayout.boxes.map((box) => ({
          ...box,
          top: box.top + contentTop,
        }));
        monthDays.push({
          key: day.key,
          label: day.label,
          headerTop,
          contentTop,
          height: totalDayHeight,
          boxes: offsetBoxes,
        });
        monthCursor += totalDayHeight;
      }
      const monthHeight = monthCursor;
      positioned.push({
        bucket: month.bucket,
        label: month.label,
        top: monthTop,
        height: monthHeight,
        itemCount: month.items.length,
        days: monthDays,
      });
      cursor += monthHeight;
    }
    return { totalHeight: cursor, months: positioned };
  }, [months, containerWidth]);

  const scrubberMonths = useMemo(
    () =>
      layout.months.map((m) => ({
        bucket: m.bucket,
        top: m.top,
        height: m.height,
        label: m.label,
      })),
    [layout],
  );

  const handleScrollTo = useCallback((offset: number) => {
    scrollRef.current?.scrollTo({ top: offset, behavior: 'auto' });
  }, []);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !onLoadMore || !hasMore) return;
    const margin = Math.max(1200, root.clientHeight * 2);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { root, rootMargin: `${margin}px 0px` },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, onLoadMore, layout.totalHeight]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !onLoadMore || !hasMore) return;
    const distanceFromBottom =
      root.scrollHeight - root.scrollTop - root.clientHeight;
    if (distanceFromBottom < root.clientHeight) {
      onLoadMore();
    }
  }, [hasMore, layout.totalHeight, onLoadMore]);

  if (items.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-40 items-center justify-center text-sm">
        {t.cloudStorage.noMediaResults}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn('relative flex h-full w-full', className)}
      style={{ minHeight: 320 }}
    >
      <div
        ref={scrollRef}
        className="bg-background relative h-full flex-1 scrollbar-none overflow-auto"
      >
        <div className="relative w-full" style={{ height: layout.totalHeight }}>
          {layout.months.map((month) => (
            <MonthBlock
              key={month.bucket}
              month={month}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
              onOpen={onOpen}
              onPreview={onPreview}
            />
          ))}
        </div>
        <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
      </div>
      <TimelineScrubber
        months={scrubberMonths}
        totalHeight={layout.totalHeight}
        onScrollTo={handleScrollTo}
        scrollContainer={scrollRef.current}
      />
    </div>
  );
}
