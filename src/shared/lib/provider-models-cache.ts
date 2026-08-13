export interface ProviderModelsCacheProvider {
  id: string;
  apiKey?: string;
  baseUrl?: string;
  agentType?: string;
  dialect?: string;
}

export interface CachedProviderModel {
  id: string;
  name?: string;
  displayLabel?: string;
}

export interface ProviderModelsCacheEntry {
  models: CachedProviderModel[];
  fetchedAt: number;
  latencyMs?: number;
  upstreamStatus?: number | null;
}

export const PROVIDER_MODELS_CACHE_TTL_MS = 30_000;

const providerModelsCache = new Map<string, ProviderModelsCacheEntry>();
const listeners = new Set<() => void>();
let cacheVersion = 0;

export function getProviderModelsCacheKey(
  provider: ProviderModelsCacheProvider,
) {
  const baseUrl = provider.baseUrl?.trim() ?? '';
  const authFingerprint = provider.apiKey
    ? hashCacheKeyPart(provider.apiKey)
    : '';
  return [
    provider.id,
    provider.agentType ?? '',
    provider.dialect ?? '',
    hashCacheKeyPart(baseUrl),
    authFingerprint,
  ].join(':');
}

export function readProviderModelsCache(
  provider: ProviderModelsCacheProvider,
  now = Date.now(),
) {
  const entry = providerModelsCache.get(getProviderModelsCacheKey(provider));
  if (!entry) return null;
  if (now - entry.fetchedAt > PROVIDER_MODELS_CACHE_TTL_MS) return null;
  return {
    ...entry,
    models: entry.models.map((model) => ({ ...model })),
  };
}

export function writeProviderModelsCache(
  provider: ProviderModelsCacheProvider,
  entry: Omit<ProviderModelsCacheEntry, 'fetchedAt'>,
  now = Date.now(),
) {
  providerModelsCache.set(getProviderModelsCacheKey(provider), {
    ...entry,
    fetchedAt: now,
    models: entry.models.map((model) => ({ ...model })),
  });
  emitProviderModelsCacheChange();
}

export function clearProviderModelsCache() {
  providerModelsCache.clear();
  emitProviderModelsCacheChange();
}

export function getProviderModelsCacheVersion() {
  return cacheVersion;
}

export function subscribeProviderModelsCache(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitProviderModelsCacheChange() {
  cacheVersion += 1;
  for (const listener of listeners) listener();
}

function hashCacheKeyPart(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
