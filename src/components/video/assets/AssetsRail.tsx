import { useCallback, useEffect, useMemo, useState } from 'react';

import { Search } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoLinkedAsset,
  VideoLinkedAssetSearchHit,
  VideoProject,
} from '@/shared/types/video';

import type { VideoProjectEditorActions } from '../editorTypes';
import { AssetRailAssetList } from './AssetRailAssetList';
import { ProjectAssetsSection } from './ProjectAssetsSection';
import { ProjectOutputsSection } from './ProjectOutputsSection';

interface AssetsRailProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  selectedContextAssetIds?: string[];
  onToggleAssetContext?: (asset: VideoProject['assets'][number]) => void;
}

export function AssetsRail({
  project,
  actions,
  selectedContextAssetIds,
  onToggleAssetContext,
}: AssetsRailProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchHits, setSearchHits] = useState<VideoLinkedAssetSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thumbnailBaseUrl = `${API_BASE_URL}/video/projects/${encodeURIComponent(
    project.id,
  )}/linked-assets`;

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const trimmed = debouncedQuery.trim();
    if (!trimmed) {
      setSearchHits([]);
      return () => controller.abort();
    }
    setLoading(true);
    void actions
      .searchLinkedAssets({ query: trimmed, limit: 80 }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setSearchHits(result.results);
          setError(null);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [actions, debouncedQuery]);

  const searchAssets = useMemo(
    () => searchHits.map((hit) => hit.asset),
    [searchHits],
  );

  const attachAsset = useCallback(
    async (assetId: string) => {
      await actions.attachLinkedAsset(assetId);
    },
    [actions],
  );

  const toggleFavorite = useCallback(
    async (asset: VideoLinkedAsset) => {
      const result = await actions.setLinkedAssetFavorite(
        asset.id,
        !asset.favorite,
      );
      if (!result) return;
      const updated = result.asset;
      setSearchHits((prev) =>
        prev.map((hit) =>
          hit.asset.id === updated.id ? { ...hit, asset: updated } : hit,
        ),
      );
    },
    [actions],
  );

  const markOpened = useCallback(
    async (assetId: string) => {
      await actions.markLinkedAssetOpened(assetId);
    },
    [actions],
  );

  return (
    <section className="flex min-h-0 flex-col gap-4">
      <div className="space-y-2">
        <div>
          <h2 className="text-foreground text-sm font-semibold">
            {t.video.editor.assetsRail.title}
          </h2>
          <p className="text-muted-foreground text-xs">
            {t.video.editor.assetsRail.description}
          </p>
        </div>
        <div className="border-input bg-background flex items-center gap-2 rounded-md border px-2">
          <Search className="text-muted-foreground size-3.5" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent py-2 text-xs outline-none"
            placeholder={t.video.editor.assetsRail.searchPlaceholder}
          />
        </div>
        {loading ? (
          <p className="text-muted-foreground text-xs">
            {t.video.project.loading}
          </p>
        ) : null}
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
      </div>

      {query.trim() ? (
        <AssetRailAssetList
          assets={searchAssets}
          title={t.video.editor.assetsRail.searchResults}
          empty={t.video.editor.linkedSearch.empty}
          thumbnailBaseUrl={thumbnailBaseUrl}
          attachLabel={t.video.editor.linkedFolder.attach.button}
          favoriteLabel={t.common.favorite}
          unfavoriteLabel={t.common.unfavorite}
          onAttach={(assetId) => void attachAsset(assetId)}
          onToggleFavorite={(asset) => void toggleFavorite(asset)}
          onMarkOpened={(assetId) => void markOpened(assetId)}
        />
      ) : null}

      <ProjectAssetsSection
        project={project}
        actions={actions}
        selectedContextAssetIds={selectedContextAssetIds}
        onToggleAssetContext={onToggleAssetContext}
      />

      <ProjectOutputsSection project={project} />
    </section>
  );
}
