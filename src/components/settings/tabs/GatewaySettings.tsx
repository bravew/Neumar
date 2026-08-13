import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

import { AuditLogViewer } from './gateway/AuditLogViewer';
import { ChannelList } from './gateway/ChannelList';
import { GatewayDashboard } from './gateway/GatewayDashboard';
import { IdentityTable } from './gateway/IdentityTable';
import { SecuritySettings } from './gateway/SecuritySettings';

interface GatewayHealth {
  status: 'running' | 'stopped';
  activeChannels: number;
  totalChannels: number;
  uptime: number;
}

interface GatewayConfigData {
  gateway: { enabled: boolean; logLevel: string };
  security: {
    defaultPermissionTier: 'viewer' | 'operator' | 'admin';
    rateLimiting: { messagesPerMinute: number };
    tokenBudget: {
      defaultDailyLimit: number;
      enforcementMode: 'enforce' | 'warn-only';
    };
    guardrails: { provider: string; failMode: string };
    concurrency: { maxAgentRunsPerIdentity: number };
  };
  routing: { defaultSessionMode: string; commandPrefix: string };
  notifications: { enabled: boolean; toolApprovalTimeoutSeconds: number };
}

interface ChannelMetrics {
  status: string;
  messagesIn: number;
  messagesOut: number;
  errors: number;
  avgLatencyMs: number;
  lastHeartbeat: string | null;
}

interface Channel {
  id: string;
  enabled: number;
  status: 'connected' | 'disconnected' | 'error';
  last_error: string | null;
  metrics: ChannelMetrics | null;
}

interface Identity {
  id: string;
  user_alias: string | null;
  permission_tier: string;
  token_budget: number;
  tokens_used_today: number;
  channels: { channel_id: string; channel_username: string | null }[];
}

export function GatewaySettings() {
  const { t } = useLanguage();
  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [config, setConfig] = useState<GatewayConfigData | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [saving, setSaving] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const mountedRef = useRef(true);
  const pollingControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    try {
      const results = await Promise.allSettled([
        fetch(`${API_BASE_URL}/gateway/health`, { signal }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
        fetch(`${API_BASE_URL}/gateway/config`, { signal }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
        fetch(`${API_BASE_URL}/gateway/channels`, { signal }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
        fetch(`${API_BASE_URL}/gateway/identities`, { signal }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
      ]);

      if (signal?.aborted) return;

      if (results[0].status === 'fulfilled') setHealth(results[0].value);
      if (results[1].status === 'fulfilled') setConfig(results[1].value);
      if (results[2].status === 'fulfilled')
        setChannels(results[2].value.channels ?? []);
      if (results[3].status === 'fulfilled')
        setIdentities(results[3].value.identities ?? []);
    } catch {
      // Ignore fetch errors (server might not be running)
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    mountedRef.current = true;
    fetchData(controller.signal);
    return () => {
      mountedRef.current = false;
      controller.abort();
      pollingControllerRef.current?.abort();
    };
  }, [fetchData]);

  const [enableError, setEnableError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/gateway/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSaveError(
          (err as { error?: string }).error ?? `Save failed (${res.status})`,
        );
      }
    } catch {
      setSaveError('Failed to save gateway config');
    } finally {
      setSaving(false);
    }
  };

  const handleEnableGateway = async () => {
    setEnabling(true);
    setEnableError(null);
    const controller = new AbortController();
    pollingControllerRef.current = controller;
    try {
      const postRes = await fetch(`${API_BASE_URL}/gateway/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateway: { enabled: true, logLevel: 'info' } }),
        signal: controller.signal,
      });
      if (!postRes.ok) {
        const err = await postRes.json().catch(() => ({}));
        setEnableError(
          (err as { error?: string }).error ??
            t.settings.gatewayEnableFailedStatus.replace(
              '{status}',
              String(postRes.status),
            ),
        );
        return;
      }
      // Gateway starts async on the server — poll until it reports running
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (controller.signal.aborted) return;
        const res = await fetch(`${API_BASE_URL}/gateway/health`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (data.status === 'running') {
          await fetchData(controller.signal);
          return;
        }
      }
      // Fallback: refresh anyway after timeout
      if (!controller.signal.aborted) {
        await fetchData(controller.signal);
        setEnableError(t.settings.gatewayStartTimeout);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setEnableError(
        err instanceof Error ? err.message : t.settings.gatewayConnectionError,
      );
    } finally {
      pollingControllerRef.current = null;
      if (mountedRef.current) setEnabling(false);
    }
  };

  if (!health || health.status === 'stopped') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <p className="text-muted-foreground text-sm">
          {t.settings.gatewayNotRunning}
        </p>
        <button
          onClick={handleEnableGateway}
          disabled={enabling}
          className="bg-primary text-primary-foreground cursor-pointer rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {enabling ? t.settings.gatewayEnabling : t.settings.gatewayEnable}
        </button>
        {enableError && (
          <p className="max-w-md text-center text-sm text-red-600 dark:text-red-400">
            {enableError}
          </p>
        )}
      </div>
    );
  }

  // Aggregate dashboard metrics from channel data
  const dashboardMetrics = channels.reduce(
    (acc, ch) => {
      if (ch.status === 'connected') acc.activeChannels++;
      if (ch.metrics) {
        acc.messagesToday += ch.metrics.messagesIn + ch.metrics.messagesOut;
        acc.errorsToday += ch.metrics.errors;
        acc.totalLatency += ch.metrics.avgLatencyMs;
        if (ch.metrics.avgLatencyMs > 0) acc.latencyCount++;
      }
      return acc;
    },
    {
      activeChannels: 0,
      totalChannels: channels.length,
      messagesToday: 0,
      errorsToday: 0,
      totalLatency: 0,
      latencyCount: 0,
      get avgLatencyMs() {
        return this.latencyCount > 0
          ? Math.round(this.totalLatency / this.latencyCount)
          : 0;
      },
    },
  );

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        {t.settings.gatewayDescription}
      </p>

      <GatewayDashboard metrics={dashboardMetrics} />

      <ChannelList channels={channels} onRefresh={fetchData} />

      {config && (
        <SecuritySettings
          config={config.security}
          onChange={(security) =>
            setConfig((prev) => (prev ? { ...prev, security } : prev))
          }
        />
      )}

      <IdentityTable identities={identities} onRefresh={fetchData} />

      <AuditLogViewer />

      {config && (
        <div className="flex items-center justify-end gap-3">
          {saveError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {saveError}
            </p>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-primary-foreground cursor-pointer rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {saving ? t.settings.gatewaySaving : t.settings.gatewaySave}
          </button>
        </div>
      )}
    </div>
  );
}
