import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSearchParams } from 'react-router-dom';

import { useStore } from 'zustand';

import { deleteAsset, fetchAssets } from '@/shared/assets/api';
import { createAssetSelectionStore } from '@/shared/assets/store';
import type {
  Asset,
  AssetKindFilter,
  AssetQueryState,
  AssetSourceFilter,
} from '@/shared/assets/types';
import { useLanguage } from '@/shared/providers/language-provider';

import { AssetFilters } from './AssetFilters';
import { AssetGrid } from './AssetGrid';
import { AssetPreviewDialog } from './AssetPreviewDialog';
import { AssetSearchBar } from './AssetSearchBar';

const DEFAULT_QUERY: AssetQueryState = {
  q: '',
  kind: 'all',
  source: 'all',
  tags: '',
  from: '',
  to: '',
  semantic: false,
};

export function AssetsLibraryTab() {
  const { t } = useLanguage();
  const s = t.assets;
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectionStore] = useState(createAssetSelectionStore);
  const selectedIds = useStore(selectionStore, (state) => state.selectedIds);
  const toggleSelected = useStore(selectionStore, (state) => state.toggle);
  const removeSelected = useStore(selectionStore, (state) => state.remove);
  const clearSelected = useStore(selectionStore, (state) => state.clear);
  const getSelectedIds = useCallback(
    () => selectionStore.getState().selectedIds,
    [selectionStore],
  );

  const query = useMemo(() => queryFromParams(searchParams), [searchParams]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const loadMoreCtrlRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      mountedRef.current = false;
      loadMoreCtrlRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    fetchAssets(query, { signal: ctrl.signal })
      .then((page) => {
        if (ctrl.signal.aborted) return;
        setAssets(page.assets);
        setNextCursor(page.nextCursor);
        clearSelected();
      })
      .catch((err) => {
        if ((err as { name?: string }).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : s.error);
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [clearSelected, query, s.error]);

  const updateQuery = useCallback(
    (patch: Partial<AssetQueryState>) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('tab', 'assets');
        writeQueryToParams({ ...query, ...patch }, next);
        return next;
      });
    },
    [query, setSearchParams],
  );

  const handleClearFilters = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tab', 'assets');
      writeQueryToParams(DEFAULT_QUERY, next);
      return next;
    });
  }, [setSearchParams]);

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor) return;
    loadMoreCtrlRef.current?.abort();
    const ctrl = new AbortController();
    loadMoreCtrlRef.current = ctrl;
    setLoadingMore(true);
    setError('');
    try {
      const page = await fetchAssets(query, {
        cursor: nextCursor,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      setAssets((prev) => [...prev, ...page.assets]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : s.error);
      }
    } finally {
      if (!ctrl.signal.aborted) setLoadingMore(false);
    }
  }, [nextCursor, query, s.error]);

  const handleOpen = useCallback((asset: Asset) => setPreviewId(asset.id), []);

  const previewAsset = useMemo(
    () => assets.find((asset) => asset.id === previewId) ?? null,
    [assets, previewId],
  );

  const handleDelete = useCallback(
    async (asset: Asset) => {
      setDeletingId(asset.id);
      try {
        await deleteAsset(asset.id);
        setAssets((prev) => prev.filter((item) => item.id !== asset.id));
        removeSelected(asset.id);
        setPreviewId(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : s.deleteFailed);
      } finally {
        setDeletingId(null);
      }
    },
    [removeSelected, s.deleteFailed],
  );

  // Compact one-line summary that sits inside the search bar — replaces the
  // taller "Assets / N assets" heading row to give the grid more vertical
  // space, especially on shorter laptop screens.
  const summary =
    s.resultsCount.replace('{count}', String(assets.length)) +
    (selectedIds.length
      ? ` · ${s.selectedCount.replace('{count}', String(selectedIds.length))}`
      : '');

  return (
    <section className="space-y-2" data-testid="assets-library-tab">
      <AssetSearchBar
        value={query.q}
        semantic={query.semantic}
        onChange={(q) => updateQuery({ q })}
        onSemanticChange={(semantic) => updateQuery({ semantic })}
        summary={summary}
      />
      <AssetFilters
        query={query}
        onChange={updateQuery}
        onClear={handleClearFilters}
      />

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <AssetGrid
        assets={assets}
        loading={loading}
        selectedIds={selectedIds}
        getSelectedIds={getSelectedIds}
        onOpen={handleOpen}
        onToggleSelected={toggleSelected}
        hasMore={Boolean(nextCursor)}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
      />

      <AssetPreviewDialog
        asset={previewAsset}
        open={Boolean(previewAsset)}
        deleting={deletingId === previewAsset?.id}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null);
        }}
        onDelete={handleDelete}
      />
    </section>
  );
}

function queryFromParams(params: URLSearchParams): AssetQueryState {
  return {
    q: params.get('q') ?? DEFAULT_QUERY.q,
    kind: readKind(params.get('kind')),
    source: readSource(params.get('source')),
    tags: params.get('tags') ?? DEFAULT_QUERY.tags,
    from: params.get('from') ?? DEFAULT_QUERY.from,
    to: params.get('to') ?? DEFAULT_QUERY.to,
    semantic: params.get('semantic') === 'true',
  };
}

function writeQueryToParams(
  query: AssetQueryState,
  params: URLSearchParams,
): void {
  writeParam(params, 'q', query.q);
  writeParam(params, 'kind', query.kind === 'all' ? '' : query.kind);
  writeParam(params, 'source', query.source === 'all' ? '' : query.source);
  writeParam(params, 'tags', query.tags);
  writeParam(params, 'from', query.from);
  writeParam(params, 'to', query.to);
  writeParam(params, 'semantic', query.semantic ? 'true' : '');
}

function writeParam(params: URLSearchParams, key: string, value: string): void {
  if (value) {
    params.set(key, value);
  } else {
    params.delete(key);
  }
}

function readKind(value: string | null): AssetKindFilter {
  const allowed: AssetKindFilter[] = [
    'all',
    'image',
    'video',
    'audio',
    'pdf',
    'text',
    'doc',
    'other',
  ];
  return allowed.includes(value as AssetKindFilter)
    ? (value as AssetKindFilter)
    : 'all';
}

function readSource(value: string | null): AssetSourceFilter {
  const allowed: AssetSourceFilter[] = [
    'all',
    'local_fs',
    'ai_gen',
    'immich',
    'photoprism',
    'google_drive',
    'dropbox',
    'box',
    'onedrive',
    's3_compatible',
    'openverse',
    'unsplash',
    'pexels',
    'pixabay',
    'coverr',
    'videvo',
  ];
  return allowed.includes(value as AssetSourceFilter)
    ? (value as AssetSourceFilter)
    : 'all';
}
