import { Loader2 } from 'lucide-react';

import type { Asset } from '@/shared/assets/types';
import { useLanguage } from '@/shared/providers/language-provider';

import { AssetTile } from './AssetTile';
import { VirtualAssetGrid } from './VirtualAssetGrid';

interface AssetGridProps {
  assets: Asset[];
  loading: boolean;
  selectedIds: string[];
  getSelectedIds: () => string[];
  onOpen: (asset: Asset) => void;
  onToggleSelected: (id: string) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

// Static result sets (no more pages, small payload) render through the
// plain CSS grid: simpler markup, no virtualization, and it survives JSDOM
// in unit tests where there is no real layout. Anything with pagination —
// or a long enough static list — flips to the virtualized grid which owns
// the endless-scroll auto-load behavior.
const STATIC_GRID_THRESHOLD = 200;

export function AssetGrid({
  assets,
  loading,
  selectedIds,
  getSelectedIds,
  onOpen,
  onToggleSelected,
  hasMore,
  loadingMore,
  onLoadMore,
}: AssetGridProps) {
  const { t } = useLanguage();
  const s = t.assets;

  if (loading && assets.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-56 items-center justify-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {s.loading}
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-56 flex-col items-center justify-center gap-1 text-sm">
        <p className="text-foreground font-medium">{s.emptyTitle}</p>
        <p>{s.emptyHint}</p>
      </div>
    );
  }

  if (!hasMore && assets.length <= STATIC_GRID_THRESHOLD) {
    return (
      <div
        data-asset-grid
        className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3"
      >
        {assets.map((asset, index) => (
          <AssetTile
            key={asset.id}
            asset={asset}
            index={index}
            selected={selectedIds.includes(asset.id)}
            getSelectedIds={getSelectedIds}
            onOpen={onOpen}
            onToggleSelected={onToggleSelected}
          />
        ))}
      </div>
    );
  }

  return (
    <VirtualAssetGrid
      assets={assets}
      selectedIds={selectedIds}
      getSelectedIds={getSelectedIds}
      onOpen={onOpen}
      onToggleSelected={onToggleSelected}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
    />
  );
}
