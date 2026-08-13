import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSearchParams } from 'react-router-dom';

import {
  File,
  Folder,
  Image,
  Loader2,
  RefreshCw,
  Search,
  Video,
  Volume2,
} from 'lucide-react';

import { useCloudStoragePickerItems } from '@/components/shared/useCloudStoragePickerItems';
import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { CloudProviderIcon } from './CloudProviderIcon';
import {
  MEDIA_GRID_PROVIDERS,
  MEDIA_KINDS,
  STOCK_PROVIDERS,
  toMediaGridItem,
  type CloudFile,
  type CloudStorageConnection,
  type MediaKind,
} from './cloudStorageLibraryUtils';
import { CloudStorageMediaLightbox } from './CloudStorageMediaLightbox';
import { EMPTY_FILTERS } from './CloudStorageSearchOptionsDialog';
import {
  decodeFolderPath,
  encodeFolderPath,
  FolderBreadcrumbs,
  FolderStrip,
  folderStripLabel,
  type FolderPathEntry,
} from './FolderNavigation';
import { LicenseFilter, type StockLicenseCode } from './LicenseFilter';
import { MediaGridView, type MediaGridItem } from './MediaGridView';
import { MediaTimelineView } from './MediaTimelineView';

interface PageResponse<T> {
  items?: T[];
  nextCursor?: string;
  hasMore?: boolean;
}

