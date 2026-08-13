import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

import { buildTokenPayload } from './buildTokenPayload';
import {
  DEFAULT_CONFIG,
  PLATFORM_LABELS,
  type ChannelStatus,
  type Platform,
  type PlatformConfig,
} from './types';

export interface UseChannelActions {
  configs: PlatformConfig[];
  statuses: Record<string, ChannelStatus>;
  expanded: string | null;
  saving: string | null;
  starting: string | null;
  testing: string | null;
  startErrors: Record<string, string>;
  testResults: Record<string, { valid: boolean; error?: string }>;
  pendingDeleteId: string | null;
  botErrors: Record<string, string>;
  setExpanded: React.Dispatch<React.SetStateAction<string | null>>;
  setPendingDeleteId: React.Dispatch<React.SetStateAction<string | null>>;
  handleToggleRunning: (
    configId: string,
    overrideStatuses?: Record<string, ChannelStatus>,
  ) => Promise<void>;
  handleSave: (
    configId: string,
    platform: Platform,
    creds: Record<string, string>,
    cfg: Partial<PlatformConfig>,
  ) => Promise<void>;
  handleTest: (
    configId: string,
    creds?: Record<string, string>,
  ) => Promise<void>;
  handleAddBot: (platform: Platform) => Promise<void>;
  handleDeleteBot: (configId: string) => Promise<void>;
}

