import { memo, useEffect, useState, type ReactElement } from 'react';

import { Plus, Trash2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useAgentProfiles } from '@/shared/hooks/useAgentProfiles';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface RoutingRule {
  id: string;
  workspace_id: string;
  channel_id: string;
  chat_pattern: string;
  intent: string;
  profile_id: string;
  model_override: string | null;
  priority: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

const INTENT_OPTIONS = [
  '*',
  'code',
  'research',
  'planning',
  'triage',
  'support',
] as const;

const CHANNEL_OPTIONS = [
  '*',
  'slack',
  'discord',
  'telegram',
  'feishu',
  'imessage',
  'linear',
  'whatsapp',
  'sms',
  'acp',
] as const;

const FIELD_CLASS =
  'bg-background border-input text-foreground rounded border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring/40';

interface NewRule {
  workspace_id: string;
  channel_id: string;
  chat_pattern: string;
  intent: string;
  profile_id: string;
  priority: number;
}

const EMPTY_RULE: NewRule = {
  workspace_id: '*',
  channel_id: '*',
  chat_pattern: '*',
  intent: '*',
  profile_id: '',
  priority: 100,
};

/**
 * Buffered text input that only commits on blur or Enter, so PATCHes don't
 * fire on every keystroke. Escape reverts. Number variant is the same shape
 * with `type="number"` and a numeric round-trip.
 */
interface EditableCellProps<T extends string | number> {
  value: T;
  className: string;
  type?: 'text' | 'number';
  onCommit: (value: T) => void;
}

const EditableCell = memo(function EditableCell<T extends string | number>({
  value,
  className,
  type = 'text',
  onCommit,
}: EditableCellProps<T>) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    if (type === 'number') {
      const next = Number(draft);
      if (!Number.isFinite(next)) {
        setDraft(String(value));
        return;
      }
      if (next !== value) onCommit(next as T);
    } else if (draft !== value) {
      onCommit(draft as T);
    }
  };

  return (
    <input
      type={type}
      value={draft}
      className={className}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(String(value));
      }}
    />
  );
}) as <T extends string | number>(props: EditableCellProps<T>) => ReactElement;

