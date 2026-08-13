/**
 * Pure faceting helpers for the marketplace Available view — entry keys, the
 * normalized type facet, tag extraction, and disjunctive count builders for
 * single- and multi-valued facets.
 */

import type { AvailablePluginEntry } from '@/shared/hooks/useMarketplaceSources';

import type { FacetValue } from './FacetPills';

export function entryKey(entry: AvailablePluginEntry): string {
  return `${entry.sourceId}/${entry.entry.name}`;
}

/**
 * Normalized type facet for an entry. Catalogs vary: Anthropic entries carry a
 * `category`, Open Design entries carry a Neuma `surface` — fall back through
 * the available signals to one comparable value.
 */
export function entryType(entry: AvailablePluginEntry): string {
  const category = entry.entry.category;
  if (category) return category;
  const surfaces = entry.entry.metadata?.neuma?.surfaces;
  if (surfaces && surfaces.length > 0) return surfaces[0]!;
  return 'other';
}

/** All tags for an entry (tags ∪ keywords), de-duped and lower-cased. */
export function entryTags(entry: AvailablePluginEntry): string[] {
  const raw = [...(entry.entry.tags ?? []), ...(entry.entry.keywords ?? [])];
  return [...new Set(raw.map((t) => t.toLowerCase()))];
}

export function titleCase(value: string): string {
  return value.replace(/(^|[-_\s])(\w)/g, (_, sep, ch) =>
    sep ? ` ${ch.toUpperCase()}` : ch.toUpperCase(),
  );
}

/** Short human label for the install dialog's "from …" line. */
export function sourceLabel(entry: AvailablePluginEntry): string {
  const source = entry.entry.source;
  if (typeof source === 'string') return source;
  if (source && typeof source === 'object') {
    const record = source as Record<string, unknown>;
    return (
      (record.url as string) ||
      (record.repo as string) ||
      (record.source as string) ||
      entry.sourceName
    );
  }
  return entry.sourceName;
}

/** Count a single-valued facet over the given entries, sorted by count desc. */
export function facetCounts(
  entries: AvailablePluginEntry[],
  keyOf: (entry: AvailablePluginEntry) => string,
  labelOf: (key: string) => string,
): FacetValue[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = keyOf(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return toSortedFacets(counts, labelOf);
}

/** Count a multi-valued facet (each entry contributes several keys). */
export function multiFacetCounts(
  entries: AvailablePluginEntry[],
  keysOf: (entry: AvailablePluginEntry) => string[],
  labelOf: (key: string) => string,
  limit = 30,
): FacetValue[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const key of keysOf(entry)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return toSortedFacets(counts, labelOf).slice(0, limit);
}

function toSortedFacets(
  counts: Map<string, number>,
  labelOf: (key: string) => string,
): FacetValue[] {
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: labelOf(value), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
