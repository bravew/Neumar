import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FlaskConical,
  Loader2,
  Play,
  Plug,
  Save,
  Square,
  Unplug,
} from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

async function openExternalUrl(url: string) {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
}

interface Channel {
  id: string;
  enabled: number;
  status: 'connected' | 'disconnected' | 'error';
  last_error: string | null;
}

interface ChannelListProps {
  channels: Channel[];
  onRefresh: () => void;
}

interface ChannelFieldDef {
  key: string;
  i18nKey: string;
  hintKey?: string;
  type: 'text' | 'password' | 'select';
  options?: { value: string; i18nKey: string }[];
}

const REDACTED_PLACEHOLDER = '••••••••';

const INPUT_CLASS =
  'border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1';

const ALL_CHANNELS = [
  'telegram',
  'discord',
  'slack',
  'whatsapp',
  'sms',
  'feishu',
] as const;

const CHANNEL_FIELDS: Record<string, ChannelFieldDef[]> = {
  telegram: [
    {
      key: 'botToken',
      i18nKey: 'gatewayBotToken',
      hintKey: 'gatewayBotTokenHint',
      type: 'password',
    },
    {
      key: 'transport',
      i18nKey: 'gatewayTransport',
      type: 'select',
      options: [
        { value: 'polling', i18nKey: 'gatewayTransportPolling' },
        { value: 'webhook', i18nKey: 'gatewayTransportWebhook' },
      ],
    },
    {
      key: 'webhookUrl',
      i18nKey: 'gatewayWebhookUrl',
      hintKey: 'gatewayWebhookUrlHint',
      type: 'text',
    },
  ],
  discord: [
    {
      key: 'botToken',
      i18nKey: 'gatewayBotToken',
      hintKey: 'gatewayDiscordBotTokenHint',
      type: 'password',
    },
    {
      key: 'applicationId',
      i18nKey: 'gatewayAppId',
      hintKey: 'gatewayDiscordAppIdHint',
      type: 'text',
    },
  ],
  slack: [
    {
      key: 'botToken',
      i18nKey: 'gatewayBotToken',
      hintKey: 'gatewaySlackBotTokenHint',
      type: 'password',
    },
    {
      key: 'appToken',
      i18nKey: 'gatewayAppToken',
      hintKey: 'gatewaySlackAppTokenHint',
      type: 'password',
    },
  ],
  whatsapp: [
    {
      key: 'authStorePath',
      i18nKey: 'gatewayAuthStorePath',
      hintKey: 'gatewayAuthStorePathHint',
      type: 'text',
    },
  ],
  sms: [
    {
      key: 'accountSid',
      i18nKey: 'gatewayAccountSid',
      hintKey: 'gatewayTwilioSidHint',
      type: 'text',
    },
    {
      key: 'authToken',
      i18nKey: 'gatewayAuthToken',
      hintKey: 'gatewayTwilioAuthHint',
      type: 'password',
    },
    { key: 'fromNumber', i18nKey: 'gatewayFromNumber', type: 'text' },
    { key: 'webhookUrl', i18nKey: 'gatewayWebhookUrl', type: 'text' },
  ],
  feishu: [
    {
      key: 'appId',
      i18nKey: 'gatewayAppId',
      hintKey: 'gatewayFeishuAppIdHint',
      type: 'text',
    },
    {
      key: 'appSecret',
      i18nKey: 'gatewayAppSecret',
      hintKey: 'gatewayFeishuAppSecretHint',
      type: 'password',
    },
  ],
};

const CHANNEL_NAME_KEYS: Record<string, string> = {
  telegram: 'gatewayChannelTelegram',
  discord: 'gatewayChannelDiscord',
  slack: 'gatewayChannelSlack',
  whatsapp: 'gatewayChannelWhatsApp',
  sms: 'gatewayChannelSMS',
  feishu: 'gatewayChannelFeishu',
};

const CHANNEL_DOC_URLS: Record<string, string> = {
  telegram: 'https://core.telegram.org/bots/tutorial',
  discord: 'https://discord.com/developers/docs/quick-start/getting-started',
  slack: 'https://docs.slack.dev/authentication/tokens/#bot',
  whatsapp:
    'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/',
  sms: 'https://www.twilio.com/docs/messaging/quickstart',
  feishu:
    'https://open.larksuite.com/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/quick-start/send-feishu-cards-with-app-bots',
};