export function useChannelActions(): UseChannelActions {
  const { t } = useLanguage();
  const s = t.settings;

  const [configs, setConfigs] = useState<PlatformConfig[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ChannelStatus>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [startErrors, setStartErrors] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { valid: boolean; error?: string }>
  >({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [botErrors, setBotErrors] = useState<Record<string, string>>({});

  const loadData = useCallback(
    async (signal?: AbortSignal): Promise<Record<string, ChannelStatus>> => {
      const freshStatuses: Record<string, ChannelStatus> = {};
      try {
        const [cfgResult, statusResult] = await Promise.allSettled([
          fetch(`${API_BASE_URL}/channels/configs`, { signal }).then((r) =>
            r.ok ? r.json() : null,
          ),
          fetch(`${API_BASE_URL}/channels/status`, { signal }).then((r) =>
            r.ok ? r.json() : null,
          ),
        ]);
        if (cfgResult.status === 'fulfilled' && cfgResult.value) {
          const data = cfgResult.value as { configs: PlatformConfig[] };
          setConfigs(data.configs);
        }
        if (statusResult.status === 'fulfilled' && statusResult.value) {
          const raw =
            (
              statusResult.value as {
                status: Record<string, ChannelStatus>;
              }
            ).status ?? {};
          for (const [k, v] of Object.entries(raw)) {
            freshStatuses[k] =
              typeof v === 'string'
                ? {
                    platform: '',
                    name: null,
                    state: v as ChannelStatus['state'],
                  }
                : v;
          }
          setStatuses(freshStatuses);
        }
      } catch {
        // ignore
      }
      return freshStatuses;
    },
    [],
  );

  useEffect(() => {
    const c = new AbortController();
    loadData(c.signal);
    return () => c.abort();
  }, [loadData]);

  const handleToggleRunning = async (
    configId: string,
    overrideStatuses?: Record<string, ChannelStatus>,
  ) => {
    const state = (overrideStatuses ?? statuses)[configId]?.state;
    const ep = state === 'running' ? 'stop' : 'start';
    if (ep === 'start') setStarting(configId);
    setStartErrors((prev) => {
      const n = { ...prev };
      delete n[configId];
      return n;
    });
    try {
      const res = await fetch(
        `${API_BASE_URL}/channels/configs/${configId}/${ep}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setStartErrors((prev) => ({
          ...prev,
          [configId]: data.error ?? s?.channelStartFailed ?? 'Start failed',
        }));
      }
    } catch {
      setStartErrors((prev) => ({
        ...prev,
        [configId]: s?.channelNetworkError ?? 'Network error',
      }));
    } finally {
      setStarting(null);
    }
    await loadData();
  };

  const handleSave = async (
    configId: string,
    platform: Platform,
    creds: Record<string, string>,
    cfg: Partial<PlatformConfig>,
  ) => {
    setSaving(configId);
    try {
      const token = buildTokenPayload(platform, creds);
      const currentCfg =
        configs.find((c) => c.id === configId) ?? DEFAULT_CONFIG;
      const body: Record<string, unknown> = {
        mode: currentCfg.mode,
        rate_limit: currentCfg.rate_limit,
        ...cfg,
        model: cfg.model !== undefined ? cfg.model : (currentCfg.model ?? null),
      };
      if (token) body.token = token;
      const res = await fetch(`${API_BASE_URL}/channels/configs/${configId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const saveData = (await res.json().catch(() => ({}))) as {
        error?: string;
        restartError?: string;
      };
      if (!res.ok) {
        throw new Error(saveData.error ?? `Save failed (${res.status})`);
      }
      if (saveData.restartError) {
        setStartErrors((prev) => ({
          ...prev,
          [configId]: saveData.restartError as string,
        }));
      }
      const freshStatuses = await loadData();
      if (
        cfg.enabled &&
        (freshStatuses[configId]?.state ?? 'stopped') !== 'running'
      ) {
        await handleToggleRunning(configId, freshStatuses);
      }
    } finally {
      setSaving(null);
    }
  };

  const handleTest = async (
    configId: string,
    creds?: Record<string, string>,
  ) => {
    setTesting(configId);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[configId];
      return next;
    });
    try {
      const cfg = configs.find((c) => c.id === configId);
      const tokenBody =
        creds && cfg ? buildTokenPayload(cfg.platform, creds) : undefined;
      const res = await fetch(
        `${API_BASE_URL}/channels/configs/${configId}/validate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: tokenBody ? JSON.stringify({ token: tokenBody }) : undefined,
        },
      );
      const data = (await res.json()) as { valid: boolean; error?: string };
      setTestResults((prev) => ({
        ...prev,
        [configId]: { valid: data.valid, error: data.error },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [configId]: {
          valid: false,
          error:
            err instanceof Error
              ? err.message
              : (s?.channelConnectionFailed ?? 'Connection failed'),
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  const handleAddBot = async (platform: Platform) => {
    setBotErrors((prev) => {
      const n = { ...prev };
      delete n[platform];
      return n;
    });
    try {
      const res = await fetch(`${API_BASE_URL}/channels/configs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          name: `New ${PLATFORM_LABELS[platform]} Bot`,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setBotErrors((prev) => ({
          ...prev,
          [platform]:
            data.error ?? s?.channelAddBotFailed ?? 'Failed to add bot',
        }));
        return;
      }
      const data = (await res.json()) as PlatformConfig;
      await loadData();
      setExpanded(data.id);
    } catch {
      setBotErrors((prev) => ({
        ...prev,
        [platform]: s?.channelNetworkError ?? 'Network error',
      }));
    }
  };

  const handleDeleteBot = async (configId: string) => {
    setPendingDeleteId(null);
    try {
      const res = await fetch(`${API_BASE_URL}/channels/configs/${configId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setStartErrors((prev) => ({
          ...prev,
          [configId]:
            data.error ?? s?.channelDeleteBotFailed ?? 'Failed to delete bot',
        }));
        return;
      }
      setExpanded(null);
      await loadData();
    } catch {
      setStartErrors((prev) => ({
        ...prev,
        [configId]: s?.channelNetworkError ?? 'Network error',
      }));
    }
  };

  return {
    configs,
    statuses,
    expanded,
    saving,
    starting,
    testing,
    startErrors,
    testResults,
    pendingDeleteId,
    botErrors,
    setExpanded,
    setPendingDeleteId,
    handleToggleRunning,
    handleSave,
    handleTest,
    handleAddBot,
    handleDeleteBot,
  };
}
