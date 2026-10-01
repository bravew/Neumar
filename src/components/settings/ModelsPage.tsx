import { useMemo, useState } from 'react';

import type { Settings, TaskType } from '@/shared/db/settings';
import {
  DEFAULT_MEDIA_CONFIG,
  isAgentCapableModel,
  isProviderReady,
} from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { SettingsCard } from './primitives/SettingsCard';
import { SettingsDrillIn } from './primitives/SettingsDrillIn';
import { SettingsRow } from './primitives/SettingsRow';
import { AgentRuntimeSettings } from './tabs/AgentRuntimeSettings';
import { MediaProviderSettings } from './tabs/model-settings-parts';
import { ModelRoutingSection } from './tabs/ModelRoutingSection';

export function ModelsPage({
  settings,
  onSettingsChange,
  onOpenAdvanced,
}: {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onOpenAdvanced: () => void;
}) {
  const { t } = useLanguage();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const choices = useMemo(
    () =>
      settings.providers
        .filter((provider) => provider.enabled)
        .flatMap((provider) =>
          provider.models
            .filter((model) => isAgentCapableModel(model))
            .map((model) => ({ provider, model })),
        ),
    [settings.providers],
  );
  const connected = settings.providers.filter(
    (provider) => provider.enabled && isProviderReady(provider),
  );

  if (adding) {
    const q = query.trim().toLowerCase();
    const available = settings.providers.filter((provider) => {
      if (provider.enabled && isProviderReady(provider)) return false;
      if (!q) return true;
      return provider.name.toLowerCase().includes(q);
    });
    return (
      <SettingsDrillIn
        title={t.settings.addProvider}
        backLabel={t.settings.models}
        onBack={() => setAdding(false)}
      >
        <label className="mb-3 block">
          <span className="sr-only">{t.settings.searchSettings}</span>
          <input
            data-testid="add-provider-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.settings.searchSettings}
            className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm"
          />
        </label>
        <div className="space-y-1">
          {available.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="hover:bg-accent flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm"
              onClick={() =>
                onSettingsChange({
                  ...settings,
                  providers: settings.providers.map((entry) =>
                    entry.id === provider.id
                      ? { ...entry, enabled: true }
                      : entry,
                  ),
                })
              }
            >
              <span>{provider.name}</span>
            </button>
          ))}
        </div>
      </SettingsDrillIn>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6">
      <SettingsCard title={t.settings.defaultModel}>
        <button
          type="button"
          data-testid="default-model-default"
          aria-pressed={settings.defaultProvider === 'default'}
          className={cn(
            'w-full px-4 py-3 text-left text-sm',
            settings.defaultProvider === 'default' && 'bg-primary/5',
          )}
          onClick={() =>
            onSettingsChange({
              ...settings,
              defaultProvider: 'default',
              defaultModel: '',
            })
          }
        >
          {t.settings.defaultEnv}
        </button>
        {choices.map(({ provider, model }) => {
          const selected =
            settings.defaultProvider === provider.id &&
            settings.defaultModel === model;
          return (
            <button
              key={`${provider.id}:${model}`}
              type="button"
              data-testid={`default-model-${provider.id}-${model}`}
              aria-pressed={selected}
              className={cn(
                'w-full px-4 py-3 text-left text-sm',
                selected && 'bg-primary/5',
              )}
              onClick={() =>
                onSettingsChange({
                  ...settings,
                  defaultProvider: provider.id,
                  defaultModel: model,
                })
              }
            >
              {provider.name} / {model}
            </button>
          );
        })}
      </SettingsCard>
      <SettingsCard title={t.settings.connectedProviders}>
        {connected.length === 0 ? (
          <p className="text-muted-foreground px-4 py-3 text-sm">
            {t.settings.selectProvider}
          </p>
        ) : (
          connected.map((provider) => (
            <SettingsRow
              key={provider.id}
              variant="status"
              label={provider.name}
              status={t.settings.providerConnected}
            />
          ))
        )}
      </SettingsCard>
      <SettingsRow
        variant="chevron"
        label={t.settings.addProvider}
        onSelect={() => setAdding(true)}
      />
      <SettingsRow
        variant="chevron"
        label={t.settings.modelsAdvanced}
        onSelect={onOpenAdvanced}
      />
    </div>
  );
}

export function ModelsAdvanced({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}) {
  const handleRoutingChange = (
    taskType: TaskType,
    field: 'provider' | 'model',
    value: string,
  ) => {
    const currentRouting = settings.modelRouting || {};
    const currentRoute = currentRouting[taskType] || {
      provider: 'default',
      model: '',
    };
    const updatedRoute = { ...currentRoute, [field]: value };
    if (field === 'provider' && value === 'default') updatedRoute.model = '';
    if (field === 'provider' && value !== 'default') {
      const provider = settings.providers.find((entry) => entry.id === value);
      const first = provider?.models.find((model) =>
        isAgentCapableModel(model),
      );
      updatedRoute.model = first || provider?.models[0] || '';
    }
    onSettingsChange({
      ...settings,
      modelRouting: { ...currentRouting, [taskType]: updatedRoute },
    });
  };

  return (
    <div className="space-y-6">
      <MediaProviderSettings
        media={settings.media ?? DEFAULT_MEDIA_CONFIG}
        onChange={(media) => onSettingsChange({ ...settings, media })}
      />
      <ModelRoutingSection
        providers={settings.providers}
        modelRouting={settings.modelRouting || {}}
        onRoutingChange={handleRoutingChange}
      />
      <AgentRuntimeSettings
        settings={settings}
        onSettingsChange={onSettingsChange}
      />
    </div>
  );
}
