/**
 * Composio OAuth access-token cache (pure in-memory).
 *
 * Kept dependency-free so it can be imported by both the provider (for
 * invalidation on disconnect / API-key change) and the access-token
 * orchestrator without creating an import cycle.
 *
 * Cache key is the Composio `connected_account_id` since each
 * connector-id can theoretically have multiple connected accounts (per
 * scopeKey). The orchestrator resolves the account id from the provider
 * before consulting the cache.
 */

export interface CachedAccessToken {
  accessToken: string;
  /** Absolute epoch-ms when the token expires per Composio's response. */
  expiresAt: number;
}

/** Refresh tokens this many ms before they actually expire. */
export const REFRESH_MARGIN_MS = 60_000;
/** Default lifetime when Composio didn't return an expires_in. */
const DEFAULT_LIFETIME_MS = 30 * 60 * 1000;

const tokenCache = new Map<string, CachedAccessToken>();

function pruneExpired(now = Date.now()): void {
  for (const [key, entry] of tokenCache.entries()) {
    if (entry.expiresAt <= now) tokenCache.delete(key);
  }
}

export function getCachedAccessToken(
  connectedAccountId: string,
  now = Date.now(),
): string | null {
  const entry = tokenCache.get(connectedAccountId);
  if (!entry) return null;
  if (entry.expiresAt <= now + REFRESH_MARGIN_MS) {
    tokenCache.delete(connectedAccountId);
    return null;
  }
  return entry.accessToken;
}

export function setCachedAccessToken(
  connectedAccountId: string,
  accessToken: string,
  expiresIn: number | undefined,
  now = Date.now(),
): void {
  pruneExpired(now);
  const expiresAt =
    typeof expiresIn === 'number' && Number.isFinite(expiresIn)
      ? now + expiresIn * 1000
      : now + DEFAULT_LIFETIME_MS;
  tokenCache.set(connectedAccountId, { accessToken, expiresAt });
}

/**
 * Invalidate cached tokens. Pass a connected-account id to clear that one
 * entry, or no argument to wipe the entire cache (used on API-key change
 * / provider reset, where every token is invalid).
 */
export function clearCachedAccessToken(connectedAccountId?: string): void {
  if (!connectedAccountId) {
    tokenCache.clear();
    return;
  }
  tokenCache.delete(connectedAccountId);
}

export function __resetCredentialCacheForTests(): void {
  tokenCache.clear();
}
