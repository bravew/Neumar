import { Images, Library } from 'lucide-react';

interface DesignAssetGalleryToolbarProps {
  assetCount: number;
  browseAssetsLabel: string;
  browseCatalogLabel: string;
  onBrowseAssets: () => void;
  onBrowseCatalog: () => void;
}

export function DesignAssetGalleryToolbar({
  assetCount,
  browseAssetsLabel,
  browseCatalogLabel,
  onBrowseAssets,
  onBrowseCatalog,
}: DesignAssetGalleryToolbarProps) {
  return (
    <div className="mb-2 flex justify-end gap-2">
      <button
        type="button"
        onClick={onBrowseAssets}
        className="border-border text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium"
      >
        <Images className="size-3.5" aria-hidden />
        {browseAssetsLabel}
        <span className="tabular-nums">{assetCount}</span>
      </button>
      <button
        type="button"
        onClick={onBrowseCatalog}
        className="border-border text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium"
      >
        <Library className="size-3.5" aria-hidden />
        {browseCatalogLabel}
      </button>
    </div>
  );
}
