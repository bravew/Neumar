import { Loader2, Pencil, RefreshCw, Trash2 } from 'lucide-react';

import { CloudProviderIcon } from '@/components/library';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { Switch } from '../components/Switch';
import { providerLabel } from './provider-label';
import type { CloudStorageConnection } from './types';

interface CloudStorageConnectionRowProps {
  connection: CloudStorageConnection;
  deleting: boolean;
  assetIndexUpdating: boolean;
  assetSyncing: boolean;
  onAssetsIndexChange?: (enabled: boolean) => void;
  onAssetsSync?: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}

const PERSONAL_MEDIA_PROVIDERS = new Set(['immich', 'photoprism']);

export function CloudStorageConnectionRow({
  connection,
  deleting,
  assetIndexUpdating,
  assetSyncing,
  onAssetsIndexChange,
  onAssetsSync,
  onEdit,
  onRemove,
}: CloudStorageConnectionRowProps) {
  const { t } = useLanguage();
  const s = t.cloudStorage;
  const isPersonal = PERSONAL_MEDIA_PROVIDERS.has(connection.provider);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <CloudProviderIcon provider={connection.provider} className="size-5" />
        <div className="min-w-0">
          <p className="text-foreground truncate text-sm font-medium">
            {connection.displayName || providerLabel(connection.provider, s)}
          </p>
          <p className="text-muted-foreground text-xs">
            {providerLabel(connection.provider, s)}
          </p>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
        <span
          className={cn(
            'rounded-md px-2 py-0.5 text-xs font-medium',
            connection.status === 'active'
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {connection.status === 'active'
            ? s.connectionStatusActive
            : connection.status}
        </span>
        {isPersonal && (
          <span className="text-muted-foreground text-xs">
            {s.selfHostedMediaTitle}
          </span>
        )}
        {onAssetsIndexChange && (
          <div className="border-border flex items-center gap-2 rounded-md border px-2 py-1">
            <span className="text-muted-foreground text-xs">
              {s.indexInAssets}
            </span>
            <Switch
              checked={Boolean(connection.assetsCatalog?.enabled)}
              onChange={onAssetsIndexChange}
              disabled={assetIndexUpdating || connection.status !== 'active'}
              label={s.indexInAssets}
            />
            {onAssetsSync && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={
                  assetSyncing ||
                  !connection.assetsCatalog?.enabled ||
                  connection.status !== 'active'
                }
                onClick={onAssetsSync}
                aria-label={s.syncAssets}
                title={s.syncAssets}
              >
                {assetSyncing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            )}
          </div>
        )}
        {onEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onEdit}
            aria-label={s.editConnection}
            title={s.editConnection}
          >
            <Pencil className="size-4" />
          </Button>
        )}
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            disabled={deleting}
            onClick={onRemove}
            aria-label={s.removeConnection}
            title={s.removeConnection}
          >
            {deleting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
