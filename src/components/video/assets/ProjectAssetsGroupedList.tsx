import { useMemo, useState } from 'react';

import { Search } from 'lucide-react';

import type { MaterializationStateMap } from '@/shared/hooks/useAssetMaterializationEvents';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import type { ProjectAssetBadgeActions } from './projectAssetMaterializationBadge';
import {
  projectAssetDisplayName,
  projectAssetDisplaySubtitle,
  ProjectAssetTile,
} from './ProjectAssetTile';

type ProjectAsset = VideoProject['assets'][number];
type Kind = ProjectAsset['kind'];
type KindFilter = 'all' | Kind;

const KIND_ORDER: Kind[] = ['video', 'image', 'audio'];
const KIND_FILTERS: KindFilter[] = ['all', 'video', 'image', 'audio'];
const PAGE_SIZE = 30;

interface ProjectAssetsGroupedListProps {
  project: VideoProject;
  newIds: Set<string>;
  materializationStates?: MaterializationStateMap;
  materializationActions?: ProjectAssetBadgeActions;
  selectedContextAssetIds?: string[];
  contextOnly?: boolean;
  onPlace?: (asset: ProjectAsset) => void;
  onDownload?: (asset: ProjectAsset) => void;
  onDelete: (assetId: string) => void;
  onPreview: (asset: ProjectAsset) => void;
  onToggleContext?: (asset: ProjectAsset) => void;
}

export function ProjectAssetsGroupedList({
  project,
  newIds,
  materializationStates,
  materializationActions,
  selectedContextAssetIds = [],
  contextOnly = false,
  onPlace,
  onDownload,
  onDelete,
  onPreview,
  onToggleContext,
}: ProjectAssetsGroupedListProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.assetsRail;
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const uniqueAssets = useMemo(
    () => dedupeProjectAssets(project.assets),
    [project.assets],
  );
  const variantCounts = useMemo(
    () => projectAssetVariantCounts(project.assets),
    [project.assets],
  );
  const queried = useProjectAssetFilter(uniqueAssets, query);
  const grouped = useProjectAssetGroups(queried);
  const kindCounts: Record<KindFilter, number> = {
    all: queried.length,
    video: grouped.video.length,
    image: grouped.image.length,
    audio: grouped.audio.length,
  };
  const visibleAssets = useMemo(() => {
    if (kindFilter === 'all') {
      return KIND_ORDER.flatMap((kind) => grouped[kind]);
    }
    return grouped[kindFilter];
  }, [grouped, kindFilter]);
  const selectedContextAssetIdSet = useMemo(
    () => new Set(selectedContextAssetIds),
    [selectedContextAssetIds],
  );
  // The header "in context" chip toggles this to filter the list down to the
  // assets the agent currently reasons over.
  const displayedAssets = useMemo(
    () =>
      contextOnly
        ? visibleAssets.filter((asset) =>
            selectedContextAssetIdSet.has(asset.id),
          )
        : visibleAssets,
    [contextOnly, visibleAssets, selectedContextAssetIdSet],
  );
  const hiddenCount = Math.max(0, displayedAssets.length - pageSize);
  const kindFilterLabel: Record<KindFilter, string> = {
    all: labels.kindAll,
    video: labels.kindVideo,
    image: labels.kindImage,
    audio: labels.kindAudio,
  };

  if (uniqueAssets.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        {labels.emptyProjectAssets}
      </p>
    );
  }

  return (
    <>
      <div className="border-input bg-background flex items-center gap-2 rounded-md border px-2">
        <Search className="text-muted-foreground size-3.5" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-xs outline-none"
          placeholder={labels.projectAssetsSearchPlaceholder}
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {KIND_FILTERS.map((kind) => {
          const active = kindFilter === kind;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => setKindFilter(kind)}
              aria-pressed={active}
              className={
                active
                  ? 'bg-primary text-primary-foreground rounded-md px-2 py-0.5 text-[10px] font-medium'
                  : 'border-border text-muted-foreground hover:text-foreground rounded-md border px-2 py-0.5 text-[10px] font-medium'
              }
            >
              {kindFilterLabel[kind]}
              <span className="ml-1 tabular-nums opacity-70">
                {kindCounts[kind]}
              </span>
            </button>
          );
        })}
      </div>

      {displayedAssets.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {labels.noMatchingProjectAssets}
        </p>
      ) : (
        <div className="space-y-1.5">
          {displayedAssets.slice(0, pageSize).map((asset) => (
            <ProjectAssetTile
              key={asset.id}
              projectId={project.id}
              asset={asset}
              isNew={newIds.has(asset.id)}
              materializationStates={materializationStates}
              materializationActions={materializationActions}
              variantCount={
                variantCounts.get(projectAssetDedupeKey(asset)) ?? 1
              }
              selectedForContext={selectedContextAssetIdSet.has(asset.id)}
              onPreview={onPreview}
              onPlace={onPlace}
              onDownload={onDownload}
              onDelete={onDelete}
              onToggleContext={onToggleContext}
            />
          ))}
        </div>
      )}

      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setPageSize((n) => n + PAGE_SIZE)}
          className="text-primary text-[11px] hover:underline"
        >
          {labels.showMore.replace('{count}', String(hiddenCount))}
        </button>
      ) : null}
    </>
  );
}

