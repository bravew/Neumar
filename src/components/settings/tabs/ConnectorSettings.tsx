import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { useAuth } from '@/shared/hooks/useAuth';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { CloudStorageConnectionsSection } from '../cloud-storage/CloudStorageConnectionsSection';
import { SlackChannelCombobox } from '../components/SlackChannelCombobox';
import { Switch } from '../components/Switch';
import { ConnectorAccessControls } from '../ConnectorAccessControls';
import { GoogleWorkspaceSection } from '../GoogleWorkspaceSection';
import { OAuthCredentialsForm } from '../OAuthCredentialsForm';
import { SlackConnectionSection } from '../SlackConnectionSection';
import type { SettingsTabProps } from '../types';
import { ConnectorAuthErrorBanner } from './connector/ConnectorAuthErrorBanner';
import {
  defaultLinearFormState,
  type LinearFormState,
} from './connector/linear-form-state';

// Hoisted outside component — no dependency on props/state (rendering-hoist-jsx)
const INPUT_CLASS =
  'border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1';

function isRedacted(value: string): boolean {
  return value.includes('****');
}

export function ConnectorSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const { t } = useLanguage();
  const auth = useAuth();
  const slackConnected = auth.getConnection('slack')?.status === 'active';
  const [form, setForm] = useState<LinearFormState>(defaultLinearFormState);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'testing' | 'connected' | 'error'
  >('idle');
  const [connectionError, setConnectionError] = useState('');
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [persistentAuthError, setPersistentAuthError] = useState('');

  useEffect(() => {
    if (auth.error) setPersistentAuthError(auth.error);
  }, [auth.error]);

  // Ref to sync enabled flags without adding deps to the mount effect
  type EnabledData = { linearEnabled?: boolean; slackEnabled?: boolean };
  const syncEnabledRef = useRef<((data: EnabledData) => void) | null>(null);
  syncEnabledRef.current = (data) => {
    const updates: Partial<typeof settings> = {};
    if (data.linearEnabled !== undefined)
      updates.linearEnabled = data.linearEnabled;
    if (data.slackEnabled !== undefined)
      updates.slackEnabled = data.slackEnabled;
    onSettingsChange({ ...settings, ...updates });
  };

  // Load config from backend on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch(`${API_BASE_URL}/linear/config`);
        if (res.ok) {
          const { data } = await res.json();
          if (data) {
            setForm({
              apiKey: data.apiKey ?? '',
              webhookSecret: data.webhookSecret ?? '',
              teamId: data.teamId ?? '',
              assigneeFilter: data.assigneeFilter ?? '',
              pollIntervalMs: data.pollIntervalMs ?? 300000,
              pollEnabled: data.pollEnabled ?? false,
              webhookEnabled: data.webhookEnabled ?? true,
              autoProcess: data.autoProcess ?? false,
              workspaceDir: data.workspaceDir ?? '',
              defaultBranch: data.defaultBranch ?? 'main',
              githubToken: data.githubToken ?? '',
              slackWebhookUrl: data.slackWebhookUrl ?? '',
              slackChannel: data.slackChannel ?? '',
            });
            if (data.apiKey && !isRedacted(data.apiKey)) {
              setConnectionStatus('connected');
            }
            // Sync enabled flags from backend to frontend settings
            if (
              data.linearEnabled !== undefined ||
              data.slackEnabled !== undefined
            ) {
              syncEnabledRef.current?.(data);
            }
          }
        }
      } catch {
        // Backend might not be running
      } finally {
        setLoading(false);
      }
    }
    loadConfig();
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError('');
    try {
      // Only send non-redacted values to avoid overwriting secrets with masked strings
      const payload: Record<string, unknown> = {
        linearEnabled: settings.linearEnabled,
        slackEnabled: settings.slackEnabled,
      };
      for (const [key, value] of Object.entries(form)) {
        if (typeof value === 'string' && isRedacted(value)) continue;
        payload[key] = value;
      }

      const res = await fetch(`${API_BASE_URL}/linear/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error ?? 'Failed to save configuration');
      }
    } catch {
      setSaveError('Failed to connect to API server');
    } finally {
      setSaving(false);
    }
  }, [form, settings.linearEnabled, settings.slackEnabled]);

  const handleTestConnection = useCallback(async () => {
    // If user edited the field, always send their value (even if it looks redacted)
    // Only use stored key when the field is untouched from the loaded redacted value
    const useStored = !apiKeyDirty && isRedacted(form.apiKey);

    if (apiKeyDirty && !form.apiKey) {
      setConnectionStatus('error');
      setConnectionError('Enter an API key to test the connection');
      return;
    }

    setConnectionStatus('testing');
    setConnectionError('');
    try {
      const res = await fetch(`${API_BASE_URL}/linear/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          useStored ? { useStored: true } : { apiKey: form.apiKey },
        ),
      });
      const data = await res.json();
      if (data.success) {
        setConnectionStatus('connected');
      } else {
        setConnectionStatus('error');
        setConnectionError(data.error ?? 'Connection failed');
      }
    } catch {
      setConnectionStatus('error');
      setConnectionError('Failed to connect to API');
    }
  }, [form.apiKey, apiKeyDirty]);

  const [slackTesting, setSlackTesting] = useState(false);
  const [slackTestResult, setSlackTestResult] = useState<
    'idle' | 'success' | 'error'
  >('idle');
  const [slackTestError, setSlackTestError] = useState('');

  const handleSlackTest = useCallback(async () => {
    setSlackTesting(true);
    setSlackTestResult('idle');
    setSlackTestError('');
    try {
      if (slackConnected) {
        // OAuth-connected: use Slack gateway test
        const res = await fetch(`${API_BASE_URL}/slack/gateway/test`, {
          method: 'POST',
        });
        const data = await res.json();
        if (data.success) {
          setSlackTestResult('success');
        } else {
          setSlackTestResult('error');
          setSlackTestError(data.error ?? 'Connectivity test failed');
        }
      } else {
        // Webhook mode: save config first so backend has the latest webhook URL
        await handleSave();
        const res = await fetch(`${API_BASE_URL}/linear/test-slack`, {
          method: 'POST',
        });
        const data = await res.json();
        if (data.success) {
          setSlackTestResult('success');
        } else {
          setSlackTestResult('error');
          setSlackTestError(data.error ?? 'Failed to send test message');
        }
      }
    } catch {
      setSlackTestResult('error');
      setSlackTestError('Failed to connect to API');
    } finally {
      setSlackTesting(false);
    }
  }, [handleSave, slackConnected]);

  const updateField = <K extends keyof LinearFormState>(
    key: K,
    value: LinearFormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  /** Sync a connector enabled flag to the backend immediately */
  const syncEnabledToBackend = useCallback(
    (field: 'linearEnabled' | 'slackEnabled', value: boolean) => {
      fetch(`${API_BASE_URL}/linear/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      }).catch(() => {});
    },
    [],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="border-primary size-5 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {persistentAuthError && (
        <ConnectorAuthErrorBanner
          error={persistentAuthError}
          onDismiss={() => setPersistentAuthError('')}
          onRetry={() => {
            setPersistentAuthError('');
            void auth.refresh();
          }}
        />
      )}

      <GoogleWorkspaceSection />

      <section className="space-y-2">
        <SlackConnectionSection />
      </section>

      {/* Notion Credentials */}
      <section className="border-border space-y-3 rounded-lg border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
            <svg
              className="size-5"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L18.18 2.25c-.42-.326-.98-.7-2.055-.607L3.01 2.71c-.467.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.84-.046.933-.56.933-1.167V6.354c0-.606-.233-.933-.746-.886l-15.177.84c-.56.047-.747.327-.747.98zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.747 0-.933-.234-1.495-.933l-4.577-7.186v6.952l1.448.327s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V8.755L8.66 8.568c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.886.747-.933zM2.31 1.234L16.452.048c1.681-.14 2.1.093 2.8.607l3.876 2.707c.56.42.747.933.747 1.54v17.007c0 1.074-.42 1.727-1.868 1.82L6.41 24.5c-1.074.047-1.588-.093-2.147-.793L.844 19.4c-.607-.793-.887-1.4-.887-2.1V2.89c0-.887.42-1.587 1.354-1.654z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-foreground text-sm font-medium">Notion</p>
            <p className="text-muted-foreground text-xs">
              {t.settings.integrationNotion}
            </p>
          </div>
        </div>
        <OAuthCredentialsForm
          provider="notion"
          setupGuideUrl="https://www.notion.so/my-integrations"
        />
      </section>

      {/* Linear Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-foreground text-base font-medium">
            {t.settings.linearSection ?? 'Linear'}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">
              {t.settings.connectorEnable ?? 'Enable'}
            </span>
            <Switch
              checked={settings.linearEnabled}
              onChange={(checked) => {
                onSettingsChange({ ...settings, linearEnabled: checked });
                syncEnabledToBackend('linearEnabled', checked);
              }}
            />
          </div>
        </div>

        <div
          className={cn(
            'space-y-3 transition-opacity',
            !settings.linearEnabled && 'pointer-events-none opacity-50',
          )}
        >
          <div>
            <label
              htmlFor="linear-api-key"
              className="text-foreground/80 mb-1 block text-sm font-medium"
            >
              {t.settings.linearApiKey ?? 'API Key'}
            </label>
            <p className="text-muted-foreground mb-1 text-xs">
              {t.settings.linearApiKeyDescription ??
                'Your Linear API key for accessing the Linear API'}
            </p>
            <input
              id="linear-api-key"
              type="password"
              value={form.apiKey}
              onChange={(e) => {
                setApiKeyDirty(true);
                updateField('apiKey', e.target.value);
              }}
              className={INPUT_CLASS}
              placeholder="lin_api_..."
              autoComplete="new-password"
            />
          </div>

          <div>
            <label
              htmlFor="linear-webhook-secret"
              className="text-foreground/80 mb-1 block text-sm font-medium"
            >
              {t.settings.linearWebhookSecret ?? 'Webhook Secret'}
            </label>
            <input
              id="linear-webhook-secret"
              type="password"
              value={form.webhookSecret}
              onChange={(e) => updateField('webhookSecret', e.target.value)}
              className={INPUT_CLASS}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label
              htmlFor="linear-team-id"
              className="text-foreground/80 mb-1 block text-sm font-medium"
            >
              {t.settings.linearTeamId ?? 'Team ID'}
            </label>
            <input
              id="linear-team-id"
              type="text"
              value={form.teamId}
              onChange={(e) => updateField('teamId', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          {/* Assignee Filter */}
          <div>
            <label
              htmlFor="linear-assignee-filter"
              className="text-foreground/80 mb-1 block text-sm font-medium"
            >
              {t.settings.linearAssigneeFilter ?? 'Assignee Filter'}
            </label>
            <p className="text-muted-foreground mb-1 text-xs">
              {t.settings.linearAssigneeFilterDescription ??
                'Linear user ID to filter issue assignments'}
            </p>
            <input
              id="linear-assignee-filter"
              type="text"
              value={form.assigneeFilter}
              onChange={(e) => updateField('assigneeFilter', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          {/* Mode */}
          <div role="radiogroup" aria-label={t.settings.linearMode ?? 'Mode'}>
            <span className="text-foreground/80 mb-1 block text-sm font-medium">
              {t.settings.linearMode ?? 'Mode'}
            </span>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="linearMode"
                  checked={form.webhookEnabled && !form.pollEnabled}
                  onChange={() => {
                    updateField('webhookEnabled', true);
                    updateField('pollEnabled', false);
                  }}
                  className="accent-primary"
                />
                {t.settings.linearModeWebhook ?? 'Webhook (Recommended)'}
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="linearMode"
                  checked={!form.webhookEnabled && form.pollEnabled}
                  onChange={() => {
                    updateField('webhookEnabled', false);
                    updateField('pollEnabled', true);
                  }}
                  className="accent-primary"
                />
                {t.settings.linearModePolling ?? 'Polling (Dev Only)'}
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="linearMode"
                  checked={form.webhookEnabled && form.pollEnabled}
                  onChange={() => {
                    updateField('webhookEnabled', true);
                    updateField('pollEnabled', true);
                  }}
                  className="accent-primary"
                />
                {t.settings.linearModeBoth ?? 'Both'}
              </label>
            </div>
            {form.pollEnabled && (
              <p className="text-muted-foreground mt-1 text-xs">
                {t.settings.linearPollIntervalDescription ??
                  'Polling is a dev-only fallback. Use webhooks in production.'}
              </p>
            )}
          </div>

          {/* Poll Interval */}
          {form.pollEnabled && (
            <div>
              <label
                htmlFor="linear-poll-interval"
                className="text-foreground/80 mb-1 block text-sm font-medium"
              >
                {t.settings.linearPollInterval ?? 'Poll Interval (ms)'}
              </label>
              <input
                id="linear-poll-interval"
                type="number"
                value={form.pollIntervalMs}
                onChange={(e) =>
                  updateField('pollIntervalMs', parseInt(e.target.value) || 0)
                }
                className={INPUT_CLASS}
                min={10000}
                step={10000}
              />
            </div>
          )}

          {/* Workspace Dir */}
          <div>
            <label
              htmlFor="linear-workspace-dir"
              className="text-foreground/80 mb-1 block text-sm font-medium"
            >
              {t.settings.linearWorkspaceDir ?? 'Target Repository'}
            </label>
            <p className="text-muted-foreground mb-1 text-xs">
              {t.settings.linearWorkspaceDirDescription ??
                'Absolute path to the git repository for code changes'}
            </p>
            <input
              id="linear-workspace-dir"
              type="text"
              value={form.workspaceDir}
              onChange={(e) => updateField('workspaceDir', e.target.value)}
              className={INPUT_CLASS}
              placeholder="/path/to/repo"
            />
          </div>

          {/* Default Branch */}
          <div>
            <label
              htmlFor="linear-default-branch"
              className="text-foreground/80 mb-1 block text-sm font-medium"
            >
              {t.settings.linearDefaultBranch ?? 'Default Branch'}
            </label>
            <input
              id="linear-default-branch"
              type="text"
              value={form.defaultBranch}
              onChange={(e) => updateField('defaultBranch', e.target.value)}
              className={INPUT_CLASS}
              placeholder="staging"
            />
          </div>

          {/* Auto Process */}
          <div className="flex items-center gap-2">
            <Switch
              checked={form.autoProcess}
              onChange={(checked) => updateField('autoProcess', checked)}
            />
            <span className="text-sm">
              {t.settings.linearAutoProcess ?? 'Auto-process assigned issues'}
            </span>
          </div>

          {/* Test Connection + Status */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestConnection}
              disabled={!form.apiKey || connectionStatus === 'testing'}
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {connectionStatus === 'testing'
                ? '...'
                : (t.settings.linearTestConnection ?? 'Test Connection')}
            </button>
            {connectionStatus === 'connected' && (
              <span className="flex items-center gap-1.5 text-sm text-green-600">
                <span className="inline-block size-2 rounded-full bg-green-500" />
                {t.settings.linearConnected ?? 'Connected'}
              </span>
            )}
            {connectionStatus === 'error' && (
              <span className="flex items-center gap-1.5 text-sm text-red-600">
                <span className="inline-block size-2 rounded-full bg-red-500" />
                {connectionError ||
                  (t.settings.linearDisconnected ?? 'Not Connected')}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* GitHub Section */}
      <section className="space-y-4">
        <h3 className="text-foreground text-base font-medium">
          {t.settings.githubSection ?? 'GitHub'}
        </h3>
        <div>
          <label
            htmlFor="github-token"
            className="text-foreground/80 mb-1 block text-sm font-medium"
          >
            {t.settings.githubToken ?? 'Personal Access Token'}
          </label>
          <p className="text-muted-foreground mb-1 text-xs">
            {t.settings.githubTokenDescription ??
              'Leave empty to use gh CLI authentication'}
          </p>
          <input
            id="github-token"
            type="password"
            value={form.githubToken}
            onChange={(e) => updateField('githubToken', e.target.value)}
            className={INPUT_CLASS}
            placeholder="ghp_..."
            autoComplete="new-password"
          />
        </div>
      </section>

      {/* Slack Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-foreground text-base font-medium">
            {t.settings.slackSection ?? 'Slack'}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">
              {t.settings.connectorEnable ?? 'Enable'}
            </span>
            <Switch
              checked={settings.slackEnabled}
              onChange={(checked) => {
                onSettingsChange({ ...settings, slackEnabled: checked });
                syncEnabledToBackend('slackEnabled', checked);
              }}
            />
          </div>
        </div>
        <div
          className={cn(
            'space-y-3 transition-opacity',
            !settings.slackEnabled && 'pointer-events-none opacity-50',
          )}
        >
          <div>
            <label
              htmlFor="slack-webhook-url"
              className="text-foreground/80 mb-1 block text-sm font-medium"
            >
              {t.settings.slackWebhookUrl ?? 'Webhook URL'}
            </label>
            <input
              id="slack-webhook-url"
              type="password"
              autoComplete="new-password"
              value={form.slackWebhookUrl}
              onChange={(e) => updateField('slackWebhookUrl', e.target.value)}
              className={INPUT_CLASS}
              placeholder="https://hooks.slack.com/services/..."
            />
          </div>
          <div>
            <label
              htmlFor="slack-channel"
              className="text-foreground/80 mb-1 block text-sm font-medium"
            >
              {t.settings.slackChannel ?? 'Channel'}
            </label>
            <SlackChannelCombobox
              inputId="slack-channel"
              value={form.slackChannel}
              onChange={(next) => updateField('slackChannel', next)}
              connected={slackConnected}
              disabled={!settings.slackEnabled}
              inputClassName={INPUT_CLASS}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSlackTest}
              disabled={
                (!slackConnected && !form.slackWebhookUrl) ||
                saving ||
                slackTesting
              }
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {slackTesting
                ? '...'
                : (t.settings.slackSendTest ?? 'Send Test Message')}
            </button>
            {slackTestResult === 'success' && (
              <span className="text-sm text-green-600">Sent!</span>
            )}
            {slackTestResult === 'error' && (
              <span className="text-sm text-red-600">{slackTestError}</span>
            )}
          </div>
        </div>
      </section>

      <CloudStorageConnectionsSection />

      {/* Phase B — connector access by tier */}
      <ConnectorAccessControls />

      {/* Save button */}
      <div className="border-border border-t pt-4">
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className={cn(
              'rounded-md px-6 py-2 text-sm font-medium transition-colors',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {saving ? '...' : (t.settings.connectorSave ?? 'Save')}
          </button>
          {saveError && (
            <span className="text-sm text-red-600">{saveError}</span>
          )}
        </div>
      </div>
    </div>
  );
}
