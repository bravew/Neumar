import { DEFAULT_DESIGN_MODE_SETTINGS } from '@/shared/db/settings';
import { useLanguage } from '@/shared/providers/language-provider';

import { Switch } from '../components/Switch';
import type { SettingsTabProps } from '../types';
import { DesignModeCritiqueSettings } from './DesignModeCritiqueSettings';
import { DesignModeDependenciesSettings } from './DesignModeDependenciesSettings';
import { DesignModeMediaSettings } from './DesignModeMediaSettings';
import { DesignModePrivacySettings } from './DesignModePrivacySettings';
import { DesignModeProjectLocationsSettings } from './DesignModeProjectLocationsSettings';
import { DesignModeTelemetryRuns } from './DesignModeTelemetryRuns';

export function DesignModeSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const { t } = useLanguage();
  const rawConfig = settings.designMode ?? DEFAULT_DESIGN_MODE_SETTINGS;
  const config = {
    ...DEFAULT_DESIGN_MODE_SETTINGS,
    ...rawConfig,
    telemetry: {
      ...DEFAULT_DESIGN_MODE_SETTINGS.telemetry,
      ...rawConfig.telemetry,
      categories: {
        ...DEFAULT_DESIGN_MODE_SETTINGS.telemetry.categories,
        ...rawConfig.telemetry?.categories,
      },
    },
    critique: {
      ...DEFAULT_DESIGN_MODE_SETTINGS.critique,
      ...rawConfig.critique,
      promotedAt: {
        ...DEFAULT_DESIGN_MODE_SETTINGS.critique.promotedAt,
        ...rawConfig.critique?.promotedAt,
      },
    },
    media: {
      ...DEFAULT_DESIGN_MODE_SETTINGS.media,
      ...rawConfig.media,
      aliases: {
        ...DEFAULT_DESIGN_MODE_SETTINGS.media.aliases,
        ...rawConfig.media?.aliases,
      },
    },
    budgets: {
      ...DEFAULT_DESIGN_MODE_SETTINGS.budgets,
      ...rawConfig.budgets,
    },
  };

  const update = (patch: Partial<typeof config>) => {
    onSettingsChange({
      ...settings,
      designMode: {
        ...DEFAULT_DESIGN_MODE_SETTINGS,
        ...config,
        ...patch,
        telemetry: {
          ...DEFAULT_DESIGN_MODE_SETTINGS.telemetry,
          ...config.telemetry,
          ...patch.telemetry,
          categories: {
            ...DEFAULT_DESIGN_MODE_SETTINGS.telemetry.categories,
            ...config.telemetry.categories,
            ...patch.telemetry?.categories,
          },
        },
        critique: {
          ...DEFAULT_DESIGN_MODE_SETTINGS.critique,
          ...config.critique,
          ...patch.critique,
          promotedAt: {
            ...DEFAULT_DESIGN_MODE_SETTINGS.critique.promotedAt,
            ...config.critique.promotedAt,
            ...patch.critique?.promotedAt,
          },
        },
        media: {
          ...DEFAULT_DESIGN_MODE_SETTINGS.media,
          ...config.media,
          ...patch.media,
          aliases: {
            ...DEFAULT_DESIGN_MODE_SETTINGS.media.aliases,
            ...config.media.aliases,
            ...patch.media?.aliases,
          },
        },
        budgets: {
          ...DEFAULT_DESIGN_MODE_SETTINGS.budgets,
          ...config.budgets,
          ...patch.budgets,
        },
      },
    });
  };

  const updateBudget = (
    key: keyof typeof DEFAULT_DESIGN_MODE_SETTINGS.budgets,
    value: number,
  ) => {
    update({
      budgets: {
        ...config.budgets,
        [key]: Math.max(0, Math.floor(value || 0)),
      },
    });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">
            {t.settings.designModeHeading}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {t.settings.designModeDescription}
          </p>
        </div>
        <ToggleRow
          label={t.settings.designModeEnabled}
          description={t.settings.designModeEnabledDescription}
          checked={config.enabled}
          onChange={(enabled) => update({ enabled })}
        />
        <ToggleRow
          label={t.settings.designModeDisclosure}
          description={t.settings.designModeDisclosureDescription}
          checked={config.aiDisclosureDefault}
          onChange={(aiDisclosureDefault) => update({ aiDisclosureDefault })}
        />
        <ToggleRow
          label={t.settings.designModeStrictProvider}
          description={t.settings.designModeStrictProviderDescription}
          checked={config.strictProviderMode}
          onChange={(strictProviderMode) => update({ strictProviderMode })}
        />
        <ToggleRow
          label={t.settings.designModeTokenChannel}
          description={t.settings.designModeTokenChannelDescription}
          checked={config.tokenChannelEnabled}
          onChange={(tokenChannelEnabled) => update({ tokenChannelEnabled })}
        />
        <ToggleRow
          label={t.settings.designModeChatLoop}
          description={t.settings.designModeChatLoopDescription}
          checked={config.chatLoop !== false}
          onChange={(chatLoop) => update({ chatLoop })}
        />
      </section>

      <DesignModePrivacySettings config={config} onChange={update} />

      <DesignModeProjectLocationsSettings />

      <DesignModeMediaSettings config={config} onChange={update} />

      <DesignModeCritiqueSettings />

      <DesignModeTelemetryRuns />

      <section className="space-y-4">
        <h3 className="text-base font-semibold">
          {t.settings.designModeDefaults}
        </h3>
        <TextField
          label={t.settings.designModeDefaultSystem}
          value={config.defaultDesignSystemId}
          placeholder="brutalist-editorial"
          onChange={(defaultDesignSystemId) =>
            update({ defaultDesignSystemId })
          }
        />
        <TextField
          label={t.settings.designModeDefaultSkill}
          value={config.defaultSkillId}
          placeholder="bundled:mobile-app"
          onChange={(defaultSkillId) => update({ defaultSkillId })}
        />
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">
            {t.settings.designModeCustomInstructions}
          </span>
          <textarea
            value={config.customInstructions}
            maxLength={5000}
            placeholder={t.settings.designModeCustomInstructionsPlaceholder}
            onChange={(event) =>
              update({ customInstructions: event.target.value })
            }
            className="border-input bg-background min-h-32 rounded-md border px-3 py-2"
          />
          <span className="text-muted-foreground text-xs">
            {t.settings.designModeCustomInstructionsDescription}
          </span>
        </label>
      </section>

      <section className="space-y-4">
        <h3 className="text-base font-semibold">
          {t.settings.designModeBudgets}
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          <NumberField
            label={t.settings.designModeMaxImages}
            value={config.budgets.maxImageGenerations}
            onChange={(value) => updateBudget('maxImageGenerations', value)}
          />
          <NumberField
            label={t.settings.designModeMaxVideoJobs}
            value={config.budgets.maxVideoJobs}
            onChange={(value) => updateBudget('maxVideoJobs', value)}
          />
          <NumberField
            label={t.settings.designModeMaxVideoSeconds}
            value={config.budgets.maxVideoSeconds}
            onChange={(value) => updateBudget('maxVideoSeconds', value)}
          />
          <NumberField
            label={t.settings.designModeMaxAudioSeconds}
            value={config.budgets.maxAudioSeconds}
            onChange={(value) => updateBudget('maxAudioSeconds', value)}
          />
          <NumberField
            label={t.settings.designModeMaxRetries}
            value={config.budgets.maxRetryCount}
            onChange={(value) => updateBudget('maxRetryCount', value)}
          />
          <NumberField
            label={t.settings.designModeMaxStorageMb}
            value={Math.round(config.budgets.maxStorageBytes / 1024 / 1024)}
            onChange={(value) =>
              updateBudget('maxStorageBytes', value * 1024 * 1024)
            }
          />
        </div>
      </section>

      <DesignModeDependenciesSettings />
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground mt-1 text-xs">{description}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="border-input bg-background h-10 rounded-md border px-3"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="border-input bg-background h-10 rounded-md border px-3"
      />
    </label>
  );
}