export function projectAssetMatchesQuery(
  asset: ProjectAsset,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    projectAssetDisplayName(asset).toLowerCase().includes(needle) ||
    projectAssetDisplaySubtitle(asset).toLowerCase().includes(needle)
  );
}

export function useProjectAssetFilter(
  assets: ProjectAsset[],
  query: string,
): ProjectAsset[] {
  return useMemo(
    () => assets.filter((asset) => projectAssetMatchesQuery(asset, query)),
    [assets, query],
  );
}

export function useProjectAssetGroups(
  assets: ProjectAsset[],
): Record<Kind, ProjectAsset[]> {
  return useMemo(() => {
    const groups: Record<Kind, ProjectAsset[]> = {
      video: [],
      image: [],
      audio: [],
    };
    for (const asset of assets) {
      if (groups[asset.kind]) groups[asset.kind].push(asset);
    }
    return groups;
  }, [assets]);
}

export function dedupeProjectAssets(assets: ProjectAsset[]): ProjectAsset[] {
  const byKey = new Map<string, ProjectAsset>();
  const order: string[] = [];
  for (const asset of assets) {
    const key = projectAssetDedupeKey(asset);
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, asset);
      order.push(key);
      continue;
    }
    byKey.set(key, chooseProjectAssetRepresentative(previous, asset));
  }
  return order.flatMap((key) => {
    const asset = byKey.get(key);
    return asset ? [asset] : [];
  });
}

export function projectAssetVariantCounts(
  assets: ProjectAsset[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const asset of assets) {
    const key = projectAssetDedupeKey(asset);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function projectAssetDedupeKey(asset: ProjectAsset): string {
  const collectionId = asset.collectionId ?? asset.provenance?.variantOf;
  if (collectionId) return `collection:${collectionId}`;
  const catalogAssetId = asset.provenance?.catalogAssetId;
  if (catalogAssetId) return `catalog:${catalogAssetId}`;
  return `asset:${asset.id}`;
}

function chooseProjectAssetRepresentative(
  first: ProjectAsset,
  second: ProjectAsset,
): ProjectAsset {
  const firstScore = projectAssetRepresentativeScore(first);
  const secondScore = projectAssetRepresentativeScore(second);
  return secondScore > firstScore ? second : first;
}

function projectAssetRepresentativeScore(asset: ProjectAsset): number {
  let score = asset.materializationState === 'ready' ? 8 : 0;
  if (asset.provenance?.connectionId && asset.provenance.sourceId) score += 4;
  if (asset.provenance?.thumbnailUrl) score += 2;
  if (asset.provenance?.sourceDisplayName) score += 1;
  return score;
}
