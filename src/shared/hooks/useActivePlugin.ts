/**
 * useActivePlugin — resolves the plugin pre-attached to the current surface via
 * the `?plugin=<id>` query param (set by the marketplace "Use" action), plus
 * whether its example query should be seeded into the composer (`?seed=1`).
 *
 * Shared by the ActivePluginChip (which shows/dismisses it) and each surface's
 * composer (which seeds the example query once, then clears the seed flag so
 * user edits aren't overwritten).
 */

import { useCallback, useMemo } from 'react';

import { useSearchParams } from 'react-router-dom';

import {
  useInstalledPlugins,
  type InstalledPlugin,
} from '@/shared/hooks/usePlugins';
import {
  USE_PLUGIN_PARAM,
  USE_PLUGIN_SEED_PARAM,
} from '@/shared/plugins/use-plugin';

export interface ActivePlugin {
  plugin: InstalledPlugin;
  /** Display name for the chip. */
  name: string;
  /** Example prompt to seed, when present. */
  exampleQuery?: string;
  /** True when the caller navigated via "Use" (seed the example query). */
  seed: boolean;
}

export interface UseActivePluginResult {
  active: ActivePlugin | null;
  /** Remove the plugin entirely (clears both params). */
  dismiss: () => void;
  /** Consume the seed flag after seeding, keeping the plugin attached. */
  clearSeed: () => void;
}

export function useActivePlugin(): UseActivePluginResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const { plugins } = useInstalledPlugins();

  const pluginId = searchParams.get(USE_PLUGIN_PARAM);
  const seed = searchParams.get(USE_PLUGIN_SEED_PARAM) === '1';

  const active = useMemo<ActivePlugin | null>(() => {
    if (!pluginId) return null;
    const plugin = plugins.find((p) => p.id === pluginId);
    if (!plugin) return null;
    return {
      plugin,
      name: plugin.manifest?.displayName || plugin.name,
      exampleQuery: plugin.manifest?.metadata?.neuma?.exampleQuery,
      seed,
    };
  }, [plugins, pluginId, seed]);

  const dismiss = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(USE_PLUGIN_PARAM);
        next.delete(USE_PLUGIN_SEED_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const clearSeed = useCallback(() => {
    setSearchParams(
      (prev) => {
        if (!prev.has(USE_PLUGIN_SEED_PARAM)) return prev;
        const next = new URLSearchParams(prev);
        next.delete(USE_PLUGIN_SEED_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return { active, dismiss, clearSeed };
}
