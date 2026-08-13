import { useState } from 'react';

import { PlugZap } from 'lucide-react';

import { useVideoProviders } from '@/shared/hooks/useVideoProject';
import { useLanguage } from '@/shared/providers/language-provider';

import { PanelShell } from './PanelShell';

export function ProviderPanel() {
  const { t } = useLanguage();
  const { providers, loading, error, updateProvider, testProvider } =
    useVideoProviders();
  const [probeMessage, setProbeMessage] = useState<string | null>(null);

  return (
    <PanelShell
      title={t.video.providers.title}
      description={t.video.providers.description}
    >
      {loading ? (
        <div className="text-muted-foreground text-xs">
          {t.video.providers.loading}
        </div>
      ) : error ? (
        <div className="text-destructive text-xs">{error}</div>
      ) : (
        <div className="space-y-2">
          {providers.slice(0, 8).map((provider) => (
            <div
              key={provider.capability.id}
              className="border-border rounded-md border px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <PlugZap className="text-muted-foreground size-4" />
                <div className="min-w-0 flex-1">
                  <div className="text-foreground truncate text-xs font-medium">
                    {provider.capability.label}
                  </div>
                  <div className="text-muted-foreground truncate text-[11px]">
                    {provider.capability.kinds.join(', ')} ·{' '}
                    {provider.capability.status}
                  </div>
                </div>
                <button
                  type="button"
                  aria-pressed={provider.config.enabled}
                  className={
                    provider.config.enabled
                      ? 'bg-primary h-5 w-9 rounded-full'
                      : 'bg-muted-foreground/30 h-5 w-9 rounded-full'
                  }
                  onClick={() =>
                    void updateProvider(provider.capability.id, {
                      enabled: !provider.config.enabled,
                    })
                  }
                >
                  <span
                    className={
                      provider.config.enabled
                        ? 'bg-background block size-4 translate-x-4 rounded-full transition-transform'
                        : 'bg-background block size-4 translate-x-0.5 rounded-full transition-transform'
                    }
                  />
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={provider.config.providerSettingId ?? ''}
                  onChange={(event) =>
                    void updateProvider(provider.capability.id, {
                      providerSettingId: event.target.value || null,
                    })
                  }
                  placeholder={t.video.providers.settingPlaceholder}
                  className="border-input bg-background min-w-0 flex-1 rounded-md border px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  className="border-border hover:bg-accent rounded-md border px-2 py-1 text-xs"
                  onClick={async () => {
                    try {
                      const result = await testProvider(provider.capability.id);
                      setProbeMessage(
                        `${provider.capability.label}: ${result.message}`,
                      );
                    } catch (err) {
                      const message =
                        err instanceof Error ? err.message : String(err);
                      setProbeMessage(
                        `${provider.capability.label}: ${message}`,
                      );
                    }
                  }}
                >
                  {t.video.providers.test}
                </button>
              </div>
            </div>
          ))}
          {probeMessage ? (
            <div className="text-muted-foreground text-xs">{probeMessage}</div>
          ) : null}
        </div>
      )}
    </PanelShell>
  );
}
