import { useEffect, useState } from 'react';

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Link2,
  Loader2,
  Lock,
  Plug,
  RefreshCw,
  Save,
  ShieldOff,
  Unplug,
  UserCheck,
  UserMinus,
  Zap,
} from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { AuditEntry } from './types';

// ─── Action Metadata ──────────────────────────────────────────────────────────

const ACTION_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  message_received: {
    icon: <ArrowDownLeft className="size-3" />,
    color: 'text-blue-500',
  },
  message_sent: {
    icon: <ArrowUpRight className="size-3" />,
    color: 'text-green-500',
  },
  agent_error: {
    icon: <AlertTriangle className="size-3" />,
    color: 'text-red-500',
  },
  user_paired: {
    icon: <UserCheck className="size-3" />,
    color: 'text-emerald-500',
  },
  user_removed: {
    icon: <UserMinus className="size-3" />,
    color: 'text-orange-500',
  },
  user_tier_changed: {
    icon: <RefreshCw className="size-3" />,
    color: 'text-purple-500',
  },
  config_updated: {
    icon: <Save className="size-3" />,
    color: 'text-muted-foreground',
  },
  message_rate_limited: {
    icon: <Zap className="size-3" />,
    color: 'text-amber-500',
  },
  message_budget_exceeded: {
    icon: <Lock className="size-3" />,
    color: 'text-red-400',
  },
  message_guardrail_blocked: {
    icon: <ShieldOff className="size-3" />,
    color: 'text-red-500',
  },
  plugin_error: {
    icon: <AlertTriangle className="size-3" />,
    color: 'text-red-500',
  },
  plugin_started: {
    icon: <Plug className="size-3" />,
    color: 'text-green-500',
  },
  plugin_stopped: {
    icon: <Unplug className="size-3" />,
    color: 'text-gray-400',
  },
};

interface StatCard {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AuditTab({ configId }: { configId: string }) {
  const { t } = useLanguage();
  const s = t.settings;
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const ACTION_LABELS: Record<string, string> = {
    message_received: s.auditActionMessageReceived,
    message_sent: s.auditActionResponseSent,
    agent_error: s.auditActionAgentError,
    user_paired: s.auditActionUserPaired,
    user_removed: s.auditActionUserRemoved,
    user_tier_changed: s.auditActionTierChanged,
    config_updated: s.auditActionConfigUpdated,
    message_rate_limited: s.auditActionRateLimited,
    message_budget_exceeded: s.auditActionBudgetExceeded,
    message_guardrail_blocked: s.auditActionGuardrailBlocked,
    plugin_error: s.auditActionPluginError,
    plugin_started: s.auditActionBotStarted,
    plugin_stopped: s.auditActionBotStopped,
  };

  function getActionMeta(action: string) {
    const base = ACTION_ICONS[action] ?? {
      icon: <Link2 className="size-3" />,
      color: 'text-muted-foreground',
    };
    return {
      ...base,
      label: ACTION_LABELS[action] ?? action.replace(/_/g, ' '),
    };
  }

  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    fetch(`${API_BASE_URL}/channels/configs/${configId}/audit-log?limit=200`, {
      signal: c.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { logs?: AuditEntry[] } | null) => {
        if (d) setEntries(d.logs ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => c.abort();
  }, [configId]);

  if (loading)
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
      </div>
    );

  const count = (action: string) =>
    entries.filter((e) => e.action === action).length;

  const stats: StatCard[] = [
    {
      label: s.auditStatReceived,
      value: count('message_received'),
      icon: <ArrowDownLeft className="size-3.5" />,
      color: 'text-blue-500 bg-blue-500/10',
    },
    {
      label: s.auditStatSent,
      value: count('message_sent'),
      icon: <ArrowUpRight className="size-3.5" />,
      color: 'text-green-500 bg-green-500/10',
    },
    {
      label: s.auditStatErrors,
      value: count('agent_error') + count('plugin_error'),
      icon: <AlertTriangle className="size-3.5" />,
      color: 'text-red-500 bg-red-500/10',
    },
    {
      label: s.auditStatBlocked,
      value:
        count('message_rate_limited') +
        count('message_budget_exceeded') +
        count('message_guardrail_blocked'),
      icon: <ShieldOff className="size-3.5" />,
      color: 'text-amber-500 bg-amber-500/10',
    },
    {
      label: s.auditStatUsers,
      value: count('user_paired'),
      icon: <UserCheck className="size-3.5" />,
      color: 'text-emerald-500 bg-emerald-500/10',
    },
  ];

  return (
    <div className="space-y-3">
      {/* Stats grid */}
      <div className="grid grid-cols-5 gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="border-border rounded-lg border px-2 py-2 text-center"
          >
            <div
              className={cn(
                'mx-auto mb-1 flex size-6 items-center justify-center rounded-full',
                stat.color,
              )}
            >
              {stat.icon}
            </div>
            <p className="text-foreground text-sm font-semibold">
              {stat.value}
            </p>
            <p className="text-muted-foreground text-xs">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Event timeline */}
      {entries.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          {s?.channelAuditLogEmpty ?? 'No audit events yet'}
        </p>
      ) : (
        <div className="border-border divide-border max-h-64 divide-y overflow-y-auto rounded-lg border">
          {entries.map((entry) => {
            const meta = getActionMeta(entry.action);
            return (
              <div
                key={entry.id}
                className="flex items-center gap-2.5 px-3 py-2"
              >
                <span className={cn('shrink-0', meta.color)}>{meta.icon}</span>
                <span className="text-foreground flex-1 truncate text-xs">
                  {meta.label}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {new Date(entry.created_at).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
