import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2 } from 'lucide-react';

import type { Asset } from '@/shared/assets/types';
import { useLanguage } from '@/shared/providers/language-provider';

import { AssetTile } from './AssetTile';

interface VirtualAssetGridProps {
  assets: Asset[];
  selectedIds: string[];
  getSelectedIds: () => string[];
  onOpen: (asset: Asset) => void;
  onToggleSelected: (id: string) => void;
  /**
   * Endless-scroll wiring. When `hasMore` is true the grid auto-fires
   * `onLoadMore` once the user scrolls within `LOAD_MORE_TRIGGER_ROWS`
   * rows of the end. `loadingMore` drives the bottom spinner.
   */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

const ASSET_TILE_MIN_WIDTH = 150;
const ASSET_TILE_GAP = 12;
const ASSET_ROW_ESTIMATE = 218;
const LOAD_MORE_TRIGGER_ROWS = 4;

export function VirtualAssetGrid({
  assets,
  selectedIds,
  getSelectedIds,
  onOpen,
  onToggleSelected,
  hasMore,
  loadingMore,
  onLoadMore,
}: VirtualAssetGridProps) {
  const { t } = useLanguage();
  const s = t.assets;
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState(1);
  const rows = useMemo(
    () => chunkAssets(assets, columnCount),
    [assets, columnCount],
  );

  // The dashboard chrome makes `window` non-scrollable — the actual scroll
  // happens in a nearest `overflow-y: auto` ancestor. Discover that
  // element on mount and feed it to the virtualizer; falling back to
  // `window` keeps things working in tests / when the grid renders inside
  // a page that does use the window scroll.
  const [scrollElement, setScrollElement] = useState<
    HTMLElement | Window | null
  >(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    const ancestor = findScrollAncestor(element);
    setScrollElement(ancestor ?? window);
    const updateLayout = () => {
      setColumnCount(columnCountForWidth(element.clientWidth));
      // `scrollMargin` is the distance between the top of the scroll
      // container and the top of the grid, expressed in scroll-container
      // coordinates. With an ancestor it's `offsetTop` from the ancestor;
      // with the window fallback it's the document offset.
      if (ancestor) {
        const elTop = element.getBoundingClientRect().top;
        const ancTop = ancestor.getBoundingClientRect().top;
        setScrollMargin(elTop - ancTop + ancestor.scrollTop);
      } else {
        setScrollMargin(element.getBoundingClientRect().top + window.scrollY);
      }
    };
    updateLayout();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updateLayout);
    observer?.observe(element);
    if (ancestor && observer) observer.observe(ancestor);
    window.addEventListener('resize', updateLayout);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateLayout);
    };
  }, []);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () =>
      scrollElement instanceof Window ? null : scrollElement,
    estimateSize: () => ASSET_ROW_ESTIMATE,
    overscan: 4,
    scrollMargin,
  });

  const gridStyle = useMemo<CSSProperties>(
    () => ({
      gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
    }),
    [columnCount],
  );

  // Trigger the next page fetch as the user nears the bottom of the
  // virtualized list. Guarded against repeat fires while a request is in
  // flight — the parent flips `loadingMore` to gate the next attempt.
  const lastTriggeredLength = useRef(-1);
  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualRowIndex =
    virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;
  useEffect(() => {
    if (!hasMore || loadingMore || !onLoadMore) return;
    if (rows.length === 0) return;
    if (lastTriggeredLength.current === assets.length) return;
    if (lastVirtualRowIndex >= rows.length - LOAD_MORE_TRIGGER_ROWS) {
      lastTriggeredLength.current = assets.length;
      onLoadMore();
    }
  }, [
    assets.length,
    hasMore,
    lastVirtualRowIndex,
    loadingMore,
    onLoadMore,
    rows.length,
  ]);

  return (
    <div ref={parentRef} data-asset-grid className="relative">
      <div
        className="relative w-full"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
        }}
      >
        {virtualItems.map((row) => {
          const rowAssets = rows[row.index];
          if (!rowAssets) return null;
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="absolute inset-x-0 top-0 grid gap-3 pb-3"
              style={{
                ...gridStyle,
                transform: `translateY(${row.start - scrollMargin}px)`,
              }}
            >
              {rowAssets.map((asset, columnIndex) => {
                const index = row.index * columnCount + columnIndex;
                return (
                  <AssetTile
                    key={asset.id}
                    asset={asset}
                    index={index}
                    selected={selectedIds.includes(asset.id)}
                    getSelectedIds={getSelectedIds}
                    onOpen={onOpen}
                    onToggleSelected={onToggleSelected}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      {loadingMore ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {s.loadingMore}
        </div>
      ) : null}
    </div>
  );
}

function chunkAssets(assets: Asset[], columnCount: number): Asset[][] {
  const rows: Asset[][] = [];
  for (let index = 0; index < assets.length; index += columnCount) {
    rows.push(assets.slice(index, index + columnCount));
  }
  return rows;
}

function columnCountForWidth(width: number): number {
  return Math.max(
    1,
    Math.floor(
      (width + ASSET_TILE_GAP) / (ASSET_TILE_MIN_WIDTH + ASSET_TILE_GAP),
    ),
  );
}

// Walk up the DOM looking for the nearest element whose CSS overflow-y is
// `auto` / `scroll`. Falls back to `null` so the caller can use the window
// scroll as the default scroll surface.
//
// We match on the CSS property alone — NOT on whether the element currently
// overflows (`scrollHeight > clientHeight`). That check is circular for a
// virtualized child: the container only overflows once the virtualizer has
// rendered rows, but the virtualizer renders nothing until it has a scroll
// element. When the grid is the container's sole child (e.g. the catalog
// dialog, where the search bar and filters live outside the scroll area),
// the placeholder sizes to exactly fit, the guard never passes, and the grid
// renders empty.
function findScrollAncestor(start: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = start.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
