import type { ReactNode } from 'react';

import type { PublishSettingsConfig } from '@/shared/db/settings';
import { DEFAULT_PUBLISH_SETTINGS } from '@/shared/db/settings';
import { useLanguage } from '@/shared/providers/language-provider';

import { Switch } from '../components/Switch';
import type { SettingsTabProps } from '../types';

const DESTINATION_KEYS = [
  'local-archive',
  'gdrive',
  'immich',
  'webdav',
  'youtube',
  'tiktok',
] as const;

export function PublishSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const { t } = useLanguage();
  const p = t.publish as Record<string, string>;
  const publish = settings.publish ?? DEFAULT_PUBLISH_SETTINGS;

  const update = (next: PublishSettingsConfig) =>
    onSettingsChange({ ...settings, publish: next });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{p.settingsTitle}</h3>
        <p className="text-muted-foreground text-sm">{p.settingsSubtitle}</p>
      </div>

      <div className="space-y-4">
        <SettingRow
          title={p.pipelineEnabled}
          description={p.pipelineEnabledDescription}
        >
          <Switch
            checked={publish.enabled}
            label={p.pipelineEnabled}
            onChange={(enabled) => update({ ...publish, enabled })}
          />
        </SettingRow>
        <SettingRow
          title={p.rcloneBridge}
          description={p.rcloneBridgeDescription}
        >
          <Switch
            checked={publish.rcloneBridgeEnabled}
            label={p.rcloneBridge}
            onChange={(rcloneBridgeEnabled) =>
              update({ ...publish, rcloneBridgeEnabled })
            }
          />
        </SettingRow>
        <SettingRow
          title={p.workspaceConnectionsOnly}
          description={p.workspaceConnectionsOnlyDescription}
        >
          <Switch
            checked={publish.workspaceConnectionsOnly}
            label={p.workspaceConnectionsOnly}
            onChange={(workspaceConnectionsOnly) =>
              update({ ...publish, workspaceConnectionsOnly })
            }
          />
        </SettingRow>
      </div>

      <label className="block space-y-2">
        <span className="text-sm font-medium">{p.c2paSignerMode}</span>
        <select
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          value={publish.c2paSignerMode}
          onChange={(event) =>
            update({
              ...publish,
              c2paSignerMode: event.target
                .value as PublishSettingsConfig['c2paSignerMode'],
            })
          }
        >
          <option value="test">{p.signerTest}</option>
          <option value="workspace">{p.signerWorkspace}</option>
          <option value="cloud">{p.signerCloud}</option>
        </select>
      </label>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">{p.destinationDefaults}</h4>
        {DESTINATION_KEYS.map((kind) => {
          const current =
            publish.destinations[kind] ??
            DEFAULT_PUBLISH_SETTINGS.destinations[kind];
          return (
            <div key={kind} className="border-border rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">
                  {p[`destination_${kind.replace(/-/g, '_')}`] ?? kind}
                </div>
                <Switch
                  checked={current.autoPublish}
                  label={p.autoPublish}
                  onChange={(autoPublish) =>
                    update({
                      ...publish,
                      destinations: {
                        ...publish.destinations,
                        [kind]: { ...current, autoPublish },
                      },
                    })
                  }
                />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-muted-foreground text-xs">
                    {p.versioningMode}
                  </span>
                  <select
                    className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
                    value={current.versioningMode}
                    onChange={(event) =>
                      update({
                        ...publish,
                        destinations: {
                          ...publish.destinations,
                          [kind]: {
                            ...current,
                            versioningMode: event.target
                              .value as typeof current.versioningMode,
                          },
                        },
                      })
                    }
                  >
                    <option value="provider-native">{p.versionProvider}</option>
                    <option value="content-addressable">
                      {p.versionContentAddressable}
                    </option>
                    <option value="timestamped-folder">
                      {p.versionTimestamped}
                    </option>
                    <option value="overwrite">{p.versionOverwrite}</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-muted-foreground text-xs">
                    {p.defaultSchedule}
                  </span>
                  <input
                    className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
                    value={current.schedule}
                    placeholder={p.defaultSchedulePlaceholder}
                    onChange={(event) =>
                      update({
                        ...publish,
                        destinations: {
                          ...publish.destinations,
                          [kind]: { ...current, schedule: event.target.value },
                        },
                      })
                    }
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-muted-foreground text-sm">{description}</div>
      </div>
      {children}
    </div>
  );
}
