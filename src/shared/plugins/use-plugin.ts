/**
 * Shared helpers for the marketplace "Use" action — routing an installed
 * plugin to the surface it targets and pre-attaching it on arrival.
 *
 * The "Use" button navigates to the plugin's home surface with the plugin id
 * in the `?plugin=` query param; the destination reads it, shows a dismissable
 * chip, and pins the plugin's skills into the next run.
 */

/** Query-string key carrying the pre-attached plugin id across navigation. */
export const USE_PLUGIN_PARAM = 'plugin';

/**
 * Query-string flag: when `1`, the destination seeds the plugin's example
 * query into the composer ("Use"). Absent means attach only ("Use without
 * prompt").
 */
export const USE_PLUGIN_SEED_PARAM = 'seed';

/**
 * Map a plugin's declared Neuma surfaces to the route its home lives at.
 * Video plugins open Video Mode, design plugins open Design Mode; everything
 * else lands in the main chat.
 */
export function surfaceRoute(
  surfaces: readonly string[] | null | undefined,
): string {
  if (surfaces?.includes('video')) return '/video';
  if (surfaces?.includes('design')) return '/design';
  return '/';
}

/**
 * Build the route a "Use" action navigates to: the plugin's surface with the
 * plugin id pre-attached, optionally flagged to seed its example query.
 */
export function buildPluginUseHref(
  surfaces: readonly string[] | null | undefined,
  pluginId: string,
  opts?: { seed?: boolean },
): string {
  const params = new URLSearchParams();
  params.set(USE_PLUGIN_PARAM, pluginId);
  if (opts?.seed) params.set(USE_PLUGIN_SEED_PARAM, '1');
  return `${surfaceRoute(surfaces)}?${params.toString()}`;
}
