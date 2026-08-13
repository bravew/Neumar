/**
 * Budget Policy Form Dialog
 *
 * Modal dialog for creating or editing a budget policy.
 */

import { useState } from 'react';

import { XCircle } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export type ScopeType =
  | 'global'
  | 'provider'
  | 'model'
  | 'agent_profile'
  | 'project'
  | 'automation';
export type PeriodType = 'monthly' | 'weekly' | 'daily';

export interface BudgetPolicy {
  id: string;
  name: string;
  scope_type: ScopeType;
  scope_id?: string;
  period_type: PeriodType;
  limit_usd: number;
  alert_threshold_pct: number;
  hard_stop: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface PolicyFormProps {
  initial: Partial<BudgetPolicy>;
  onSave: (
    data: Omit<BudgetPolicy, 'id' | 'created_at' | 'updated_at'>,
  ) => void;
  onClose: () => void;
  saving: boolean;
  saveError?: string | null;
}

export function PolicyForm({
  initial,
  onSave,
  onClose,
  saving,
  saveError,
}: PolicyFormProps) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    name: initial.name ?? '',
    scope_type: initial.scope_type ?? ('global' as ScopeType),
    scope_id: initial.scope_id ?? '',
    period_type: initial.period_type ?? ('monthly' as PeriodType),
    limit_usd: initial.limit_usd ?? 100,
    alert_threshold_pct: initial.alert_threshold_pct ?? 75,
    hard_stop: initial.hard_stop ?? false,
    enabled: initial.enabled ?? true,
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const fieldClass =
    'border-border bg-background text-foreground h-8 rounded-md border px-2 text-sm w-full';
  const labelClass = 'text-foreground mb-1 block text-xs font-medium';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border-border w-full max-w-md rounded-xl border p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-foreground text-sm font-semibold">
            {initial.id
              ? t.settings.budgetEditPolicy
              : t.settings.budgetAddPolicy}
          </h3>
          <button
            onClick={onClose}
            aria-label={t.settings.budgetCancel}
            className="text-muted-foreground hover:text-foreground"
          >
            <XCircle className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={labelClass}>{t.settings.budgetPolicyName}</label>
            <input
              className={fieldClass}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder={t.settings.budgetPolicyNamePlaceholder}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{t.settings.budgetScope}</label>
              <select
                className={fieldClass}
                value={form.scope_type}
                onChange={(e) => set('scope_type', e.target.value as ScopeType)}
              >
                <option value="global">{t.settings.budgetScopeGlobal}</option>
                <option value="provider">
                  {t.settings.budgetScopeProvider}
                </option>
                <option value="model">{t.settings.budgetScopeModel}</option>
                <option value="agent_profile">
                  {t.settings.budgetScopeAgentProfile}
                </option>
                <option value="project">{t.settings.budgetScopeProject}</option>
                <option value="automation">
                  {t.settings.budgetScopeAutomation}
                </option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t.settings.budgetPeriod}</label>
              <select
                className={fieldClass}
                value={form.period_type}
                onChange={(e) =>
                  set('period_type', e.target.value as PeriodType)
                }
              >
                <option value="daily">{t.settings.budgetPeriodDaily}</option>
                <option value="weekly">{t.settings.budgetPeriodWeekly}</option>
                <option value="monthly">
                  {t.settings.budgetPeriodMonthly}
                </option>
              </select>
            </div>
          </div>

          {form.scope_type !== 'global' && (
            <div>
              <label className={labelClass}>{t.settings.budgetScopeId}</label>
              <input
                className={fieldClass}
                value={form.scope_id}
                onChange={(e) => set('scope_id', e.target.value)}
                placeholder={t.settings.budgetScopeIdPlaceholder}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>
                {t.settings.budgetLimit} (USD)
              </label>
              <input
                type="number"
                min="0.01"
                step="1"
                className={fieldClass}
                value={form.limit_usd}
                onChange={(e) => set('limit_usd', Number(e.target.value))}
              />
            </div>
            <div>
              <label className={labelClass}>
                {t.settings.budgetAlertThreshold} (%)
              </label>
              <input
                type="number"
                min="1"
                max="100"
                step="5"
                className={fieldClass}
                value={form.alert_threshold_pct}
                onChange={(e) =>
                  set('alert_threshold_pct', Number(e.target.value))
                }
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className={labelClass + ' mb-0'}>
              {t.settings.budgetHardStop}
            </label>
            <button
              type="button"
              onClick={() => set('hard_stop', !form.hard_stop)}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
                form.hard_stop ? 'bg-foreground' : 'bg-muted',
              )}
            >
              <span
                className={cn(
                  'bg-background inline-block size-4 rounded-full transition-transform',
                  form.hard_stop ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>
        </div>

        {saveError && (
          <p className="text-destructive mt-3 text-xs">{saveError}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="border-border text-foreground hover:bg-accent h-8 rounded-md border px-3 text-sm"
          >
            {t.settings.budgetCancel}
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={saving || !form.name.trim()}
            className="bg-foreground text-background h-8 rounded-md px-3 text-sm disabled:opacity-50"
          >
            {saving ? t.settings.budgetSaving : t.settings.budgetSave}
          </button>
        </div>
      </div>
    </div>
  );
}
