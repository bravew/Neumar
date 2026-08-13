import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CreativeAssetBrowser } from '@/components/creative/CreativeAssetBrowser';
import { AssetFilters } from '@/components/library/assets/AssetFilters';
import { AssetGrid } from '@/components/library/assets/AssetGrid';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchAssets } from '@/shared/assets/api';
import type { Asset, AssetQueryState } from '@/shared/assets/types';
import { useLanguage } from '@/shared/providers/language-provider';

// After this delay, surface a non-blocking "taking longer" hint with a retry
// affordance — but do NOT abort the request. The backend returns the indexed
// page without blocking on provider latency, so a slow-but-alive load should
// still resolve and replace the hint, never wipe the view to an empty error.
const SLOW_LOAD_HINT_MS = 15000;

// Hard ceiling: a healthy backend returns the indexed page in well under a
// second, so a load still pending this long is genuinely stuck (e.g. the
// browser's per-host connection pool is saturated by the long-lived editor, or
// the API is unreachable). Abort it so the grid recovers into a retryable error
// instead of spinning forever behind the slow hint.
const LOAD_HARD_TIMEOUT_MS = 45000;

const DEFAULT_QUERY: AssetQueryState = {
  q: '',
  kind: 'all',
  source: 'all',
  tags: '',
  from: '',
  to: '',
  semantic: false,
};

interface AssetCatalogPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Fire-and-forget: the dialog closes immediately on click and the
  // background download surfaces progress through the materialization
  // notice + per-tile badge. The handler may run for minutes; it must
  // not block the dialog from closing.
  onAttach: (assetIds: string[]) => void;
}

export function AssetCatalogPickerDialog({
  open,
  onOpenChange,
  onAttach,
}: AssetCatalogPickerDialogProps) {
  const { t } = useLanguage();
  const s = t.assets;
  const [query, setQuery] = useState<AssetQueryState>(DEFAULT_QUERY);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const selectedIdsRef = useRef<string[]>([]);
  const loadMoreCtrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  const retry = useCallback(() => {
    setError('');
    setReloadNonce((nonce) => nonce + 1);
  }, []);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    let timedOut = false;
    setLoading(true);
    setSlow(false);
    setError('');
    // Hint-only timer: flag the load as slow without aborting it, so a slow
    // request still completes and shows its results. Retry (below) is what
    // actually cancels and refetches if the user wants a fresh attempt.
    const slowTimer = setTimeout(() => setSlow(true), SLOW_LOAD_HINT_MS);
    // Hard timeout: a load still pending past the ceiling is stuck, not slow —
    // abort it so the dialog falls through to the retryable error state instead
    // of spinning indefinitely behind the slow hint.
    const hardTimer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, LOAD_HARD_TIMEOUT_MS);
    fetchAssets(query, { signal: ctrl.signal })
      .then((page) => {
        if (ctrl.signal.aborted) return;
        setAssets(page.assets);
        setNextCursor(page.nextCursor);
        setSelectedIds([]);
      })
      .catch((err) => {
        // A hard-timeout abort is a genuine failure — surface it as a
        // retryable error distinct from the slow hint. Our own abort (unmount
        // or retry) is expected and ignored.
        if (timedOut) {
          setError(s.error);
          return;
        }
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : s.error);
      })
      .finally(() => {
        clearTimeout(slowTimer);
        clearTimeout(hardTimer);
        // Clear the spinner on resolution and on the hard-timeout abort (whose
        // signal is aborted) — but not on an unmount/retry abort, which is
        // tearing the effect down anyway.
        if (!ctrl.signal.aborted || timedOut) {
          setLoading(false);
          setSlow(false);
        }
      });
    return () => {
      clearTimeout(slowTimer);
      clearTimeout(hardTimer);
      ctrl.abort();
    };
  }, [open, query, s.error, reloadNonce]);

  useEffect(
    () => () => {
      loadMoreCtrlRef.current?.abort();
    },
    [],
  );

  const updateQuery = useCallback((patch: Partial<AssetQueryState>) => {
    setQuery((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }, []);

  const getSelectedIds = useCallback(() => selectedIdsRef.current, []);

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
      if ((err as { name?: string }).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : s.error);
      }
    } finally {
      if (!ctrl.signal.aborted) setLoadingMore(false);
    }
  }, [nextCursor, query, s.error]);

  const summary = useMemo(
    () =>
      s.resultsCount.replace('{count}', String(assets.length)) +
      (selectedIds.length
        ? ` · ${s.selectedCount.replace('{count}', String(selectedIds.length))}`
        : ''),
    [assets.length, s, selectedIds.length],
  );

  const handleAttach = useCallback(() => {
    if (selectedIds.length === 0) return;
    // Fire the attach in the background — the parent shows a queued
    // toast and per-tile progress badges drive the rest of the UX. Any
    // errors surface as toasts from the caller, not inline here.
    onAttach(selectedIds);
    setSelectedIds([]);
    onOpenChange(false);
  }, [onAttach, onOpenChange, selectedIds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] max-h-[88vh] max-w-6xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{s.browseCatalog}</DialogTitle>
          <DialogDescription>{s.browseCatalogDescription}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden pr-1">
          <CreativeAssetBrowser
            query={query.q}
            onQueryChange={(q) => updateQuery({ q })}
            queryPlaceholder={s.searchPlaceholder}
            semantic={query.semantic}
            onSemanticChange={(semantic) => updateQuery({ semantic })}
            empty={!loading && !error && assets.length === 0}
            emptyMessage={s.emptyHint}
            contentClassName="show-scrollbar"
            totalCount={assets.length}
            selectedCount={selectedIds.length}
            filterPanel={
              <AssetFilters
                query={query}
                onChange={updateQuery}
                onClear={() => setQuery(DEFAULT_QUERY)}
              />
            }
          >
            {error ? (
              <div className="flex items-center gap-3">
                <p className="text-destructive text-sm">{error}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={retry}
                >
                  {s.retry}
                </Button>
              </div>
            ) : slow && loading ? (
              <div className="flex items-center gap-3">
                <p className="text-muted-foreground text-sm">{s.loadTimeout}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={retry}
                >
                  {s.retry}
                </Button>
              </div>
            ) : null}
            <AssetGrid
              assets={assets}
              loading={loading}
              selectedIds={selectedIds}
              getSelectedIds={getSelectedIds}
              onOpen={(asset) => toggleSelected(asset.id)}
              onToggleSelected={toggleSelected}
              hasMore={Boolean(nextCursor)}
              loadingMore={loadingMore}
              onLoadMore={handleLoadMore}
            />
          </CreativeAssetBrowser>
        </div>
        <DialogFooter className="items-center gap-3 sm:justify-between sm:space-x-0">
          <p
            className="text-muted-foreground min-w-0 truncate text-xs tabular-nums"
            aria-live="polite"
          >
            {summary}
          </p>
          <div className="flex shrink-0 justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {s.cancel}
            </Button>
            <Button
              type="button"
              onClick={handleAttach}
              disabled={selectedIds.length === 0}
            >
              {selectedIds.length
                ? s.attachSelectedCount.replace(
                    '{count}',
                    String(selectedIds.length),
                  )
                : s.attachSelected}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
