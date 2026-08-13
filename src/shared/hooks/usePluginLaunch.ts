/**
 * usePluginLaunch — when a surface is opened via the marketplace "Use" action
 * (`?plugin=<id>`), start a working session for that plugin exactly once.
 *
 * Design and Video mode entries are galleries, not composers, so landing there
 * with only a chip is a dead end. This hook fires the provided launcher (which
 * creates + opens a project seeded with the plugin's example query) the first
 * time an active plugin appears, guarding against re-fires per plugin id.
 */

import { useEffect, useRef } from 'react';

import {
  useActivePlugin,
  type ActivePlugin,
} from '@/shared/hooks/useActivePlugin';

export function usePluginLaunch(
  launch: (active: ActivePlugin) => void | Promise<void>,
  enabled = true,
): void {
  const { active } = useActivePlugin();
  const startedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !active) return;
    if (startedRef.current === active.plugin.id) return;
    startedRef.current = active.plugin.id;
    void launch(active);
  }, [enabled, active, launch]);
}

/** The prompt to seed a launched session with, falling back sensibly. */
export function launchPrompt(active: ActivePlugin): string {
  return (
    active.exampleQuery || active.plugin.manifest?.description || active.name
  );
}
