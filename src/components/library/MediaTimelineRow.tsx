import { type CSSProperties, useState } from 'react';

import justifiedLayout from 'justified-layout';
import { Check, FileImage, Folder, Play } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

import {
  AttributionChip,
  type CloudStorageLicenseInfo,
} from './AttributionChip';
import type { MediaGridItem } from './MediaGridView';
import type { DayGroup } from './mediaTimelineGrouping';

export const ROW_TARGET_HEIGHT = 220;
export const ROW_HEIGHT_TOLERANCE = 0.25;
export const BOX_SPACING = 4;
export const MONTH_HEADER_HEIGHT = 40;
export const DAY_HEADER_HEIGHT = 28;

export interface PositionedBox {
  item: MediaGridItem;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface DayLayout {
  key: string;
  label: string;
  headerTop: number;
  contentTop: number;
  height: number;
  boxes: PositionedBox[];
}

export interface MonthLayout {
  bucket: string;
  label: string;
  top: number;
  height: number;
  itemCount: number;
  days: DayLayout[];
}

export interface TimelineLayout {
  totalHeight: number;
  months: MonthLayout[];
}

interface RowCallbacks {
  selectedIds: string[];
  onToggleSelect?: (item: MediaGridItem) => void;
  onOpen?: (item: MediaGridItem) => void;
  onPreview?: (item: MediaGridItem) => void;
}

export function MonthBlock({
  month,
  ...callbacks
}: { month: MonthLayout } & RowCallbacks) {
  return (
    <div
      className="absolute right-0 left-0"
      style={{ top: month.top, height: month.height }}
    >
      <div
        className="bg-background/95 sticky z-10 flex items-end px-2 pt-3 pb-2 text-base font-semibold backdrop-blur"
        style={{ top: 0, height: MONTH_HEADER_HEIGHT }}
      >
        {month.label}
      </div>
      {month.days.map((day) => (
        <DayBlock key={day.key} day={day} {...callbacks} />
      ))}
    </div>
  );
}

function DayBlock({ day, ...callbacks }: { day: DayLayout } & RowCallbacks) {
  return (
    <>
      <div
        className="text-muted-foreground absolute right-0 left-0 px-2 text-sm font-medium"
        style={{
          top: day.headerTop,
          height: DAY_HEADER_HEIGHT,
          lineHeight: `${DAY_HEADER_HEIGHT}px`,
        }}
      >
        {day.label}
      </div>
      {day.boxes.map((box) => (
        <TimelineTile
          key={box.item.id}
          box={box}
          selected={callbacks.selectedIds.includes(box.item.id)}
          onToggleSelect={callbacks.onToggleSelect}
          onOpen={callbacks.onOpen}
          onPreview={callbacks.onPreview}
        />
      ))}
    </>
  );
}

function TimelineTile({
  box,
  selected,
  onToggleSelect,
  onOpen,
  onPreview,
}: {
  box: PositionedBox;
  selected: boolean;
  onToggleSelect?: (item: MediaGridItem) => void;
  onOpen?: (item: MediaGridItem) => void;
  onPreview?: (item: MediaGridItem) => void;
}) {
  const { item } = box;
  const style: CSSProperties = {
    position: 'absolute',
    top: box.top,
    left: box.left,
    width: box.width,
    height: box.height,
  };
  return (
    <div
      style={style}
      className={cn(
        'group bg-muted overflow-hidden rounded-md',
        selected && 'ring-primary ring-2',
      )}
    >
      <HoverableTileBody item={item} onPreview={onPreview} onOpen={onOpen} />
      {onToggleSelect && item.kind !== 'folder' ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect(item);
          }}
          className={cn(
            'border-border bg-background/70 absolute top-2 left-2 flex size-5 items-center justify-center rounded border opacity-0 transition group-hover:opacity-100',
            selected &&
              'border-primary bg-primary text-primary-foreground opacity-100',
          )}
        >
          {selected ? <Check className="size-3" aria-hidden /> : null}
        </button>
      ) : null}
    </div>
  );
}

function HoverableTileBody({
  item,
  onPreview,
  onOpen,
}: {
  item: MediaGridItem;
  onPreview?: (item: MediaGridItem) => void;
  onOpen?: (item: MediaGridItem) => void;
}) {
  const [hovering, setHovering] = useState(false);
  const isFolder = item.kind === 'folder';
  const thumbnail = isFolder
    ? undefined
    : (item.thumbnailUrl ?? item.previewUrl);
  const isVideo = item.kind === 'video' && !!item.videoStreamUrl;

  return (
    <button
      type="button"
      className="relative block size-full"
      onClick={() => onOpen?.(item)}
      onDoubleClick={() => onPreview?.(item)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {thumbnail ? (
        <img
          src={thumbnail}
          alt={item.name}
          className="size-full object-cover transition-transform group-hover:scale-[1.02]"
          decoding="async"
          loading="lazy"
        />
      ) : isFolder ? (
        <span className="text-muted-foreground flex size-full flex-col items-center justify-center gap-1 p-2 text-center text-xs">
          <Folder className="size-10" aria-hidden />
          <span className="text-foreground line-clamp-2">{item.name}</span>
        </span>
      ) : (
        <span className="text-muted-foreground flex size-full items-center justify-center">
          <FileImage className="size-8" aria-hidden />
        </span>
      )}
      {isVideo && hovering ? (
        <video
          src={item.videoStreamUrl}
          poster={thumbnail}
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          className="absolute inset-0 size-full bg-black object-cover"
        />
      ) : null}
      {item.kind === 'video' ? (
        <span className="absolute right-2 bottom-2 rounded-md bg-black/60 p-1 text-white">
          <Play className="size-3" aria-hidden />
        </span>
      ) : null}
      <AttributionChip
        licenseInfo={item.licenseInfo as CloudStorageLicenseInfo | undefined}
        className="absolute bottom-1 left-1 max-w-[80%] text-[10px]"
      />
    </button>
  );
}

export function layoutDay(
  day: DayGroup,
  containerWidth: number,
): { height: number; boxes: PositionedBox[] } {
  const ratios = day.items.map((item) => {
    const { width, height } = item.dimensions ?? {};
    if (width && height) return width / height;
    if (item.kind === 'video') return 16 / 9;
    return 1;
  });
  const layout = justifiedLayout(ratios, {
    containerWidth,
    containerPadding: 8,
    boxSpacing: BOX_SPACING,
    targetRowHeight: ROW_TARGET_HEIGHT,
    targetRowHeightTolerance: ROW_HEIGHT_TOLERANCE,
  });
  const boxes: PositionedBox[] = day.items.map((item, index) => {
    const box = layout.boxes[index] ?? {
      top: 0,
      left: 0,
      width: ROW_TARGET_HEIGHT,
      height: ROW_TARGET_HEIGHT,
    };
    return {
      item,
      top: box.top,
      left: box.left,
      width: box.width,
      height: box.height,
    };
  });
  return { height: layout.containerHeight, boxes };
}