export function CloudStorageLibraryTab() {
  const { t, language } = useLanguage();
  const s = t.cloudStorage;
  const [connections, setConnections] = useState<CloudStorageConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MediaKind>('all');
  const [licenses, setLicenses] = useState<StockLicenseCode[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(-1);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  // Folder navigation is persisted in the URL (`?folder=<base64>`) so the
  // browser back/forward buttons (and the trackpad swipe gesture) walk up
  // the breadcrumb the same way they do in Google Drive Web and Box Web.
  // Source of truth is `searchParams.folder`; local state mirrors it.
  const [searchParams, setSearchParams] = useSearchParams();
  const folderPath = useMemo<FolderPathEntry[]>(
    () => decodeFolderPath(searchParams.get('folder')),
    [searchParams],
  );
  const parentId = folderPath.at(-1)?.id ?? null;

  const updateFolderPath = useCallback(
    (
      next:
        | FolderPathEntry[]
        | ((prev: FolderPathEntry[]) => FolderPathEntry[]),
    ) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          const previous = decodeFolderPath(params.get('folder'));
          const resolved = typeof next === 'function' ? next(previous) : next;
          if (resolved.length === 0) params.delete('folder');
          else params.set('folder', encodeFolderPath(resolved));
          return params;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  // Switching providers / running a search resets the drill state so the
  // user isn't browsing inside a folder that no longer exists in the new
  // context. Same intent as Drive: searching collapses you to a flat result
  // list. Guard against the initial render so we don't strip a `folder=`
  // param that the URL already supplied.
  const skipResetOnMount = useRef(true);
  useEffect(() => {
    if (skipResetOnMount.current) {
      skipResetOnMount.current = false;
      return;
    }
    updateFolderPath([]);
    // We intentionally key on connection only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConnectionId]);
  useEffect(() => {
    if (query.trim() && folderPath.length > 0) updateFolderPath([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const {
    items,
    setItems,
    loadingItems,
    nextCursor,
    error,
    setError,
    handleLoadMore,
    itemsConnectionId,
  } = useCloudStoragePickerItems({
    open: true,
    selectedConnectionId,
    parentId,
    query,
    kind,
    licenses,
    filters: EMPTY_FILTERS,
    loadErrorLabel: s.connectionLoadError,
  });

  // Same guard as CloudStorageAssetPicker: gate URL synthesis until the
  // items in state actually belong to the currently-selected connection.
  // Otherwise switching from e.g. Drive → Box leaks Drive item ids into
  // /local_box/items/<id>/thumbnail for one render.
  const renderConnectionId =
    itemsConnectionId === selectedConnectionId ? selectedConnectionId : '';

  const selectedConnection = useMemo(
    () =>
      connections.find((connection) => connection.id === selectedConnectionId),
    [connections, selectedConnectionId],
  );

  const loadConnections = useCallback(
    async (signal?: AbortSignal) => {
      setLoadingConnections(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE_URL}/cloud-storage/connections`, {
          signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as PageResponse<CloudStorageConnection>;
        if (!signal?.aborted) {
          const nextConnections = body.items ?? [];
          setConnections(nextConnections);
          setSelectedConnectionId((current) =>
            nextConnections.some((connection) => connection.id === current)
              ? current
              : (nextConnections[0]?.id ?? ''),
          );
        }
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : s.connectionLoadError);
        }
      } finally {
        if (!signal?.aborted) setLoadingConnections(false);
      }
    },
    [s.connectionLoadError, setError],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    loadConnections(ctrl.signal);
    return () => ctrl.abort();
  }, [loadConnections]);

  // Server already filters by media_kind (when kind is image/video/audio/document)
  // and by license_filter. Only filter client-side for `folder` since the server
  // doesn't express folder filtering via media_kind.
  const renderItems = renderConnectionId ? items : [];
  const filteredItems = useMemo(
    () =>
      kind === 'folder'
        ? renderItems.filter((item) => toMediaGridItem(item).kind === 'folder')
        : renderItems,
    [renderItems, kind],
  );

  const mediaItems = useMemo(
    () =>
      filteredItems.map((item) =>
        toMediaGridItem(item, {
          connectionId: renderConnectionId,
          videoStreamUrl: item.mimeType?.startsWith('video/')
            ? `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
                renderConnectionId,
              )}/items/${encodeURIComponent(item.id)}/content`
            : undefined,
        }),
      ),
    [filteredItems, renderConnectionId],
  );

  // Pull folders out of the main media list and render them as a dedicated
  // strip above the timeline. Without this, Immich albums (which carry a
  // creation date) get interleaved with photos in chronological order and
  // disappear into the timeline — matching Google Drive's "Folders" header
  // section and Immich's own Albums-above-Timeline layout.
  const [folderItems, nonFolderItems] = useMemo(() => {
    const folders: MediaGridItem[] = [];
    const rest: MediaGridItem[] = [];
    for (const item of mediaItems) {
      if (item.kind === 'folder') folders.push(item);
      else rest.push(item);
    }
    return [folders, rest] as const;
  }, [mediaItems]);

  // Show the folder strip at any depth (root or inside a folder) — as long
  // as the user isn't running a search. Matches Google Drive Web: sub-folders
  // appear in a "Folders" header above the files in the same folder.
  const showFoldersStrip = !query.trim() && folderItems.length > 0;
  const gridItems = showFoldersStrip ? nonFolderItems : mediaItems;

  const previewContentUrl = useCallback(
    (item: CloudFile) =>
      `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
        selectedConnectionId,
      )}/items/${encodeURIComponent(item.id)}/content`,
    [selectedConnectionId],
  );

  const previewThumbnailUrl = useCallback(
    (item: CloudFile) => {
      const value = item.thumbnailUrl;
      if (!value) return value;
      const match = /^([\w-]+)-thumbnail:(.+)$/.exec(value);
      if (!match) return value;
      const assetId = match[2];
      if (!assetId) return undefined;
      return `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
        selectedConnectionId,
      )}/items/${encodeURIComponent(assetId)}/thumbnail`;
    },
    [selectedConnectionId],
  );

  const handlePreview = useCallback(
    (target: { id: string }) => {
      const idx = filteredItems.findIndex((file) => file.id === target.id);
      if (idx >= 0) setPreviewIndex(idx);
    },
    [filteredItems],
  );

  // Single-click handler: a folder navigates into itself, a file opens the
  // preview. Matches Google Drive's "single-click to drill" convention (it
  // replaced double-click in 2024) and Box's web picker behaviour.
  const handleOpenItem = useCallback(
    (target: MediaGridItem) => {
      if (target.kind === 'folder') {
        updateFolderPath((prev) => [
          ...prev,
          { id: target.id, name: target.name },
        ]);
        return;
      }
      handlePreview(target);
    },
    [handlePreview, updateFolderPath],
  );

  const handleBreadcrumbNavigate = useCallback(
    (depth: number) => {
      // depth = 0 means "Home"; otherwise truncate the stack to that depth.
      updateFolderPath((prev) => prev.slice(0, depth));
    },
    [updateFolderPath],
  );

  const lightboxCapabilities = useMemo(() => {
    const writable =
      selectedConnection?.capabilities?.mediaMetadata?.writableFields ?? [];
    return {
      canFavorite: writable.includes('isFavorite'),
      canRotate: false,
      canDelete: !selectedConnection?.capabilities?.readOnly,
    };
  }, [selectedConnection]);

  const updateLocalItem = useCallback(
    (id: string, updater: (item: CloudFile) => CloudFile) => {
      setItems((prev) =>
        prev.map((item) => (item.id === id ? updater(item) : item)),
      );
    },
    [setItems],
  );

  const handleToggleFavorite = useCallback(
    async (item: CloudFile) => {
      if (!selectedConnectionId) return;
      const previous = item.mediaMetadata?.isFavorite ?? false;
      setPendingActionId(item.id);
      updateLocalItem(item.id, (current) => ({
        ...current,
        mediaMetadata: {
          ...current.mediaMetadata,
          isFavorite: !previous,
        },
      }));
      try {
        const res = await fetch(
          `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
            selectedConnectionId,
          )}/items/${encodeURIComponent(item.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              metadata: { isFavorite: String(!previous) },
            }),
          },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        updateLocalItem(item.id, (current) => ({
          ...current,
          mediaMetadata: {
            ...current.mediaMetadata,
            isFavorite: previous,
          },
        }));
        setError(err instanceof Error ? err.message : s.previewActionFailed);
      } finally {
        setPendingActionId(null);
      }
    },
    [s.previewActionFailed, selectedConnectionId, setError, updateLocalItem],
  );

  const handleDelete = useCallback(
    async (item: CloudFile) => {
      if (!selectedConnectionId) return;
      setPendingActionId(item.id);
      try {
        const res = await fetch(
          `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
            selectedConnectionId,
          )}/items/${encodeURIComponent(item.id)}`,
          { method: 'DELETE' },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setItems((prev) => prev.filter((it) => it.id !== item.id));
        setPreviewIndex(-1);
      } catch (err) {
        setError(err instanceof Error ? err.message : s.previewActionFailed);
      } finally {
        setPendingActionId(null);
      }
    },
    [s.previewActionFailed, selectedConnectionId, setError, setItems],
  );

  const useMediaGrid =
    selectedConnection?.capabilities?.preferredView === 'media-grid' ||
    MEDIA_GRID_PROVIDERS.has(selectedConnection?.provider ?? '') ||
    mediaItems.some((item) => item.kind && item.kind !== 'document');

  const showLicenseFilter = STOCK_PROVIDERS.has(
    selectedConnection?.provider ?? '',
  );

  if (loadingConnections && connections.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-48 items-center justify-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {s.loadingConnections}
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-48 items-center justify-center text-sm">
        {s.noCloudStorageConnections}
      </div>
    );
  }

  return (
    <section className="space-y-5" data-testid="cloud-storage-library-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {connections.map((connection) => (
            <button
              key={connection.id}
              type="button"
              onClick={() => setSelectedConnectionId(connection.id)}
              className={cn(
                'border-border text-muted-foreground hover:text-foreground inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors',
                selectedConnectionId === connection.id &&
                  'border-primary bg-primary/10 text-primary',
              )}
            >
              <CloudProviderIcon
                provider={connection.provider}
                className="size-4"
              />
              <span className="truncate">
                {connection.displayName ||
                  providerLabel(connection.provider, s)}
              </span>
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => loadConnections()}
          aria-label={s.refreshConnections}
        >
          {loadingConnections ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
        </Button>
      </div>

      <div className="space-y-3">
        <label className="border-input bg-background flex h-10 items-center gap-2 rounded-md border px-3 text-sm">
          <Search className="text-muted-foreground size-4" aria-hidden />
          <input
            data-testid="cloud-storage-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={s.mediaSearchPlaceholder}
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {MEDIA_KINDS.map((nextKind) => (
            <button
              key={nextKind}
              type="button"
              aria-pressed={kind === nextKind}
              onClick={() => setKind(nextKind)}
              className={cn(
                'border-border text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
                kind === nextKind &&
                  'border-primary bg-primary/10 text-primary',
              )}
            >
              <KindIcon kind={nextKind} />
              {kindLabel(nextKind, s)}
            </button>
          ))}
        </div>

        {showLicenseFilter ? (
          <LicenseFilter value={licenses} onChange={setLicenses} />
        ) : null}

        {folderPath.length > 0 ? (
          <FolderBreadcrumbs
            path={folderPath}
            rootLabel={
              selectedConnection?.displayName ??
              providerLabel(selectedConnection?.provider ?? '', s)
            }
            onNavigate={handleBreadcrumbNavigate}
          />
        ) : null}
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      {loadingItems ? (
        <div className="text-muted-foreground flex min-h-40 items-center justify-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {s.loadingMedia}
        </div>
      ) : (
        <>
          {showFoldersStrip ? (
            <FolderStrip
              items={folderItems}
              label={folderStripLabel(selectedConnection?.provider ?? '', s)}
              language={language ?? 'en'}
              s={s as Record<string, string>}
              onOpen={handleOpenItem}
            />
          ) : null}
          {useMediaGrid ? (
            gridItems.some((item) => item.takenAt) ? (
              <div className="h-[80vh]">
                <MediaTimelineView
                  items={gridItems}
                  onOpen={handleOpenItem}
                  onPreview={handlePreview}
                  onLoadMore={handleLoadMore}
                  hasMore={!!nextCursor}
                />
              </div>
            ) : (
              <MediaGridView
                items={gridItems}
                onOpen={handleOpenItem}
                onPreview={handlePreview}
              />
            )
          ) : (
            <FileList items={gridItems} onOpenFolder={handleOpenItem} />
          )}
        </>
      )}

      <CloudStorageMediaLightbox
        open={previewIndex >= 0}
        index={Math.max(0, previewIndex)}
        items={filteredItems}
        contentUrl={previewContentUrl}
        thumbnailUrl={previewThumbnailUrl}
        capabilities={lightboxCapabilities}
        actions={{
          pendingId: pendingActionId ?? undefined,
          onToggleFavorite: handleToggleFavorite,
          onDelete: handleDelete,
        }}
        onClose={() => setPreviewIndex(-1)}
        onIndexChange={setPreviewIndex}
      />
    </section>
  );
}

