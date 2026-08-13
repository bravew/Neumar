import { type CSSProperties, useRef } from 'react';

import { useVirtualizer } from '@tanstack/react-virtual';
import { Image, Music2, Paperclip, Star, Video } from 'lucide-react';

import type { VideoLinkedAsset } from '@/shared/types/video';

import { writeLinkedAssetDrag } from '../linkedAssetDrag';

interface AssetRailAssetListProps {
  assets: VideoLinkedAsset[];
  title: string;
  empty: string;
  thumbnailBaseUrl: string;
  attachLabel: string;
  favoriteLabel: string;
  unfavoriteLabel: string;
  onAttach: (assetId: string) => void;
  onToggleFavorite: (asset: VideoLinkedAsset) => void;
  onMarkOpened: (assetId: string) => void;
}

export function AssetRailAssetList({
  assets,
  title,
  empty,
  thumbnailBaseUrl,
  attachLabel,
  favoriteLabel,
  unfavoriteLabel,
  onAttach,
  onToggleFavorite,
  onMarkOpened,
}: AssetRailAssetListProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: assets.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 6,
  });

  return (
    <section className="min-h-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-foreground text-xs font-semibold">{title}</h3>
        <span className="text-muted-foreground text-[11px]">
          {assets.length}
        </span>
      </div>
      {assets.length === 0 ? (
        <p className="text-muted-foreground text-xs">{empty}</p>
      ) : (
        <div ref={parentRef} className="max-h-56 overflow-auto pr-1">
          <div
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const asset = assets[row.index];
              if (!asset) return null;
              return (
                <AssetRow
                  key={asset.id}
                  asset={asset}
                  thumbnailBaseUrl={thumbnailBaseUrl}
                  attachLabel={attachLabel}
                  favoriteLabel={favoriteLabel}
                  unfavoriteLabel={unfavoriteLabel}
                  onAttach={onAttach}
                  onToggleFavorite={onToggleFavorite}
                  onMarkOpened={onMarkOpened}
                  style={{
                    transform: `translateY(${row.start}px)`,
                    height: row.size,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function AssetRow({
  asset,
  thumbnailBaseUrl,
  attachLabel,
  favoriteLabel,
  unfavoriteLabel,
  onAttach,
  onToggleFavorite,
  onMarkOpened,
  style,
}: {
  asset: VideoLinkedAsset;
  thumbnailBaseUrl: string;
  attachLabel: string;
  favoriteLabel: string;
  unfavoriteLabel: string;
  onAttach: (assetId: string) => void;
  onToggleFavorite: (asset: VideoLinkedAsset) => void;
  onMarkOpened: (assetId: string) => void;
  style: CSSProperties;
}) {
  const draggable = asset.kind !== 'other';
  const FavoriteIcon = Star;
  return (
    <div className="absolute inset-x-0 top-0 py-1" style={style}>
      <div
        className="border-border bg-background hover:bg-accent/50 flex h-full items-center gap-2 rounded-md border px-2"
        draggable={draggable}
        onClick={() => onMarkOpened(asset.id)}
        onDragStart={(event) => {
          if (!draggable || asset.kind === 'other') return;
          writeLinkedAssetDrag(event.dataTransfer, {
            assetId: asset.id,
            kind: asset.kind,
            name: asset.name,
            durationMs: asset.durationMs,
          });
        }}
      >
        <Thumb asset={asset} thumbnailBaseUrl={thumbnailBaseUrl} />
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-xs" title={asset.name}>
            {asset.name}
          </p>
          <p className="text-muted-foreground text-[11px]">
            {asset.kind}
            {asset.durationMs
              ? ` · ${Math.round(asset.durationMs / 1000)}s`
              : ''}
          </p>
        </div>
        <button
          type="button"
          className="hover:bg-background rounded p-1"
          aria-label={asset.favorite ? unfavoriteLabel : favoriteLabel}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(asset);
          }}
        >
          <FavoriteIcon
            className={
              asset.favorite
                ? 'fill-primary text-primary size-3.5'
                : 'text-muted-foreground size-3.5'
            }
          />
        </button>
        <button
          type="button"
          className="hover:bg-background rounded p-1"
          aria-label={attachLabel}
          onClick={(event) => {
            event.stopPropagation();
            onAttach(asset.id);
          }}
        >
          <Paperclip className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function Thumb({
  asset,
  thumbnailBaseUrl,
}: {
  asset: VideoLinkedAsset;
  thumbnailBaseUrl: string;
}) {
  if (asset.thumbnailCachePath) {
    return (
      <img
        src={`${thumbnailBaseUrl}/${encodeURIComponent(asset.id)}/thumbnail`}
        alt=""
        className="bg-muted h-12 w-14 rounded object-cover"
      />
    );
  }
  const Icon =
    asset.kind === 'video' ? Video : asset.kind === 'audio' ? Music2 : Image;
  return (
    <div className="bg-muted text-muted-foreground flex h-12 w-14 items-center justify-center rounded">
      <Icon className="size-4" />
    </div>
  );
}
