import { useEffect, useState } from 'react';

import { Check, Copy, KeyRound, Loader2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { TierBadge } from './PlatformIcon';
import type { ChannelUser, PermissionTier } from './types';

export function UsersTab({ configId }: { configId: string }) {
  const { t } = useLanguage();
  const s = t.settings;
  const [users, setUsers] = useState<ChannelUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    fetch(`${API_BASE_URL}/channels/configs/${configId}/users`, {
      signal: c.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { users?: ChannelUser[] } | null) => {
        if (d) setUsers(d.users ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => c.abort();
  }, [configId]);

  const generateCode = async () => {
    setGenerating(true);
    setPairCode(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/channels/configs/${configId}/pairing/generate`,
        {
          method: 'POST',
        },
      );
      if (res.ok) {
        const data = (await res.json()) as { code: string; expiresAt: string };
        setPairCode(data);
      }
    } catch {
      // ignore
    } finally {
      setGenerating(false);
    }
  };

  const copyCode = async () => {
    if (!pairCode) return;
    await navigator.clipboard.writeText(pairCode.code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const patchTier = async (id: string, tier: PermissionTier) => {
    setUpdating(id);
    await fetch(`${API_BASE_URL}/channels/users/${id}/tier`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    }).catch(() => {});
    setUsers((p) =>
      p.map((u) => (u.id === id ? { ...u, permission_tier: tier } : u)),
    );
    setUpdating(null);
  };

  const patchBudget = async (id: string, token_budget: number) => {
    setUpdating(id);
    await fetch(`${API_BASE_URL}/channels/users/${id}/budget`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenBudget: token_budget }),
    }).catch(() => {});
    setUsers((p) => p.map((u) => (u.id === id ? { ...u, token_budget } : u)));
    setUpdating(null);
  };

  const remove = async (id: string) => {
    await fetch(`${API_BASE_URL}/channels/users/${id}`, {
      method: 'DELETE',
    }).catch(() => {});
    setUsers((p) => p.filter((u) => u.id !== id));
  };

  if (loading)
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
      </div>
    );

  return (
    <div className="space-y-3">
      {/* Pairing code generator */}
      <div className="border-border bg-muted/30 rounded-lg border p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-foreground text-xs font-medium">
              {s?.channelAddUser ?? 'Add User'}
            </p>
            <p className="text-muted-foreground text-xs">
              {s?.channelAddUserHint ??
                'Generate a code, then send /pair <code> to the bot'}
            </p>
          </div>
          <button
            type="button"
            onClick={generateCode}
            disabled={generating}
            className="bg-primary text-primary-foreground inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {generating ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <KeyRound className="size-3" />
            )}
            {s?.channelGenerateCode ?? 'Generate Code'}
          </button>
        </div>

        {pairCode && (
          <div className="border-border mt-3 flex items-center gap-2 rounded-md border bg-white/5 px-3 py-2">
            <span className="text-foreground flex-1 font-mono text-lg font-bold tracking-[0.25em]">
              {pairCode.code}
            </span>
            <button
              type="button"
              onClick={copyCode}
              className={cn(
                'inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
                copied
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              {copied ? (
                <Check className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
              {copied
                ? (s?.channelCopied ?? 'Copied')
                : (s?.channelCopy ?? 'Copy')}
            </button>
            <span className="text-muted-foreground text-xs">
              {s?.channelExpires ?? 'expires'}{' '}
              {new Date(pairCode.expiresAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        )}
      </div>

      {/* User list */}
      {users.length === 0 ? (
        <p className="text-muted-foreground py-2 text-center text-xs">
          {s?.channelNoUsers ?? 'No paired users yet'}
        </p>
      ) : (
        <div className="border-border divide-border divide-y rounded-lg border">
          {users.map((u) => (
            <div key={u.id} className="space-y-2 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-foreground text-sm font-medium">
                    {u.display_name ?? u.platform_user_id}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    #{u.platform_user_id}
                  </span>
                  <TierBadge tier={u.permission_tier} />
                </div>
                <button
                  onClick={() => remove(u.id)}
                  className="text-muted-foreground hover:text-destructive cursor-pointer text-xs transition-colors"
                >
                  {s?.channelRemoveUser ?? 'Remove'}
                </button>
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-muted-foreground text-xs">
                    {s?.channelUserTier ?? 'Tier'}
                  </label>
                  <select
                    value={u.permission_tier}
                    onChange={(e) =>
                      patchTier(u.id, e.target.value as PermissionTier)
                    }
                    disabled={updating === u.id}
                    className="border-border bg-background text-foreground rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                  >
                    <option value="viewer">
                      {s?.channelTierViewer ?? 'Viewer'}
                    </option>
                    <option value="operator">
                      {s?.channelTierOperator ?? 'Operator'}
                    </option>
                    <option value="admin">
                      {s?.channelTierAdmin ?? 'Admin'}
                    </option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-muted-foreground text-xs">
                    {s?.channelUserBudget ?? 'Budget (tokens)'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={u.token_budget}
                    onChange={(e) => patchBudget(u.id, Number(e.target.value))}
                    disabled={updating === u.id}
                    className="border-border bg-background text-foreground w-24 rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                  />
                  {u.token_budget === 0 && (
                    <span className="text-muted-foreground text-xs">
                      {s?.channelUserBudgetUnlimited ?? 'Unlimited'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
