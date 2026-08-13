import { useEffect, useRef, useState } from 'react';

import {
  AlertTriangle,
  Check,
  ExternalLink,
  FlaskConical,
  Loader2,
  Save,
} from 'lucide-react';

import { ModelPicker } from '@/components/shared/ModelPicker';
import { useAgentProfiles } from '@/shared/hooks/useAgentProfiles';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { Switch } from '../../components/Switch';
import { CredentialFields } from './CredentialFields';
import { SlackHomeSection } from './SlackHomeSection';
import {
  PLATFORM_DOC_URLS,
  PLATFORM_LABELS,
  type Platform,
  type PlatformConfig,
  type McpPolicy,
  SLACK_HOME_CONNECTORS,
  parseConnectorAllowlist,
  stringifyConnectorAllowlist,
} from './types';

interface ConfigTabProps {
  platform: Platform;
  config: PlatformConfig;
  onSave: (
    creds: Record<string, string>,
    cfg: Partial<PlatformConfig>,
  ) => Promise<void>;
  onTest: (creds: Record<string, string>) => Promise<void>;
  saving: boolean;
  testing: boolean;
  testResult: { valid: boolean; error?: string } | null;
}

export function ConfigTab({
  platform,
  config,
  onSave,
  onTest,
  saving,
  testing,
  testResult,
}: ConfigTabProps) {
  const { t } = useLanguage();
  const s = t.settings;

  // Pre-fill with masked token so field looks populated on re-open
  const [creds, setCreds] = useState<Record<string, string>>(() => {
    if (!config.token) return {};
    if (platform === 'telegram' || platform === 'discord')
      return { token: config.token };
    try {
      return JSON.parse(config.token) as Record<string, string>;
    } catch {
      return { token: config.token };
    }
  });
  const [enabled, setEnabled] = useState(config.enabled);
  const [guardrailsProvider, setGuardrailsProvider] = useState(
    config.guardrails_provider ?? 'none',
  );
  const [failMode, setFailMode] = useState<'open' | 'closed'>(
    config.guardrails_fail_mode ?? 'open',
  );
  const [model, setModel] = useState<string | null>(config.model ?? null);
  const [mentionOnly, setMentionOnly] = useState(config.mention_only ?? false);
  const [accessMode, setAccessMode] = useState<'open' | 'gated'>(
    config.access_mode ?? 'open',
  );
  const [agentProfileId, setAgentProfileId] = useState<string | null>(
    config.agent_profile_id ?? null,
  );
  const [botName, setBotName] = useState(config.name ?? '');
  // App Home — connector allowlist held as a Set for cheap toggling.
  // Initialised from the persisted CSV; `null` parse means "all allowed".
  const [allowedConnectors, setAllowedConnectors] = useState<Set<string>>(
    () =>
      parseConnectorAllowlist(config.cred_connectors_allowlist ?? null) ??
      new Set(SLACK_HOME_CONNECTORS.map((c) => c.key)),
  );
  const [mcpPolicy, setMcpPolicy] = useState<McpPolicy>(
    config.user_mcp_policy ?? 'open',
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const { profiles, loading: profilesLoading } = useAgentProfiles('active');

  // Sync local state when parent config loads/updates (e.g. after loadData() completes).
  const prevConfiguredRef = useRef(config.configured);
  useEffect(() => {
    if (!config.configured && prevConfiguredRef.current) {
      setEnabled(false);
      setCreds({});
      setModel(null);
      setMentionOnly(false);
      setGuardrailsProvider('none');
    } else if (config.configured && !prevConfiguredRef.current) {
      setEnabled(config.enabled);
      setModel(config.model ?? null);
      setMentionOnly(config.mention_only ?? false);
      if (config.token) {
        if (platform === 'telegram' || platform === 'discord') {
          setCreds((prev) => {
            const cur = prev.token ?? '';
            return !cur || cur.startsWith('...')
              ? { token: config.token! }
              : prev;
          });
        } else {
          try {
            const parsed = JSON.parse(config.token) as Record<string, string>;
            setCreds((prev) => {
              const isEmpty = Object.values(prev).every(
                (v) => !v || v.startsWith('...'),
              );
              return isEmpty ? parsed : prev;
            });
          } catch {
            // ignore
          }
        }
      }
    } else if (config.configured) {
      setEnabled(config.enabled);
      setModel(config.model ?? null);
      setMentionOnly(config.mention_only ?? false);
      setAccessMode(config.access_mode ?? 'open');
      setAgentProfileId(config.agent_profile_id ?? null);
      setBotName(config.name ?? '');
      setAllowedConnectors(
        parseConnectorAllowlist(config.cred_connectors_allowlist ?? null) ??
          new Set(SLACK_HOME_CONNECTORS.map((c) => c.key)),
      );
      setMcpPolicy(config.user_mcp_policy ?? 'open');
    }
    prevConfiguredRef.current = config.configured;
  }, [
    config.configured,
    config.enabled,
    config.model,
    config.mention_only,
    config.access_mode,
    config.agent_profile_id,
    config.name,
    config.token,
    config.cred_connectors_allowlist,
    config.user_mcp_policy,
    platform,
  ]);

  const hasCreds = Object.values(creds).some(
    (v) => v.trim().length > 0 && !v.startsWith('...'),
  );

  const handleSave = async () => {
    setSaveError(null);
    try {
      const partial: Partial<PlatformConfig> = {
        name: botName.trim() || null,
        enabled,
        guardrails_provider: guardrailsProvider || 'none',
        guardrails_fail_mode: failMode,
        model,
        mention_only: mentionOnly,
        access_mode: accessMode,
        agent_profile_id: agentProfileId,
      };
      if (platform === 'slack') {
        partial.cred_connectors_allowlist = stringifyConnectorAllowlist(
          allowedConnectors,
          SLACK_HOME_CONNECTORS.length,
        );
        partial.user_mcp_policy = mcpPolicy;
      }
      await onSave(creds, partial);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const toggleConnector = (key: string) => {
    setAllowedConnectors((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-3 py-1">
      {/* Bot name */}
      <div>
        <label className="text-foreground mb-1 block text-xs font-medium">
          {s?.channelBotName ?? 'Bot Name'}
        </label>
        <input
          type="text"
          value={botName}
          onChange={(e) => setBotName(e.target.value)}
          placeholder={`${PLATFORM_LABELS[platform]} Bot`}
          className="border-border bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-sm placeholder:text-gray-500"
        />
      </div>

      {/* Setup guide */}
      <button
        type="button"
        onClick={async () => {
          try {
            const { openUrl } = await import('@tauri-apps/plugin-opener');
            await openUrl(PLATFORM_DOC_URLS[platform]);
          } catch {
            window.open(PLATFORM_DOC_URLS[platform], '_blank');
          }
        }}
        className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 text-xs underline-offset-2 hover:underline"
      >
        <ExternalLink className="size-3" />
        {s?.gatewayChannelSetupGuide ?? 'Setup guide'}
      </button>

      {/* Credentials */}
      <CredentialFields
        platform={platform}
        values={creds}
        onChange={(k, v) => setCreds((p) => ({ ...p, [k]: v }))}
      />

      {/* Slack presence hint */}
      {platform === 'slack' && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {s?.channelSlackPresenceHint ??
            'To show the bot as online, enable "Always Show My Bot as Online" in your Slack app\'s App Home settings.'}
        </p>
      )}

      {/* Guardrails */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">
            {s?.channelGuardrails ?? 'Guardrails'}
          </label>
          <select
            value={guardrailsProvider}
            onChange={(e) => setGuardrailsProvider(e.target.value)}
            className="border-border bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
          >
            <option value="none">{s?.channelGuardrailsNone ?? 'None'}</option>
            <option value="anthropic">
              {s?.channelGuardrailsAnthropic ?? 'Anthropic'}
            </option>
            <option value="llm-guard">
              {s?.channelGuardrailsLlmGuard ?? 'LLM Guard'}
            </option>
          </select>
        </div>
        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">
            {s?.channelGuardrailsFailMode ?? 'On failure'}
          </label>
          <select
            value={failMode}
            onChange={(e) => setFailMode(e.target.value as 'open' | 'closed')}
            disabled={guardrailsProvider === 'none'}
            className="border-border bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-sm disabled:opacity-50"
          >
            <option value="open">
              {s?.channelGuardrailsFailOpen ?? 'Allow (fail open)'}
            </option>
            <option value="closed">
              {s?.channelGuardrailsFailClosed ?? 'Block (fail closed)'}
            </option>
          </select>
        </div>
      </div>

      {/* Model override */}
      <div>
        <label className="text-foreground mb-1 block text-xs font-medium">
          {s?.channelModel ?? 'Agent Model'}
        </label>
        <ModelPicker
          value={model}
          onChange={setModel}
          showDefault
          defaultLabel={s?.channelModelDefault ?? 'Global default'}
        />
      </div>

      {/* Agent Profile */}
      <div>
        <label className="text-foreground mb-1 block text-xs font-medium">
          {s?.channelAgentProfile ?? 'Agent Profile'}
        </label>
        <select
          value={agentProfileId ?? ''}
          onChange={(e) => setAgentProfileId(e.target.value || null)}
          disabled={profilesLoading || profiles.length === 0}
          className="border-border bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-sm disabled:opacity-50"
        >
          <option value="">
            {profilesLoading
              ? 'Loading…'
              : profiles.length === 0
                ? (s?.channelNoProfilesAvailable ?? 'No profiles available')
                : (s?.channelNoProfile ?? 'None (default)')}
          </option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.role ? ` — ${p.role}` : ''}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {s?.channelAgentProfileDesc ??
            'Assign a personality and behavior to this channel.'}
        </p>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-foreground text-xs font-medium">
            {s?.channelEnabled ?? 'Enabled'}
          </p>
          <p className="text-muted-foreground text-xs">
            {s?.channelEnabledDesc ?? 'Start bot when token is configured'}
          </p>
        </div>
        <Switch
          checked={enabled}
          onChange={setEnabled}
          label={s?.channelEnabled ?? 'Enabled'}
        />
      </div>

      {/* Access mode toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-foreground text-xs font-medium">
            {s?.channelAccessMode ?? 'User Access'}
          </p>
          <p className="text-muted-foreground text-xs">
            {accessMode === 'open'
              ? (s?.channelAccessModeOpenDesc ??
                'Any user can chat without pairing')
              : (s?.channelAccessModeGatedDesc ??
                'Users must /pair before chatting')}
          </p>
        </div>
        <Switch
          checked={accessMode === 'gated'}
          onChange={(gated) => setAccessMode(gated ? 'gated' : 'open')}
          label={s?.channelAccessModeGated ?? 'Require pairing'}
        />
      </div>

      {platform === 'slack' && (
        <SlackHomeSection
          allowedConnectors={allowedConnectors}
          onToggleConnector={toggleConnector}
          mcpPolicy={mcpPolicy}
          onMcpPolicyChange={setMcpPolicy}
        />
      )}

      {/* Mention-only toggle (Discord only) */}
      {platform === 'discord' && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-foreground text-xs font-medium">
              {s?.channelMentionOnly ?? 'Mention only'}
            </p>
            <p className="text-muted-foreground text-xs">
              {s?.channelMentionOnlyDesc ??
                'Only respond when @mentioned in channels'}
            </p>
          </div>
          <Switch
            checked={mentionOnly}
            onChange={setMentionOnly}
            label={s?.channelMentionOnly ?? 'Mention only'}
          />
        </div>
      )}

      {/* Actions */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-primary-foreground inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Save className="size-3" />
            )}
            {saving
              ? (s?.channelSave ?? 'Saving…')
              : (s?.channelSave ?? 'Save')}
          </button>

          <button
            type="button"
            onClick={() => onTest(creds)}
            disabled={testing || (!config.configured && !hasCreds)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
              testing
                ? 'text-muted-foreground cursor-wait'
                : testResult?.valid
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            {testing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : testResult?.valid ? (
              <Check className="size-3" />
            ) : (
              <FlaskConical className="size-3" />
            )}
            {s?.channelTestConnection ?? 'Test Connection'}
          </button>
        </div>
        {saveError && (
          <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
            <AlertTriangle className="size-3 shrink-0" />
            {saveError}
          </p>
        )}
        {testResult && !testResult.valid && (
          <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
            <AlertTriangle className="size-3 shrink-0" />
            {testResult.error ??
              s?.channelConnectionFailed ??
              'Connection failed'}
          </p>
        )}
      </div>
    </div>
  );
}
