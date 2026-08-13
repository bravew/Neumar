import { useLanguage } from '@/shared/providers/language-provider';

interface SecurityConfig {
  defaultPermissionTier: 'viewer' | 'operator' | 'admin';
  rateLimiting: { messagesPerMinute: number };
  tokenBudget: {
    defaultDailyLimit: number;
    enforcementMode: 'enforce' | 'warn-only';
  };
  guardrails: { provider: string; failMode: string };
  concurrency: { maxAgentRunsPerIdentity: number };
}

interface SecuritySettingsProps {
  config: SecurityConfig;
  onChange: (config: SecurityConfig) => void;
}

export function SecuritySettings({ config, onChange }: SecuritySettingsProps) {
  const { t } = useLanguage();

  const update = <K extends keyof SecurityConfig>(
    key: K,
    value: SecurityConfig[K],
  ) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-foreground text-sm font-medium">
        {t.settings.gatewaySecurity}
      </h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">
            {t.settings.gatewayDefaultPermission}
          </label>
          <select
            value={config.defaultPermissionTier}
            onChange={(e) =>
              update(
                'defaultPermissionTier',
                e.target.value as SecurityConfig['defaultPermissionTier'],
              )
            }
            className="border-border bg-background text-foreground w-full rounded border px-2 py-1.5 text-sm"
          >
            <option value="viewer">{t.settings.gatewayPermissionViewer}</option>
            <option value="operator">
              {t.settings.gatewayPermissionOperator}
            </option>
            <option value="admin">{t.settings.gatewayPermissionAdmin}</option>
          </select>
        </div>

        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">
            {t.settings.gatewayRateLimit}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={1000}
              value={config.rateLimiting.messagesPerMinute}
              onChange={(e) =>
                update('rateLimiting', {
                  messagesPerMinute: Number(e.target.value),
                })
              }
              className="border-border bg-background text-foreground w-20 rounded border px-2 py-1.5 text-sm"
            />
            <span className="text-muted-foreground text-xs">
              {t.settings.gatewayRateLimitUnit}
            </span>
          </div>
        </div>

        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">
            {t.settings.gatewayTokenBudget}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={config.tokenBudget.defaultDailyLimit}
              onChange={(e) =>
                update('tokenBudget', {
                  ...config.tokenBudget,
                  defaultDailyLimit: Number(e.target.value),
                })
              }
              className="border-border bg-background text-foreground w-24 rounded border px-2 py-1.5 text-sm"
            />
            <span className="text-muted-foreground text-xs">
              {t.settings.gatewayTokenBudgetHint}
            </span>
          </div>
        </div>

        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">
            {t.settings.gatewayMaxConcurrent}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={20}
              value={config.concurrency.maxAgentRunsPerIdentity}
              onChange={(e) =>
                update('concurrency', {
                  maxAgentRunsPerIdentity: Number(e.target.value),
                })
              }
              className="border-border bg-background text-foreground w-16 rounded border px-2 py-1.5 text-sm"
            />
            <span className="text-muted-foreground text-xs">
              {t.settings.gatewayMaxConcurrentHint}
            </span>
          </div>
        </div>

        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">
            {t.settings.gatewayGuardrails}
          </label>
          <select
            value={config.guardrails.provider}
            onChange={(e) =>
              update('guardrails', {
                ...config.guardrails,
                provider: e.target.value,
              })
            }
            className="border-border bg-background text-foreground w-full rounded border px-2 py-1.5 text-sm"
          >
            <option value="none">{t.settings.gatewayGuardrailsNone}</option>
            <option value="anthropic">
              {t.settings.gatewayGuardrailsAnthropic}
            </option>
          </select>
        </div>

        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">
            {t.settings.gatewayFailMode}
          </label>
          <select
            value={config.guardrails.failMode}
            onChange={(e) =>
              update('guardrails', {
                ...config.guardrails,
                failMode: e.target.value,
              })
            }
            className="border-border bg-background text-foreground w-full rounded border px-2 py-1.5 text-sm"
          >
            <option value="open">{t.settings.gatewayFailModeOpen}</option>
            <option value="closed">{t.settings.gatewayFailModeClosed}</option>
          </select>
        </div>
      </div>
    </div>
  );
}
