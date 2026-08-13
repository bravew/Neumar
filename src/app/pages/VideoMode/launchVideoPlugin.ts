/**
 * launchVideoPlugin — start a new video project seeded with a plugin's example
 * query and open it, so the marketplace "Use" action lands the user in a
 * working project rather than the video gallery.
 */

import type { ActivePlugin } from '@/shared/hooks/useActivePlugin';
import { launchPrompt } from '@/shared/hooks/usePluginLaunch';
import { createVideoProject } from '@/shared/hooks/useVideoProject';

export interface LaunchVideoDeps {
  navigate: (to: string) => void;
  defaultProjectName: string;
  onError: (message: string) => void;
}

export async function launchVideoPlugin(
  active: ActivePlugin,
  deps: LaunchVideoDeps,
): Promise<void> {
  try {
    const { project } = await createVideoProject({
      name: deps.defaultProjectName,
      template: 'slideshow',
      aspectRatio: '16:9',
      prompt: launchPrompt(active),
    });
    deps.navigate(`/video/${project.id}`);
  } catch (err) {
    deps.onError(err instanceof Error ? err.message : String(err));
  }
}
