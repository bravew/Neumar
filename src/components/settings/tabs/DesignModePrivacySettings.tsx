import type { DesignModeSettingsConfig } from '@/shared/db/settings';
import { useLanguage } from '@/shared/providers/language-provider';

import { Switch } from '../components/Switch';

export function DesignModePrivacySettings({
  config,
  onChange,
}: {
  config: DesignModeSettingsConfig;
  onChange: (patch: Partial<DesignModeSettingsConfig>) => void;
}) {
  const { t } = useLanguage();
  const telemetry = config.telemetry;
  const updateTelemetry = (patch: Partial<typeof telemetry>) => {
    onChange({
      telemetry: {
        ...telemetry,
        ...patch,
        categories: {
          ...telemetry.categories,
          ...patch.categories,
        },
      },
    });
  };
  const updateCategory = (
    key: keyof typeof telemetry.categories,
    checked: boolean,
  ) => {
    updateTelemetry({
      categories: {
        ...telemetry.categories,
        [key]: checked,
      },
    });
  };

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">
          {t.settings.designModePrivacy}
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          {t.settings.designModePrivacyDescription}
        </p>
      </div>
      <ToggleRow
        label={t.settings.designModeRoutineScheduler}
        description={t.settings.designModeRoutineSchedulerDescription}
        checked={config.routineSchedulerEnabled}
        onChange={(routineSchedulerEnabled) =>
          onChange({ routineSchedulerEnabled })
        }
      />
      <ToggleRow
        label={t.settings.designModeTelemetry}
        description={t.settings.designModeTelemetryDescription}
        checked={telemetry.enabled}
        onChange={(enabled) => updateTelemetry({ enabled })}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <ToggleRow
          label={t.settings.designModeTelemetryRuns}
          description={t.settings.designModeTelemetryRunsDescription}
          checked={telemetry.categories.runs}
          onChange={(checked) => updateCategory('runs', checked)}
        />
        <ToggleRow
          label={t.settings.designModeTelemetrySchedules}
          description={t.settings.designModeTelemetrySchedulesDescription}
          checked={telemetry.categories.schedules}
          onChange={(checked) => updateCategory('schedules', checked)}
        />
        <ToggleRow
          label={t.settings.designModeTelemetryErrors}
          description={t.settings.designModeTelemetryErrorsDescription}
          checked={telemetry.categories.errors}
          onChange={(checked) => updateCategory('errors', checked)}
        />
        <ToggleRow
          label={t.settings.designModeTelemetryArtifacts}
          description={t.settings.designModeTelemetryArtifactsDescription}
          checked={telemetry.sendArtifactManifests}
          onChange={(sendArtifactManifests) =>
            updateTelemetry({ sendArtifactManifests })
          }
        />
        <ToggleRow
          label={t.settings.designModeTelemetryAssistantText}
          description={t.settings.designModeTelemetryAssistantTextDescription}
          checked={telemetry.sendAssistantText}
          onChange={(sendAssistantText) =>
            updateTelemetry({ sendAssistantText })
          }
        />
        <ToggleRow
          label={t.settings.designModeTelemetryIdentity}
          description={t.settings.designModeTelemetryIdentityDescription}
          checked={telemetry.sendIdentity}
          onChange={(sendIdentity) => updateTelemetry({ sendIdentity })}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {telemetry.enabled
          ? t.settings.designModeTelemetryStatusEnabled
          : t.settings.designModeTelemetryStatusDisabled}
      </p>
    </section>
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
