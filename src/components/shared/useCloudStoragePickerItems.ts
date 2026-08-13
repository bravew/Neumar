import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildSearchUrlParams,
  isFiltersActive,
  type CloudSearchFilters,
} from '@/components/library';
import type { StockLicenseCode } from '@/components/library';
import type { CloudFile } from '@/components/library/cloudStorageLibraryUtils';
import type { MediaKind } from '@/components/library/cloudStorageLibraryUtils';
import { API_BASE_URL } from '@/config';

interface PageResponse<T> {
  items?: T[];
  nextCursor?: string;
  hasMore?: boolean;
}

interface UseCloudStoragePickerItemsInput {
  open: boolean;
  selectedConnectionId: string;
  parentId: string | null;
  query: string;
  kind: MediaKind;
  licenses: StockLicenseCode[];
  filters: CloudSearchFilters;
  loadErrorLabel: string;
}

interface UseCloudStoragePickerItemsResult {
  items: CloudFile[];
  setItems: React.Dispatch<React.SetStateAction<CloudFile[]>>;
  loadingItems: boolean;
  nextCursor: string | undefined;
  error: string;
  setError: (value: string) => void;
  handleLoadMore: () => void;
  /**
   * The connection these `items` were fetched from. Useful for picker
   * code that builds per-connection URLs (e.g. thumbnail proxies) — if
   * the user has just switched connections, this trails
   * `selectedConnectionId` by one render and the consumer should
   * suppress URL synthesis until they match.
   */
  itemsConnectionId: string;
}

export function useCloudStoragePickerItems({
  open,
  selectedConnectionId,
  parentId,
  query,
  kind,
  licenses,
  filters,
  loadErrorLabel,
}: UseCloudStoragePickerItemsInput): UseCloudStoragePickerItemsResult {
  const [items, setItems] = useState<CloudFile[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [error, setError] = useState('');
  // Tracks which connection the current `items` belong to so consumers
  // never render Drive items under a Box connection's URL prefix during
  // the one-render gap between switching `selectedConnectionId` and the
  // next fetch resolving.
  const [itemsConnectionId, setItemsConnectionId] = useState('');

  const buildQueryUrl = useCallback(
    (cursor?: string) => {
      const trimmedQuery = query.trim();
      const advancedActive = isFiltersActive(filters);
      const hasSearchFilters =
        (kind !== 'all' && kind !== 'folder') || licenses.length > 0;
      const endpoint =
        trimmedQuery || hasSearchFilters || advancedActive
          ? `/cloud-storage/connections/${encodeURIComponent(
              selectedConnectionId,
            )}/search`
          : `/cloud-storage/connections/${encodeURIComponent(
              selectedConnectionId,
            )}/items`;
      const params = advancedActive
        ? buildSearchUrlParams(filters)
        : new URLSearchParams();
      params.set('limit', '50');
      if (parentId) params.set('parentId', parentId);
      if (trimmedQuery && !params.has('q')) params.set('q', trimmedQuery);
      if (kind !== 'all' && kind !== 'folder' && !params.has('media_kind')) {
        params.set('media_kind', kind);
      }
      for (const license of licenses) params.append('license_filter', license);
      if (cursor) params.set('cursor', cursor);
      return `${API_BASE_URL}${endpoint}?${params}`;
    },
    [filters, kind, licenses, parentId, query, selectedConnectionId],
  );

  useEffect(() => {
    if (!open || !selectedConnectionId) {
      setItems([]);
      setItemsConnectionId('');
      setNextCursor(undefined);
      return;
    }
    const ctrl = new AbortController();
    setLoadingItems(true);
    setError('');
    // Drop whatever was rendered for the previous connector/parent/query so
    // we never show stale results while a switch is in flight or fails.
    setItems([]);
    setItemsConnectionId('');
    setNextCursor(undefined);
    fetch(buildQueryUrl(), { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as PageResponse<CloudFile>;
      })
      .then((body) => {
        if (!ctrl.signal.aborted) {
          setItems(body.items ?? []);
          setItemsConnectionId(selectedConnectionId);
          setNextCursor(body.hasMore ? body.nextCursor : undefined);
        }
      })
      .catch((err) => {
        if ((err as { name?: string }).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : loadErrorLabel);
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoadingItems(false);
      });
    return () => ctrl.abort();
  }, [buildQueryUrl, open, loadErrorLabel, selectedConnectionId]);

  const cursorRef = useRef<string | undefined>(undefined);
  const inflightRef = useRef(false);
  cursorRef.current = nextCursor;

  const handleLoadMore = useCallback(() => {
    if (!cursorRef.current || inflightRef.current) return;
    const cursor = cursorRef.current;
    inflightRef.current = true;
    const ctrl = new AbortController();
    fetch(buildQueryUrl(cursor), { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as PageResponse<CloudFile>;
      })
      .then((body) => {
        if (ctrl.signal.aborted) return;
        setItems((prev) => {
          const seen = new Set(prev.map((it) => it.id));
          const newOnes = (body.items ?? []).filter((it) => !seen.has(it.id));
          return newOnes.length === 0 ? prev : [...prev, ...newOnes];
        });
        const newCursor = body.hasMore ? body.nextCursor : undefined;
        setNextCursor(newCursor === cursor ? undefined : newCursor);
      })
      .catch((err) => {
        if ((err as { name?: string }).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : loadErrorLabel);
        }
      })
      .finally(() => {
        inflightRef.current = false;
      });
  }, [buildQueryUrl, loadErrorLabel]);

  return useMemo(
    () => ({
      items,
      setItems,
      loadingItems,
      nextCursor,
      error,
      setError,
      handleLoadMore,
      itemsConnectionId,
    }),
    [items, loadingItems, nextCursor, error, handleLoadMore, itemsConnectionId],
  );
}