function ChannelIcon({ id, className }: { id: string; className?: string }) {
  const cls = cn('size-7 shrink-0', className);

  switch (id) {
    case 'telegram':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path
            fill="#26A5E4"
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.28-.02-.12.03-2.02 1.28-5.69 3.77-.54.37-1.03.55-1.47.54-.48-.01-1.4-.27-2.09-.5-.84-.27-1.51-.42-1.45-.89.03-.24.38-.49 1.05-.74 4.11-1.79 6.85-2.97 8.24-3.54 3.93-1.62 4.75-1.9 5.27-1.91.12 0 .37.03.54.17.14.12.18.28.2.45-.01.06.01.24 0 .38z"
          />
        </svg>
      );
    case 'discord':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path
            fill="#5865F2"
            d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.52.07.07 0 0 0-.08.04c-.21.38-.45.87-.61 1.26a18.27 18.27 0 0 0-5.4 0 12.6 12.6 0 0 0-.62-1.26.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.93 1.52.07.07 0 0 0-.03.03C1.16 8.25.5 11.97.84 15.64a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.22-2a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1 0-.13c.13-.09.25-.19.37-.29a.08.08 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.07 0a.08.08 0 0 1 .08.01c.12.1.25.2.37.29a.08.08 0 0 1 0 .13c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.1c.36.7.77 1.37 1.22 2a.08.08 0 0 0 .08.03 19.83 19.83 0 0 0 6-3.03.08.08 0 0 0 .04-.05c.39-4.13-.67-7.72-2.8-10.9a.06.06 0 0 0-.04-.03zM8.02 13.33c-.95 0-1.73-.87-1.73-1.94s.76-1.94 1.73-1.94c.97 0 1.74.88 1.73 1.94 0 1.07-.77 1.94-1.73 1.94zm6.39 0c-.95 0-1.73-.87-1.73-1.94s.76-1.94 1.73-1.94c.97 0 1.74.88 1.73 1.94 0 1.07-.76 1.94-1.73 1.94z"
          />
        </svg>
      );
    case 'slack':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path
            fill="#E01E5A"
            d="M5.04 15.16a2.1 2.1 0 0 1-2.1 2.1 2.1 2.1 0 0 1-2.1-2.1 2.1 2.1 0 0 1 2.1-2.1h2.1v2.1zm1.06 0a2.1 2.1 0 0 1 2.1-2.1 2.1 2.1 0 0 1 2.1 2.1v5.26a2.1 2.1 0 0 1-2.1 2.1 2.1 2.1 0 0 1-2.1-2.1v-5.26z"
          />
          <path
            fill="#36C5F0"
            d="M8.2 5.04a2.1 2.1 0 0 1-2.1-2.1A2.1 2.1 0 0 1 8.2.84a2.1 2.1 0 0 1 2.1 2.1v2.1H8.2zm0 1.07a2.1 2.1 0 0 1 2.1 2.1 2.1 2.1 0 0 1-2.1 2.1H2.94a2.1 2.1 0 0 1-2.1-2.1 2.1 2.1 0 0 1 2.1-2.1H8.2z"
          />
          <path
            fill="#2EB67D"
            d="M18.96 8.2a2.1 2.1 0 0 1 2.1-2.1 2.1 2.1 0 0 1 2.1 2.1 2.1 2.1 0 0 1-2.1 2.1h-2.1V8.2zm-1.07 0a2.1 2.1 0 0 1-2.1 2.1 2.1 2.1 0 0 1-2.1-2.1V2.94a2.1 2.1 0 0 1 2.1-2.1 2.1 2.1 0 0 1 2.1 2.1V8.2z"
          />
          <path
            fill="#ECB22E"
            d="M15.8 18.96a2.1 2.1 0 0 1 2.1 2.1 2.1 2.1 0 0 1-2.1 2.1 2.1 2.1 0 0 1-2.1-2.1v-2.1h2.1zm0-1.07a2.1 2.1 0 0 1-2.1-2.1 2.1 2.1 0 0 1 2.1-2.1h5.26a2.1 2.1 0 0 1 2.1 2.1 2.1 2.1 0 0 1-2.1 2.1H15.8z"
          />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path
            fill="#25D366"
            d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15s-.77.97-.94 1.17c-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57a1.1 1.1 0 0 0-.8.37c-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.21 5.1 4.5.71.31 1.27.5 1.7.63.72.23 1.37.2 1.88.12.57-.08 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.37l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.9-9.88a9.83 9.83 0 0 1 7 2.9 9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.9 9.88m8.41-18.27A11.82 11.82 0 0 0 12.05.98C5.94.98.93 5.99.93 12.1a11.08 11.08 0 0 0 1.49 5.56L.84 23.02l5.49-1.44a11.12 11.12 0 0 0 5.71 1.54c6.11 0 11.12-5.01 11.12-11.12a11.07 11.07 0 0 0-3.1-7.89"
          />
        </svg>
      );
    case 'sms':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path
            fill="#F22F46"
            d="M12 2C6.48 2 2 5.58 2 10c0 1.5.5 2.89 1.35 4.1L2 18l4.26-1.28C7.86 17.54 9.86 18 12 18c5.52 0 10-3.58 10-8s-4.48-8-10-8zm-3 9a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm3 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm3 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"
          />
        </svg>
      );
    case 'feishu':
      return (
        <svg viewBox="0 0 24 24" className={cls}>
          <path
            fill="#3370FF"
            d="M3.72 3.72c.3-.64.96-.84 1.46-.46l8.98 6.79-3.14 3.35L3.5 5.26c-.42-.54-.2-1.1.22-1.54zm16.56 16.56c-.3.64-.96.84-1.46.46l-8.98-6.79 3.14-3.35 7.52 8.14c.42.54.2 1.1-.22 1.54zM6.88 20.28c-.64.3-1.24-.04-1.34-.7l-1.5-10.98 4.4.84 1.26 9.6c.08.68-.4 1.1-.82 1.24zm10.24-16.56c.64-.3 1.24.04 1.34.7l1.5 10.98-4.4-.84-1.26-9.6c-.08-.68.4-1.1.82-1.24z"
          />
        </svg>
      );
    default:
      return null;
  }
}

