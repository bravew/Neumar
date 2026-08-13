import {
  buildVividOverlayRenderEntries as buildEntriesWithResolver,
  vividOverlayControlDefaults,
  vividOverlayControlErrors,
  type VividOverlayParams,
  type VividOverlayRenderEntry,
} from '@neumar/video-ir';

import type { VideoTimeline } from '@/shared/video/types';

import { findPluginOverlayPreset } from './plugin-presets';
import { resolveVividOverlay, type ResolvedVividOverlay } from './registry';

// SERVER-ONLY overlay resolution: built-in catalog first, then trusted
// plugin preset packs. Kept out of registry.ts/render-entries.ts on purpose —
// those bundle into the headless Remotion composition, which must stay free
// of node-side imports (logger, plugin runtime). Plugin presets reference
// built-in documents only, so the bundled composition renders their entries
// without ever consulting the plugin store.

export function resolveVividOverlayWithPlugins(
  params: VividOverlayParams,
): ResolvedVividOverlay | null {
  const builtIn = resolveVividOverlay(params);
  if (builtIn) return builtIn;
  const preset = findPluginOverlayPreset(params.presetId);
  if (!preset || preset.backend !== params.backend) return null;
  return {
    preset,
    controls: {
      ...vividOverlayControlDefaults(preset.controls),
      ...params.controls,
    },
    errors: vividOverlayControlErrors(params.controls, preset.controls),
  };
}

export function buildVividOverlayRenderEntriesWithPlugins(
  timeline: VideoTimeline | undefined,
  fps: number,
): VividOverlayRenderEntry[] {
  return buildEntriesWithResolver(
    timeline,
    fps,
    resolveVividOverlayWithPlugins,
  );
}
