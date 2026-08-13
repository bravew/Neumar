/**
 * PluginSourcesPanel — manage marketplace catalog sources: add a catalog URL
 * with a user-assigned trust level, refresh, and remove. Mirrors the Sources
 * model from the plugin consolidation plan (dev-doc/plan/07-04-plugin-system).
 */

import { useState } from 'react';

import { RefreshCw, Trash2 } from 'lucide-react';

import {
  useMarketplaceSources,
  type MarketplaceSource,
  type MarketplaceSourceTrust,
} from '@/shared/hooks/useMarketplaceSources';
import { useLanguage } from '@/shared/providers/language-provider';

import { TrustBadge } from './DetailPrimitives';

export function PluginSourcesPanel() {
  const { t } = useLanguage();
  const {
    sources,
    loading,
    error,
    actionPending,
    addSource,
    refreshSource,
    removeSource,
  } = useMarketplaceSources();

  const [url, setUrl] = useState('');
  const [trust, setTrust] = useState<MarketplaceSourceTrust>('restricted');
  const [actionError, setActionError] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!url.trim()) return;
    setActionError(null);
    try {
      await addSource({ url: url.trim(), trust });
      setUrl('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSourceAction = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border flex flex-col gap-2 rounded-md border p-3">
        <label
          className="text-muted-foreground text-xs font-medium"
          htmlFor="plugin-source-url"
        >
          {t.plugins.sources.urlLabel}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="plugin-source-url"
            type="url"
            data-testid="plugin-source-url-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t.plugins.sources.urlPlaceholder}
            className="border-border placeholder:text-muted-foreground flex-1 rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
          />
          <select
            value={trust}
            data-testid="plugin-source-trust-select"
            onChange={(e) => setTrust(e.target.value as MarketplaceSourceTrust)}
            className="border-border rounded-md border bg-transparent px-2 py-2 text-sm"
          >
            <option value="restricted">
              {t.plugins.sources.trustRestricted}
            </option>
            <option value="official">{t.plugins.sources.trustOfficial}</option>
          </select>
          <button
            type="button"
            onClick={handleAdd}
            disabled={actionPending || !url.trim()}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {t.plugins.sources.add}
          </button>
        </div>
        {actionError && (
          <p className="text-destructive text-xs" role="alert">
            {actionError}
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-muted-foreground py-8 text-center text-sm">…</p>
      ) : error ? (
        <p className="text-destructive py-4 text-center text-sm" role="alert">
          {error}
        </p>
      ) : sources.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {t.plugins.sources.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              pending={actionPending}
              onRefresh={() =>
                void handleSourceAction(() => refreshSource(source.id))
              }
              onRemove={() =>
                void handleSourceAction(() => removeSource(source.id))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceRow({
  source,
  pending,
  onRefresh,
  onRemove,
}: {
  source: MarketplaceSource;
  pending: boolean;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const { t } = useLanguage();
  return (
    <li className="border-border flex flex-col gap-1 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{source.name}</span>
          <TrustBadge trust={source.trust} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={t.plugins.sources.refresh}
            title={t.plugins.sources.refresh}
            onClick={onRefresh}
            disabled={pending}
            className="text-muted-foreground hover:text-foreground rounded p-1.5 disabled:opacity-50"
          >
            <RefreshCw className="size-4" />
          </button>
          <button
            type="button"
            aria-label={t.plugins.sources.remove}
            title={t.plugins.sources.remove}
            onClick={onRemove}
            disabled={pending}
            className="text-muted-foreground hover:text-destructive rounded p-1.5 disabled:opacity-50"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
      <p className="text-muted-foreground truncate text-xs">{source.url}</p>
      <p className="text-muted-foreground text-xs">
        {typeof source.pluginCount === 'number'
          ? t.plugins.sources.pluginCount.replace(
              '{n}',
              String(source.pluginCount),
            )
          : ''}
        {source.catalogVersion
          ? ` · ${t.plugins.sources.catalogVersion.replace('{v}', source.catalogVersion)}`
          : ''}
        {source.fetchError ? ` · ${source.fetchError}` : ''}
      </p>
    </li>
  );
}
