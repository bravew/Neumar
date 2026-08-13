import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

type Tier = 'viewer' | 'operator' | 'admin' | 'disabled';

interface AccessSetting {
  defaultTier: Tier;
  channels?: Record<string, Tier>;
}

type AccessMap = Record<
  'google' | 'notion' | 'slack_user_token' | 'schedule_create',
  AccessSetting
>;

const CONNECTORS: Array<keyof AccessMap> = [
  'google',
  'notion',
  'slack_user_token',
  'schedule_create',
];

const TIER_OPTIONS: Tier[] = ['admin', 'operator', 'viewer', 'disabled'];

/**
 * Phase B — per-connector access controls. Lets the install owner
 * choose which permission tier may use each globally-scoped connector
 * from chat platforms. Default is admin-only.
 */
export function ConnectorAccessControls() {
  const { t } = useLanguage();
  const labels = t.settings as Record<string, string | undefined>;

  const [access, setAccess] = useState<AccessMap | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/connectors/access`, {
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { access: AccessMap };
        setAccess(body.access);
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(String(err));
      }
    })();
    return () => ac.abort();
  }, []);

  const updateTier = useCallback(
    async (connector: keyof AccessMap, defaultTier: Tier) => {
      if (!access) return;
      setSavingKey(connector);
      setError('');
      const next: AccessSetting = {
        ...access[connector],
        defaultTier,
      };
      try {
        const res = await fetch(
          `${API_BASE_URL}/connectors/access/${connector}`,
          {
            method: 'PUT',
            headers: {
              'content-type': 'application/json',
              // Required by the API's admin-origin guard — see
              // src-api/src/app/api/connectors.ts requireAdminOrigin.
              'x-neuma-admin-origin': 'desktop',
            },
            body: JSON.stringify(next),
          },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setAccess({ ...access, [connector]: next });
      } catch (err) {
        setError(String(err));
      } finally {
        setSavingKey(null);
      }
    },
    [access],
  );

  if (!access) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">
          {labels.connectorAccessTitle ?? 'Connector access by tier'}
        </h2>
        <p className="text-muted-foreground text-sm">
          {labels.connectorAccessLoading ?? 'Loading…'}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">
        {labels.connectorAccessTitle ?? 'Connector access by tier'}
      </h2>
      <p className="text-muted-foreground text-sm">
        {labels.connectorAccessHelp ??
          'Choose which permission tier may use each connector from chat platforms (Slack / Discord / Telegram / etc.). Defaults to admin-only — change with care.'}
      </p>
      <div className="border-border divide-y rounded-md border">
        {CONNECTORS.map((connector) => {
          const current = access[connector]?.defaultTier ?? 'admin';
          return (
            <div
              key={connector}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {labelForConnector(connector, labels)}
                </span>
                <span className="text-muted-foreground text-xs">
                  {descriptionForConnector(connector, labels)}
                </span>
              </div>
              <select
                aria-label={labelForConnector(connector, labels)}
                value={current}
                disabled={savingKey === connector}
                onChange={(e) =>
                  void updateTier(connector, e.target.value as Tier)
                }
                className="border-input bg-background text-foreground rounded-md border px-3 py-1.5 text-sm"
              >
                {TIER_OPTIONS.map((tier) => (
                  <option key={tier} value={tier}>
                    {tierLabel(tier, labels)}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </section>
  );
}

function labelForConnector(
  connector: keyof AccessMap,
  labels: Record<string, string | undefined>,
): string {
  switch (connector) {
    case 'google':
      return labels.connectorAccessGoogle ?? 'Google Workspace';
    case 'notion':
      return labels.connectorAccessNotion ?? 'Notion';
    case 'slack_user_token':
      return labels.connectorAccessSlackUserToken ?? 'Shared Slack user token';
    case 'schedule_create':
      return labels.connectorAccessScheduleCreate ?? 'Create automations';
  }
}

function descriptionForConnector(
  connector: keyof AccessMap,
  labels: Record<string, string | undefined>,
): string {
  switch (connector) {
    case 'google':
      return (
        labels.connectorAccessGoogleHelp ??
        'Gmail, Drive, Calendar, Docs, Sheets…'
      );
    case 'notion':
      return labels.connectorAccessNotionHelp ?? 'Notion workspace tools';
    case 'slack_user_token':
      return (
        labels.connectorAccessSlackUserTokenHelp ??
        'Shared Slack search/automation tools'
      );
    case 'schedule_create':
      return (
        labels.connectorAccessScheduleCreateHelp ??
        'Create or modify scheduled automations from chat'
      );
  }
}

function tierLabel(
  tier: Tier,
  labels: Record<string, string | undefined>,
): string {
  switch (tier) {
    case 'viewer':
      return labels.connectorAccessTierViewer ?? 'Anyone (viewer+)';
    case 'operator':
      return labels.connectorAccessTierOperator ?? 'Operators+';
    case 'admin':
      return labels.connectorAccessTierAdmin ?? 'Admins only (default)';
    case 'disabled':
      return labels.connectorAccessTierDisabled ?? 'Disabled (no one)';
  }
}
