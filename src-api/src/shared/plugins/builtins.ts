/**
 * Built-in plugin reconciliation.
 *
 * Repo-shipped plugins under `plugins/builtin/` load as `scope: 'bundled'` but
 * aren't in `installed_plugins`, so they can't be shown or toggled. This
 * reconciles them into the table (insert-if-absent, preserving a user's
 * disable) so the Plugins tab can list them as "Built-in" with an enable/
 * disable switch. Enforcement lives in each surface loader, which skips any
 * plugin whose name is in `getDisabledPluginNames()`.
 */

import {
  reconcileBundledPlugins,
  type BundledPluginSeed,
} from '@/shared/db/plugins';
import { createLogger } from '@/shared/utils/logger';

import { loadPluginsFromRoot } from './loader';
import { resolveBuiltinPluginRoot } from './paths';

const logger = createLogger('BuiltinPlugins');

/** Stable install-record id for a bundled plugin. */
export function bundledPluginId(name: string): string {
  return `bundled/${name}`;
}

/**
 * Discover the repo-shipped builtin plugins and reconcile them into
 * `installed_plugins`. Idempotent; safe to call on every boot.
 */
export async function reconcileBuiltinPlugins(): Promise<void> {
  const plugins = await loadPluginsFromRoot(
    resolveBuiltinPluginRoot(),
    'bundled',
  );
  const seeds: BundledPluginSeed[] = plugins.map((plugin) => ({
    id: bundledPluginId(plugin.manifest.name),
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    installPath: plugin.path,
    manifest: plugin.manifest,
  }));
  const inserted = reconcileBundledPlugins(seeds);
  logger.info(
    `Reconciled ${seeds.length} builtin plugins (${inserted} newly registered)`,
  );
}
