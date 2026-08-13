/**
 * MarketplaceAvailableView — searchable grid of catalog entries merged from
 * every configured marketplace source, each tagged with its source trust and a
 * pre-install capability summary. Install stamps marketplace provenance.
 */

import { useCallback, useMemo, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { Search } from 'lucide-react';

import {
  useAvailablePlugins,
  type AvailablePluginEntry,
} from '@/shared/hooks/useMarketplaceSources';
import {
  useInstalledPlugins,
  usePluginActions,
  type InstalledPlugin,
} from '@/shared/hooks/usePlugins';
import { buildPluginUseHref } from '@/shared/plugins/use-plugin';
import { useLanguage } from '@/shared/providers/language-provider';

import { AvailablePluginCard } from './AvailablePluginCard';
import { AvailablePluginDetailDialog } from './AvailablePluginDetailDialog';
import { FacetPills } from './FacetPills';
import {
  entryKey,
  entryTags,
  entryType,
  facetCounts,
  multiFacetCounts,
  sourceLabel,
  titleCase,
} from './marketplace-facets';
import { PluginInstallDialog } from './PluginInstallDialog';
import { VirtualCardGrid } from './VirtualCardGrid';

export function MarketplaceAvailableView() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { entries, loading, error, refresh } = useAvailablePlugins();
  const { plugins: installedPlugins, refresh: refreshInstalled } =
    useInstalledPlugins();
  const {
    installPlugin,
    enablePlugin,
    pending: installPending,
    error: installError,
  } = usePluginActions();

  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [candidate, setCandidate] = useState<AvailablePluginEntry | null>(null);
  const [selected, setSelected] = useState<AvailablePluginEntry | null>(null);

  const sourceLabelFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) map.set(entry.sourceId, entry.sourceName);
    return (id: string) => map.get(id) ?? id;
  }, [entries]);

  // Match catalog entries to installed plugins so already-installed entries
  // offer "Use" instead of "Install". Prefer the recorded marketplace
  // provenance (source + entry name); fall back to a plain name match for
  // bundled/built-in plugins that also appear in a catalog.
  const installedFor = useMemo(() => {
    const byProvenance = new Map<string, InstalledPlugin>();
    const byName = new Map<string, InstalledPlugin>();
    for (const plugin of installedPlugins) {
      if (plugin.sourceMarketplaceId && plugin.sourceEntryName) {
        byProvenance.set(
          `${plugin.sourceMarketplaceId}/${plugin.sourceEntryName}`,
          plugin,
        );
      }
      if (!byName.has(plugin.name)) byName.set(plugin.name, plugin);
    }
    return (entry: AvailablePluginEntry): InstalledPlugin | undefined =>
      byProvenance.get(`${entry.sourceId}/${entry.entry.name}`) ??
      byName.get(entry.entry.name);
  }, [installedPlugins]);

  const handleUse = useCallback(
    async (entry: AvailablePluginEntry, opts?: { seed?: boolean }) => {
      const plugin = installedFor(entry);
      if (!plugin) return;
      const surfaces =
        entry.entry.metadata?.neuma?.surfaces ??
        plugin.manifest?.metadata?.neuma?.surfaces;
      // "Use" seeds the example query; only offer it when one exists.
      const seed =
        (opts?.seed ?? true) &&
        !!plugin.manifest?.metadata?.neuma?.exampleQuery;
      // An enabled plugin's skills reach the agent globally, so "Use" only
      // needs to guarantee the plugin is enabled before routing to it.
      if (!plugin.enabled) {
        try {
          await enablePlugin(plugin.id);
        } catch {
          // Enable failure is surfaced via installError; still route so the
          // user lands where they expect.
        }
      }
      // Close the Settings modal if the marketplace is embedded in it, then
      // route to the plugin's surface with it pre-attached.
      window.dispatchEvent(new CustomEvent('close-settings'));
      navigate(buildPluginUseHref(surfaces, plugin.id, { seed }));
    },
    [installedFor, enablePlugin, navigate],
  );

  // Predicates for disjunctive faceting: each facet's counts reflect the other
  // active facets and the search query, but not itself.
  const matchers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return {
      query: (e: AvailablePluginEntry) =>
        !q ||
        e.entry.name.toLowerCase().includes(q) ||
        e.entry.description.toLowerCase().includes(q),
      source: (e: AvailablePluginEntry) =>
        sources.size === 0 || sources.has(e.sourceId),
      type: (e: AvailablePluginEntry) =>
        types.size === 0 || types.has(entryType(e)),
      tag: (e: AvailablePluginEntry) =>
        tags.size === 0 || entryTags(e).some((tag) => tags.has(tag)),
    };
  }, [query, sources, types, tags]);

  const sourceFacets = useMemo(
    () =>
      facetCounts(
        entries.filter(
          (e) => matchers.query(e) && matchers.type(e) && matchers.tag(e),
        ),
        (e) => e.sourceId,
        sourceLabelFor,
      ),
    [entries, matchers, sourceLabelFor],
  );

  const typeFacets = useMemo(
    () =>
      facetCounts(
        entries.filter(
          (e) => matchers.query(e) && matchers.source(e) && matchers.tag(e),
        ),
        entryType,
        titleCase,
      ),
    [entries, matchers],
  );

  const tagFacets = useMemo(
    () =>
      multiFacetCounts(
        entries.filter(
          (e) => matchers.query(e) && matchers.source(e) && matchers.type(e),
        ),
        entryTags,
        titleCase,
      ),
    [entries, matchers],
  );

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          matchers.query(e) &&
          matchers.source(e) &&
          matchers.type(e) &&
          matchers.tag(e),
      ),
    [entries, matchers],
  );

  const toggle = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const handleConfirmInstall = async () => {
    if (!candidate) return;
    try {
      await installPlugin({
        source: 'marketplace',
        marketplaceSourceId: candidate.sourceId,
        entryName: candidate.entry.name,
        scope: 'user',
      });
      setCandidate(null);
      refresh();
      // Refresh the installed list too so the entry flips to "Use" immediately.
      refreshInstalled();
    } catch {
      // surfaced via installError
    }
  };

  const candidateManifest = candidate
    ? {
        name: candidate.entry.name,
        version: candidate.entry.version ?? '0.0.0',
        description: candidate.entry.description,
        displayName: candidate.entry.displayName,
      }
    : null;

  return (
    <div className="flex flex-col gap-4">
      <label className="border-border focus-within:border-foreground/30 flex items-center gap-2 rounded-md border px-3 py-2">
        <Search className="text-muted-foreground size-4" />
        <input
          type="text"
          data-testid="marketplace-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.plugins.search.placeholder}
          className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
        />
      </label>

      {!loading && !error && entries.length > 0 ? (
        <div className="flex flex-col gap-2">
          <FacetPills
            label={t.plugins.filters.source}
            values={sourceFacets}
            selected={sources}
            onToggle={(v) => setSources((s) => toggle(s, v))}
            onClear={() => setSources(new Set())}
          />
          <FacetPills
            label={t.plugins.filters.type}
            values={typeFacets}
            selected={types}
            onToggle={(v) => setTypes((s) => toggle(s, v))}
            onClear={() => setTypes(new Set())}
          />
          {tagFacets.length > 0 ? (
            <FacetPills
              label={t.plugins.filters.tags}
              values={tagFacets}
              selected={tags}
              onToggle={(v) => setTags((s) => toggle(s, v))}
              onClear={() => setTags(new Set())}
            />
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <p className="text-muted-foreground py-12 text-center text-sm">…</p>
      ) : error ? (
        <p className="text-destructive py-6 text-center text-sm" role="alert">
          {error}
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          {t.plugins.empty.marketplace}
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            {t.plugins.filters.results.replace('{n}', String(filtered.length))}
          </p>
          <VirtualCardGrid
            items={filtered}
            getKey={entryKey}
            renderItem={(entry) => (
              <AvailablePluginCard
                entry={entry}
                pending={installPending}
                installed={!!installedFor(entry)}
                canSeed={
                  !!installedFor(entry)?.manifest?.metadata?.neuma?.exampleQuery
                }
                onInstall={() => setCandidate(entry)}
                onUse={() => handleUse(entry, { seed: true })}
                onUseWithoutPrompt={() => handleUse(entry, { seed: false })}
                onSelect={() => setSelected(entry)}
              />
            )}
          />
        </>
      )}

      <AvailablePluginDetailDialog
        entry={selected}
        installedPlugin={selected ? installedFor(selected) : undefined}
        open={!!selected}
        pending={installPending}
        onOpenChange={(o) => !o && setSelected(null)}
        onInstall={() => {
          if (selected) {
            setCandidate(selected);
            setSelected(null);
          }
        }}
        onUse={() => {
          if (selected) {
            handleUse(selected, { seed: true });
            setSelected(null);
          }
        }}
        onUseWithoutPrompt={() => {
          if (selected) {
            handleUse(selected, { seed: false });
            setSelected(null);
          }
        }}
      />

      <PluginInstallDialog
        open={!!candidate}
        source={{
          kind: 'url',
          ref: candidate ? sourceLabel(candidate) : '',
        }}
        manifest={candidateManifest}
        pending={installPending}
        errorMessage={installError}
        onCancel={() => setCandidate(null)}
        onConfirm={handleConfirmInstall}
      />
    </div>
  );
}
