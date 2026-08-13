/**
 * Marketplace sources — a source is a catalog URL plus a USER-ASSIGNED trust
 * level (dev-doc/plan/07-04-plugin-system checkpoint 4, mirroring the
 * Open Design "Sources" model).
 *
 * Trust rules:
 *   - `trust` is set by the user when adding the source and stored on the row.
 *   - Trust fields inside a fetched catalog document are hints, never
 *     authority — they are ignored entirely.
 *   - Installs from a source stamp the source's trust into the install record
 *     (`marketplace_trust`) as provenance.
 */

import {
  deleteMarketplaceSource,
  getMarketplaceSource,
  getMarketplaceSourceByUrl,
  insertMarketplaceSource,
  listMarketplaceSources,
  updateMarketplaceSourceRefresh,
  type MarketplaceSource,
  type MarketplaceSourceTrust,
} from '@/shared/db/marketplace-sources';
import { validateBaseUrl } from '@/shared/utils/url-validator';

import {
  fetchRegistryByUrl,
  invalidateRegistryCache,
  type RegistryFetchResult,
} from './marketplace';
import type { MarketplacePlugin } from './marketplace-schema';

export type { MarketplaceSource, MarketplaceSourceTrust };

export class MarketplaceSourceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502 = 400,
  ) {
    super(message);
    this.name = 'MarketplaceSourceError';
  }
}

/** A catalog entry decorated with the source it came from. */
export interface AvailablePluginEntry {
  sourceId: string;
  sourceName: string;
  sourceTrust: MarketplaceSourceTrust;
  /** The catalog document URL this entry was read from. */
  sourceUrl: string;
  entry: MarketplacePlugin;
}

export interface MarketplaceSourceStatus extends MarketplaceSource {
  fetchError?: string;
  fromCache?: boolean;
}

const SOURCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'source'
  );
}

function uniqueSourceId(base: string): string {
  const root = SOURCE_ID_RE.test(base) ? base : slugify(base);
  if (!getMarketplaceSource(root)) return root;
  for (let n = 2; n < 100; n++) {
    const candidate = `${root}-${n}`.slice(0, 64);
    if (!getMarketplaceSource(candidate)) return candidate;
  }
  throw new MarketplaceSourceError('could not allocate a unique source id');
}

export interface AddMarketplaceSourceInput {
  url: string;
  trust: MarketplaceSourceTrust;
  name?: string;
}

/**
 * Validate, fetch, and persist a new catalog source. The URL must pass the
 * SSRF policy (https, or http on localhost only; no private ranges or
 * metadata hosts) and must serve a parseable `marketplace.json`.
 */
export async function addMarketplaceSource(
  input: AddMarketplaceSourceInput,
): Promise<MarketplaceSourceStatus> {
  const validation = validateBaseUrl(input.url);
  if (!validation.valid) {
    throw new MarketplaceSourceError(
      `URL rejected: ${validation.reason ?? 'invalid'}`,
    );
  }
  // validateBaseUrl permits plain http to public hosts; catalog sources are
  // stricter — https only, except loopback for local development.
  const parsed = new URL(input.url);
  const loopback =
    parsed.hostname === 'localhost' ||
    /^127\.\d+\.\d+\.\d+$/.test(parsed.hostname);
  if (parsed.protocol !== 'https:' && !loopback) {
    throw new MarketplaceSourceError(
      'URL rejected: catalog sources must use https (http is allowed for localhost only)',
    );
  }
  if (getMarketplaceSourceByUrl(input.url)) {
    throw new MarketplaceSourceError('source URL already added', 409);
  }

  const result = await fetchRegistryByUrl(input.url);
  if (!result.index) {
    throw new MarketplaceSourceError(
      `catalog fetch failed: ${result.error ?? 'unknown error'}`,
      502,
    );
  }

  const name = input.name?.trim() || result.index.name;
  const source = insertMarketplaceSource({
    id: uniqueSourceId(name),
    name,
    url: input.url,
    // User-assigned only — result.index metadata is never consulted for trust.
    trust: input.trust,
    catalogVersion: catalogVersionOf(result),
    pluginCount: result.index.plugins.length,
    lastRefreshedAt: new Date().toISOString(),
  });
  return { ...source, fromCache: result.fromCache };
}

