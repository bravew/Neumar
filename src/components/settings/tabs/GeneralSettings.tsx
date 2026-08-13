import { useEffect, useState } from 'react';

import { ExternalLink } from 'lucide-react';

import { DesktopAccessGuide } from '@/components/auth/DesktopAccessGuide';
import type { Language } from '@/config/locale';
import { usePermissions } from '@/shared/hooks/usePermissions';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { SettingsTabProps } from '../types';
import { LanguageTileGrid } from './LanguageTileGrid';
import { NotificationSettingsSection } from './NotificationSettingsSection';

const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

export function GeneralSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const { t, language, setLanguage } = useLanguage();
  const { openSystemSettings } = usePermissions();

  // Sync local toggle with the OS-level autostart state on mount
  const [autoStartEnabled, setAutoStartEnabled] = useState(
    settings.runOnStartup ?? false,
  );
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    import('@tauri-apps/plugin-autostart')
      .then(({ isEnabled }) =>
        isEnabled().then((enabled) => {
          if (cancelled) return;
          setAutoStartEnabled(enabled);
          if (enabled !== (settings.runOnStartup ?? false)) {
            onSettingsChange({ ...settings, runOnStartup: enabled });
          }
        }),
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAutoStartToggle = async () => {
    if (!isTauri) return;
    try {
      const { enable, disable } = await import('@tauri-apps/plugin-autostart');
      const next = !autoStartEnabled;
      if (next) {
        await enable();
      } else {
        await disable();
      }
      setAutoStartEnabled(next);
      onSettingsChange({ ...settings, runOnStartup: next });
    } catch {
      // Plugin unavailable (e.g. dev browser mode) — ignore
    }
  };

  return (
    <div className="space-y-8">
      {/* Language */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <label className="text-foreground text-sm font-medium">
            {t.settings.language}
          </label>
          <p className="text-muted-foreground text-xs">
            {t.settings.languageDescription}
          </p>
        </div>
        <LanguageTileGrid
          language={language as Language}
          label={t.settings.language}
          onSelect={setLanguage}
        />
      </div>

      {/* Plan mode */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-foreground text-sm font-medium">
            {t.settings.planMode}
          </label>
          <p className="text-muted-foreground text-xs">
            {t.settings.planModeDescription}
          </p>
        </div>
        <div className="bg-muted flex rounded-lg p-0.5">
          {(
            [
              { value: 'off', label: t.settings.planModeOff },
              { value: 'auto', label: t.settings.planModeAuto },
              { value: 'on', label: t.settings.planModeOn },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onSettingsChange({ ...settings, planMode: value })}
              className={cn(
                'flex-1 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                (settings.planMode ?? 'on') === value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Batch Mode (PTC) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <label className="text-foreground text-sm font-medium">
              {t.settings.ptcEnabled}
            </label>
            <p className="text-muted-foreground text-xs">
              {t.settings.ptcEnabledDescription}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={settings.ptcEnabled ?? false}
            onClick={() =>
              onSettingsChange({
                ...settings,
                ptcEnabled: !settings.ptcEnabled,
              })
            }
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none',
              settings.ptcEnabled
                ? 'bg-primary focus:ring-primary'
                : 'bg-input focus:ring-ring',
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block size-5 rounded-full bg-white shadow-lg transition-transform',
                settings.ptcEnabled ? 'translate-x-5' : 'translate-x-0',
              )}
            />
          </button>
        </div>
      </div>

      {/* Run on Startup — only visible in Tauri desktop builds */}
      {isTauri && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <label className="text-foreground text-sm font-medium">
                {t.settings.runOnStartup}
              </label>
              <p className="text-muted-foreground text-xs">
                {t.settings.runOnStartupDescription}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={autoStartEnabled}
              onClick={handleAutoStartToggle}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none',
                autoStartEnabled
                  ? 'bg-primary focus:ring-primary'
                  : 'bg-input focus:ring-ring',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block size-5 rounded-full bg-white shadow-lg transition-transform',
                  autoStartEnabled ? 'translate-x-5' : 'translate-x-0',
                )}
              />
            </button>
          </div>
        </div>
      )}

      {/* Advanced Mode */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <label className="text-foreground text-sm font-medium">
              {t.settings.advancedMode}
            </label>
            <p className="text-muted-foreground text-xs">
              {t.settings.advancedModeDescription}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={settings.advancedMode ?? false}
            onClick={() =>
              onSettingsChange({
                ...settings,
                advancedMode: !settings.advancedMode,
              })
            }
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none',
              settings.advancedMode
                ? 'bg-primary focus:ring-primary'
                : 'bg-input focus:ring-ring',
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block size-5 rounded-full bg-white shadow-lg transition-transform',
                settings.advancedMode ? 'translate-x-5' : 'translate-x-0',
              )}
            />
          </button>
        </div>
      </div>

      {/* Live Artifacts (Phase 3 — gated) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <label className="text-foreground text-sm font-medium">
              {t.settings.artifactsV2}
            </label>
            <p className="text-muted-foreground text-xs">
              {t.settings.artifactsV2Description}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={settings.artifactsV2 ?? false}
            onClick={() =>
              onSettingsChange({
                ...settings,
                artifactsV2: !settings.artifactsV2,
              })
            }
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none',
              settings.artifactsV2
                ? 'bg-primary focus:ring-primary'
                : 'bg-input focus:ring-ring',
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block size-5 rounded-full bg-white shadow-lg transition-transform',
                settings.artifactsV2 ? 'translate-x-5' : 'translate-x-0',
              )}
            />
          </button>
        </div>
      </div>

      <NotificationSettingsSection
        settings={settings}
        onSettingsChange={onSettingsChange}
      />

      {/* Desktop Access / System Permissions */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-foreground text-sm font-semibold">
              {t.settings.desktopAccess}
            </h3>
            <p className="text-muted-foreground text-xs">
              {t.settings.desktopAccessDescription}
            </p>
          </div>
          <button
            onClick={openSystemSettings}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
            aria-label={t.settings.systemSettings}
          >
            <ExternalLink className="size-3" />
            {t.settings.systemSettings}
          </button>
        </div>
        <DesktopAccessGuide />
      </section>
    </div>
  );
}
