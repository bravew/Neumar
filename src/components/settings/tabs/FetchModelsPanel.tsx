import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Check, Loader2, RefreshCw, Search } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import {
  getProviderModelsCacheKey,
  readProviderModelsCache,
  writeProviderModelsCache,
} from '@/shared/lib/provider-models-cache';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type {
  FetchedModel,
  FetchModelsPanelProps,
  FetchModelsResponse,
} from './fetch-models-utils';
import { resolveBaseUrl } from './fetch-models-utils';
import { ModelCapabilityBadges } from './ModelCapabilityBadges';

export function FetchModelsPanel({
  provider,
  onModelsChange,
}: FetchModelsPanelProps) {
  const { t } = useLanguage();
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>(() => {
    return readProviderModelsCache(provider)?.models ?? [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(
    () => readProviderModelsCache(provider)?.latencyMs ?? null,
  );
  const [upstreamStatus, setUpstreamStatus] = useState<number | null>(
    () => readProviderModelsCache(provider)?.upstreamStatus ?? null,
  );
  const [hasFetched, setHasFetched] = useState(
    () => readProviderModelsCache(provider) !== null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const providerCacheKey = getProviderModelsCacheKey(provider);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const cached = readProviderModelsCache(provider);
    setFetchedModels(cached?.models ?? []);
    setLatencyMs(cached?.latencyMs ?? null);
    setUpstreamStatus(cached?.upstreamStatus ?? null);
    setHasFetched(cached !== null);
    setError(null);
    setSearchQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- providerCacheKey is the protected identity for cache reads
  }, [providerCacheKey]);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLatencyMs(null);
    setUpstreamStatus(null);

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const startedAt = performance.now();
      const baseUrl = resolveBaseUrl(provider);
      if (!baseUrl) {
        if (abortRef.current === controller) {
          setError(t.settings.noBaseUrlConfigured);
        }
        return;
      }

      const resp = await fetch(`${API_BASE_URL}/providers/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: provider.apiKey,
          baseUrl,
          agentType: provider.agentType,
          providerId: provider.id,
          dialect: provider.dialect,
        }),
        signal: controller.signal,
      });

      const data = (await resp.json()) as FetchModelsResponse;
      const measuredLatency = Math.round(performance.now() - startedAt);
      const resolvedLatencyMs = data.latencyMs ?? measuredLatency;
      const resolvedUpstreamStatus = data.upstreamStatus ?? resp.status;
      if (abortRef.current !== controller) return;
      setLatencyMs(resolvedLatencyMs);
      setUpstreamStatus(resolvedUpstreamStatus);

      if (data.success) {
        setFetchedModels(data.models);
        setHasFetched(true);
        writeProviderModelsCache(provider, {
          models: data.models,
          latencyMs: resolvedLatencyMs,
          upstreamStatus: resolvedUpstreamStatus,
        });
      } else {
        const fallbackModels = provider.models.filter((m) => m !== 'default');
        if (fallbackModels.length > 0) {
          setFetchedModels(
            fallbackModels.map((id) => ({ id, displayLabel: id })),
          );
          setHasFetched(true);
          setError(
            t.settings.fetchModelsFallback.replace(
              '{error}',
              data.message || t.settings.fetchModelsError,
            ),
          );
        } else {
          setError(data.message || t.settings.fetchModelsError);
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (abortRef.current === controller) {
        setError(
          err instanceof Error ? err.message : t.settings.fetchModelsError,
        );
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, [provider, t]);

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return fetchedModels;
    const q = searchQuery.toLowerCase();
    return fetchedModels.filter(
      (m) =>
        m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q),
    );
  }, [fetchedModels, searchQuery]);

  const selectedSet = useMemo(
    () => new Set(provider.models),
    [provider.models],
  );

  const toggleModel = useCallback(
    (modelId: string) => {
      if (selectedSet.has(modelId)) {
        const next = provider.models.filter((m) => m !== modelId);
        onModelsChange(next.length > 0 ? next : ['default']);
      } else {
        onModelsChange([...provider.models, modelId]);
      }
    },
    [provider.models, selectedSet, onModelsChange],
  );

  const selectAllVisible = useCallback(() => {
    const newModels = new Set(provider.models);
    for (const m of filteredModels) {
      newModels.add(m.id);
    }
    onModelsChange([...newModels]);
  }, [provider.models, filteredModels, onModelsChange]);

  const deselectAll = useCallback(() => {
    const visibleIds = new Set(filteredModels.map((m) => m.id));
    const remaining = provider.models.filter((m) => !visibleIds.has(m));
    onModelsChange(remaining.length > 0 ? remaining : ['default']);
  }, [provider.models, filteredModels, onModelsChange]);

  const visibleSelectedCount = useMemo(
    () => filteredModels.filter((m) => selectedSet.has(m.id)).length,
    [filteredModels, selectedSet],
  );

  if (!hasFetched) {
    return (
      <div className="space-y-2">
        <button
          onClick={fetchModels}
          disabled={loading}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            loading
              ? 'text-muted-foreground cursor-wait'
              : 'bg-accent text-accent-foreground hover:bg-accent/80',
          )}
          aria-label={t.settings.fetchModels}
        >
          {loading ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {t.settings.fetchingModels}
            </>
          ) : (
            <>
              <RefreshCw className="size-3.5" />
              {t.settings.fetchModels}
            </>
          )}
        </button>
        <p className="text-muted-foreground text-xs">
          {t.settings.fetchModelsHint}
        </p>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          {searchQuery.trim() && filteredModels.length !== fetchedModels.length
            ? (t.settings.modelsShowing || 'Showing {count} of {total}')
                .replace('{count}', String(filteredModels.length))
                .replace('{total}', String(fetchedModels.length))
            : (t.settings.modelsFound || '{count} models found').replace(
                '{count}',
                String(fetchedModels.length),
              )}
          {latencyMs !== null &&
            ` · ${t.settings.fetchModelsLatency.replace('{ms}', String(latencyMs))}`}
          {upstreamStatus !== null &&
            ` · ${t.settings.fetchModelsUpstreamStatus.replace(
              '{status}',
              String(upstreamStatus),
            )}`}
        </span>
        <button
          onClick={fetchModels}
          disabled={loading}
          className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-xs"
          aria-label={t.settings.refreshModels}
        >
          {loading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          {t.settings.refreshModels}
        </button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t.settings.searchModels}
          className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-8 w-full rounded-md border pr-3 pl-8 text-xs focus:ring-1 focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={selectAllVisible}
          className="text-primary hover:text-primary/80 text-xs"
        >
          {t.settings.selectAllVisible}
        </button>
        <span className="text-muted-foreground text-xs">|</span>
        <button
          onClick={deselectAll}
          className="text-primary hover:text-primary/80 text-xs"
        >
          {t.settings.deselectAll}
        </button>
        {visibleSelectedCount > 0 && (
          <span className="text-muted-foreground text-xs">
            {(t.settings.modelsSelected || '({count} selected)').replace(
              '{count}',
              String(visibleSelectedCount),
            )}
          </span>
        )}
      </div>

      <div className="border-border max-h-64 overflow-y-auto rounded-lg border">
        {filteredModels.length === 0 ? (
          <div className="text-muted-foreground p-4 text-center text-xs">
            {t.settings.noModelsFound}
          </div>
        ) : (
          <div className="divide-border divide-y">
            {filteredModels.map((model) => {
              const isSelected = selectedSet.has(model.id);
              return (
                <label
                  key={model.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 px-3 py-2 transition-colors',
                    isSelected ? 'bg-accent/30' : 'hover:bg-accent/20',
                  )}
                >
                  <div className="flex pt-0.5">
                    <div
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input',
                      )}
                    >
                      {isSelected && <Check className="size-3" />}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleModel(model.id)}
                    className="sr-only"
                    aria-label={`Toggle model ${model.id}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground truncate text-xs font-medium">
                      {model.displayLabel ?? model.id}
                    </div>
                    {model.name && model.name !== model.id && (
                      <div className="text-muted-foreground truncate text-[10px]">
                        {model.name}
                      </div>
                    )}
                    <div className="mt-0.5">
                      <ModelCapabilityBadges modelName={model.id} />
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
