import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';

import { useLocation, useNavigate } from 'react-router-dom';

import {
  DEFAULT_DESIGN_MODE_SETTINGS,
  DEFAULT_MODES_SETTINGS,
  useSetting,
} from '@/shared/db/settings';

import { ModeRegistry } from './ModeRegistry';
import type { ModeDefinition, ModeId } from './types';

const LAST_ACTIVE_MODE_KEY = 'neuma.activeMode';
const LEGACY_DESIGN_ENTRY_WIDTH_KEY = 'neuma-design-entry-sidebar-width';

interface ModeContextValue {
  activeMode: ModeDefinition;
  modes: ModeDefinition[];
  setActiveMode: (id: ModeId) => void;
}

const ModeContext = createContext<ModeContextValue | undefined>(undefined);

function pathMatches(pathname: string, pattern: RegExp | string): boolean {
  if (typeof pattern === 'string') return pathname === pattern;
  return pattern.test(pathname);
}

function modeMatchesPath(mode: ModeDefinition, pathname: string): boolean {
  return mode.matches.some((pattern) => pathMatches(pathname, pattern));
}

function getFallbackMode(modes: ModeDefinition[]): ModeDefinition {
  const fallback = modes.find((mode) => mode.id === 'tasks') ?? modes[0];
  if (!fallback) {
    throw new Error('ModeProvider requires at least one registered mode');
  }
  return fallback;
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const designModeSettings =
    useSetting('designMode') ?? DEFAULT_DESIGN_MODE_SETTINGS;
  const savedModeSettings = useSetting('modes');
  const modeSettings = useMemo(
    () => ({ ...DEFAULT_MODES_SETTINGS, ...savedModeSettings }),
    [savedModeSettings],
  );
  const designModeEnabled = designModeSettings.enabled;
  const modes = useMemo(() => {
    const orderRank = new Map(
      (modeSettings.order ?? DEFAULT_MODES_SETTINGS.order).map((id, index) => [
        id,
        index,
      ]),
    );
    return ModeRegistry.list({ includeDisabled: true })
      .filter((mode) => {
        if (!mode.enabled) return false;
        if (mode.id === 'design') return designModeEnabled;
        if (mode.id === 'video') return modeSettings.videoEnabled;
        if (mode.id === 'automate') return modeSettings.automateEnabled;
        if (mode.id === 'chat') return modeSettings.chatEnabled;
        return true;
      })
      .sort((a, b) => {
        const aRank = orderRank.get(a.id) ?? a.order;
        const bRank = orderRank.get(b.id) ?? b.order;
        return aRank - bRank || a.order - b.order;
      });
  }, [designModeEnabled, modeSettings]);
  const activeMode =
    modes.find((mode) => modeMatchesPath(mode, location.pathname)) ??
    getFallbackMode(modes);

  useEffect(() => {
    globalThis.localStorage?.removeItem?.(LEGACY_DESIGN_ENTRY_WIDTH_KEY);
  }, []);

  useEffect(() => {
    if (activeMode.enabled) {
      globalThis.localStorage?.setItem?.(LAST_ACTIVE_MODE_KEY, activeMode.id);
    }
  }, [activeMode]);

  const setActiveMode = useCallback(
    (id: ModeId) => {
      const mode = modes.find((entry) => entry.id === id);
      if (!mode) return;
      navigate(mode.rootPath);
    },
    [modes, navigate],
  );

  const value = useMemo<ModeContextValue>(
    () => ({ activeMode, modes, setActiveMode }),
    [activeMode, modes, setActiveMode],
  );

  return <ModeContext value={value}>{children}</ModeContext>;
}

export function useMode() {
  const context = useContext(ModeContext);
  if (!context) throw new Error('useMode must be used within ModeProvider');
  return context;
}

export function useOptionalMode() {
  return useContext(ModeContext);
}
