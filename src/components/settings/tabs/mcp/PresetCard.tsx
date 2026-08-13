import { Download, LogIn } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import type { MCPPreset } from './types';

export function PresetCard({
  preset,
  isInstalled,
  onInstall,
  onUninstall,
}: {
  preset: MCPPreset;
  isInstalled: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="border-border bg-background hover:border-foreground/20 flex flex-col rounded-xl border p-4 transition-colors">
      <div className="mb-3 flex gap-3">
        {preset.icon ? (
          <img
            src={preset.icon}
            alt=""
            className="size-12 shrink-0 rounded-xl"
            aria-hidden="true"
          />
        ) : (
          <div className="bg-muted size-12 shrink-0 rounded-xl" />
        )}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate text-sm font-medium">
              {preset.name}
            </span>
            {preset.requiresOAuth && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                <LogIn className="size-2.5" />
                {t.settings.mcpOAuth}
              </span>
            )}
          </div>
          <p className="text-muted-foreground line-clamp-2 text-xs">
            {preset.description}
          </p>
        </div>
      </div>

      <div className="border-border border-t pt-3">
        {isInstalled ? (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium">
              {t.settings.mcpPresetsInstalled}
            </span>
            <button
              onClick={onUninstall}
              className="text-muted-foreground hover:text-destructive text-xs transition-colors"
              aria-label={`${t.settings.mcpPresetsUninstall} ${preset.name}`}
            >
              {t.settings.mcpPresetsUninstall}
            </button>
          </div>
        ) : (
          <button
            onClick={onInstall}
            className="bg-foreground text-background hover:bg-foreground/90 flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors"
            aria-label={`${t.settings.mcpPresetsInstall} ${preset.name}`}
          >
            <Download className="size-3.5" />
            {t.settings.mcpPresetsInstall}
          </button>
        )}
      </div>
    </div>
  );
}
