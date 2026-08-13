/**
 * VirtualCardGrid — responsive card grid that virtualizes above a threshold so
 * large plugin lists (hundreds of built-ins, marketplace catalogs) stay
 * smooth. Below the threshold it renders a plain grid.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from 'react';

import { useVirtualizer } from '@tanstack/react-virtual';

const GRID_CLASS = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3';
const VIRTUALIZE_THRESHOLD = 60;

export interface VirtualCardGridHandle {
  scrollToIndex: (index: number) => void;
  getColumnCount: () => number;
}

interface VirtualCardGridProps<T> {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Estimated row height in px; tune to the card's rendered height. */
  rowEstimate?: number;
  gridClassName?: string;
  mediumBreakpoint?: number;
  largeBreakpoint?: number;
  getScrollElement?: () => HTMLElement | null;
  apiRef?: MutableRefObject<VirtualCardGridHandle | null>;
}

export function VirtualCardGrid<T>({
  items,
  getKey,
  renderItem,
  rowEstimate = 190,
  gridClassName = GRID_CLASS,
  mediumBreakpoint = 640,
  largeBreakpoint = 1024,
  getScrollElement,
  apiRef,
}: VirtualCardGridProps<T>) {
  if (items.length < VIRTUALIZE_THRESHOLD) {
    return (
      <PlainGrid
        items={items}
        getKey={getKey}
        renderItem={renderItem}
        gridClassName={gridClassName}
        mediumBreakpoint={mediumBreakpoint}
        largeBreakpoint={largeBreakpoint}
        apiRef={apiRef}
      />
    );
  }
  return (
    <VirtualGrid
      items={items}
      getKey={getKey}
      renderItem={renderItem}
      rowEstimate={rowEstimate}
      mediumBreakpoint={mediumBreakpoint}
      largeBreakpoint={largeBreakpoint}
      getScrollElement={getScrollElement}
      apiRef={apiRef}
    />
  );
}

function PlainGrid<T>({
  items,
  getKey,
  renderItem,
  gridClassName = GRID_CLASS,
  mediumBreakpoint = 640,
  largeBreakpoint = 1024,
  apiRef,
}: VirtualCardGridProps<T>) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    const update = () =>
      setColumnCount(
        columnCountForWidth(
          element.clientWidth,
          mediumBreakpoint,
          largeBreakpoint,
        ),
      );
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [largeBreakpoint, mediumBreakpoint]);

  useEffect(() => {
    if (!apiRef) return;
    const api: VirtualCardGridHandle = {
      scrollToIndex: (index) => {
        gridRef.current
          ?.querySelector(`[data-card-index="${index}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      },
      getColumnCount: () => columnCount,
    };
    apiRef.current = api;
    return () => {
      if (apiRef.current === api) apiRef.current = null;
    };
  }, [apiRef, columnCount]);

  return (
    <div ref={gridRef} className={gridClassName}>
      {items.map((item, index) => (
        <div key={getKey(item)} data-card-index={index}>
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  );
}

function columnCountForWidth(
  width: number,
  mediumBreakpoint: number,
  largeBreakpoint: number,
) {
  if (width >= largeBreakpoint) return 3;
  if (width >= mediumBreakpoint) return 2;
  return 1;
}

function VirtualGrid<T>({
  items,
  getKey,
  renderItem,
  rowEstimate,
  mediumBreakpoint = 640,
  largeBreakpoint = 1024,
  getScrollElement,
  apiRef,
}: VirtualCardGridProps<T> & { rowEstimate: number }) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState(1);

  const rows = useMemo(() => {
    const chunked: T[][] = [];
    for (let i = 0; i < items.length; i += columnCount) {
      chunked.push(items.slice(i, i + columnCount));
    }
    return chunked;
  }, [items, columnCount]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => getScrollElement?.() ?? parentRef.current,
    estimateSize: () => rowEstimate,
    overscan: 4,
    initialRect: { width: 900, height: 700 },
  });

  const gridStyle = useMemo<CSSProperties>(
    () => ({ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }),
    [columnCount],
  );

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    const update = () =>
      setColumnCount(
        columnCountForWidth(
          element.clientWidth,
          mediumBreakpoint,
          largeBreakpoint,
        ),
      );
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [largeBreakpoint, mediumBreakpoint]);

  useEffect(() => {
    if (!apiRef) return;
    const api: VirtualCardGridHandle = {
      scrollToIndex: (index) => {
        const rowIndex = Math.floor(index / columnCount);
        virtualizer.scrollToIndex(rowIndex, { align: 'center' });
        queueMicrotask(() => {
          if (
            parentRef.current?.querySelector(`[data-card-index="${index}"]`)
          ) {
            return;
          }
          const scrollElement = getScrollElement?.() ?? parentRef.current;
          scrollElement?.scrollTo({
            top: Math.max(0, rowIndex * rowEstimate - rowEstimate),
            behavior: 'auto',
          });
        });
      },
      getColumnCount: () => columnCount,
    };
    apiRef.current = api;
    return () => {
      if (apiRef.current === api) apiRef.current = null;
    };
  }, [apiRef, columnCount, getScrollElement, rowEstimate, virtualizer]);

  return (
    <div
      ref={parentRef}
      data-testid="virtual-card-grid"
      className={getScrollElement ? 'pr-1' : 'max-h-[70vh] overflow-auto pr-1'}
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const rowItems = rows[row.index];
          if (!rowItems) return null;
          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={row.index}
              className="absolute inset-x-0 top-0 grid gap-3 pb-3"
              style={{ ...gridStyle, transform: `translateY(${row.start}px)` }}
            >
              {rowItems.map((item, columnIndex) => {
                const itemIndex = row.index * columnCount + columnIndex;
                return (
                  <div key={getKey(item)} data-card-index={itemIndex}>
                    {renderItem(item, itemIndex)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
