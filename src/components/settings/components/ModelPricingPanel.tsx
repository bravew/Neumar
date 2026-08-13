import { useState } from 'react';

import type { BillingType, ModelPricing } from '@/shared/db/usage-api';
import { updateModelPricing } from '@/shared/db/usage-api';
import { useLanguage } from '@/shared/providers/language-provider';

interface Props {
  pricing: ModelPricing | null;
  pricingModelId: string;
  onUpdated: (updated: ModelPricing) => void;
  defaultBillingType?: BillingType;
}

function usdFromMicro(micro: number) {
  return (micro / 1_000_000).toFixed(micro === 0 ? 2 : micro < 1_000 ? 4 : 2);
}

export function ModelPricingPanel({
  pricing,
  pricingModelId,
  onUpdated,
  defaultBillingType = 'api',
}: Props) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [billing, setBilling] = useState<BillingType>('api');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const startEdit = () => {
    setInput(usdFromMicro(pricing?.input_cost_per_million ?? 0));
    setOutput(usdFromMicro(pricing?.output_cost_per_million ?? 0));
    setBilling(pricing?.default_billing_type ?? defaultBillingType);
    setError(false);
    setEditing(true);
  };

  const save = async () => {
    const inputVal = parseFloat(input);
    const outputVal = parseFloat(output);
    if (isNaN(inputVal) || isNaN(outputVal)) return;
    setSaving(true);
    setError(false);
    try {
      const updated = await updateModelPricing(pricingModelId, {
        input_cost_per_million: Math.round(inputVal * 1_000_000),
        output_cost_per_million: Math.round(outputVal * 1_000_000),
        default_billing_type: billing,
      });
      onUpdated(updated);
      setEditing(false);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const billingLabel: Record<BillingType, string> = {
    api: t.settings.usagePricingBillingApi,
    subscription: t.settings.usagePricingBillingSubscription,
    free: t.settings.usagePricingBillingFree,
  };

  const billingColor: Record<BillingType, string> = {
    api: 'text-red-500',
    subscription: 'text-purple-600',
    free: 'text-green-600',
  };

  const currentBilling = pricing?.default_billing_type ?? defaultBillingType;
  const isSubscription = currentBilling === 'subscription';

  return (
    <div className="border-border bg-muted/20 mt-2 ml-6 rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          {t.settings.modelPricingSection}
        </span>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="text-muted-foreground hover:text-foreground text-[11px]"
          >
            {t.settings.memoryEdit}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          {/* Billing mode */}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-24 text-xs">
              {t.settings.modelBillingMode}
            </span>
            <select
              value={billing}
              onChange={(e) => setBilling(e.target.value as BillingType)}
              className="border-border bg-background h-7 flex-1 rounded border px-1.5 text-xs"
            >
              <option value="api">{t.settings.usagePricingBillingApi}</option>
              <option value="subscription">
                {t.settings.usagePricingBillingSubscription}
              </option>
              <option value="free">{t.settings.usagePricingBillingFree}</option>
            </select>
          </div>
          {/* Input cost */}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-24 text-xs">
              {t.settings.usagePriceInput}
            </span>
            <input
              type="number"
              step="0.0001"
              min="0"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="border-border bg-background h-7 flex-1 rounded border px-1.5 text-right text-xs"
              placeholder="0.00"
            />
            <span className="text-muted-foreground text-xs">$/M</span>
          </div>
          {/* Output cost */}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-24 text-xs">
              {t.settings.usagePriceOutput}
            </span>
            <input
              type="number"
              step="0.0001"
              min="0"
              value={output}
              onChange={(e) => setOutput(e.target.value)}
              className="border-border bg-background h-7 flex-1 rounded border px-1.5 text-right text-xs"
              placeholder="0.00"
            />
            <span className="text-muted-foreground text-xs">$/M</span>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded px-3 py-1 text-xs disabled:opacity-50"
            >
              {saving ? '…' : t.settings.connectorSave}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              {t.common?.cancel ?? 'Cancel'}
            </button>
            {error && <span className="text-xs text-red-500">✕</span>}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span
            className={`text-xs font-medium ${billingColor[currentBilling]}`}
          >
            {billingLabel[currentBilling]}
          </span>
          {!isSubscription && pricing && (
            <>
              <span className="text-muted-foreground text-xs">
                {t.settings.usagePriceInput}:{' '}
                <span className="text-foreground font-mono">
                  ${usdFromMicro(pricing.input_cost_per_million)}/M
                </span>
              </span>
              <span className="text-muted-foreground text-xs">
                {t.settings.usagePriceOutput}:{' '}
                <span className="text-foreground font-mono">
                  ${usdFromMicro(pricing.output_cost_per_million)}/M
                </span>
              </span>
            </>
          )}
          {isSubscription && (
            <span className="text-muted-foreground text-xs">
              {t.settings.usagePricingBillingNote}
            </span>
          )}
          {!pricing && (
            <span className="text-muted-foreground text-xs italic">
              No pricing record — click Edit
            </span>
          )}
        </div>
      )}
    </div>
  );
}