export function RoutingRulesTable() {
  const { t } = useLanguage();
  const s = t.settings as Record<string, string>;
  const { profiles } = useAgentProfiles();
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<NewRule>(EMPTY_RULE);
  const [creating, setCreating] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/channels/routing-rules`);
      if (res.ok) {
        const data = (await res.json()) as { rules: RoutingRule[] };
        setRules(data.rules);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/channels/routing-rules`, {
          signal: ac.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { rules: RoutingRule[] };
          setRules(data.rules);
        }
      } catch {
        // aborted
      } finally {
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

  const handleCreate = async () => {
    if (!draft.profile_id) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE_URL}/channels/routing-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (res.ok) {
        setDraft(EMPTY_RULE);
        await refresh();
      }
    } finally {
      setCreating(false);
    }
  };

  const handlePatch = async (id: string, updates: Partial<RoutingRule>) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    );
    const res = await fetch(`${API_BASE_URL}/channels/routing-rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) await refresh();
  };

  const handleDelete = async (id: string) => {
    setConfirmId(null);
    setRules((prev) => prev.filter((r) => r.id !== id));
    const res = await fetch(`${API_BASE_URL}/channels/routing-rules/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) await refresh();
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-foreground text-sm font-medium">
          {s.routingRules}
        </h3>
        <p className="text-muted-foreground text-xs">
          {s.routingRulesDescription}
        </p>
      </div>

      <div className="border-border divide-border divide-y rounded-lg border text-xs">
        <div className="bg-muted/30 text-muted-foreground grid grid-cols-[80px_100px_minmax(120px,1fr)_100px_minmax(120px,1.5fr)_70px_40px] items-center gap-2 px-3 py-2 font-medium">
          <span>{s.routingPriority}</span>
          <span>{s.routingChannel}</span>
          <span>{s.routingWorkspace}</span>
          <span>{s.routingIntent}</span>
          <span>{s.routingProfile}</span>
          <span>{s.routingPattern}</span>
          <span />
        </div>

        {loading && (
          <div className="text-muted-foreground px-3 py-4 text-center">
            {s.loading}
          </div>
        )}

        {!loading && rules.length === 0 && (
          <div className="text-muted-foreground px-3 py-4 text-center">
            {s.routingNoRules}
          </div>
        )}

        {rules.map((rule) => (
          <div
            key={rule.id}
            className="grid grid-cols-[80px_100px_minmax(120px,1fr)_100px_minmax(120px,1.5fr)_70px_40px] items-center gap-2 px-3 py-2"
          >
            <EditableCell
              type="number"
              value={rule.priority}
              className={FIELD_CLASS}
              onCommit={(priority) => handlePatch(rule.id, { priority })}
            />
            <select
              value={rule.channel_id}
              className={FIELD_CLASS}
              onChange={(e) =>
                handlePatch(rule.id, { channel_id: e.target.value })
              }
            >
              {CHANNEL_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <EditableCell
              value={rule.workspace_id}
              className={FIELD_CLASS}
              onCommit={(workspace_id) =>
                handlePatch(rule.id, { workspace_id })
              }
            />
            <select
              value={rule.intent}
              className={FIELD_CLASS}
              onChange={(e) =>
                handlePatch(rule.id, {
                  intent: e.target.value as RoutingRule['intent'],
                })
              }
            >
              {INTENT_OPTIONS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
            <select
              value={rule.profile_id}
              className={FIELD_CLASS}
              onChange={(e) =>
                handlePatch(rule.id, { profile_id: e.target.value })
              }
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <EditableCell
              value={rule.chat_pattern}
              className={FIELD_CLASS}
              onCommit={(chat_pattern) =>
                handlePatch(rule.id, { chat_pattern })
              }
            />
            {confirmId === rule.id ? (
              <div className="flex gap-1">
                <button
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => handleDelete(rule.id)}
                  aria-label={s.confirm}
                >
                  ✓
                </button>
                <button
                  className="text-muted-foreground text-xs hover:underline"
                  onClick={() => setConfirmId(null)}
                  aria-label={s.cancel}
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                className="text-muted-foreground hover:text-red-500"
                onClick={() => setConfirmId(rule.id)}
                aria-label={s.routingDeleteRule}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="border-border bg-muted/20 grid grid-cols-[80px_100px_minmax(120px,1fr)_100px_minmax(120px,1.5fr)_70px_40px] items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs">
        <input
          type="number"
          value={draft.priority}
          className={FIELD_CLASS}
          onChange={(e) =>
            setDraft({ ...draft, priority: Number(e.target.value) })
          }
        />
        <select
          value={draft.channel_id}
          className={FIELD_CLASS}
          onChange={(e) => setDraft({ ...draft, channel_id: e.target.value })}
        >
          {CHANNEL_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          value={draft.workspace_id}
          className={FIELD_CLASS}
          placeholder="*"
          onChange={(e) => setDraft({ ...draft, workspace_id: e.target.value })}
        />
        <select
          value={draft.intent}
          className={FIELD_CLASS}
          onChange={(e) => setDraft({ ...draft, intent: e.target.value })}
        >
          {INTENT_OPTIONS.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <select
          value={draft.profile_id}
          className={FIELD_CLASS}
          onChange={(e) => setDraft({ ...draft, profile_id: e.target.value })}
        >
          <option value="">{s.routingSelectProfile}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          value={draft.chat_pattern}
          className={FIELD_CLASS}
          placeholder="*"
          onChange={(e) => setDraft({ ...draft, chat_pattern: e.target.value })}
        />
        <button
          className={cn(
            'flex items-center justify-center rounded p-1',
            draft.profile_id
              ? 'text-foreground hover:bg-foreground/10'
              : 'text-muted-foreground/50 cursor-not-allowed',
          )}
          onClick={handleCreate}
          disabled={!draft.profile_id || creating}
          aria-label={s.routingAddRule}
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
