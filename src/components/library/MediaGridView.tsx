import { useState } from 'react';

import { Check, FileImage, Folder, Play } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  AttributionChip,
  type CloudStorageLicenseInfo,
} from './AttributionChip';

export interface MediaGridItem {
  id: string;
  name: string;
  kind?: 'image' | 'video' | 'audio' | 'document' | 'folder';
  thumbnailUrl?: string;
  previewUrl?: string;
  videoStreamUrl?: string;
  videoMimeType?: string;
  takenAt?: string | Date;
  modifiedAt?: string | Date;
  // For folders: number of items inside, when the provider returns it.
  // Immich albums populate this from `assetCount`. Box/Drive don't return a
  // folder child count in the listChildren payload, so this stays undefined.
  itemCount?: number;
  // File size in bytes for regular files. Folder rows leave this undefined
  // since "folder size" is meaningless without a recursive walk.
  sizeBytes?: number;
  // Provider id (`'immich'`, `'box'`, …) — folder strip uses it to pick
  // provider-specific terminology ("album" vs "folder") and tooltip copy.
  provider?: string;
  dimensions?: {
    width: number;
    height: number;
    durationSec?: number;
  };
  licenseInfo?: CloudStorageLicenseInfo;
}

interface MediaGridViewProps {
  items: MediaGridItem[];
  selectedIds?: string[];
  onToggleSelect?: (item: MediaGridItem) => void;
  onOpen?: (item: MediaGridItem) => void;
  onPreview?: (item: MediaGridItem) => void;
  className?: string;
}

export function MediaGridView({
  items,
  selectedIds = [],
  onToggleSelect,
  onOpen,
  onPreview,
  className,
}: MediaGridViewProps) {
  const { t } = useLanguage();

  if (items.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-40 items-center justify-center text-sm">
        {t.cloudStorage.noMediaResults}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3',
        className,
      )}
    >
      {items.map((item) => (
        <MediaGridTile
          key={item.id}
          item={item}
          selected={selectedIds.includes(item.id)}
          onToggleSelect={onToggleSelect}
          onOpen={onOpen}
          onPreview={onPreview}
        />
      ))}
    </div>
  );
}

function MediaGridTile({
  item,
  selected,
  onToggleSelect,
  onOpen,
  onPreview,
}: {
  item: MediaGridItem;
  selected: boolean;
  onToggleSelect: ((item: MediaGridItem) => void) | undefined;
  onOpen: ((item: MediaGridItem) => void) | undefined;
  onPreview: ((item: MediaGridItem) => void) | undefined;
}) {
  const isFolder = item.kind === 'folder';
  // Folders don't carry a real preview unless the cloud provider gave us
  // one explicitly — skip the thumbnail attempt so we render a folder
  // affordance instead of a generic image placeholder.
  const thumbnail = isFolder
    ? undefined
    : (item.thumbnailUrl ?? item.previewUrl);
  const isVideo = item.kind === 'video';
  const [hovering, setHovering] = useState(false);

  return (
    <article
      className={cn(
        'bg-card border-border group overflow-hidden rounded-md border',
        selected && 'border-primary ring-primary/30 ring-2',
      )}
    >
      <button
        type="button"
        className="bg-muted relative block aspect-square w-full overflow-hidden"
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
        ) : (
          <span className="text-muted-foreground flex size-full items-center justify-center">
            {isFolder ? (
              <Folder className="size-10" aria-hidden />
            ) : (
              <FileImage className="size-8" aria-hidden />
            )}
          </span>
        )}
        {isVideo && hovering && item.videoStreamUrl ? (
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
        {isVideo ? (
          <span className="absolute right-2 bottom-2 rounded-md bg-black/60 p-1 text-white">
            <Play className="size-3" aria-hidden />
          </span>
        ) : null}
      </button>

      <div className="space-y-2 p-2">
        <div className="flex items-start gap-2">
          {onToggleSelect && !isFolder ? (
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onToggleSelect(item)}
              className={cn(
                'border-border mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border',
                selected && 'border-primary bg-primary text-primary-foreground',
              )}
            >
              {selected ? <Check className="size-3" aria-hidden /> : null}
            </button>
          ) : null}
          <span className="text-foreground line-clamp-2 min-w-0 text-xs font-medium">
            {item.name}
          </span>
        </div>
        <AttributionChip
          licenseInfo={item.licenseInfo}
          className="max-w-full text-[11px]"
        />
      </div>
    </article>
  );
}
