import { useCallback, useEffect, useMemo, useState } from 'react';

import { ChevronDown, Database, Image, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { CloudStorageProviderSection } from '../CloudStorageProviderSection';
import { AssetsStorageBudgetNotice } from './AssetsStorageBudgetNotice';
import { CloudStorageConnectionRow } from './CloudStorageConnectionRow';
import { PathMappingsCard } from './PathMappingsCard';
import { PersonalMediaConnectDialog } from './PersonalMediaConnectDialog';
import { providerLabel } from './provider-label';
import {
  StockCatalogConnectDialog,
  STOCK_PROVIDERS,
  type StockProvider,
} from './StockCatalogConnectDialog';
import {
  StockCatalogProviderSection,
  stockProviderDescription,
  stockProviderDisplayName,
} from './StockCatalogProviderSection';
import type { CloudStorageConnection } from './types';

interface ConnectionsResponse {
  items?: CloudStorageConnection[];
}

interface ConnectionMutationResponse {
  item?: CloudStorageConnection;
}

const PERSONAL_MEDIA_PROVIDERS = new Set(['immich', 'photoprism']);
const GOOGLE_DRIVE_LOCAL_ID = 'local_google_drive';

export function CloudStorageConnectionsSection() {
  const { t } = useLanguage();
  const s = t.cloudStorage;
  const [connections, setConnections] = useState<CloudStorageConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [personalDialogOpen, setPersonalDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] =
    useState<CloudStorageConnection | null>(null);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [stockDialogProvider, setStockDialogProvider] = useState<
    StockProvider | undefined
  >();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [assetIndexUpdatingId, setAssetIndexUpdatingId] = useState<
    string | null
  >(null);
  const [assetSyncingId, setAssetSyncingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE_URL}/cloud-storage/connections`, {
          signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as ConnectionsResponse;
        setConnections(body.items ?? []);
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : s.connectionLoadError);
        }
      } finally {
        setLoading(false);
      }
    },
    [s.connectionLoadError],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const personalConnections = useMemo(
    () =>
      connections.filter((connection) =>
        PERSONAL_MEDIA_PROVIDERS.has(connection.provider),
      ),
    [connections],
  );

  const onCreated = useCallback((connection: CloudStorageConnection) => {
    setConnections((prev) => [connection, ...prev]);
  }, []);

  const onUpdated = useCallback((updated: CloudStorageConnection) => {
    setConnections((prev) =>
      prev.map((connection) =>
        connection.id === updated.id
          ? { ...connection, ...updated }
          : connection,
      ),
    );
  }, []);

  const toggleAssetsIndex = useCallback(
    async (connection: CloudStorageConnection, enabled: boolean) => {
      setAssetIndexUpdatingId(connection.id);
      setError('');
      try {
        const body = await patchJson<ConnectionMutationResponse>(
          `/connections/${encodeURIComponent(connection.id)}/assets-index`,
          { enabled },
        );
        if (body.item) onUpdated(body.item);
      } catch (err) {
        setError(err instanceof Error ? err.message : s.assetsIndexUpdateError);
      } finally {
        setAssetIndexUpdatingId(null);
      }
    },
    [onUpdated, s.assetsIndexUpdateError],
  );

  const syncAssets = useCallback(
    async (connection: CloudStorageConnection) => {
      setAssetSyncingId(connection.id);
      setError('');
      try {
        const body = await postJson<ConnectionMutationResponse>(
          `/connections/${encodeURIComponent(connection.id)}/assets-sync`,
          { mode: 'auto' },
        );
        if (body.item) onUpdated(body.item);
      } catch (err) {
        setError(err instanceof Error ? err.message : s.assetsIndexSyncError);
      } finally {
        setAssetSyncingId(null);
      }
    },
    [onUpdated, s.assetsIndexSyncError],
  );

  const openPersonalCreateDialog = useCallback(() => {
    setEditingConnection(null);
    setPersonalDialogOpen(true);
  }, []);

  const openPersonalEditDialog = useCallback(
    (connection: CloudStorageConnection) => {
      setEditingConnection(connection);
      setPersonalDialogOpen(true);
    },
    [],
  );

  const onPersonalDialogOpenChange = useCallback((open: boolean) => {
    setPersonalDialogOpen(open);
    if (!open) setEditingConnection(null);
  }, []);

  const removeConnection = useCallback(
    async (connection: CloudStorageConnection) => {
      const name =
        connection.displayName || providerLabel(connection.provider, s);
      if (!window.confirm(s.removeConnectionConfirm.replace('{name}', name))) {
        return;
      }

      setDeletingId(connection.id);
      setError('');
      try {
        await deleteJson(`/connections/${encodeURIComponent(connection.id)}`);
        setConnections((prev) =>
          prev.filter((current) => current.id !== connection.id),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : s.connectionDeleteError);
      } finally {
        setDeletingId(null);
      }
    },
    [s],
  );

  const activeCount = useMemo(
    () => connections.filter((c) => c.status === 'active').length,
    [connections],
  );

  return (
    <section className="border-border bg-card overflow-hidden rounded-xl border shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
      >
        <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Database className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-foreground text-base font-medium">
              {s.cloudStorageConnectorsTitle}
            </h3>
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums">
              {activeCount}
            </span>
          </div>
          <p className="text-muted-foreground text-sm">
            {s.cloudStorageConnectorsDescription}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="border-border space-y-4 border-t px-4 py-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => load()}
              aria-label={s.refreshConnections}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openPersonalCreateDialog}
            >
              <Image className="size-4" />
              {s.connectPersonalMedia}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setStockDialogOpen(true)}
            >
              <Database className="size-4" />
              {s.connectStockCatalog}
            </Button>
          </div>

          <AssetsStorageBudgetNotice />

          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="border-border divide-border divide-y rounded-lg border">
            <CloudStorageProviderSection
              provider="box"
              name="Box"
              description={t.settings.integrationBox}
              setupGuideUrl="https://app.box.com/developers/console"
            />
            <CloudStorageProviderSection
              provider="dropbox"
              name="Dropbox"
              description={t.settings.integrationDropbox}
              setupGuideUrl="https://www.dropbox.com/developers/apps"
            />
            <CloudStorageProviderSection
              provider="onedrive"
              name="OneDrive"
              description={t.settings.integrationOneDrive}
              setupGuideUrl="https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app"
            />
            {connections.map((connection) => (
              <CloudStorageConnectionRow
                key={connection.id}
                connection={connection}
                deleting={deletingId === connection.id}
                assetIndexUpdating={assetIndexUpdatingId === connection.id}
                assetSyncing={assetSyncingId === connection.id}
                onAssetsIndexChange={
                  connection.provider === 'immich'
                    ? (enabled) => toggleAssetsIndex(connection, enabled)
                    : undefined
                }
                onAssetsSync={
                  connection.provider === 'immich'
                    ? () => syncAssets(connection)
                    : undefined
                }
                onEdit={
                  canEditConnection(connection)
                    ? () => openPersonalEditDialog(connection)
                    : undefined
                }
                onRemove={
                  canRemoveConnection(connection)
                    ? () => removeConnection(connection)
                    : undefined
                }
              />
            ))}
            {connections.length === 0 && !loading && (
              <p className="text-muted-foreground px-4 py-3 text-center text-xs">
                {s.noCloudStorageConnections}
              </p>
            )}
          </div>

          <div>
            <h4 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
              {s.stockCatalogsSectionTitle}
            </h4>
            <div className="border-border divide-border divide-y rounded-lg border">
              {STOCK_PROVIDERS.map((provider) => (
                <StockCatalogProviderSection
                  key={provider}
                  provider={provider}
                  name={stockProviderDisplayName(provider, s)}
                  description={stockProviderDescription(provider, s)}
                  connections={connections.filter(
                    (c) => c.provider === provider,
                  )}
                  onConnect={(p) => {
                    setStockDialogProvider(p);
                    setStockDialogOpen(true);
                  }}
                  onRemove={(c) =>
                    canRemoveConnection(c) ? removeConnection(c) : undefined
                  }
                  removingId={deletingId}
                />
              ))}
            </div>
          </div>

          {personalConnections.map((connection) => (
            <PathMappingsCard
              key={connection.id}
              connectionId={connection.id}
            />
          ))}
        </div>
      )}

      <PersonalMediaConnectDialog
        open={personalDialogOpen}
        onOpenChange={onPersonalDialogOpenChange}
        onCreated={onCreated}
        connection={editingConnection}
        onUpdated={onUpdated}
      />
      <StockCatalogConnectDialog
        open={stockDialogOpen}
        onOpenChange={(open) => {
          setStockDialogOpen(open);
          if (!open) setStockDialogProvider(undefined);
        }}
        onCreated={onCreated}
        initialProvider={stockDialogProvider}
        lockProvider={Boolean(stockDialogProvider)}
      />
    </section>
  );
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/cloud-storage${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/cloud-storage${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

async function deleteJson(path: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/cloud-storage${path}`, {
    method: 'DELETE',
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
}

function canEditConnection(connection: CloudStorageConnection): boolean {
  return (
    connection.provider === 'immich' &&
    connection.capabilities?.selfHostedBaseUrl === true
  );
}

function canRemoveConnection(connection: CloudStorageConnection): boolean {
  return connection.id !== GOOGLE_DRIVE_LOCAL_ID;
}
