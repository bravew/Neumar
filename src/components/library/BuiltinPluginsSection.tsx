/**
 * BuiltinPluginsSection — repo-shipped plugins grouped under "Built-in" with a
 * category filter and search. Enabled and disabled plugins stay together (a
 * disabled card shows an "Off" marker in place); toggling is optimistic so the
 * list never reloads.
 */

import { useMemo, useState } from 'react';

import { Search } from 'lucide-react';

import { type InstalledPlugin } from '@/shared/hooks/usePlugins';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { BuiltinPluginCard } from './BuiltinPluginCard';
import { VirtualCardGrid } from './VirtualCardGrid';

/** A built-in plugin can be "used" when it targets a design/video surface. */
function pluginCanUse(plugin: InstalledPlugin): boolean {
  const surfaces = plugin.manifest?.metadata?.neuma?.surfaces ?? [];
  return surfaces.includes('design') || surfaces.includes('video');
}

/** Derive a built-in plugin's category from its install path under builtin/. */
export function builtinCategory(plugin: InstalledPlugin): string {
  const match = /[/\\]builtin[/\\]([^/\\]+)[/\\]/.exec(plugin.installPath);
  return match ? match[1] : 'other';
}

export function BuiltinPluginsSection({
  plugins,
  onToggle,
  onUse,
  onSelect,
}: {
  plugins: InstalledPlugin[];
  onToggle: (plugin: InstalledPlugin) => void;
  onUse: (plugin: InstalledPlugin) => void;
  onSelect: (plugin: InstalledPlugin) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const categoryLabel = (key: string): string => {
    const map: Record<string, string> = {
      'video-templates': t.plugins.categories.videoTemplates,
      'design-systems': t.plugins.categories.designSystems,
      'design-skills': t.plugins.categories.designSkills,
    };
    return map[key] ?? key;
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const plugin of plugins) set.add(builtinCategory(plugin));
    return [...set].sort();
  }, [plugins]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (
      plugins
        .filter((plugin) => {
          if (category !== 'all' && builtinCategory(plugin) !== category) {
            return false;
          }
          if (!q) return true;
          return (
            plugin.name.toLowerCase().includes(q) ||
            (plugin.manifest?.description ?? '').toLowerCase().includes(q)
          );
        })
        // Keep a stable order so enabled/disabled stay interleaved in place.
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  }, [plugins, category, query]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">{t.plugins.sections.builtin}</h3>
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-medium">
          {t.plugins.status.builtin}
        </span>
        <span className="text-muted-foreground text-xs">{plugins.length}</span>
      </div>

      <label className="border-border focus-within:border-foreground/30 flex items-center gap-2 rounded-md border px-3 py-2">
        <Search className="text-muted-foreground size-4" />
        <input
          type="text"
          data-testid="builtin-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.plugins.categories.searchPlaceholder}
          className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <CategoryChip
          active={category === 'all'}
          label={t.plugins.categories.all}
          onClick={() => setCategory('all')}
        />
        {categories.map((key) => (
          <CategoryChip
            key={key}
            active={category === key}
            label={categoryLabel(key)}
            onClick={() => setCategory(key)}
          />
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {t.plugins.empty.marketplace}
        </p>
      ) : (
        <VirtualCardGrid
          items={filtered}
          getKey={(plugin) => plugin.id}
          renderItem={(plugin) => (
            <BuiltinPluginCard
              plugin={plugin}
              canUse={pluginCanUse(plugin)}
              onToggle={() => onToggle(plugin)}
              onUse={() => onUse(plugin)}
              onSelect={() => onSelect(plugin)}
            />
          )}
        />
      )}
    </section>
  );
}

function CategoryChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-sm transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}