function FileList({
  items,
  onOpenFolder,
}: {
  items: MediaGridItem[];
  onOpenFolder?: (item: MediaGridItem) => void;
}) {
  const { t } = useLanguage();
  if (items.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-40 items-center justify-center text-sm">
        {t.cloudStorage.noMediaResults}
      </div>
    );
  }
  return (
    <div className="border-border overflow-hidden rounded-lg border">
      {items.map((item) => {
        const isFolder = item.kind === 'folder';
        const content = (
          <>
            <KindIcon kind={item.kind ?? 'document'} />
            <span className="text-foreground min-w-0 truncate text-sm">
              {item.name}
            </span>
          </>
        );
        if (isFolder && onOpenFolder) {
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenFolder(item)}
              className="border-border hover:bg-muted/50 flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-b-0"
            >
              {content}
            </button>
          );
        }
        return (
          <div
            key={item.id}
            className="border-border flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

function providerLabel(provider: string, s: Record<string, string>) {
  const key = `provider${provider
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}`;
  return s[key] ?? provider;
}

function kindLabel(kind: MediaKind, s: Record<string, string>) {
  const labels: Record<MediaKind, string> = {
    all: s.mediaKindAll,
    image: s.mediaKindImages,
    video: s.mediaKindVideos,
    audio: s.mediaKindAudio,
    document: s.mediaKindDocuments,
    folder: s.mediaKindFolders,
  };
  return labels[kind];
}

function KindIcon({ kind }: { kind: MediaKind }) {
  const className = 'size-4';
  if (kind === 'image') return <Image className={className} aria-hidden />;
  if (kind === 'video') return <Video className={className} aria-hidden />;
  if (kind === 'audio') return <Volume2 className={className} aria-hidden />;
  if (kind === 'folder') return <Folder className={className} aria-hidden />;
  return <File className={className} aria-hidden />;
}
