/**
 * launchDesignPlugin — start a new design project seeded with a plugin's
 * example query and open it, so the marketplace "Use" action lands the user in
 * a working design project rather than the design gallery.
 *
 * Design-system plugins additionally apply their design system (resolved from
 * the bundled `design-system-<id>` naming) so the project starts styled.
 */

import type { ActivePlugin } from '@/shared/hooks/useActivePlugin';
import { createDesignProject } from '@/shared/hooks/useDesignMode';
import { launchPrompt } from '@/shared/hooks/usePluginLaunch';
import type { DesignProject } from '@/shared/types/design-mode';

/** Resolve a design-system id from a design-system plugin, when derivable. */
export function designSystemIdForPlugin(active: ActivePlugin): string | null {
  const neuma = active.plugin.manifest?.metadata?.neuma;
  if (!neuma?.designManifest) return null;
  const match = /^design-system-(.+)$/.exec(active.plugin.name);
  return match ? match[1] : null;
}

export interface LaunchDesignDeps {
  /** Open the created project (adds it to the list and navigates into it). */
  onOpen: (project: DesignProject) => void;
  locale: string;
  onError?: (message: string) => void;
}

export async function launchDesignPlugin(
  active: ActivePlugin,
  deps: LaunchDesignDeps,
): Promise<void> {
  const designSystemId = designSystemIdForPlugin(active);
  try {
    const { project } = await createDesignProject({
      title: active.name,
      surface: 'prototype',
      ...(designSystemId ? { designSystemId } : {}),
      brief: {
        prompt: launchPrompt(active),
        createdFromPlugin: true,
        pluginId: active.plugin.id,
        locale: deps.locale,
        chatLocale: deps.locale,
      },
    });
    deps.onOpen(project);
  } catch (err) {
    deps.onError?.(err instanceof Error ? err.message : String(err));
  }
}
