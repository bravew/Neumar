import { useEffect, useRef, useState } from 'react';

// @ts-ignore – culori ships JS-only; no @types package available
import { formatHex, oklch } from 'culori';

import type { BackgroundStyle } from '@/shared/db/settings';
import { backgroundStyles } from '@/shared/db/settings';
import {
  exportTheme,
  importTheme,
  resetTheme,
  useTheme as useColorPresets,
} from '@/shared/hooks/useTheme';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  UI_ZOOM_MAX,
  UI_ZOOM_MIN,
  UI_ZOOM_STEP,
  useTheme,
} from '@/shared/providers/theme-provider';

const SWATCH_KEYS = ['primary', 'secondary', 'accent', 'background', 'border'];

const toHex = (oklchStr: string): string => {
  try {
    return formatHex(oklchStr) ?? '#000000';
  } catch {
    return '#000000';
  }
};

const toOklch = (hex: string): string => {
  try {
    const c = oklch(hex);
    if (!c) return hex;
    return `oklch(${(c.l ?? 0).toFixed(3)} ${(c.c ?? 0).toFixed(3)} ${(c.h ?? 0).toFixed(1)})`;
  } catch {
    return hex;
  }
};

function getComputedColor(variable: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--${variable}`)
    .trim();
  if (!raw) return '#888888';
  if (raw.startsWith('oklch')) return toHex(raw);
  return raw;
}

export function ThemeSettings() {
  const { t } = useLanguage();
  const {
    theme,
    setTheme,
    backgroundStyle,
    setBackgroundStyle,
    uiZoom,
    setUiZoom,
  } = useTheme();
  const [zoomDraft, setZoomDraft] = useState(uiZoom);
  // Sync draft when zoom changes externally (e.g. keyboard shortcut)
  useEffect(() => {
    setZoomDraft(uiZoom);
  }, [uiZoom]);
  const zoomDirty = zoomDraft !== uiZoom;

  const applyZoom = () => {
    setUiZoom(zoomDraft);
  };
  const { activePresetId, loadedPresets, applyPreset, saveCustomColor } =
    useColorPresets();
  const [applying, setApplying] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
  };

  const handleBackgroundStyleChange = (newStyle: BackgroundStyle) => {
    setBackgroundStyle(newStyle);
  };

  const handleSelectPreset = async (presetId: string | null) => {
    setApplying(presetId ?? '__default__');
    try {
      await applyPreset(presetId);
    } finally {
      setApplying(null);
    }
  };

  const handleColorChange = (variable: string, hex: string) => {
    const oklchValue = toOklch(hex);
    saveCustomColor(variable, oklchValue);
  };

  const handleExport = () => {
    const json = exportTheme();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'theme.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      try {
        importTheme(text);
        setImportError(null);
      } catch (err) {
        setImportError(
          err instanceof Error
            ? err.message
            : (s.themeImportFailed ?? 'Import failed'),
        );
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const s = t.settings as Record<string, string>;

  const COLOR_VARIABLES = [
    { key: 'primary', label: s.themePrimary ?? 'Primary' },
    { key: 'accent', label: s.themeAccent ?? 'Accent' },
    { key: 'background', label: s.themeBackground ?? 'Background' },
    { key: 'border', label: s.themeBorder ?? 'Border' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.appearance}
        </label>
        <div className="flex gap-3">
          <button
            onClick={() => handleThemeChange('light')}
            className="group flex cursor-pointer flex-col items-center gap-2 focus:outline-none"
          >
            <div
              className={cn(
                'flex h-20 w-28 items-center justify-center rounded-lg border-2 bg-white transition-all',
                theme === 'light'
                  ? 'border-primary ring-primary/20 ring-2'
                  : 'border-border hover:border-primary/50',
              )}
            >
              <div className="flex h-12 w-20 flex-col gap-1 rounded border border-gray-200 bg-gray-100 p-1.5">
                <div className="flex gap-1">
                  <div className="h-3 w-3 rounded-sm bg-gray-300" />
                  <div className="h-3 flex-1 rounded-sm bg-gray-200" />
                </div>
                <div className="flex-1 rounded-sm border border-gray-200 bg-white" />
              </div>
            </div>
            <span
              className={cn(
                'text-sm',
                theme === 'light'
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground',
              )}
            >
              {t.settings.light}
            </span>
          </button>

          <button
            onClick={() => handleThemeChange('dark')}
            className="group flex cursor-pointer flex-col items-center gap-2 focus:outline-none"
          >
            <div
              className={cn(
                'flex h-20 w-28 items-center justify-center rounded-lg border-2 bg-gray-900 transition-all',
                theme === 'dark'
                  ? 'border-primary ring-primary/20 ring-2'
                  : 'hover:border-primary/50 border-gray-700',
              )}
            >
              <div className="flex h-12 w-20 flex-col gap-1 rounded border border-gray-700 bg-gray-800 p-1.5">
                <div className="flex gap-1">
                  <div className="h-3 w-3 rounded-sm bg-gray-600" />
                  <div className="h-3 flex-1 rounded-sm bg-gray-700" />
                </div>
                <div className="flex-1 rounded-sm border border-gray-700 bg-gray-900" />
              </div>
            </div>
            <span
              className={cn(
                'text-sm',
                theme === 'dark'
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground',
              )}
            >
              {t.settings.dark}
            </span>
          </button>

          <button
            onClick={() => handleThemeChange('system')}
            className="group flex cursor-pointer flex-col items-center gap-2 focus:outline-none"
          >
            <div
              className={cn(
                'flex h-20 w-28 items-center justify-center overflow-hidden rounded-lg border-2 transition-all',
                theme === 'system'
                  ? 'border-primary ring-primary/20 ring-2'
                  : 'border-border hover:border-primary/50',
              )}
            >
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
            </div>
            <span
              className={cn(
                'text-sm',
                theme === 'system'
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground',
              )}
            >
              {t.settings.system}
            </span>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.backgroundStyle}
        </label>
        <div className="flex gap-3">
          {backgroundStyles.map((style) => (
            <button
              key={style.id}
              onClick={() => handleBackgroundStyleChange(style.id)}
              className={cn(
                'flex flex-col gap-1 rounded-lg border-2 px-4 py-2 text-left transition-all focus:outline-none',
                backgroundStyle === style.id
                  ? 'border-primary ring-primary/20 ring-2'
                  : 'border-border hover:border-primary/50',
                'cursor-pointer',
              )}
            >
              <span className="text-foreground text-sm font-medium">
                {style.name}
              </span>
              <span className="text-muted-foreground text-xs">
                {style.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <label className="text-foreground text-sm font-medium">
              {t.settings.uiZoom}
            </label>
            <p className="text-muted-foreground text-xs">
              {t.settings.uiZoomDescription}
            </p>
          </div>
          <span className="text-foreground text-sm font-medium tabular-nums">
            {zoomDraft}%
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs">A</span>
          <input
            type="range"
            min={UI_ZOOM_MIN}
            max={UI_ZOOM_MAX}
            step={UI_ZOOM_STEP}
            value={zoomDraft}
            onChange={(e) => setZoomDraft(Number(e.target.value))}
            className="bg-input accent-primary h-1.5 w-full max-w-xs cursor-pointer appearance-none rounded-full"
          />
          <span className="text-muted-foreground text-base">A</span>
          <button
            onClick={applyZoom}
            disabled={!zoomDirty}
            className={cn(
              'ml-1 rounded-md px-3 py-1 text-xs font-medium transition-colors',
              zoomDirty
                ? 'bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            {t.settings.apply ?? 'Apply'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label className="text-foreground block text-sm font-medium">
          {s.themePresets ?? 'Color Presets'}
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {loadedPresets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleSelectPreset(preset.id)}
              disabled={applying === preset.id}
              className={cn(
                'flex flex-col gap-2 rounded-xl border-2 p-3 text-left transition-all focus:outline-none',
                activePresetId === preset.id
                  ? 'border-primary ring-primary/20 ring-2'
                  : 'border-border hover:border-primary/50',
                'cursor-pointer',
              )}
            >
              <div className="flex gap-1">
                {SWATCH_KEYS.map((key) => (
                  <div
                    key={key}
                    className="size-4 rounded-full border border-black/10"
                    style={{
                      backgroundColor: toHex(preset.colors[key] ?? '#888'),
                    }}
                  />
                ))}
              </div>
              <span className="text-foreground truncate text-xs font-medium">
                {preset.name}
              </span>
            </button>
          ))}
          {/* Default (none) option */}
          <button
            onClick={() => handleSelectPreset(null)}
            className={cn(
              'flex flex-col gap-2 rounded-xl border-2 p-3 text-left transition-all focus:outline-none',
              activePresetId === null
                ? 'border-primary ring-primary/20 ring-2'
                : 'border-border hover:border-primary/50',
              'cursor-pointer',
            )}
          >
            <div className="flex gap-1">
              {SWATCH_KEYS.map((k) => (
                <div
                  key={k}
                  className="size-4 rounded-full border border-black/10 bg-gray-300"
                />
              ))}
            </div>
            <span className="text-foreground truncate text-xs font-medium">
              {s.themeDefaultPreset ?? 'Default'}
            </span>
          </button>
        </div>
      </div>

      {/* Custom color pickers */}
      <div className="flex flex-col gap-3">
        <label className="text-foreground block text-sm font-medium">
          {s.themeCustomize ?? 'Customize Colors'}
        </label>
        <div className="grid grid-cols-2 gap-4">
          {COLOR_VARIABLES.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-sm">{label}</span>
              <input
                type="color"
                defaultValue={getComputedColor(key)}
                onChange={(e) => handleColorChange(key, e.target.value)}
                className="border-input h-8 w-12 cursor-pointer rounded border bg-transparent p-0.5"
                aria-label={(s.themePickColor ?? 'Pick {label} color').replace(
                  '{label}',
                  label,
                )}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Import error */}
      {importError && <p className="text-destructive text-sm">{importError}</p>}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleExport}
          className="bg-muted text-foreground hover:bg-muted/80 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
        >
          {s.themeExport ?? 'Export'}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="bg-muted text-foreground hover:bg-muted/80 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
        >
          {s.themeImport ?? 'Import'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImportFile}
        />
        <button
          onClick={resetTheme}
          className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-sm transition-colors"
        >
          {s.themeReset ?? 'Reset'}
        </button>
      </div>
    </div>
  );
}
