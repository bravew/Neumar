import { Shield, ShieldOff } from 'lucide-react';

import type { Settings } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { SandboxProviderBadge } from './sandbox/SandboxProviderBadge';

const sandboxOptions = [
  {
    id: 'codex' as const,
    icon: Shield,
    nameKey: 'sandboxCodex' as const,
    descKey: 'sandboxCodexDescription' as const,
    enforcement: 'reduced' as const,
    marketplaceEligible: false,
  },
  {
    id: 'native' as const,
    icon: ShieldOff,
    nameKey: 'sandboxNative' as const,
    descKey: 'sandboxNativeDescription' as const,
    enforcement: 'none' as const,
    marketplaceEligible: false,
  },
];

export function SandboxModeGroup({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col gap-2">
      <p className="text-foreground text-sm font-medium">
        {t.settings.whereCodeRuns}
      </p>
      <p className="text-muted-foreground text-xs">
        {t.settings.defaultSandboxDescription}
      </p>
      <div className="grid max-w-md grid-cols-2 gap-2">
        {sandboxOptions.map((option) => {
          const Icon = option.icon;
          const selected = settings.defaultSandboxProvider === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() =>
                onSettingsChange({
                  ...settings,
                  sandboxEnabled: true,
                  defaultSandboxProvider: option.id,
                })
              }
              className={cn(
                'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                selected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-accent',
              )}
            >
              <Icon
                className={cn(
                  'size-5 shrink-0',
                  selected ? 'text-primary' : 'text-muted-foreground',
                )}
              />
              <div className="min-w-0">
                <div
                  className={cn(
                    'flex items-center gap-2 text-sm font-medium',
                    selected ? 'text-primary' : 'text-foreground',
                  )}
                >
                  <span>{t.settings[option.nameKey]}</span>
                  <SandboxProviderBadge
                    enforcement={option.enforcement}
                    marketplaceEligible={option.marketplaceEligible}
                  />
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {t.settings[option.descKey]}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {settings.defaultSandboxProvider === 'native' && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {(t.settings as Record<string, string>).sandboxNativeWarning}
        </p>
      )}
    </div>
  );
}
