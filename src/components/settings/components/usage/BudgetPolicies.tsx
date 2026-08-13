/**
 * Budget Policies UI
 *
 * CRUD table for budget policies. Columns: name, scope, period, limit, alert %, hard-stop, spend, utilization bar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { AlertTriangle, Plus, Trash2, XCircle } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// ─── Types ───────────────────────────────────────────────────────────────────

type ScopeType =
  | 'global'
  | 'provider'
  | 'model'
  | 'agent_profile'
  | 'project'
  | 'automation';
type PeriodType = 'monthly' | 'weekly' | 'daily';

interface BudgetPolicy {
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

interface BudgetStatusItem {
  policy: BudgetPolicy;
  period_start: string;
  currentSpend: number;
  percentUsed: number;
  severity: 'ok' | 'soft' | 'urgent' | 'blocked';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EMPTY_POLICY: Omit<BudgetPolicy, 'id' | 'created_at' | 'updated_at'> = {
  name: '',
  scope_type: 'global',
  period_type: 'monthly',
  limit_usd: 100,
  alert_threshold_pct: 75,
  hard_stop: false,
  enabled: true,
};

function UtilizationBar({ pct, severity }: { pct: number; severity: string }) {
  const barClass =
    severity === 'blocked'
      ? 'bg-red-500'
      : severity === 'urgent'
        ? 'bg-orange-400'
        : severity === 'soft'
          ? 'bg-yellow-400'
          : 'bg-green-500';
  return (
    <div className="bg-muted h-1.5 w-20 overflow-hidden rounded-full">
      <div
        className={cn('h-full rounded-full transition-all', barClass)}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

// ─── Policy Form Dialog ────────────────────────────────────────────────────────

interface PolicyFormProps {
  initial: Partial<BudgetPolicy>;
  onSave: (
    data: Omit<BudgetPolicy, 'id' | 'created_at' | 'updated_at'>,
  ) => void;
  onClose: () => void;
  saving: boolean;
}

function PolicyForm({ initial, onSave, onClose, saving }: PolicyFormProps) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    name: initial.name ?? '',
    scope_type: initial.scope_type ?? 'global',
    scope_id: initial.scope_id ?? '',
    period_type: initial.period_type ?? 'monthly',
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
              placeholder="e.g., Monthly global cap"
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
                <option value="global">Global</option>
                <option value="provider">Provider</option>
                <option value="model">Model</option>
                <option value="agent_profile">Agent Profile</option>
                <option value="project">Project</option>
                <option value="automation">Automation</option>
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
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
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
                placeholder="e.g., anthropic, claude-sonnet-5"
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
            {saving ? '...' : t.settings.budgetSave}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function BudgetPolicies() {
  const { t } = useLanguage();
  const [statusItems, setStatusItems] = useState<BudgetStatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<BudgetPolicy> | null>(null);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/budget/status`, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { items: BudgetStatusItem[] };
        if (mountedRef.current) setStatusItems(data.items ?? []);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        if (mountedRef.current) setError(t.settings.budgetLoadError);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    mountedRef.current = true;
    const ac = new AbortController();
    load(ac.signal);
    return () => {
      mountedRef.current = false;
      ac.abort();
    };
  }, [load]);

  const handleSave = async (
    formData: Omit<BudgetPolicy, 'id' | 'created_at' | 'updated_at'>,
  ) => {
    setSaving(true);
    try {
      const isEdit = !!editing?.id;
      const url = isEdit
        ? `${API_BASE_URL}/budget/policies/${editing!.id}`
        : `${API_BASE_URL}/budget/policies`;
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditing(null);
      await load();
    } catch {
      // Show error inline; keep dialog open
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.settings.budgetDeleteConfirm)) return;
    try {
      await fetch(`${API_BASE_URL}/budget/policies/${id}`, {
        method: 'DELETE',
      });
      await load();
    } catch {
      // ignore
    }
  };

  const severityIcon = (severity: string) => {
    if (severity === 'blocked')
      return <XCircle className="size-3.5 text-red-500" />;
    if (severity === 'urgent')
      return <AlertTriangle className="size-3.5 text-orange-400" />;
    if (severity === 'soft')
      return <AlertTriangle className="size-3.5 text-yellow-400" />;
    return null;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {t.settings.budgetDescription}
        </p>
        <button
          onClick={() => setEditing({ ...EMPTY_POLICY })}
          className="bg-foreground text-background flex h-8 items-center gap-1.5 rounded-md px-3 text-sm"
        >
          <Plus className="size-3.5" />
          {t.settings.budgetAddPolicy}
        </button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {loading ? (
        <div className="text-muted-foreground py-8 text-center text-sm">
          {t.settings.budgetLoading}
        </div>
      ) : statusItems.length === 0 ? (
        <div className="text-muted-foreground py-8 text-center text-sm">
          {t.settings.budgetNoPolicies}
        </div>
      ) : (
        <div className="border-border overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-border border-b">
                <th className="text-muted-foreground px-4 py-2.5 text-left text-xs font-medium">
                  {t.settings.budgetColName}
                </th>
                <th className="text-muted-foreground px-4 py-2.5 text-left text-xs font-medium">
                  {t.settings.budgetColScope}
                </th>
                <th className="text-muted-foreground px-4 py-2.5 text-left text-xs font-medium">
                  {t.settings.budgetColPeriod}
                </th>
                <th className="text-muted-foreground px-4 py-2.5 text-right text-xs font-medium">
                  {t.settings.budgetColLimit}
                </th>
                <th className="text-muted-foreground px-4 py-2.5 text-right text-xs font-medium">
                  {t.settings.budgetColSpend}
                </th>
                <th className="text-muted-foreground px-4 py-2.5 text-left text-xs font-medium">
                  {t.settings.budgetColUtilization}
                </th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {statusItems.map(
                ({ policy, currentSpend, percentUsed, severity }) => (
                  <tr
                    key={policy.id}
                    className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {severityIcon(severity)}
                        <span className="text-foreground font-medium">
                          {policy.name}
                        </span>
                        {!policy.enabled && (
                          <span className="text-muted-foreground rounded px-1 text-xs">
                            (off)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5 capitalize">
                      {policy.scope_type}
                      {policy.scope_id ? `: ${policy.scope_id}` : ''}
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5 capitalize">
                      {policy.period_type}
                    </td>
                    <td className="text-foreground px-4 py-2.5 text-right">
                      ${policy.limit_usd.toFixed(2)}
                    </td>
                    <td className="text-foreground px-4 py-2.5 text-right">
                      ${currentSpend.toFixed(4)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <UtilizationBar pct={percentUsed} severity={severity} />
                        <span className="text-muted-foreground w-9 text-xs">
                          {percentUsed.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditing(policy)}
                          className="text-muted-foreground hover:text-foreground rounded p-1 text-xs"
                        >
                          {t.settings.budgetEdit}
                        </button>
                        <button
                          onClick={() => handleDelete(policy.id)}
                          className="text-muted-foreground hover:text-destructive rounded p-1"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PolicyForm
          initial={editing}
          onSave={handleSave}
          onClose={() => setEditing(null)}
          saving={saving}
        />
      )}
    </div>
  );
}
