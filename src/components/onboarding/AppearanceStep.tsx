/**
 * Onboarding Step 2: Appearance
 *
 * Theme and background style selection.
 */

import type { BackgroundStyle, Settings } from '@/shared/db/settings';
import { backgroundStyles } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { useTheme } from '@/shared/providers/theme-provider';

interface AppearanceStepProps {
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}

export function AppearanceStep({
  settings,
  onSettingsChange,
}: AppearanceStepProps) {
  const { t } = useLanguage();
  const ob = t.onboarding;
  const { theme, setTheme, backgroundStyle, setBackgroundStyle } = useTheme();

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    onSettingsChange({ ...settings, theme: newTheme });
  };

  const handleBackgroundStyleChange = (newStyle: BackgroundStyle) => {
    setBackgroundStyle(newStyle);
    onSettingsChange({ ...settings, backgroundStyle: newStyle });
  };

  // Map background style IDs to i18n labels
  const bgStyleLabels: Record<BackgroundStyle, string> = {
    default: ob.bgDefault ?? 'Default',
    warm: ob.bgWarm ?? 'Warm',
    cool: ob.bgCool ?? 'Cool',
  };

  return (
    <div>
      <h1 className="text-foreground text-center text-3xl font-bold">
        {ob.appearanceTitle}
      </h1>
      <p className="text-muted-foreground mt-3 text-center text-base">
        {ob.appearanceSubtitle}
      </p>

      <div className="mt-8 space-y-8">
        {/* Theme */}
        <div className="flex flex-col gap-3">
          <label className="text-foreground text-sm font-medium">
            {ob.themeLabel}
          </label>
          <div className="flex gap-3">
            {(
              [
                { id: 'light', label: ob.light },
                { id: 'dark', label: ob.dark },
                { id: 'system', label: ob.system },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => handleThemeChange(opt.id)}
                className="group flex cursor-pointer flex-col items-center gap-2 focus:outline-none"
              >
                <ThemePreview themeId={opt.id} isSelected={theme === opt.id} />
                <span
                  className={cn(
                    'text-sm',
                    theme === opt.id
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground',
                  )}
                >
                  {opt.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Background Style */}
        <div className="flex flex-col gap-3">
          <label className="text-foreground text-sm font-medium">
            {ob.backgroundLabel}
          </label>
          <div className="flex gap-3">
            {backgroundStyles.map((styleOption) => (
              <button
                key={styleOption.id}
                onClick={() => handleBackgroundStyleChange(styleOption.id)}
                className="group flex cursor-pointer flex-col items-center gap-2 focus:outline-none"
              >
                <BgStylePreview
                  styleId={styleOption.id}
                  isSelected={backgroundStyle === styleOption.id}
                />
                <span
                  className={cn(
                    'text-sm',
                    backgroundStyle === styleOption.id
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground',
                  )}
                >
                  {bgStyleLabels[styleOption.id]}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Sub-components for theme/bg previews ----

function ThemePreview({
  themeId,
  isSelected,
}: {
  themeId: 'light' | 'dark' | 'system';
  isSelected: boolean;
}) {
  return (
    <div
      className={cn(
        'flex h-20 w-28 items-center justify-center rounded-lg border-2 transition-all',
        themeId === 'light'
          ? 'bg-white'
          : themeId === 'dark'
            ? 'bg-gray-900'
            : 'overflow-hidden',
        isSelected
          ? 'border-primary ring-primary/20 ring-2'
          : themeId === 'dark'
            ? 'hover:border-primary/50 border-gray-700'
            : 'border-border hover:border-primary/50',
      )}
    >
      {themeId === 'system' ? (
        <div className="flex h-full w-full">
          <div className="flex h-full w-1/2 items-center justify-center bg-white">
            <div className="flex h-12 w-10 flex-col gap-0.5 rounded-l border-y border-l border-gray-200 bg-gray-100 p-1">
              <div className="h-2 w-2 rounded-sm bg-gray-300" />
              <div className="flex-1 rounded-sm border border-gray-200 bg-white" />
            </div>
          </div>
          <div className="flex h-full w-1/2 items-center justify-center bg-gray-900">
            <div className="flex h-12 w-10 flex-col gap-0.5 rounded-r border-y border-r border-gray-700 bg-gray-800 p-1">
              <div className="h-2 w-2 rounded-sm bg-gray-600" />
              <div className="flex-1 rounded-sm border border-gray-700 bg-gray-900" />
            </div>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            'flex h-12 w-20 flex-col gap-1 rounded border p-1.5',
            themeId === 'light'
              ? 'border-gray-200 bg-gray-100'
              : 'border-gray-700 bg-gray-800',
          )}
        >
          <div className="flex gap-1">
            <div
              className={cn(
                'h-3 w-3 rounded-sm',
                themeId === 'light' ? 'bg-gray-300' : 'bg-gray-600',
              )}
            />
            <div
              className={cn(
                'h-3 flex-1 rounded-sm',
                themeId === 'light' ? 'bg-gray-200' : 'bg-gray-700',
              )}
            />
          </div>
          <div
            className={cn(
              'flex-1 rounded-sm border',
              themeId === 'light'
                ? 'border-gray-200 bg-white'
                : 'border-gray-700 bg-gray-900',
            )}
          />
        </div>
      )}
    </div>
  );
}

function BgStylePreview({
  styleId,
  isSelected,
}: {
  styleId: string;
  isSelected: boolean;
}) {
  return (
    <div
      className={cn(
        'flex h-16 w-24 items-center justify-center rounded-lg border-2 transition-all',
        styleId === 'default'
          ? 'bg-white'
          : styleId === 'warm'
            ? 'bg-amber-50'
            : 'bg-slate-50',
        isSelected
          ? 'border-primary ring-primary/20 ring-2'
          : 'border-border hover:border-primary/50',
      )}
    >
      <div
        className={cn(
          'flex h-9 w-16 flex-col gap-0.5 rounded border p-1',
          styleId === 'default'
            ? 'border-gray-200 bg-gray-100'
            : styleId === 'warm'
              ? 'border-amber-200 bg-amber-100/50'
              : 'border-slate-200 bg-slate-100',
        )}
      >
        <div
          className={cn(
            'h-2 w-3 rounded-sm',
            styleId === 'default'
              ? 'bg-gray-300'
              : styleId === 'warm'
                ? 'bg-amber-300'
                : 'bg-slate-300',
          )}
        />
        <div
          className={cn(
            'flex-1 rounded-sm border',
            styleId === 'default'
              ? 'border-gray-200 bg-white'
              : styleId === 'warm'
                ? 'border-amber-100 bg-amber-50/50'
                : 'border-slate-200 bg-white',
          )}
        />
      </div>
    </div>
  );
}
