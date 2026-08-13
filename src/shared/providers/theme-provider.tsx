import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  accentColors,
  getSettings,
  saveSettings,
  type AccentColor,
  type BackgroundStyle,
} from '@/shared/db/settings';

export const UI_ZOOM_MIN = 50;
export const UI_ZOOM_MAX = 200;
export const UI_ZOOM_STEP = 10;
export const UI_ZOOM_DEFAULT = 100;

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  accentColor: AccentColor;
  backgroundStyle: BackgroundStyle;
  uiZoom: number;
  setTheme: (theme: Theme) => void;
  setAccentColor: (color: AccentColor) => void;
  setBackgroundStyle: (style: BackgroundStyle) => void;
  setUiZoom: (zoom: number) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Stable MediaQueryList reference for useSyncExternalStore
const darkModeQuery =
  typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

function subscribeToSystemTheme(callback: () => void) {
  if (!darkModeQuery) return () => {};
  darkModeQuery.addEventListener('change', callback);
  return () => darkModeQuery.removeEventListener('change', callback);
}

function getSystemThemeSnapshot(): ResolvedTheme {
  return darkModeQuery?.matches ? 'dark' : 'light';
}

function getServerSnapshot(): ResolvedTheme {
  return 'light';
}

function applyTheme(resolvedTheme: ResolvedTheme) {
  const root = document.documentElement;
  // Clear the inline backgroundColor set by the anti-flash script in index.html
  // so CSS variables take over (important for bg-warm / bg-cool variants).
  root.style.removeProperty('background-color');
  if (resolvedTheme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

function applyAccentColor(colorId: AccentColor, resolvedTheme: ResolvedTheme) {
  const colorConfig = accentColors.find((c) => c.id === colorId);
  if (!colorConfig) return;

  const root = document.documentElement;
  const color =
    resolvedTheme === 'dark' ? colorConfig.darkColor : colorConfig.color;

  // Set primary color CSS variable
  root.style.setProperty('--primary', color);
  root.style.setProperty('--ring', color);
  root.style.setProperty('--sidebar-primary', color);
  root.style.setProperty('--sidebar-ring', color);
}

function applyBackgroundStyle(style: BackgroundStyle) {
  const root = document.documentElement;
  // Remove existing background style classes
  root.classList.remove('bg-warm', 'bg-cool');
  // Apply new background style class (default has no class)
  if (style !== 'default') {
    root.classList.add(`bg-${style}`);
  }
}

function applyUiZoom(zoom: number) {
  // Scale root font-size so all rem-based sizes adapt proportionally
  // Default browser font-size is 16px; 100% → 16px, 120% → 19.2px, etc.
  document.documentElement.style.fontSize = `${(zoom / 100) * 16}px`;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => getSettings().theme);

  const [accentColor, setAccentColorState] = useState<AccentColor>(
    () => getSettings().accentColor || 'brand',
  );

  const [backgroundStyle, setBackgroundStyleState] = useState<BackgroundStyle>(
    () => getSettings().backgroundStyle || 'default',
  );

  const [uiZoom, setUiZoomState] = useState<number>(
    () => getSettings().uiZoom || 100,
  );

  // Use useSyncExternalStore for system theme (per React docs recommendation)
  const systemTheme = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemThemeSnapshot,
    getServerSnapshot,
  );

  // Derive resolvedTheme during render - NO useState, NO useEffect
  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme;

  // Apply side effects (DOM manipulation) - only real side effects belong in useEffect
  useEffect(() => {
    applyTheme(resolvedTheme);
    applyAccentColor(accentColor, resolvedTheme);
    applyBackgroundStyle(backgroundStyle);
    applyUiZoom(uiZoom);
  }, [resolvedTheme, accentColor, backgroundStyle, uiZoom]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    const settings = getSettings();
    saveSettings({ ...settings, theme: newTheme });
  }, []);

  const setAccentColor = useCallback((newColor: AccentColor) => {
    setAccentColorState(newColor);
    const settings = getSettings();
    saveSettings({ ...settings, accentColor: newColor });
  }, []);

  const setBackgroundStyle = useCallback((newStyle: BackgroundStyle) => {
    setBackgroundStyleState(newStyle);
    const settings = getSettings();
    saveSettings({ ...settings, backgroundStyle: newStyle });
  }, []);

  const setUiZoom = useCallback((newZoom: number) => {
    setUiZoomState(newZoom);
    const settings = getSettings();
    saveSettings({ ...settings, uiZoom: newZoom });
  }, []);

  // Keyboard zoom shortcuts: Cmd/Ctrl + =/- to zoom in/out, Cmd/Ctrl + 0 to reset
  const uiZoomRef = useRef(uiZoom);
  uiZoomRef.current = uiZoom;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        const next = Math.min(uiZoomRef.current + UI_ZOOM_STEP, UI_ZOOM_MAX);
        if (next !== uiZoomRef.current) setUiZoom(next);
      } else if (e.key === '-') {
        e.preventDefault();
        const next = Math.max(uiZoomRef.current - UI_ZOOM_STEP, UI_ZOOM_MIN);
        if (next !== uiZoomRef.current) setUiZoom(next);
      } else if (e.key === '0') {
        e.preventDefault();
        if (uiZoomRef.current !== UI_ZOOM_DEFAULT) setUiZoom(UI_ZOOM_DEFAULT);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setUiZoom]);

  const value = useMemo<ThemeContextType>(
    () => ({
      theme,
      resolvedTheme,
      accentColor,
      backgroundStyle,
      uiZoom,
      setTheme,
      setAccentColor,
      setBackgroundStyle,
      setUiZoom,
    }),
    [
      theme,
      resolvedTheme,
      accentColor,
      backgroundStyle,
      uiZoom,
      setTheme,
      setAccentColor,
      setBackgroundStyle,
      setUiZoom,
    ],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
