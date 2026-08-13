import { useCallback, useEffect, useState } from 'react';

import { Loader2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { Switch } from '../../components/Switch';
import {
  GATEWAY_LABELS,
  GatewayIcon,
  type GatewayChannelId,
} from './GatewayIcon';

interface GatewayChannelRow {
  id: string;
  enabled: boolean;
  runtimeClass?: 'official' | 'bridge' | 'experimental';
  health:
    | 'connected'
    | 'degraded'
    | 'quarantined'
    | 'disabled'
    | 'disconnected';
  lastError: string | null;
  lastConnectedAt: string | null;
}

const HEALTH_STYLES: Record<string, string> = {
  connected: 'bg-green-500/10 text-green-600',
  degraded: 'bg-amber-500/10 text-amber-600',
  quarantined: 'bg-red-500/10 text-red-600',
  disabled: 'bg-gray-500/10 text-gray-500',
  disconnected: 'bg-gray-500/10 text-gray-500',
};

export function GatewayChannelList() {
  const { t } = useLanguage();
  const s = t.settings as Record<string, string>;
  const [channels, setChannels] = useState<GatewayChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${API_BASE_URL}/channels/`, { signal });
      if (res.ok) {
        const data = (await res.json()) as { channels: GatewayChannelRow[] };
        setChannels(data.channels);
      }
    } catch {
      // aborted or network error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    refresh(ac.signal);
    return () => ac.abort();
  }, [refresh]);

  const onToggle = async (id: string, enable: boolean) => {
    setBusy(id);
    setChannels((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, enabled: enable, health: enable ? c.health : 'disabled' }
          : c,
      ),
    );
    try {
      const res = await fetch(
        `${API_BASE_URL}/channels/${id}/${enable ? 'enable' : 'disable'}`,
        { method: 'POST' },
      );
      if (!res.ok) await refresh();
    } finally {
      setBusy(null);
    }
  };

  const onReconnect = async (id: string) => {
    setBusy(id);
    setChannels((prev) =>
      prev.map((c) => (c.id === id ? { ...c, health: 'disconnected' } : c)),
    );
    try {
      const res = await fetch(`${API_BASE_URL}/channels/${id}/reconnect`, {
        method: 'POST',
      });
      if (!res.ok) await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-foreground text-sm font-medium">
          {s.gatewayAdapters}
        </h3>
        <p className="text-muted-foreground text-xs">
          {s.gatewayAdaptersDescriptionPrefix} <code>gateway_channels</code>
          {s.gatewayAdaptersDescriptionSuffix}
        </p>
      </div>

      <div className="border-border divide-border divide-y rounded-lg border">
        {loading && (
          <div className="text-muted-foreground flex items-center gap-2 px-4 py-4 text-sm">
            <Loader2 className="size-3.5 animate-spin" />
            {s.loading}
          </div>
        )}

        {!loading && channels.length === 0 && (
          <div className="text-muted-foreground px-4 py-4 text-sm">
            {s.gatewayNoAdapters}
          </div>
        )}

        {channels.map((row) => {
          const id = row.id as GatewayChannelId;
          return (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <GatewayIcon id={id} className="size-6" />
                <div>
                  <div className="text-foreground text-sm font-medium">
                    {GATEWAY_LABELS[id] ?? row.id}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 font-medium',
                        HEALTH_STYLES[row.health] ?? HEALTH_STYLES.disabled,
                      )}
                    >
                      {row.health}
                    </span>
                    {row.runtimeClass && row.runtimeClass !== 'official' && (
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 font-medium',
                          row.runtimeClass === 'bridge'
                            ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
                            : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                        )}
                      >
                        {row.runtimeClass}
                      </span>
                    )}
                    {row.lastError && (
                      <span className="text-red-500" title={row.lastError}>
                        {row.lastError.slice(0, 60)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {busy === row.id && (
                  <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
                )}
                <button
                  onClick={() => onReconnect(row.id)}
                  className="text-muted-foreground hover:text-foreground text-xs"
                  disabled={busy === row.id || !row.enabled}
                >
                  {s.reconnect}
                </button>
                <Switch
                  checked={row.enabled}
                  onChange={(next) => onToggle(row.id, next)}
                  disabled={busy === row.id}
                  label={`${s.gatewayEnableAdapter} ${GATEWAY_LABELS[id] ?? row.id}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
