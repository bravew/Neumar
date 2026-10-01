import { useEffect, useState } from 'react';

import type { Settings } from '@/shared/db/settings';
import {
  applyPermissionPreset,
  DEFAULT_TOOL_RULES,
  visiblePermissionPreset,
  type PermissionPresetId,
  type ToolPermissionRules,
} from '@/shared/permissions/presets';
import { useLanguage } from '@/shared/providers/language-provider';

import { ConnectorAccessControls } from './ConnectorAccessControls';
import { API_BASE_URL } from './constants';
import { SettingsDrillIn } from './primitives/SettingsDrillIn';
import { SettingsPresetGroup } from './primitives/SettingsPresetGroup';
import { SettingsRow } from './primitives/SettingsRow';
import { SandboxModeGroup } from './SandboxModeGroup';
import {
  FilesystemRuleSection,
  type FilesystemRule,
} from './tabs/PermissionFilesystemRules';
import { PermissionSettings } from './tabs/PermissionSettings';

type ManageSection = 'tools' | 'folders' | 'connectors';

export function PermissionsPage({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}) {
  const { t } = useLanguage();
  const [rules, setRules] = useState<ToolPermissionRules>(DEFAULT_TOOL_RULES);
  const [connectorCount, setConnectorCount] = useState(0);
  const [section, setSection] = useState<ManageSection | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${API_BASE_URL}/db/settings/toolPermissionRules`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data?.value) return;
        const parsed = JSON.parse(data.value) as ToolPermissionRules;
        setRules({
          alwaysAllow: parsed.alwaysAllow ?? [],
          alwaysDeny: parsed.alwaysDeny ?? [],
          alwaysAsk: parsed.alwaysAsk ?? [],
          filesystem: parsed.filesystem ?? [],
        });
      })
      .catch(() => undefined);
    void fetch(`${API_BASE_URL}/connectors/access`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.access) setConnectorCount(Object.keys(data.access).length);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const selected = visiblePermissionPreset(settings.planMode, rules);
  const labels = t.settings as Record<string, string>;
  const options: {
    value: PermissionPresetId;
    label: string;
    caption: string;
  }[] = [
    {
      value: 'plan',
      label: labels.presetPlan,
      caption: labels.presetPlanCaption,
    },
    {
      value: 'ask',
      label: labels.presetAsk,
      caption: labels.presetAskCaption,
    },
    {
      value: 'auto',
      label: labels.presetAuto,
      caption: labels.presetAutoCaption,
    },
  ];
  if (selected === 'custom') {
    options.push({
      value: 'custom',
      label: labels.presetCustom,
      caption: labels.presetCustomCaption,
    });
  }

  if (section) {
    const title =
      section === 'tools'
        ? labels.permissionTools
        : section === 'folders'
          ? labels.permissionFolders
          : labels.permissionConnectors;
    return (
      <SettingsDrillIn
        title={title}
        backLabel={t.settings.permissions}
        onBack={() => setSection(null)}
      >
        {section === 'tools' ? (
          <PermissionSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        ) : null}
        {section === 'folders' ? (
          <FilesystemRuleSection
            rules={(rules.filesystem ?? []) as FilesystemRule[]}
          />
        ) : null}
        {section === 'connectors' ? <ConnectorAccessControls /> : null}
      </SettingsDrillIn>
    );
  }

  const toolCount =
    rules.alwaysAllow.length + rules.alwaysDeny.length + rules.alwaysAsk.length;

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-6">
      <SettingsPresetGroup
        legend={labels.presetAskWhen}
        value={selected}
        options={options}
        onValueChange={(value) =>
          onSettingsChange(
            applyPermissionPreset(settings, value as PermissionPresetId),
          )
        }
      />
      <SandboxModeGroup
        settings={settings}
        onSettingsChange={onSettingsChange}
      />
      <div>
        <p className="text-foreground mb-2 text-sm font-medium">
          {labels.managePermissions}
        </p>
        <SettingsRow
          variant="chevron"
          label={labels.permissionTools}
          caption={String(toolCount)}
          onSelect={() => setSection('tools')}
        />
        <SettingsRow
          variant="chevron"
          label={labels.permissionFolders}
          caption={String(rules.filesystem?.length ?? 0)}
          onSelect={() => setSection('folders')}
        />
        <SettingsRow
          variant="chevron"
          label={labels.permissionConnectors}
          caption={String(connectorCount)}
          onSelect={() => setSection('connectors')}
        />
      </div>
    </div>
  );
}