export async function refreshMarketplaceSource(
  id: string,
): Promise<MarketplaceSourceStatus> {
  const source = getMarketplaceSource(id);
  if (!source) throw new MarketplaceSourceError('source not found', 404);

  invalidateRegistryCache(source.url);
  const result = await fetchRegistryByUrl(source.url);
  if (!result.index) {
    return { ...source, fetchError: result.error ?? 'fetch failed' };
  }
  const updated = updateMarketplaceSourceRefresh(id, {
    catalogVersion: catalogVersionOf(result),
    pluginCount: result.index.plugins.length,
  });
  return { ...(updated ?? source), fromCache: result.fromCache };
}

export function removeMarketplaceSource(id: string): boolean {
  return deleteMarketplaceSource(id);
}

export function getMarketplaceSources(): MarketplaceSource[] {
  return listMarketplaceSources();
}

/**
 * Ensure the official website catalog is registered as a default `official`
 * source. Env-overridable via `NEUMA_OFFICIAL_MARKETPLACE_URL`; when unset,
 * nothing is seeded (the site is not yet deployed to a stable URL, so we don't
 * hardcode a dead one). Idempotent — safe to call on every boot.
 */
export function ensureDefaultMarketplaceSource(): void {
  const url = process.env.NEUMA_OFFICIAL_MARKETPLACE_URL?.trim();
  if (!url) return;
  if (!validateBaseUrl(url).valid) return;
  if (getMarketplaceSourceByUrl(url)) return;
  try {
    insertMarketplaceSource({
      id: 'neuma-official',
      name: 'neuma-official',
      url,
      trust: 'official',
    });
  } catch {
    // A concurrent boot may have inserted it; ignore.
  }
}

/**
 * Merge every source's catalog into one Available list, tagging each entry
 * with its source id/name/trust. Partial failures are reported per source.
 */
export async function listAvailablePlugins(): Promise<{
  entries: AvailablePluginEntry[];
  sources: MarketplaceSourceStatus[];
}> {
  const sources = listMarketplaceSources();
  const results = await Promise.all(
    sources.map(async (source) => ({
      source,
      result: await fetchRegistryByUrl(source.url),
    })),
  );

  const entries: AvailablePluginEntry[] = [];
  const statuses: MarketplaceSourceStatus[] = [];
  for (const { source, result } of results) {
    statuses.push({
      ...source,
      fromCache: result.fromCache,
      ...(result.error ? { fetchError: result.error } : {}),
    });
    for (const entry of result.index?.plugins ?? []) {
      entries.push({
        sourceId: source.id,
        sourceName: source.name,
        sourceTrust: source.trust,
        sourceUrl: source.url,
        entry,
      });
    }
  }
  return { entries, sources: statuses };
}

/**
 * Resolve one catalog entry from a source — used to stamp provenance on
 * installs. Throws when the source or entry is unknown.
 */
export async function resolveCatalogEntry(
  sourceId: string,
  entryName: string,
): Promise<{ source: MarketplaceSource; entry: MarketplacePlugin }> {
  const source = getMarketplaceSource(sourceId);
  if (!source) throw new MarketplaceSourceError('source not found', 404);
  const result = await fetchRegistryByUrl(source.url);
  if (!result.index) {
    throw new MarketplaceSourceError(
      `catalog fetch failed: ${result.error ?? 'unknown error'}`,
      502,
    );
  }
  const entry = result.index.plugins.find((p) => p.name === entryName);
  if (!entry) {
    throw new MarketplaceSourceError(
      `entry '${entryName}' not found in source '${sourceId}'`,
      404,
    );
  }
  return { source, entry };
}

function catalogVersionOf(result: RegistryFetchResult): string | null {
  const metadata = result.index?.metadata;
  const version = metadata?.version;
  return typeof version === 'string' ? version : null;
}
