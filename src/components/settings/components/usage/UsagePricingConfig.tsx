import { useEffect, useRef, useState } from 'react';

import type { BillingType, ModelPricing } from '@/shared/db/usage-api';
import { fetchPricing, updateModelPricing } from '@/shared/db/usage-api';
import { useLanguage } from '@/shared/providers/language-provider';

function formatPricingDisplay(microPerMillion: number): string {
  const usd = microPerMillion / 1_000_000;
  return `$${usd.toFixed(2)}`;
}

const BILLING_BADGE: Record<
  BillingType,
  { label: (t: ReturnType<typeof useLanguage>['t']) => string; cls: string }
> = {
  api: {
    label: (t) => t.settings.usagePricingBillingApi,
    cls: 'text-red-500 border-red-200 dark:border-red-800',
  },
  subscription: {
    label: (t) => t.settings.usagePricingBillingSubscription,
    cls: 'text-purple-600 border-purple-200 dark:border-purple-800',
  },
  free: {
    label: (t) => t.settings.usagePricingBillingFree,
    cls: 'text-green-600 border-green-200 dark:border-green-800',
  },
};

export function UsagePricingConfig() {
  const { t } = useLanguage();
  const [data, setData] = useState<ModelPricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<
    Record<string, string | BillingType>
  >({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const ac = new AbortController();
    fetchPricing(ac.signal)
      .then((result) => {
        if (mountedRef.current) setData(result);
      })
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => {
      mountedRef.current = false;
      ac.abort();
    };
  }, []);

  const startEditing = (pricing: ModelPricing) => {
    setEditingId(pricing.model_id);
    setEditValues({
      input: String(pricing.input_cost_per_million / 1_000_000),
      output: String(pricing.output_cost_per_million / 1_000_000),
      billing: pricing.default_billing_type ?? 'api',
    });
  };

  const saveEditing = async () => {
    if (!editingId) return;
    const inputVal = parseFloat(editValues.input as string);
    const outputVal = parseFloat(editValues.output as string);
    if (isNaN(inputVal) || isNaN(outputVal)) return;

    setSaveError(null);
    try {
      const updated = await updateModelPricing(editingId, {
        input_cost_per_million: Math.round(inputVal * 1_000_000),
        output_cost_per_million: Math.round(outputVal * 1_000_000),
        default_billing_type: editValues.billing as BillingType,
      });
      setData((prev) =>
        prev.map((p) => (p.model_id === editingId ? updated : p)),
      );
      setEditingId(null);
    } catch {
      setSaveError(editingId);
    }
  };

  return (
    <div className="space-y-3">
      <div className="border-border overflow-hidden rounded-lg border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-border bg-muted/50 text-muted-foreground border-b text-left">
              <th className="px-3 py-2">{t.settings.usageColModel}</th>
              <th className="px-3 py-2">{t.settings.usageColProvider}</th>
              <th className="px-3 py-2">
                {t.settings.usagePricingBillingMode}
              </th>
              <th className="px-3 py-2 text-right">
                {t.settings.usagePriceInput}
              </th>
              <th className="px-3 py-2 text-right">
                {t.settings.usagePriceOutput}
              </th>
              <th className="px-3 py-2 text-right">
                {t.settings.usagePriceCacheRead}
              </th>
              <th className="px-3 py-2 text-center" />
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-border border-b">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-3 py-2">
                        <div className="bg-muted h-3 w-12 animate-pulse rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              : data.map((row) => {
                  const billingType = row.default_billing_type ?? 'api';
                  const badge = BILLING_BADGE[billingType];
                  return (
                    <tr
                      key={row.model_id}
                      className="border-border hover:bg-muted/30 border-b"
                    >
                      <td className="px-3 py-2">
                        <span className="font-medium">{row.display_name}</span>
                        {row.is_default === 0 && (
                          <span className="ml-1 text-[10px] text-amber-500">
                            {t.settings.usageCustomBadge}
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground px-3 py-2">
                        {row.provider}
                      </td>
                      {editingId === row.model_id ? (
                        <>
                          <td className="px-3 py-2">
                            <select
                              value={editValues.billing as string}
                              onChange={(e) =>
                                setEditValues((prev) => ({
                                  ...prev,
                                  billing: e.target.value as BillingType,
                                }))
                              }
                              className="border-border bg-background w-28 rounded border px-1 py-0.5 text-xs"
                            >
                              <option value="api">
                                {t.settings.usagePricingBillingApi}
                              </option>
                              <option value="subscription">
                                {t.settings.usagePricingBillingSubscription}
                              </option>
                              <option value="free">
                                {t.settings.usagePricingBillingFree}
                              </option>
                            </select>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={editValues.input as string}
                              onChange={(e) =>
                                setEditValues((prev) => ({
                                  ...prev,
                                  input: e.target.value,
                                }))
                              }
                              className="border-border bg-background w-16 rounded border px-1 py-0.5 text-right text-xs"
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={editValues.output as string}
                              onChange={(e) =>
                                setEditValues((prev) => ({
                                  ...prev,
                                  output: e.target.value,
                                }))
                              }
                              className="border-border bg-background w-16 rounded border px-1 py-0.5 text-right text-xs"
                            />
                          </td>
                          <td className="text-muted-foreground px-3 py-2 text-right font-mono">
                            {formatPricingDisplay(
                              row.cache_read_cost_per_million,
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={saveEditing}
                              aria-label={t.settings.connectorSave}
                              className="rounded px-2 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                            >
                              {t.settings.connectorSave}
                            </button>
                            {saveError === row.model_id && (
                              <span className="ml-1 text-[10px] text-red-500">
                                ✕
                              </span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}
                            >
                              {badge.label(t)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {billingType === 'subscription'
                              ? '$0'
                              : row.unit_type
                                ? `$${(row.unit_cost / 1_000_000).toFixed(4)}/${row.unit_type}`
                                : formatPricingDisplay(
                                    row.input_cost_per_million,
                                  )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {billingType === 'subscription'
                              ? '$0'
                              : row.unit_type
                                ? '-'
                                : formatPricingDisplay(
                                    row.output_cost_per_million,
                                  )}
                          </td>
                          <td className="text-muted-foreground px-3 py-2 text-right font-mono">
                            {billingType === 'subscription'
                              ? '$0'
                              : row.unit_type
                                ? '-'
                                : formatPricingDisplay(
                                    row.cache_read_cost_per_million,
                                  )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => startEditing(row)}
                              aria-label={`${t.settings.memoryEdit} ${row.display_name}`}
                              className="text-muted-foreground hover:bg-muted hover:text-foreground rounded px-2 py-0.5 text-[10px]"
                            >
                              {t.settings.memoryEdit}
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-[11px]">
        {t.settings.usagePricingBillingNote}
      </p>
    </div>
  );
}
