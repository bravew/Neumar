/**
 * InstalledPluginsTab — user-installed plugins (enable/disable + uninstall)
 * and a searchable, category-filtered "Built-in" section for repo-shipped
 * plugins. Enable/disable is optimistic: the card updates in place with no
 * refetch, so the list never reloads.
 */

import { useCallback, useMemo, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import {
  useInstalledPlugins,
  usePluginActions,
  type InstalledPlugin,
} from '@/shared/hooks/usePlugins';
import { buildPluginUseHref } from '@/shared/plugins/use-plugin';
import { useLanguage } from '@/shared/providers/language-provider';

import { BuiltinPluginsSection } from './BuiltinPluginsSection';
import { InstalledPluginDetailDialog } from './InstalledPluginDetailDialog';
import { PluginCard } from './PluginCard';

export function InstalledPluginsTab() {
  const { t } = useLanguage();
  const { plugins, loading, error, refresh, applyPluginUpdate, removePlugin } =
    useInstalledPlugins();
  const {
    enablePlugin,
    disablePlugin,
    uninstallPlugin,
    error: actionError,
  } = usePluginActions();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<InstalledPlugin | null>(null);

  const { installed, builtin } = useMemo(() => {
    const installedList: InstalledPlugin[] = [];
    const builtinList: InstalledPlugin[] = [];
    for (const plugin of plugins) {
      (plugin.scope === 'bundled' ? builtinList : installedList).push(plugin);
    }
    return { installed: installedList, builtin: builtinList };
  }, [plugins]);

  // Optimistic toggle: flip the card immediately, reconcile with the server
  // response, and revert on failure. No full-list refetch — no page flicker.
  const handleToggle = async (plugin: InstalledPlugin) => {
    const optimistic = { ...plugin, enabled: !plugin.enabled };
    applyPluginUpdate(optimistic);
    if (selected?.id === plugin.id) setSelected(optimistic);
    try {
      const updated = plugin.enabled
        ? await disablePlugin(plugin.id)
        : await enablePlugin(plugin.id);
      applyPluginUpdate(updated);
      if (selected?.id === plugin.id) setSelected(updated);
    } catch {
      applyPluginUpdate(plugin);
      if (selected?.id === plugin.id) setSelected(plugin);
    }
  };

  // "Use" a design/video plugin: ensure it's enabled, close Settings, and
  // route to its surface with the plugin pre-attached (seeding its example
  // query when it has one). Mirrors the marketplace "Use".
  const handleUse = useCallback(
    async (plugin: InstalledPlugin) => {
      const neuma = plugin.manifest?.metadata?.neuma;
      if (!plugin.enabled) {
        try {
          applyPluginUpdate(await enablePlugin(plugin.id));
        } catch {
          // Enable failure surfaces via actionError; still route.
        }
      }
      window.dispatchEvent(new CustomEvent('close-settings'));
      navigate(
        buildPluginUseHref(neuma?.surfaces, plugin.id, {
          seed: !!neuma?.exampleQuery,
        }),
      );
    },
    [applyPluginUpdate, enablePlugin, navigate],
  );

  const handleUninstall = async (plugin: InstalledPlugin) => {
    try {
      await uninstallPlugin(plugin.id);
      removePlugin(plugin.id);
      if (selected?.id === plugin.id) setSelected(null);
    } catch {
      refresh();
    }
  };

  if (loading) {
    return <p className="text-muted-foreground py-12 text-center text-sm">…</p>;
  }
  if (error) {
    return (
      <p className="text-destructive py-6 text-center text-sm" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {actionError ? (
        <p className="text-destructive text-xs" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">
            {t.plugins.sections.installed}
          </h3>
          <span className="text-muted-foreground text-xs">
            {installed.length}
          </span>
        </div>
        {installed.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {t.plugins.empty.installed}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {installed.map((plugin) => (
              <PluginCard
                key={plugin.id}
                variant="installed"
                item={{
                  id: plugin.id,
                  name: plugin.name,
                  displayName: plugin.manifest?.displayName,
                  version: plugin.version,
                  description: plugin.manifest?.description ?? plugin.name,
                  scope: plugin.scope,
                  signatureOk: plugin.signatureOk,
                  enabled: plugin.enabled,
                }}
                primaryActionLabel={
                  plugin.enabled
                    ? t.plugins.actions.disable
                    : t.plugins.actions.enable
                }
                secondaryActionLabel={t.plugins.actions.uninstall}
                onPrimaryAction={() => handleToggle(plugin)}
                onSecondaryAction={() => handleUninstall(plugin)}
                onSelect={() => setSelected(plugin)}
              />
            ))}
          </div>
        )}
      </section>

      {builtin.length > 0 ? (
        <BuiltinPluginsSection
          plugins={builtin}
          onToggle={handleToggle}
          onUse={handleUse}
          onSelect={setSelected}
        />
      ) : null}

      <InstalledPluginDetailDialog
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        plugin={selected}
        onEnableToggle={() => selected && handleToggle(selected)}
        onUse={selected ? () => handleUse(selected) : undefined}
        onUninstall={
          selected && selected.scope !== 'bundled'
            ? () => selected && handleUninstall(selected)
            : undefined
        }
      />
    </div>
  );
}
