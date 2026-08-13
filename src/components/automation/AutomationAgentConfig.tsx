/**
 * AutomationAgentConfig
 *
 * Agent configuration form section for automation settings.
 */

import { useLanguage } from '@/shared/providers/language-provider';
import type { AutomationAgentConfig as AgentConfigType } from '@/shared/types/automation';

/** Preset timeout options in milliseconds */
const TIMEOUT_PRESETS = [
  { label: '5 min', value: 5 * 60_000 },
  { label: '10 min', value: 10 * 60_000 },
  { label: '30 min', value: 30 * 60_000 },
  { label: '1 hour', value: 60 * 60_000 },
];

interface AutomationAgentConfigProps {
  config: AgentConfigType;
  onChange: (config: AgentConfigType) => void;
}

export function AutomationAgentConfig({
  config,
  onChange,
}: AutomationAgentConfigProps) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      {/* Use Planning */}
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={config.usePlanning}
          onChange={(e) =>
            onChange({ ...config, usePlanning: e.target.checked })
          }
          className="accent-primary size-4 rounded"
          aria-label={t.automation.fields.usePlanning}
        />
        <span className="text-foreground text-sm">
          {t.automation.fields.usePlanning}
        </span>
      </label>

      {/* Auto-Approve (only if usePlanning) */}
      {config.usePlanning && (
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={config.autoApprove}
            onChange={(e) =>
              onChange({ ...config, autoApprove: e.target.checked })
            }
            className="accent-primary size-4 rounded"
            aria-label={t.automation.fields.autoApprove}
          />
          <span className="text-foreground text-sm">
            {t.automation.fields.autoApprove}
          </span>
        </label>
      )}

      {/* Timeout */}
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-medium">
          {t.automation.fields.timeout}
        </label>
        <select
          value={config.timeoutMs ?? 10 * 60_000}
          onChange={(e) =>
            onChange({ ...config, timeoutMs: parseInt(e.target.value, 10) })
          }
          className="bg-background text-foreground border-input w-full rounded-md border px-3 py-2 text-sm"
          aria-label={t.automation.fields.timeout}
        >
          {TIMEOUT_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>

      {/* Working Directory */}
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-medium">
          {t.automation.fields.workDir}
        </label>
        <input
          type="text"
          value={config.workDir ?? ''}
          onChange={(e) =>
            onChange({ ...config, workDir: e.target.value || undefined })
          }
          placeholder="~/projects/my-app"
          className="bg-background text-foreground border-input w-full rounded-md border px-3 py-2 text-sm"
          aria-label={t.automation.fields.workDir}
        />
      </div>
    </div>
  );
}
