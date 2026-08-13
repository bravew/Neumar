/**
 * Search Settings Tab
 *
 * Configures web search service providers for use by AI agents.
 * When using non-Claude models, these providers replace the
 * built-in WebSearch tool.
 */

import { useCallback, useState } from 'react';

import { Loader2, TestTube2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import {
  DEFAULT_SEARCH_CONFIG,
  type SearchConfig,
  type SearchProviderEntry,
} from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { SettingsTabProps } from '../types';
import { PROVIDER_PRESETS, ProviderCard } from './search/ProviderCard';
import type { ProviderPreset } from './search/ProviderCard';

// ============================================================================
// Component
// ============================================================================

export function SearchSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const { t } = useLanguage();
  // settings locale uses dot-notation keys (e.g. 'search.title')
  const s = t.settings as Record<string, string>;
  const searchConfig: SearchConfig = settings.search ?? DEFAULT_SEARCH_CONFIG;
  const [testQuery, setTestQuery] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const updateConfig = useCallback(
    (patch: Partial<SearchConfig>) => {
      onSettingsChange({
        ...settings,
        search: { ...searchConfig, ...patch },
      });
    },
    [settings, searchConfig, onSettingsChange],
  );

  const updateProvider = useCallback(
    (id: string, patch: Partial<SearchProviderEntry>) => {
      const providers = searchConfig.providers.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      );
      updateConfig({ providers });
    },
    [searchConfig, updateConfig],
  );

  const addProvider = useCallback(
    (preset: ProviderPreset) => {
      if (searchConfig.providers.some((p) => p.id === preset.id)) return;
      const entry: SearchProviderEntry = {
        id: preset.id,
        name: preset.name,
        enabled: false,
        apiKey: '',
        baseUrl: preset.defaultBaseUrl,
        priority: preset.defaultPriority,
      };
      updateConfig({ providers: [...searchConfig.providers, entry] });
    },
    [searchConfig, updateConfig],
  );

  const removeProvider = useCallback(
    (id: string) => {
      updateConfig({
        providers: searchConfig.providers.filter((p) => p.id !== id),
      });
    },
    [searchConfig, updateConfig],
  );

  const moveProvider = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const idx = searchConfig.providers.findIndex((p) => p.id === id);
      if (idx < 0) return;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= searchConfig.providers.length) return;
      const providers = [...searchConfig.providers];
      [providers[idx], providers[newIdx]] = [providers[newIdx], providers[idx]];
      // Reassign priorities
      const updated = providers.map((p, i) => ({
        ...p,
        priority: (i + 1) * 10,
      }));
      updateConfig({ providers: updated });
    },
    [searchConfig, updateConfig],
  );

  const handleTestSearch = useCallback(async () => {
    if (!testQuery.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/search/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: testQuery, maxResults: 3 }),
      });
      if (!res.ok) {
        setTestResult(`Error: ${res.status} ${res.statusText}`);
        return;
      }
      const data = await res.json();
      const lines = [
        `Provider: ${data.provider} | ${data.latencyMs}ms | ${data.results?.length ?? 0} results`,
      ];
      for (const r of data.results ?? []) {
        lines.push(`  - ${r.title}: ${r.url}`);
      }
      setTestResult(lines.join('\n'));
    } catch (err) {
      setTestResult(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setTesting(false);
    }
  }, [testQuery]);

  // Providers not yet added
  const availablePresets = PROVIDER_PRESETS.filter(
    (p) => !searchConfig.providers.some((sp) => sp.id === p.id),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold">
          {s['search.title'] || 'Search Services'}
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          {s['search.description'] ||
            'When using non-Claude models, AI will use these search services instead of built-in WebSearch. When multiple services are enabled, they are called in priority order with automatic failover.'}
        </p>
      </div>

      {/* Master Toggle */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">
          {s['search.enabled'] || 'Enable Search Service'}
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={searchConfig.enabled}
          onClick={() => updateConfig({ enabled: !searchConfig.enabled })}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors',
            searchConfig.enabled ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'pointer-events-none block size-4 rounded-full bg-white shadow-sm transition-transform',
              searchConfig.enabled ? 'translate-x-4' : 'translate-x-0.5',
              'mt-0.5',
            )}
          />
        </button>
      </div>

      {searchConfig.enabled && (
        <>
          {/* Mode Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {s['search.mode'] || 'Mode'}
            </label>
            <div className="flex gap-2">
              {(['auto', 'always', 'manual'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => updateConfig({ mode })}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    searchConfig.mode === mode
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80',
                  )}
                >
                  {s[`search.mode.${mode}`] ||
                    mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              {searchConfig.mode === 'auto' &&
                (s['search.mode.auto.desc'] ||
                  'Use search service for non-Claude models only')}
              {searchConfig.mode === 'always' &&
                (s['search.mode.always.desc'] ||
                  'Override built-in search for all models')}
              {searchConfig.mode === 'manual' &&
                (s['search.mode.manual.desc'] ||
                  'Only use when agent explicitly calls search tool')}
            </p>
          </div>

          {/* Configured Providers */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {s['search.providers'] || 'Providers'}
            </label>

            {searchConfig.providers.length === 0 && (
              <p className="text-muted-foreground text-sm italic">
                {s['search.noProviders'] ||
                  'No providers configured. Add one below.'}
              </p>
            )}

            <div className="space-y-2">
              {[...searchConfig.providers]
                .sort((a, b) => a.priority - b.priority)
                .map((provider, idx) => {
                  const preset = PROVIDER_PRESETS.find(
                    (p) => p.id === provider.id,
                  );
                  return (
                    <ProviderCard
                      key={provider.id}
                      provider={provider}
                      preset={preset}
                      index={idx}
                      total={searchConfig.providers.length}
                      onUpdate={(patch) => updateProvider(provider.id, patch)}
                      onRemove={() => removeProvider(provider.id)}
                      onMove={(dir) => moveProvider(provider.id, dir)}
                      t={s}
                    />
                  );
                })}
            </div>
          </div>

          {/* Add Provider */}
          {availablePresets.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {s['search.addProvider'] || 'Add Provider'}
              </label>
              <div className="flex flex-wrap gap-2">
                {availablePresets.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => addProvider(preset)}
                    className="bg-muted hover:bg-muted/80 rounded-md px-3 py-1.5 text-xs transition-colors"
                  >
                    + {preset.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* General Settings */}
          <div className="border-border space-y-3 border-t pt-4">
            <label className="text-sm font-medium">
              {s['search.generalSettings'] || 'General Settings'}
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-muted-foreground text-xs">
                  {s['search.maxResults'] || 'Max Results'}
                </label>
                <select
                  value={searchConfig.maxResults}
                  onChange={(e) =>
                    updateConfig({ maxResults: Number(e.target.value) })
                  }
                  className="bg-muted mt-1 w-full rounded-md px-2 py-1.5 text-sm"
                >
                  {[3, 5, 8, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-muted-foreground text-xs">
                  {s['search.timeout'] || 'Timeout'}
                </label>
                <select
                  value={searchConfig.timeoutSeconds}
                  onChange={(e) =>
                    updateConfig({ timeoutSeconds: Number(e.target.value) })
                  }
                  className="bg-muted mt-1 w-full rounded-md px-2 py-1.5 text-sm"
                >
                  {[5, 10, 15, 30].map((n) => (
                    <option key={n} value={n}>
                      {n}s
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-muted-foreground text-xs">
                  {s['search.cacheTtl'] || 'Cache TTL'}
                </label>
                <select
                  value={searchConfig.cacheTtlMinutes}
                  onChange={(e) =>
                    updateConfig({ cacheTtlMinutes: Number(e.target.value) })
                  }
                  className="bg-muted mt-1 w-full rounded-md px-2 py-1.5 text-sm"
                >
                  {[0, 5, 15, 30, 60].map((n) => (
                    <option key={n} value={n}>
                      {n === 0
                        ? s['search.off'] || 'Off'
                        : `${n} ${s['search.minutes'] || 'min'}`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-muted-foreground text-xs">
                  {s['search.safeSearch'] || 'SafeSearch'}
                </label>
                <select
                  value={searchConfig.safeSearch}
                  onChange={(e) =>
                    updateConfig({
                      safeSearch: e.target.value as
                        | 'off'
                        | 'moderate'
                        | 'strict',
                    })
                  }
                  className="bg-muted mt-1 w-full rounded-md px-2 py-1.5 text-sm"
                >
                  <option value="off">
                    {s['search.safeSearch.off'] || 'Off'}
                  </option>
                  <option value="moderate">
                    {s['search.safeSearch.moderate'] || 'Moderate'}
                  </option>
                  <option value="strict">
                    {s['search.safeSearch.strict'] || 'Strict'}
                  </option>
                </select>
              </div>
            </div>
          </div>

          {/* Test Search */}
          <div className="border-border space-y-2 border-t pt-4">
            <label className="text-sm font-medium">
              {s['search.testSearch'] || 'Test Search'}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTestSearch()}
                placeholder={
                  s['search.testPlaceholder'] || 'Enter a test query...'
                }
                className="bg-muted flex-1 rounded-md px-3 py-1.5 text-sm"
              />
              <button
                onClick={handleTestSearch}
                disabled={testing || !testQuery.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {testing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <TestTube2 className="size-3.5" />
                )}
                {s['search.test'] || 'Test'}
              </button>
            </div>
            {testResult && (
              <pre className="bg-muted max-h-40 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">
                {testResult}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}
