import { useEffect, useMemo, useRef, useState } from 'react';

import { Loader2 } from 'lucide-react';

import { type StockLicenseCode } from '@/components/library';
import {
  CloudStorageSearchOptionsDialog,
  EMPTY_FILTERS,
  isFiltersActive,
  MediaGridView,
  MediaTimelineView,
  type CloudSearchFilters,
} from '@/components/library';
import {
  licenseMatches,
  MEDIA_GRID_PROVIDERS,
  STOCK_PROVIDERS,
  toMediaGridItem,
  type CloudFile,
  type CloudStorageConnection,
  type MediaKind,
} from '@/components/library/cloudStorageLibraryUtils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

import { CloudStorageListView } from './CloudStorageListView';
import { CloudStorageMediaPreviewDialog } from './CloudStorageMediaPreviewDialog';
import { CloudStoragePickerControls } from './CloudStoragePickerControls';
import { withPickerPreviewUrls } from './cloudStoragePickerUtils';
import { useCloudStoragePickerItems } from './useCloudStoragePickerItems';

export interface CloudStoragePickerItem {
  connectionId: string;
  connectionProvider: string;
  connectionLabel?: string;
  item: CloudFile;
}

interface CloudStorageAssetPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (items: CloudStoragePickerItem[]) => void;
}

interface PageResponse<T> {
  items?: T[];
  nextCursor?: string;
  hasMore?: boolean;
}

