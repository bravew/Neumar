/**
 * Marketplace registry index — fetches and caches `marketplace.json` files
 * from a configurable list of registry URLs. Wire-compatible with Anthropic's
 * spec (`anthropics/claude-plugins-official/.claude-plugin/marketplace.json`)
 * so the same JSON drives the desktop UI and the upstream `claude` CLI.
 *
 * Configuration:
 *   - Settings key `pluginMarketplaceUrls`: JSON array of HTTPS URLs.
 *     Defaults to the Anthropic-official registry below.
 *   - Each URL is SSRF-validated before fetch.
 *   - Successful fetches are cached for {@link CACHE_TTL_MS} in memory and
 *     mirrored to `~/.<slug>/marketplace/<digest>.json` so the UI works
 *     offline after first warm-up.
 */

import fs from 'fs/promises';
import { join } from 'path';

import { getAppDir } from '@/config/constants';

import { listMarketplaceSources } from '@/shared/db/marketplace-sources';
import { NetworkPolicyDenied, safeFetch } from '@/shared/network-policy/fetch';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';
import { shortSha256 } from '@/shared/utils/hash';
import { createLogger } from '@/shared/utils/logger';

import {
  adaptOpenDesignMarketplace,
  isOpenDesignMarketplace,
} from './adapters/open-design';
import { formatZodIssues } from './manifest';
import {
  MarketplaceSchema,
  type Marketplace,
  type MarketplacePlugin,
} from './marketplace-schema';

const logger = createLogger('Marketplace');

/** Default registry — Anthropic's curated list. Users may add more. */
export const DEFAULT_MARKETPLACE_URL =
  'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json';

/** 15 min keeps the UI responsive while letting marketplace authors push
 *  updates that appear within an hour. */
const CACHE_TTL_MS = 15 * 60 * 1000;

const FETCH_TIMEOUT_MS = 10_000;

/** Anthropic wire format (marketplace-schema.ts) — one schema everywhere. */
export const MarketplaceIndexSchema = MarketplaceSchema;

export type MarketplaceIndex = Marketplace;
export type { MarketplacePlugin };

export interface RegistryFetchResult {
  url: string;
  index?: MarketplaceIndex;
  fromCache: boolean;
  fetchedAt: string;
  error?: string;
}

interface CacheEntry {
  fetchedAt: number;
  index: MarketplaceIndex;
}

const memCache = new Map<string, CacheEntry>();
/** Dedup concurrent cache-misses so two callers don't both hit the network. */
const inflight = new Map<string, Promise<RegistryFetchResult>>();

function cacheDir(): string {
  return join(getAppDir(), 'marketplace');
}

function cachePath(url: string): string {
  return join(cacheDir(), `${shortSha256(url)}.json`);
}

/**
 * Registry URLs come from the `marketplace_sources` table (migration 045).
 * Falls back to the Anthropic default when the table is unavailable (e.g.
 * fixture databases created before the migration).
 */
export function getConfiguredRegistries(): string[] {
  try {
    const sources = listMarketplaceSources();
    if (sources.length > 0) return sources.map((source) => source.url);
  } catch (err) {
    logger.warn(
      `marketplace_sources unavailable; falling back to default registry: ${(err as Error).message}`,
    );
  }
  return [DEFAULT_MARKETPLACE_URL];
}

async function readDiskCache(url: string): Promise<CacheEntry | null> {
  const path = cachePath(url);
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    const wire = JSON.parse(raw) as { fetchedAt?: unknown; index?: unknown };
    if (typeof wire?.fetchedAt !== 'number') return null;
    const parsed = MarketplaceIndexSchema.safeParse(wire.index);
    if (!parsed.success) return null;
    return { fetchedAt: wire.fetchedAt, index: parsed.data };
  } catch {
    return null;
  }
}

async function writeDiskCache(url: string, entry: CacheEntry): Promise<void> {
  await fs.mkdir(cacheDir(), { recursive: true });
  const finalPath = cachePath(url);
  // Atomic: write to .tmp then rename so a crash mid-write can't corrupt
  // the cache file (which would silently drift the index for 15 min).
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  await fs.writeFile(
    tmpPath,
    JSON.stringify({ fetchedAt: entry.fetchedAt, index: entry.index }),
    'utf-8',
  );
  await fs.rename(tmpPath, finalPath);
}

async function performFetch(url: string): Promise<RegistryFetchResult> {
  const fetchedAtIso = (t: number) => new Date(t).toISOString();
  const fail = (error: string, fromCache = false): RegistryFetchResult => ({
    url,
    fromCache,
    fetchedAt: new Date().toISOString(),
    error,
  });

  const cached = memCache.get(url);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      url,
      index: cached.index,
      fromCache: true,
      fetchedAt: fetchedAtIso(cached.fetchedAt),
    };
  }

  let body: unknown;
  try {
    // Phase 7: marketplace registry is the canonical untrusted-network case.
    // safeFetch validates per-hop (DNS rebinding + redirect smuggling) and
    // pins the resolved IP for connect — fetch()'s automatic redirect handling
    // bypasses both.
    const res = await safeFetch(url, trustedLocalPolicy(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) {
      return fail(`HTTP ${res.status}`);
    }
    try {
      body = JSON.parse(res.body.toString('utf8'));
    } catch (err) {
      return fail(`invalid JSON: ${(err as Error).message}`);
    }
  } catch (err) {
    if (err instanceof NetworkPolicyDenied) {
      return fail(`URL rejected by SSRF policy: ${err.reason}`);
    }
    const disk = await readDiskCache(url);
    if (disk) {
      memCache.set(url, disk);
      return {
        url,
        index: disk.index,
        fromCache: true,
        fetchedAt: fetchedAtIso(disk.fetchedAt),
        error: `live fetch failed (${(err as Error).message}); served stale cache`,
      };
    }
    return fail((err as Error).message);
  }

  // Normalize an Open Design catalog into the Neuma wire format before
  // validation so users can add Open Design marketplaces as sources.
  if (isOpenDesignMarketplace(body)) {
    body = adaptOpenDesignMarketplace(body as Record<string, unknown>);
  }

  const parsed = MarketplaceIndexSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      `invalid marketplace.json: ${formatZodIssues(parsed.error).join('; ')}`,
    );
  }

  const entry: CacheEntry = { fetchedAt: now, index: parsed.data };
  memCache.set(url, entry);
  void writeDiskCache(url, entry).catch((err) =>
    logger.warn(`Failed to write marketplace cache: ${(err as Error).message}`),
  );
  return {
    url,
    index: parsed.data,
    fromCache: false,
    fetchedAt: fetchedAtIso(now),
  };
}

/** Fetch (or serve from cache) a single registry by URL. */
export async function fetchRegistryByUrl(
  url: string,
): Promise<RegistryFetchResult> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const promise = performFetch(url).finally(() => inflight.delete(url));
  inflight.set(url, promise);
  return promise;
}

/**
 * Fetch every configured registry in parallel. Returns one result per URL —
 * partial failures are reported in the `error` field, never thrown, so the
 * UI can render whatever did load.
 */
export async function fetchAllRegistries(): Promise<RegistryFetchResult[]> {
  const urls = getConfiguredRegistries();
  return Promise.all(urls.map(fetchRegistryByUrl));
}

/** Drop a URL's cached catalog so the next fetch hits the network. */
export function invalidateRegistryCache(url: string): void {
  memCache.delete(url);
}

export function _resetMarketplaceCache(): void {
  memCache.clear();
  inflight.clear();
}
