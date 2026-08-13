import { VirtualCardGrid } from '@/components/library/VirtualCardGrid';
import type {
  DesignAssetVersion,
  DesignOutput,
} from '@/shared/types/design-mode';

import { AssetCard } from './AssetCard';
import { VersionTimeline } from './VersionTimeline';

export function AssetGalleryGrid({
  projectId,
  assets,
  versions,
  expandedId,
  onOpen,
  onVersions,
  onCompare,
  onProvenance,
  onPromote,
}: {
  projectId: string;
  assets: DesignOutput[];
  versions: Record<string, DesignAssetVersion[]>;
  expandedId: string | null;
  onOpen: (path: string) => void;
  onVersions: (asset: DesignOutput) => void;
  onCompare: (left: DesignAssetVersion, right: DesignAssetVersion) => void;
  onProvenance: (asset: DesignOutput) => void;
  onPromote: (asset: DesignOutput, version: DesignAssetVersion) => void;
}) {
  return (
    <VirtualCardGrid
      items={assets}
      getKey={(asset) => asset.id}
      gridClassName="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
      mediumBreakpoint={768}
      largeBreakpoint={1280}
      rowEstimate={360}
      renderItem={(asset) => {
        const assetVersions = versions[asset.id] ?? [asset];
        return (
          <div className="space-y-2">
            <AssetCard
              projectId={projectId}
              asset={asset}
              onOpen={() => onOpen(asset.path)}
              onVersions={() => onVersions(asset)}
              onCompare={() =>
                onCompare(
                  asset,
                  assetVersions.find((item) => item.path !== asset.path) ??
                    assetVersions[0] ??
                    asset,
                )
              }
              onProvenance={() => onProvenance(asset)}
            />
            {expandedId === asset.id ? (
              <VersionTimeline
                versions={assetVersions}
                primaryPath={asset.path}
                onOpen={onOpen}
                onCompare={(version) => onCompare(asset, version)}
                onPromote={(version) => onPromote(asset, version)}
              />
            ) : null}
          </div>
        );
      }}
    />
  );
}
