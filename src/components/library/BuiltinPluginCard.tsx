/**
 * BuiltinPluginCard — a repo-shipped plugin tile. Design-system plugins get a
 * live preview thumbnail (Open Design parity); every card shows its tags and,
 * for design/video plugins, a "Use" action that opens the plugin's surface —
 * alongside the enable/disable toggle and a Details link.
 */

import { Package } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { InstalledPlugin } from '@/shared/hooks/usePlugins';
import { useLanguage } from '@/shared/providers/language-provider';

import { PluginPreview } from './PluginPreview';

/** Tags to hide — they duplicate the category axis already shown as chips. */
const CATEGORY_TAGS = new Set([
  'design-system',
  'design-skill',
  'video-template',
]);

export function BuiltinPluginCard({
  plugin,
  canUse,
  onToggle,
  onUse,
  onSelect,
}: {
  plugin: InstalledPlugin;
  /** True when the plugin targets a design/video surface (offer "Use"). */
  canUse: boolean;
  onToggle: () => void;
  onUse: () => void;
  onSelect: () => void;
}) {
  const { t } = useLanguage();
  const neuma = plugin.manifest?.metadata?.neuma;
  const isDesignSystem = !!neuma?.designManifest;
  const title = plugin.manifest?.displayName || plugin.name;
  const tags = (plugin.manifest?.keywords ?? [])
    .filter((k) => !CATEGORY_TAGS.has(k))
    .slice(0, 4);

  return (
    <div className="border-border bg-card hover:border-foreground/20 flex h-full flex-col overflow-hidden rounded-lg border transition-colors">
      {isDesignSystem ? (
        <button
          type="button"
          onClick={onSelect}
          className="block w-full"
          aria-label={title}
        >
          <PluginPreview pluginId={plugin.id} />
        </button>
      ) : null}

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          {isDesignSystem ? null : (
            <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
              <Package className="size-4" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onSelect}
              className="hover:text-foreground/80 block w-full truncate text-left text-sm font-medium"
              title={title}
            >
              {title}
            </button>
            <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
              <span className="font-mono">v{plugin.version}</span>
              {plugin.enabled === false ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{t.plugins.card.disabledBadge}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onSelect}
          className="text-muted-foreground line-clamp-2 text-left text-xs"
        >
          {plugin.manifest?.description ?? plugin.name}
        </button>

        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-auto flex items-center gap-2 pt-1">
          {canUse ? (
            <Button size="sm" onClick={onUse}>
              {t.plugins.actions.use}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={onToggle}>
            {plugin.enabled
              ? t.plugins.actions.disable
              : t.plugins.actions.enable}
          </Button>
          <Button size="sm" variant="ghost" onClick={onSelect}>
            {t.plugins.actions.details}
          </Button>
        </div>
      </div>
    </div>
  );
}
