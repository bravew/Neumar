import { useCallback, useEffect, useState } from 'react';

import { CheckCircle2, Loader2, Save } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { fetchAssetStorageStats } from '@/shared/assets/api';
import type { AssetStorageStats } from '@/shared/assets/types';
import { useLanguage } from '@/shared/providers/language-provider';

import { AssetMaterializationNumberField } from './AssetMaterializationNumberField';
import {
  DEFAULT_MATERIALIZATION_FORM,
  MATERIALIZATION_FIELD_CONFIG,
  buildMaterializationForm,
  buildMaterializationSettingsPayload,
  scopeLabel,
  type MaterializationFormState,
} from './assetsMaterializationSettingsModel';
import { AssetStorageMetric } from './AssetStorageMetric';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const SETTINGS_ENDPOINT = `${API_BASE_URL}/db/settings`;

export function AssetsMaterializationSettings() {
  const { t } = useLanguage();
  const s = t.settings as Record<string, string>;
  const [form, setForm] = useState<MaterializationFormState>(
    DEFAULT_MATERIALIZATION_FORM,
  );
  const [stats, setStats] = useState<AssetStorageStats | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchAssetStorageStats({ signal: ctrl.signal })
      .then(setStats)
      .catch((statsError) => {
        if ((statsError as { name?: string }).name !== 'AbortError') {
          setStats(null);
        }
      });
    fetch(SETTINGS_ENDPOINT, { signal: ctrl.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as Record<string, string>;
      })
      .then((settings) => setForm(buildMaterializationForm(settings)))
      .catch((loadError) => {
        if ((loadError as { name?: string }).name === 'AbortError') return;
        setError(
          loadError instanceof Error ? loadError.message : String(loadError),
        );
      });
    return () => ctrl.abort();
  }, []);

  const updateField = useCallback(
    (field: keyof MaterializationFormState, value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      setStatus('idle');
      setError(null);
    },
    [],
  );

  const save = useCallback(async () => {
    setStatus('saving');
    setError(null);
    try {
      await Promise.all(
        buildMaterializationSettingsPayload(form).map(([key, value]) =>
          saveSetting(key, value),
        ),
      );
      setStatus('saved');
      window.setTimeout(() => setStatus('idle'), 2000);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
      setStatus('error');
    }
  }, [form]);

  return (
    <div className="border-border rounded-lg border p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-foreground font-medium">
            {s.assetsMaterializeTitle}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {s.assetsMaterializeDescription}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={status === 'saving'}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === 'saving' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : status === 'saved' ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <Save className="size-4" />
          )}
          {status === 'saved'
            ? s.assetsMaterializeSaved
            : s.assetsMaterializeSave}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {MATERIALIZATION_FIELD_CONFIG.map((field) => (
          <AssetMaterializationNumberField
            key={field.id}
            label={s[field.labelKey]}
            description={s[field.descriptionKey]}
            value={form[field.id]}
            min={field.min}
            step={field.step}
            suffix={field.suffixKey ? s[field.suffixKey] : field.suffix}
            onChange={(value) => updateField(field.id, value)}
          />
        ))}
      </div>

      {stats && (
        <div className="border-border mt-4 border-t pt-4">
          <p className="text-foreground text-sm font-medium">
            {s.assetsMaterializeStorageUsage}
          </p>
          <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <AssetStorageMetric
              label={s.assetsMaterializeManagedBytes}
              value={stats.managedBytes}
            />
            <AssetStorageMetric
              label={s.assetsMaterializeCacheBytes}
              value={stats.cacheBytes}
            />
            <AssetStorageMetric
              label={s.assetsMaterializeMaterializedBytes}
              value={stats.materializedBytes}
            />
            <AssetStorageMetric
              label={s.assetsMaterializeDerivativeBytes}
              value={stats.proxyBytes + stats.previewArtifactBytes}
            />
          </div>
          {stats.materializedBytesByScope.length > 0 && (
            <div className="mt-3">
              <p className="text-muted-foreground text-xs">
                {s.assetsMaterializeScopeUsage}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {stats.materializedBytesByScope.map((row) => (
                  <AssetStorageMetric
                    key={row.scope}
                    label={`${scopeLabel(row.scope, s)} (${row.materializationCount})`}
                    value={row.materializedBytes}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
    </div>
  );
}

async function saveSetting(key: string, value: string) {
  const response = await fetch(
    `${SETTINGS_ENDPOINT}/${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