// ============================================================================
// Channel Config Form (extracted sub-component)
// ============================================================================

interface ChannelConfigFormProps {
  channelId: string;
  config: Record<string, unknown>;
  settingsMap: Record<string, string>;
  onFieldChange: (key: string, value: unknown) => void;
  onSave: () => void;
  onTest: () => void;
  saving: boolean;
  testing: boolean;
  testResult?: { success: boolean; error?: string };
}

function ChannelConfigForm({
  channelId,
  config,
  settingsMap,
  onFieldChange,
  onSave,
  onTest,
  saving,
  testing,
  testResult,
}: ChannelConfigFormProps) {
  const { t } = useLanguage();
  const fields = CHANNEL_FIELDS[channelId] ?? [];

  const docUrl = CHANNEL_DOC_URLS[channelId];

  return (
    <div className="border-border space-y-3 border-t px-3 py-3">
      {docUrl && (
        <button
          type="button"
          onClick={() => openExternalUrl(docUrl)}
          className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 text-xs underline-offset-2 hover:underline"
        >
          <ExternalLink className="size-3" />
          {t.settings.gatewayChannelSetupGuide}
        </button>
      )}
      {fields.map((field) => {
        const value = (config[field.key] as string) ?? '';

        const hint = field.hintKey ? settingsMap[field.hintKey] : undefined;

        return (
          <div key={field.key}>
            <label className="text-foreground mb-1 block text-xs font-medium">
              {settingsMap[field.i18nKey] ?? field.key}
            </label>
            {field.type === 'select' ? (
              <select
                value={value}
                onChange={(e) => onFieldChange(field.key, e.target.value)}
                className={INPUT_CLASS}
                title={settingsMap[field.i18nKey] ?? field.key}
              >
                {field.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {settingsMap[opt.i18nKey] ?? opt.value}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type === 'password' ? 'password' : 'text'}
                value={value}
                onChange={(e) => onFieldChange(field.key, e.target.value)}
                placeholder={settingsMap[field.i18nKey] ?? field.key}
                className={INPUT_CLASS}
                autoComplete={
                  field.type === 'password' ? 'new-password' : undefined
                }
              />
            )}
            {hint && (
              <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
            )}
          </div>
        );
      })}

      {testResult && (
        <p
          className={cn(
            'text-xs',
            testResult.success ? 'text-green-600' : 'text-red-600',
          )}
        >
          {testResult.success
            ? t.settings.gatewayChannelTestPassed
            : testResult.error}
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="bg-primary text-primary-foreground inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Save className="size-3" />
          )}
          {saving
            ? t.settings.gatewaySaving
            : t.settings.gatewayChannelSaveAndEnable}
        </button>
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 text-xs disabled:opacity-50"
        >
          {testing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <FlaskConical className="size-3" />
          )}
          {testing ? t.settings.gatewaySaving : t.settings.gatewayChannelTest}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Channel List
// ============================================================================

export function ChannelList({ channels, onRefresh }: ChannelListProps) {
  const { t } = useLanguage();
  const settingsMap = t.settings as Record<string, string>;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [configs, setConfigs] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<
    Record<string, { success: boolean; error?: string }>
  >({});

  const channelMap = useMemo(
    () => new Map(channels.map((ch) => [ch.id, ch])),
    [channels],
  );

  const fetchChannelConfig = useCallback(
    async (channelId: string, signal?: AbortSignal) => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/gateway/channels/${channelId}/config`,
          { signal },
        );
        if (signal?.aborted) return;
        if (res.ok) {
          const data = await res.json();
          setConfigs((prev) => ({ ...prev, [channelId]: data.config ?? {} }));
        }
      } catch {
        // Channel not configured yet — use empty
      }
    },
    [],
  );

  useEffect(() => {
    if (expanded && !configs[expanded]) {
      const controller = new AbortController();
      fetchChannelConfig(expanded, controller.signal);
      return () => controller.abort();
    }
  }, [expanded, configs, fetchChannelConfig]);

  const handleToggleExpand = (channelId: string) => {
    setExpanded((prev) => (prev === channelId ? null : channelId));
  };

  const handleFieldChange = (
    channelId: string,
    key: string,
    value: unknown,
  ) => {
    setConfigs((prev) => ({
      ...prev,
      [channelId]: { ...(prev[channelId] ?? {}), [key]: value },
    }));
  };

  const stripRedacted = (config: Record<string, unknown>) => {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (value !== REDACTED_PLACEHOLDER) {
        cleaned[key] = value;
      }
    }
    return cleaned;
  };

  const handleSaveChannel = async (channelId: string) => {
    const config = configs[channelId];
    if (!config) return;
    setSaving(channelId);
    try {
      const payload = stripRedacted(config);
      const res = await fetch(
        `${API_BASE_URL}/gateway/channels/${channelId}/config`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            enabled: true, // "Save & Enable" always enables
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setTestResult((prev) => ({
          ...prev,
          [channelId]: {
            success: false,
            error: (err as { error?: string }).error ?? 'Save failed',
          },
        }));
        return;
      }
      onRefresh();
    } catch {
      setTestResult((prev) => ({
        ...prev,
        [channelId]: {
          success: false,
          error: t.settings.gatewayChannelTestFailed,
        },
      }));
    } finally {
      setSaving(null);
    }
  };

  const handleTest = async (channelId: string) => {
    setTesting(channelId);
    try {
      // Save current config first so the server has the latest credentials
      const config = configs[channelId];
      if (config) {
        const payload = stripRedacted(config);
        // Don't send `enabled` — test should only save credentials, not change enabled state
        delete payload.enabled;
        await fetch(`${API_BASE_URL}/gateway/channels/${channelId}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const res = await fetch(
        `${API_BASE_URL}/gateway/channels/${channelId}/test`,
        { method: 'POST' },
      );
      const data = await res.json();
      setTestResult((prev) => ({ ...prev, [channelId]: data }));
    } catch {
      setTestResult((prev) => ({
        ...prev,
        [channelId]: {
          success: false,
          error: t.settings.gatewayChannelTestFailed,
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  const handleToggleChannel = async (
    channelId: string,
    isConnected: boolean,
  ) => {
    const endpoint = isConnected ? 'stop' : 'start';
    try {
      await fetch(`${API_BASE_URL}/gateway/channels/${channelId}/${endpoint}`, {
        method: 'POST',
      });
      onRefresh();
    } catch {
      // Handled by refresh
    }
  };

  const getChannelName = (id: string) => {
    const key = CHANNEL_NAME_KEYS[id];
    return key ? (settingsMap[key] ?? id) : id;
  };

  const getStatusBadge = (status: string) => {
    const config: Record<
      string,
      { style: string; icon: React.ReactNode; label: string }
    > = {
      connected: {
        style: 'bg-green-500/10 text-green-600',
        icon: <Plug className="size-3" />,
        label: t.settings.gatewayChannelConnected,
      },
      disconnected: {
        style: 'bg-gray-500/10 text-gray-500',
        icon: <Unplug className="size-3" />,
        label: t.settings.gatewayChannelDisconnected,
      },
      error: {
        style: 'bg-red-500/10 text-red-600',
        icon: <AlertTriangle className="size-3" />,
        label: t.settings.gatewayChannelError,
      },
    };
    const c = config[status];
    if (!c) return null;
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
          c.style,
        )}
        title={c.label}
      >
        {c.icon}
        {c.label}
      </span>
    );
  };

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-foreground text-sm font-medium">
          {t.settings.gatewayChannels}
        </h3>
        <p className="text-muted-foreground text-xs">
          {t.settings.gatewayChannelsDescription}
        </p>
      </div>

      <div className="border-border divide-border divide-y rounded-lg border">
        {ALL_CHANNELS.map((channelId) => {
          const ch = channelMap.get(channelId);
          const isExpanded = expanded === channelId;
          const config = configs[channelId] ?? {};

          return (
            <div key={channelId}>
              <button
                type="button"
                onClick={() => handleToggleExpand(channelId)}
                className="flex w-full cursor-pointer items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="text-muted-foreground size-3.5" />
                  ) : (
                    <ChevronRight className="text-muted-foreground size-3.5" />
                  )}
                  <ChannelIcon id={channelId} />
                  <span className="text-foreground text-sm font-medium">
                    {getChannelName(channelId)}
                  </span>
                  {ch && getStatusBadge(ch.status)}
                  {!ch && (
                    <span className="text-muted-foreground text-xs">
                      {t.settings.gatewayChannelNotConfigured}
                    </span>
                  )}
                </div>
                {ch && (
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => handleTest(channelId)}
                      disabled={testing === channelId}
                      title={t.settings.gatewayChannelTest}
                      className="text-muted-foreground hover:text-foreground cursor-pointer rounded p-1.5 transition-colors hover:bg-gray-500/10 disabled:opacity-50"
                    >
                      {testing === channelId ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <FlaskConical className="size-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleToggleChannel(
                          channelId,
                          ch.status === 'connected',
                        )
                      }
                      title={
                        ch.status === 'connected'
                          ? t.settings.gatewayChannelStop
                          : t.settings.gatewayChannelStart
                      }
                      className={cn(
                        'cursor-pointer rounded p-1.5 transition-colors',
                        ch.status === 'connected'
                          ? 'text-red-600 hover:bg-red-500/10'
                          : 'text-green-600 hover:bg-green-500/10',
                      )}
                    >
                      {ch.status === 'connected' ? (
                        <Square className="size-3.5" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                    </button>
                  </div>
                )}
              </button>

              {isExpanded && (
                <ChannelConfigForm
                  channelId={channelId}
                  config={config}
                  settingsMap={settingsMap}
                  onFieldChange={(key, value) =>
                    handleFieldChange(channelId, key, value)
                  }
                  onSave={() => handleSaveChannel(channelId)}
                  onTest={() => handleTest(channelId)}
                  saving={saving === channelId}
                  testing={testing === channelId}
                  testResult={testResult[channelId]}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