export function CloudStorageAssetPicker({
  open,
  onOpenChange,
  onSelect,
}: CloudStorageAssetPickerProps) {
  const { t } = useLanguage();
  const s = t.cloudStorage;
  const [connections, setConnections] = useState<CloudStorageConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [folderStack, setFolderStack] = useState<CloudFile[]>([]);
  const [selectedItems, setSelectedItems] = useState<Record<string, CloudFile>>(
    {},
  );
  const [previewItem, setPreviewItem] = useState<CloudFile | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MediaKind>('all');
  const [licenses, setLicenses] = useState<StockLicenseCode[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [filters, setFilters] = useState<CloudSearchFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const {
    items,
    loadingItems,
    nextCursor,
    error,
    setError,
    handleLoadMore,
    itemsConnectionId,
  } = useCloudStoragePickerItems({
    open,
    selectedConnectionId,
    parentId,
    query,
    kind,
    licenses,
    filters,
    loadErrorLabel: s.connectionLoadError,
  });

  const selectedConnection = useMemo(
    () =>
      connections.find((connection) => connection.id === selectedConnectionId),
    [connections, selectedConnectionId],
  );

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setLoadingConnections(true);
    setError('');
    fetch(`${API_BASE_URL}/cloud-storage/connections`, {
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as PageResponse<CloudStorageConnection>;
      })
      .then((body) => {
        if (ctrl.signal.aborted) return;
        const nextConnections = body.items ?? [];
        setConnections(nextConnections);
        setSelectedConnectionId((current) =>
          nextConnections.some((connection) => connection.id === current)
            ? current
            : (nextConnections[0]?.id ?? ''),
        );
      })
      .catch((err) => {
        if ((err as { name?: string }).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : s.connectionLoadError);
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoadingConnections(false);
      });
    return () => ctrl.abort();
  }, [open, s.connectionLoadError, setError]);

  useEffect(() => {
    setParentId(null);
    setFolderStack([]);
    setSelectedItems({});
    setPreviewItem(null);
  }, [selectedConnectionId]);

  // Browser back inside the picker should pop the folder stack instead
  // of closing the dialog (which is the natural Dialog → onOpenChange
  // behavior when the page navigates back). We push a history entry on
  // folder-enter (see handleOpen) and listen for popstate here. When the
  // stack is non-empty we pop one folder; when empty we let onOpenChange
  // close the dialog normally. `pushedHistoryRef` tracks how many entries
  // we've added since open so the dialog-close path can unwind them with a
  // single `history.go(-n)` instead of leaving stale states behind that
  // hijack the user's back button after the picker is dismissed.
  const pushedHistoryRef = useRef(0);

  useEffect(() => {
    if (!open) {
      pushedHistoryRef.current = 0;
      return;
    }
    const onPopState = () => {
      if (pushedHistoryRef.current > 0) pushedHistoryRef.current -= 1;
      setFolderStack((current) => {
        if (current.length === 0) {
          onOpenChange(false);
          return current;
        }
        const nextStack = current.slice(0, -1);
        setParentId(nextStack.at(-1)?.id ?? null);
        return nextStack;
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [open, onOpenChange]);

  // Unwind any history entries we pushed when the dialog closes via any
  // path other than browser-back (X button, Escape, selection-commit). The
  // popstate handler already decrements pushedHistoryRef on each pop, so
  // by the time we run this effect with `open === false` the remaining
  // count is exactly what we still need to roll back.
  useEffect(() => {
    if (open) return;
    const count = pushedHistoryRef.current;
    if (count > 0) {
      pushedHistoryRef.current = 0;
      try {
        window.history.go(-count);
      } catch {
        /* history API may be unavailable in some embedders */
      }
    }
  }, [open]);

  // Suppress rendering until the items in state actually belong to the
  // currently-selected connection — otherwise the picker briefly builds
  // thumbnail URLs like /local_box/items/<drive-id>/thumbnail after the
  // user switches connections (Drive item ids leaked into the Box URL
  // prefix because items state trails selectedConnectionId by one render).
  const renderConnectionId =
    itemsConnectionId === selectedConnectionId ? selectedConnectionId : '';
  const renderItems = renderConnectionId ? items : [];
  const mediaItems = useMemo(
    () =>
      renderItems
        .map((item) =>
          toMediaGridItem(withPickerPreviewUrls(item, renderConnectionId), {
            connectionId: renderConnectionId,
            videoStreamUrl: item.mimeType?.startsWith('video/')
              ? `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
                  renderConnectionId,
                )}/items/${encodeURIComponent(item.id)}/content`
              : undefined,
          }),
        )
        .filter((item) => kind === 'all' || item.kind === kind)
        .filter((item) => licenseMatches(item, licenses)),
    [renderItems, renderConnectionId, kind, licenses],
  );

  const showLicenseFilter = STOCK_PROVIDERS.has(
    selectedConnection?.provider ?? '',
  );
  const showMediaFilters = connections.some(
    (connection) =>
      connection.capabilities?.preferredView === 'media-grid' ||
      MEDIA_GRID_PROVIDERS.has(connection.provider),
  );
  const showAdvancedFilters = selectedConnection?.provider === 'immich';
  const advancedActive = isFiltersActive(filters);

  const selectedEntries = useMemo(
    () => Object.values(selectedItems),
    [selectedItems],
  );

  function toggleSelection(itemId: string) {
    const raw = items.find((item) => item.id === itemId);
    if (!raw) return;
    setSelectedItems((current) => {
      if (current[itemId]) {
        const { [itemId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [itemId]: raw };
    });
  }

  function handleOpen(itemId: string) {
    const raw = items.find((item) => item.id === itemId);
    if (!raw) return;
    if (raw.isFolder) {
      setParentId(raw.id);
      setFolderStack((current) => [...current, raw]);
      setQuery('');
      // Push a history entry so the browser back button pops the folder
      // instead of closing the picker dialog. The popstate listener
      // below pops the stack; if the stack is already empty it falls
      // through to the dialog's onOpenChange(false).
      try {
        window.history.pushState(
          { picker: 'cloud-storage', folderId: raw.id },
          '',
        );
        pushedHistoryRef.current += 1;
      } catch {
        /* history API may be unavailable in some embedders */
      }
      return;
    }
    toggleSelection(itemId);
  }

  async function handlePreview(itemId: string) {
    const raw = items.find((item) => item.id === itemId);
    if (!raw || raw.isFolder || !selectedConnection) return;
    setPreviewItem(withPickerPreviewUrls(raw, selectedConnection.id));
    try {
      const res = await fetch(
        `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
          selectedConnection.id,
        )}/items/${encodeURIComponent(raw.id)}`,
      );
      if (res.ok) {
        const detailed = (await res.json()) as CloudFile;
        setPreviewItem(withPickerPreviewUrls(detailed, selectedConnection.id));
      }
    } catch {
      // Keep the summary preview open when rich metadata cannot be loaded.
    }
  }

  function navigateToDepth(depth: number) {
    // depth 0 = root (empty stack), N = keep the first N folders.
    setFolderStack((current) => {
      if (depth >= current.length) return current;
      const nextStack = current.slice(0, depth);
      setParentId(nextStack.at(-1)?.id ?? null);
      return nextStack;
    });
  }

  function handleAttachSelected() {
    if (!selectedConnection || selectedEntries.length === 0) return;
    onSelect(
      selectedEntries.map((item) => ({
        connectionId: selectedConnection.id,
        connectionProvider: selectedConnection.provider,
        connectionLabel:
          selectedConnection.displayName?.trim() || selectedConnection.provider,
        item,
      })),
    );
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden p-0 sm:rounded-none">
        <DialogHeader className="border-border flex-row items-center gap-3 border-b px-4 py-2">
          <DialogTitle className="shrink-0 text-sm font-semibold">
            {s.cloudStoragePickerTitle}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {s.cloudStoragePickerDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
          <CloudStoragePickerControls
            connections={connections}
            selectedConnectionId={selectedConnectionId}
            query={query}
            kind={kind}
            licenses={licenses}
            folderStack={folderStack}
            showMediaFilters={showMediaFilters}
            showLicenseFilter={showLicenseFilter}
            showAdvancedFilters={showAdvancedFilters}
            hasActiveFilters={advancedActive}
            strings={s as unknown as Record<string, string>}
            onConnectionChange={setSelectedConnectionId}
            onQueryChange={setQuery}
            onKindChange={setKind}
            onLicensesChange={setLicenses}
            onNavigateToDepth={navigateToDepth}
            onOpenAdvancedFilters={() => setFiltersOpen(true)}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div className="min-h-0 flex-1 overflow-hidden">
            {loadingConnections || loadingItems ? (
              <div className="text-muted-foreground flex min-h-56 items-center justify-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {s.loadingMedia}
              </div>
            ) : connections.length === 0 ? (
              <div className="text-muted-foreground flex min-h-56 items-center justify-center text-sm">
                {s.noCloudStorageConnections}
              </div>
            ) : viewMode === 'list' ? (
              <div className="size-full overflow-y-auto">
                <CloudStorageListView
                  items={renderItems}
                  connectionId={renderConnectionId}
                  selectedIds={Object.keys(selectedItems)}
                  onOpen={(id) => handleOpen(id)}
                  onPreview={(id) => {
                    void handlePreview(id);
                  }}
                  onToggleSelect={(id) => toggleSelection(id)}
                  onLoadMore={nextCursor ? handleLoadMore : undefined}
                />
              </div>
            ) : mediaItems.some((item) => item.takenAt) ? (
              <MediaTimelineView
                items={mediaItems}
                onOpen={(item) => handleOpen(item.id)}
                onPreview={(item) => {
                  void handlePreview(item.id);
                }}
                onToggleSelect={(item) => toggleSelection(item.id)}
                selectedIds={Object.keys(selectedItems)}
                onLoadMore={handleLoadMore}
                hasMore={!!nextCursor}
                className="size-full"
              />
            ) : (
              <div className="size-full overflow-y-auto pr-1">
                <MediaGridView
                  items={mediaItems}
                  onOpen={(item) => handleOpen(item.id)}
                  onPreview={(item) => {
                    void handlePreview(item.id);
                  }}
                  onToggleSelect={(item) => toggleSelection(item.id)}
                  selectedIds={Object.keys(selectedItems)}
                />
              </div>
            )}
          </div>
        </div>

        {selectedEntries.length > 0 ? (
          <DialogFooter className="border-border border-t px-6 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
              <span className="text-muted-foreground shrink-0">
                {s.selectedMediaCount.replace(
                  '{count}',
                  String(selectedEntries.length),
                )}
              </span>
              <span className="text-foreground truncate">
                {selectedEntries.map((item) => item.name).join(', ')}
              </span>
            </div>
            <Button type="button" onClick={handleAttachSelected}>
              {s.attachSelectedMedia}
            </Button>
          </DialogFooter>
        ) : null}
        <CloudStorageMediaPreviewDialog
          connectionId={selectedConnectionId}
          item={previewItem}
          open={previewItem !== null}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setPreviewItem(null);
          }}
        />
        <CloudStorageSearchOptionsDialog
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          initial={filters}
          onApply={(next) => {
            setFilters(next);
            if (next.query) setQuery(next.query);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
