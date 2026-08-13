import { useCallback, useEffect, useState } from 'react';

export interface ThemePreset {
  id: string;
  name: string;
  colors: Record<string, string>;
  dark?: Record<string, string>;
}

// Dynamically import preset JSON files
const presetModules: Record<string, () => Promise<{ default: unknown }>> = {
  nord: () => import('@/config/style/themes/nord.json'),
  solarized: () => import('@/config/style/themes/solarized.json'),
  'tokyo-night': () => import('@/config/style/themes/tokyo-night.json'),
  gruvbox: () => import('@/config/style/themes/gruvbox.json'),
  catppuccin: () => import('@/config/style/themes/catppuccin.json'),
};

export const PRESET_IDS = [
  'nord',
  'solarized',
  'tokyo-night',
  'gruvbox',
  'catppuccin',
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const THEME_PRESETS = PRESET_IDS;

const STORAGE_KEY = 'theme-preset';
const STORAGE_OVERRIDES_KEY = 'theme-overrides';

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function applyThemeColors(colors: Record<string, string>): void {
  for (const [key, value] of Object.entries(colors)) {
    if (key === 'dark') continue;
    document.documentElement.style.setProperty(`--${key}`, value);
  }
}

export function resetTheme(): void {
  const el = document.documentElement;
  // Remove all inline custom property overrides
  const toRemove: string[] = [];
  for (let i = 0; i < el.style.length; i++) {
    const prop = el.style.item(i);
    if (prop.startsWith('--')) toRemove.push(prop);
  }
  for (const prop of toRemove) {
    el.style.removeProperty(prop);
  }
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_OVERRIDES_KEY);
}

export function exportTheme(): string {
  const el = document.documentElement;
  const overrides: Record<string, string> = {};
  for (let i = 0; i < el.style.length; i++) {
    const prop = el.style.item(i);
    if (prop.startsWith('--')) {
      overrides[prop.slice(2)] = el.style.getPropertyValue(prop).trim();
    }
  }
  return JSON.stringify(overrides, null, 2);
}

export function importTheme(json: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Theme must be an object');
  }
  const colors = parsed as Record<string, string>;
  applyThemeColors(colors);
  localStorage.setItem(STORAGE_OVERRIDES_KEY, json);
}

export function useTheme() {
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [loadedPresets, setLoadedPresets] = useState<ThemePreset[]>([]);

  const loadPresets = useCallback(async () => {
    const presets: ThemePreset[] = [];
    for (const id of PRESET_IDS) {
      try {
        const mod = await presetModules[id]();
        const data = mod.default;
        const { dark, ...colors } = data as {
          dark?: Record<string, string>;
        } & Record<string, string>;
        presets.push({
          id,
          name: id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          colors,
          dark,
        });
      } catch {
        // skip failed presets
      }
    }
    setLoadedPresets(presets);
    return presets;
  }, []);

  const applyPreset = useCallback(
    async (presetId: string | null) => {
      if (!presetId) {
        resetTheme();
        setActivePresetId(null);
        return;
      }

      let presets = loadedPresets;
      if (presets.length === 0) {
        presets = await loadPresets();
      }
      const preset = presets.find((p) => p.id === presetId);
      if (!preset) return;

      // Reset first, then apply
      resetTheme();
      applyThemeColors(preset.colors);
      if (isDark() && preset.dark) {
        applyThemeColors(preset.dark);
      }
      localStorage.setItem(STORAGE_KEY, presetId);
      setActivePresetId(presetId);
    },
    [loadedPresets, loadPresets],
  );

  const saveCustomColor = useCallback((variable: string, value: string) => {
    document.documentElement.style.setProperty(`--${variable}`, value);
    // Persist overrides
    const current = localStorage.getItem(STORAGE_OVERRIDES_KEY);
    let overrides: Record<string, string> = {};
    if (current) {
      try {
        overrides = JSON.parse(current) as Record<string, string>;
      } catch {
        // ignore malformed JSON
      }
    }
    overrides[variable] = value;
    localStorage.setItem(STORAGE_OVERRIDES_KEY, JSON.stringify(overrides));
  }, []);

  // Load saved theme on mount
  useEffect(() => {
    let cancelled = false;
    const savedPreset = localStorage.getItem(STORAGE_KEY);
    const savedOverrides = localStorage.getItem(STORAGE_OVERRIDES_KEY);

    loadPresets().then((presets) => {
      if (cancelled) return;
      if (savedPreset) {
        const preset = presets.find((p) => p.id === savedPreset);
        if (preset) {
          applyThemeColors(preset.colors);
          if (isDark() && preset.dark) applyThemeColors(preset.dark);
          setActivePresetId(savedPreset);
        }
      }
      if (savedOverrides) {
        try {
          const overrides = JSON.parse(savedOverrides) as Record<
            string,
            string
          >;
          applyThemeColors(overrides);
        } catch {
          // ignore malformed JSON
        }
      }
    });
    return () => {
      cancelled = true;
    };
    // loadPresets is stable (useCallback) and only needs to run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    activePresetId,
    loadedPresets,
    applyPreset,
    saveCustomColor,
    resetTheme,
    exportTheme,
    importTheme,
  };
}
