import type { LoadedPlugin, PluginManifest } from '@/shared/plugins';

export const PLUGIN_SURFACES = ['task', 'design', 'video', 'chat'] as const;

export type PluginSurface = (typeof PLUGIN_SURFACES)[number];
export type DomainManifestPointer =
  | 'videoManifest'
  | 'designManifest'
  | 'taskManifest';

export function getPluginSurfaces(
  pluginOrManifest: LoadedPlugin | PluginManifest,
): PluginSurface[] {
  const manifest =
    'manifest' in pluginOrManifest
      ? pluginOrManifest.manifest
      : pluginOrManifest;
  const surfaces = manifest.metadata?.neuma?.surfaces ?? [];
  return surfaces.filter((surface): surface is PluginSurface =>
    PLUGIN_SURFACES.includes(surface as PluginSurface),
  );
}

export function pluginTargetsSurface(
  pluginOrManifest: LoadedPlugin | PluginManifest,
  surface: PluginSurface,
): boolean {
  return getPluginSurfaces(pluginOrManifest).includes(surface);
}

export function filterPluginsBySurface(
  plugins: readonly LoadedPlugin[],
  surface: PluginSurface,
): LoadedPlugin[] {
  return plugins.filter((plugin) => pluginTargetsSurface(plugin, surface));
}

export function getDomainManifestPointer(
  pluginOrManifest: LoadedPlugin | PluginManifest,
  pointer: DomainManifestPointer,
): string | undefined {
  const manifest =
    'manifest' in pluginOrManifest
      ? pluginOrManifest.manifest
      : pluginOrManifest;
  return manifest.metadata?.neuma?.[pointer];
}
